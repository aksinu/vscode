/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { IChannel } from '../../../../base/parts/ipc/common/ipc.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IClaudeService } from '../common/claude.js';
import { IClaudeMessage, IClaudeSendRequestOptions, ClaudeServiceState, IClaudeSession, IClaudeToolAction, IClaudeAskUserRequest, IClaudeAskUserQuestion, IClaudeQueuedMessage } from '../common/claudeTypes.js';
import { IMainProcessService } from '../../../../platform/ipc/common/mainProcessService.js';
import { IClaudeCLIStreamEvent, IClaudeCLIRequestOptions, IClaudeRateLimitInfo } from '../common/claudeCLI.js';
import { CLAUDE_CLI_CHANNEL_NAME } from '../common/claudeCLIChannel.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { URI } from '../../../../base/common/uri.js';
import { IClaudeLocalConfig, DEFAULT_LOCAL_CONFIG } from '../common/claudeLocalConfig.js';

export class ClaudeService extends Disposable implements IClaudeService {
	declare readonly _serviceBrand: undefined;

	private _state: ClaudeServiceState = 'idle';
	private _currentSession: IClaudeSession | undefined;
	private _sessions: IClaudeSession[] = [];
	private _currentMessageId: string | undefined;
	private _accumulatedContent: string = '';
	private _toolActions: IClaudeToolAction[] = [];
	private _currentToolAction: IClaudeToolAction | undefined;
	private _currentAskUserRequest: IClaudeAskUserRequest | undefined;
	private _isWaitingForUser = false;
	private _cliSessionId: string | undefined; // Claude CLI 세션 ID (--resume 용)
	private _localConfig: IClaudeLocalConfig = DEFAULT_LOCAL_CONFIG;
	private _messageQueue: IClaudeQueuedMessage[] = [];
	private _isProcessingQueue = false;

	// Rate limit 재시도 관련
	private _rateLimitInfo: IClaudeRateLimitInfo | undefined;
	private _retryTimer: ReturnType<typeof setTimeout> | undefined;
	private _retryCountdown = 0;
	private _pendingRetryRequest: { prompt: string; options?: IClaudeCLIRequestOptions } | undefined;
	private _retryCountdownInterval: ReturnType<typeof setInterval> | undefined;

	private readonly channel: IChannel;

	private readonly _onDidReceiveMessage = this._register(new Emitter<IClaudeMessage>());
	readonly onDidReceiveMessage: Event<IClaudeMessage> = this._onDidReceiveMessage.event;

	private readonly _onDidUpdateMessage = this._register(new Emitter<IClaudeMessage>());
	readonly onDidUpdateMessage: Event<IClaudeMessage> = this._onDidUpdateMessage.event;

	private readonly _onDidChangeState = this._register(new Emitter<ClaudeServiceState>());
	readonly onDidChangeState: Event<ClaudeServiceState> = this._onDidChangeState.event;

	private readonly _onDidChangeSession = this._register(new Emitter<IClaudeSession | undefined>());
	readonly onDidChangeSession: Event<IClaudeSession | undefined> = this._onDidChangeSession.event;

	private readonly _onDidChangeQueue = this._register(new Emitter<IClaudeQueuedMessage[]>());
	readonly onDidChangeQueue: Event<IClaudeQueuedMessage[]> = this._onDidChangeQueue.event;

	private readonly _onDidChangeRateLimitStatus = this._register(new Emitter<{ waiting: boolean; countdown: number; message?: string }>());
	readonly onDidChangeRateLimitStatus: Event<{ waiting: boolean; countdown: number; message?: string }> = this._onDidChangeRateLimitStatus.event;

	private static readonly STORAGE_KEY = 'claude.sessions';

	constructor(
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IMainProcessService mainProcessService: IMainProcessService,
		@IStorageService private readonly storageService: IStorageService,
		@IFileService private readonly fileService: IFileService,
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService
	) {
		super();

		// Main Process의 Claude CLI 채널에 연결
		this.channel = mainProcessService.getChannel(CLAUDE_CLI_CHANNEL_NAME);
		console.log('[ClaudeService] Channel obtained:', CLAUDE_CLI_CHANNEL_NAME);

		// 로컬 설정 로드 (비동기)
		this.loadLocalConfig();

		// CLI 이벤트 구독
		this._register(this.channel.listen<IClaudeCLIStreamEvent>('onDidReceiveData')(event => {
			console.log('[ClaudeService] Received CLI data:', event.type, event);
			this.handleCLIData(event);
		}));
		this._register(this.channel.listen<void>('onDidComplete')(() => {
			console.log('[ClaudeService] CLI complete');
			this.handleCLIComplete();
		}));
		this._register(this.channel.listen<string>('onDidError')(error => {
			console.log('[ClaudeService] CLI error:', error);
			this.handleCLIError(error);
		}));

		// 저장된 세션 로드
		this.loadSessions();

		// 현재 세션이 없으면 새로 생성
		if (!this._currentSession) {
			this.startNewSession();
		}
	}

	// ========== Storage ==========

	private loadSessions(): void {
		try {
			const data = this.storageService.get(ClaudeService.STORAGE_KEY, StorageScope.WORKSPACE);
			if (data) {
				const parsed = JSON.parse(data) as { sessions: IClaudeSession[]; currentSessionId?: string };
				this._sessions = parsed.sessions || [];
				if (parsed.currentSessionId) {
					this._currentSession = this._sessions.find(s => s.id === parsed.currentSessionId);
				}
				if (!this._currentSession && this._sessions.length > 0) {
					this._currentSession = this._sessions[this._sessions.length - 1];
				}

				// 이전 메시지 개수 기록 (구분선 표시용)
				if (this._currentSession && this._currentSession.messages.length > 0) {
					(this._currentSession as { previousMessageCount?: number }).previousMessageCount = this._currentSession.messages.length;
					console.log('[ClaudeService] Previous message count:', this._currentSession.previousMessageCount);
				}

				console.log('[ClaudeService] Loaded sessions:', this._sessions.length);
			}
		} catch (e) {
			console.error('[ClaudeService] Failed to load sessions:', e);
		}
	}

	private saveSessions(): void {
		try {
			const data = JSON.stringify({
				sessions: this._sessions,
				currentSessionId: this._currentSession?.id
			});
			this.storageService.store(ClaudeService.STORAGE_KEY, data, StorageScope.WORKSPACE, StorageTarget.MACHINE);
		} catch (e) {
			console.error('[ClaudeService] Failed to save sessions:', e);
		}
	}

	// ========== Local Config ==========

	private async loadLocalConfig(): Promise<void> {
		try {
			const workspaceFolder = this.workspaceContextService.getWorkspace().folders[0];
			if (!workspaceFolder) {
				console.log('[ClaudeService] No workspace folder, using default config');
				return;
			}

			const configUri = URI.joinPath(workspaceFolder.uri, '.vscode', 'claude.local.json');
			console.log('[ClaudeService] Looking for local config at:', configUri.fsPath);

			try {
				const content = await this.fileService.readFile(configUri);
				const configData = JSON.parse(content.value.toString()) as IClaudeLocalConfig;
				this._localConfig = { ...DEFAULT_LOCAL_CONFIG, ...configData };
				console.log('[ClaudeService] Local config loaded:', this._localConfig);
			} catch {
				// 파일이 없으면 기본값 사용
				console.log('[ClaudeService] No local config file, using defaults');
			}
		} catch (e) {
			console.error('[ClaudeService] Failed to load local config:', e);
		}
	}

	/**
	 * 로컬 설정 가져오기
	 */
	getLocalConfig(): IClaudeLocalConfig {
		return this._localConfig;
	}

	/**
	 * 로컬 설정 다시 로드 (UI에서 설정 변경 후 호출)
	 */
	async reloadLocalConfig(): Promise<void> {
		await this.loadLocalConfig();
	}

	/**
	 * 워크스페이스 루트 경로 가져오기
	 */
	private getWorkspaceRoot(): string | undefined {
		const workspaceFolder = this.workspaceContextService.getWorkspace().folders[0];
		return workspaceFolder?.uri.fsPath;
	}

	// ========== CLI Event Handlers ==========

	private handleCLIData(event: IClaudeCLIStreamEvent): void {
		console.log('[ClaudeService] handleCLIData:', event.type, event.subtype || '');

		// Rate limit 에러 처리
		if (event.type === 'error' && event.error_type === 'rate_limit') {
			console.log('[ClaudeService] Rate limit detected! Retry after:', event.retry_after, 'seconds');
			this.handleRateLimitError(event.retry_after || 60, event.content);
			return;
		}

		// system 이벤트 처리 (초기화)
		if (event.type === 'system') {
			console.log('[ClaudeService] System event - Claude initializing...');
			// 세션 ID 저장 (--resume 용)
			const systemEvent = event as { session_id?: string };
			if (systemEvent.session_id) {
				this._cliSessionId = systemEvent.session_id;
				console.log('[ClaudeService] CLI session ID:', this._cliSessionId);
			}
			// 초기화 상태를 UI에 표시하기 위해 상태 업데이트
			if (this._currentMessageId && this._currentSession) {
				this._accumulatedContent = '';
				this.updateCurrentMessage();
			}
			return;
		}

		// input_request 이벤트 처리 (AskUser - CLI 직접 형식)
		if (event.type === 'input_request' && event.questions) {
			this.handleInputRequest(event);
			return;
		}

		if (!this._currentMessageId || !this._currentSession) {
			return;
		}

		// 도구 사용 이벤트 처리
		if (event.type === 'tool_use') {
			this.handleToolUse(event);
			return;
		}

		// 도구 결과 이벤트 처리
		if (event.type === 'tool_result') {
			this.handleToolResult(event);
			return;
		}

		// 텍스트 컨텐츠 추출
		let text = '';

		if (event.type === 'assistant' && event.message) {
			// CLI의 assistant 타입: message.content 배열에서 텍스트 추출
			if (typeof event.message === 'object' && event.message.content) {
				for (const block of event.message.content) {
					if (block.type === 'text' && block.text) {
						text += block.text;
					} else if (block.type === 'tool_use' && block.name) {
						// assistant 메시지 내의 tool_use 블록
						this.handleToolUse({
							type: 'tool_use',
							tool_use_id: generateUuid(),
							tool_name: block.name,
							tool_input: block.input
						});
					}
				}
			} else if (typeof event.message === 'string') {
				text = event.message;
			}
		} else if (event.type === 'result' && event.result) {
			// result 타입: 최종 결과
			text = event.result;
		} else if (event.type === 'content_block_delta' && event.delta?.text) {
			text = event.delta.text;
		} else if (event.type === 'text' && event.content) {
			text = event.content;
		}

		if (text) {
			// 텍스트 누적 (CLI는 여러 text 이벤트로 응답을 스트리밍)
			if (this._accumulatedContent) {
				this._accumulatedContent += '\n' + text;
			} else {
				this._accumulatedContent = text;
			}

			this.updateCurrentMessage();
		}
	}

	private handleToolUse(event: IClaudeCLIStreamEvent): void {
		const toolName = event.tool_name || 'unknown';

		// AskUserQuestion 도구 처리
		if (toolName === 'AskUserQuestion') {
			this.handleAskUserQuestion(event);
			return;
		}

		const toolAction: IClaudeToolAction = {
			id: event.tool_use_id || generateUuid(),
			tool: toolName,
			status: 'running',
			input: event.tool_input
		};

		this._currentToolAction = toolAction;
		this._toolActions.push(toolAction);

		console.log('[ClaudeService] Tool use started:', toolAction.tool, toolAction.input);
		this.updateCurrentMessage();
	}

	private handleAskUserQuestion(event: IClaudeCLIStreamEvent): void {
		console.log('[ClaudeService] AskUserQuestion received:', event.tool_input);

		const input = event.tool_input as { questions?: Array<{ question: string; header?: string; options: Array<{ label: string; description?: string }>; multiSelect?: boolean }> } | undefined;

		if (!input?.questions) {
			console.error('[ClaudeService] AskUserQuestion missing questions');
			return;
		}

		const questions: IClaudeAskUserQuestion[] = input.questions.map(q => ({
			question: q.question,
			header: q.header,
			options: q.options.map(o => ({ label: o.label, description: o.description })),
			multiSelect: q.multiSelect
		}));

		// Auto Accept 모드: 첫 번째 옵션 자동 선택
		if (this._localConfig.autoAccept && questions.length > 0 && questions[0].options.length > 0) {
			const firstOption = questions[0].options[0].label;
			console.log('[ClaudeService] Auto-accept enabled, selecting:', firstOption);

			// 자동 선택 표시를 위해 잠깐 UI에 보여줌
			this._currentAskUserRequest = {
				id: event.tool_use_id || generateUuid(),
				questions,
				autoAccepted: true,
				autoAcceptedOption: firstOption
			} as IClaudeAskUserRequest & { autoAccepted?: boolean; autoAcceptedOption?: string };
			this.updateCurrentMessage();

			// 잠시 후 자동 응답
			setTimeout(() => {
				this.respondToAskUser([firstOption]);
			}, 500);
			return;
		}

		this._currentAskUserRequest = {
			id: event.tool_use_id || generateUuid(),
			questions
		};
		this._isWaitingForUser = true;

		console.log('[ClaudeService] Waiting for user response...');
		this.updateCurrentMessage();
	}

	private handleInputRequest(event: IClaudeCLIStreamEvent): void {
		console.log('[ClaudeService] InputRequest received:', event.questions);

		if (!event.questions || event.questions.length === 0) {
			console.error('[ClaudeService] InputRequest missing questions');
			return;
		}

		// 현재 메시지가 없으면 생성
		if (!this._currentMessageId) {
			this._currentMessageId = generateUuid();
			this._accumulatedContent = '';

			if (this._currentSession) {
				const assistantMessage: IClaudeMessage = {
					id: this._currentMessageId,
					role: 'assistant',
					content: '',
					timestamp: Date.now(),
					isStreaming: true
				};
				this._currentSession.messages.push(assistantMessage);
				this._onDidReceiveMessage.fire(assistantMessage);
			}
		}

		const questions: IClaudeAskUserQuestion[] = event.questions.map(q => ({
			question: q.question,
			header: q.header,
			options: q.options.map(o => ({ label: o.label, description: o.description })),
			multiSelect: q.multiSelect
		}));

		// Auto Accept 모드: 첫 번째 옵션 자동 선택
		if (this._localConfig.autoAccept && questions.length > 0 && questions[0].options.length > 0) {
			const firstOption = questions[0].options[0].label;
			console.log('[ClaudeService] Auto-accept enabled (input_request), selecting:', firstOption);

			this._currentAskUserRequest = {
				id: generateUuid(),
				questions,
				autoAccepted: true,
				autoAcceptedOption: firstOption
			} as IClaudeAskUserRequest & { autoAccepted?: boolean; autoAcceptedOption?: string };
			this.updateCurrentMessage();

			setTimeout(() => {
				this.respondToAskUser([firstOption]);
			}, 500);
			return;
		}

		this._currentAskUserRequest = {
			id: generateUuid(),
			questions
		};
		this._isWaitingForUser = true;

		console.log('[ClaudeService] Waiting for user response (input_request)...');
		this.updateCurrentMessage();
	}

	private handleToolResult(event: IClaudeCLIStreamEvent): void {
		if (this._currentToolAction) {
			// 현재 도구 액션 완료 처리
			const completedAction: IClaudeToolAction = {
				...this._currentToolAction,
				status: event.is_error ? 'error' : 'completed',
				output: event.tool_result,
				error: event.is_error ? event.tool_result : undefined
			};

			// _toolActions 배열에서 업데이트
			const idx = this._toolActions.findIndex(a => a.id === completedAction.id);
			if (idx !== -1) {
				this._toolActions[idx] = completedAction;
			}

			this._currentToolAction = undefined;
			console.log('[ClaudeService] Tool use completed:', completedAction.tool);
			this.updateCurrentMessage();
		}
	}

	private updateCurrentMessage(): void {
		if (!this._currentMessageId || !this._currentSession) {
			return;
		}

		// 메시지 업데이트
		const updatedMessage: IClaudeMessage = {
			id: this._currentMessageId,
			role: 'assistant',
			content: this._accumulatedContent,
			timestamp: Date.now(),
			isStreaming: !this._isWaitingForUser,
			toolActions: [...this._toolActions],
			currentToolAction: this._currentToolAction,
			askUserRequest: this._currentAskUserRequest,
			isWaitingForUser: this._isWaitingForUser
		};

		// 세션의 메시지 업데이트
		const msgIndex = this._currentSession.messages.findIndex(m => m.id === this._currentMessageId);
		if (msgIndex !== -1) {
			(this._currentSession.messages as IClaudeMessage[])[msgIndex] = updatedMessage;
		}

		this._onDidUpdateMessage.fire(updatedMessage);
	}

	/**
	 * AskUser 질문에 응답
	 */
	async respondToAskUser(responses: string[]): Promise<void> {
		if (!this._isWaitingForUser || !this._currentAskUserRequest) {
			console.error('[ClaudeService] Not waiting for user input');
			return;
		}

		console.log('[ClaudeService] User responded:', responses);
		console.log('[ClaudeService] CLI session ID for resume:', this._cliSessionId);

		// 상태 리셋
		this._isWaitingForUser = false;
		this._currentAskUserRequest = undefined;

		// 응답 텍스트
		const responseText = responses.join(', ');

		if (this._cliSessionId) {
			// --resume 옵션으로 세션 재개
			console.log('[ClaudeService] Resuming session with response:', responseText);

			// 메시지 업데이트 (스트리밍 상태로)
			this.updateCurrentMessage();
			this.setState('streaming');

			try {
				const cliOptions: IClaudeCLIRequestOptions = {
					resumeSessionId: this._cliSessionId
				};

				await this.channel.call('sendPrompt', [responseText, cliOptions]);
			} catch (error) {
				console.error('[ClaudeService] Resume failed:', error);
			}
		} else {
			// 세션 ID가 없으면 일반 메시지로 전송
			console.log('[ClaudeService] No session ID, sending as new message');
			this.updateCurrentMessage();
		}
	}

	private handleCLIComplete(): void {
		if (!this._currentMessageId || !this._currentSession) {
			return;
		}

		// AskUser 대기 중이면 상태 유지
		if (this._isWaitingForUser && this._currentAskUserRequest) {
			console.log('[ClaudeService] CLI completed but waiting for user response');
			// 메시지 업데이트 (AskUser 상태 유지)
			const waitingMessage: IClaudeMessage = {
				id: this._currentMessageId,
				role: 'assistant',
				content: this._accumulatedContent,
				timestamp: Date.now(),
				isStreaming: false,
				toolActions: [...this._toolActions],
				askUserRequest: this._currentAskUserRequest,
				isWaitingForUser: true
			};

			const msgIndex = this._currentSession.messages.findIndex(m => m.id === this._currentMessageId);
			if (msgIndex !== -1) {
				(this._currentSession.messages as IClaudeMessage[])[msgIndex] = waitingMessage;
			}

			this._onDidUpdateMessage.fire(waitingMessage);
			this.setState('idle');
			this.saveSessions();
			// _currentMessageId는 유지 (응답 후 업데이트 필요)
			return;
		}

		// 최종 메시지
		const finalMessage: IClaudeMessage = {
			id: this._currentMessageId,
			role: 'assistant',
			content: this._accumulatedContent,
			timestamp: Date.now(),
			isStreaming: false,
			toolActions: [...this._toolActions]
		};

		// 세션의 메시지 업데이트
		const msgIndex = this._currentSession.messages.findIndex(m => m.id === this._currentMessageId);
		if (msgIndex !== -1) {
			(this._currentSession.messages as IClaudeMessage[])[msgIndex] = finalMessage;
		}

		this._onDidUpdateMessage.fire(finalMessage);
		this.setState('idle');

		// 세션 저장
		this.saveSessions();

		this._currentMessageId = undefined;
		this._accumulatedContent = '';
		this._toolActions = [];
		this._currentToolAction = undefined;
		this._cliSessionId = undefined;

		// 큐에 대기 중인 메시지 처리
		this.processQueue();
	}

	private async processQueue(): Promise<void> {
		if (this._isProcessingQueue || this._messageQueue.length === 0) {
			return;
		}

		// AskUser 대기 중이면 큐 처리 안 함
		if (this._isWaitingForUser) {
			console.log('[ClaudeService] Waiting for user, queue processing paused');
			return;
		}

		this._isProcessingQueue = true;

		try {
			const nextMessage = this._messageQueue.shift();
			if (nextMessage) {
				this._onDidChangeQueue.fire([...this._messageQueue]);
				console.log('[ClaudeService] Processing queued message:', nextMessage.content.substring(0, 50));

				await this.sendMessageInternal(nextMessage.content, { context: nextMessage.context });
			}
		} finally {
			this._isProcessingQueue = false;
		}
	}

	private handleCLIError(error: string): void {
		console.log('[ClaudeService] handleCLIError:', error);

		// Rate limit 에러인지 확인 (stderr에서 못 잡은 경우)
		if (this.isRateLimitError(error)) {
			console.log('[ClaudeService] Rate limit detected in error message');
			const retrySeconds = this.parseRetrySeconds(error) || 60;
			this.handleRateLimitError(retrySeconds, error);
			return;
		}

		if (!this._currentSession) {
			return;
		}

		const errorMessage: IClaudeMessage = {
			id: this._currentMessageId || generateUuid(),
			role: 'assistant',
			content: `Error: ${error}`,
			timestamp: Date.now(),
			isError: true
		};

		// 기존 스트리밍 메시지가 있으면 업데이트, 없으면 추가
		if (this._currentMessageId) {
			const msgIndex = this._currentSession.messages.findIndex(m => m.id === this._currentMessageId);
			if (msgIndex !== -1) {
				(this._currentSession.messages as IClaudeMessage[])[msgIndex] = errorMessage;
				this._onDidUpdateMessage.fire(errorMessage);
			}
		} else {
			this._currentSession.messages.push(errorMessage);
			this._onDidReceiveMessage.fire(errorMessage);
		}

		this.setState('error');
		this._currentMessageId = undefined;
		this._accumulatedContent = '';
	}

	// ========== Rate Limit Handling ==========

	private isRateLimitError(error: string): boolean {
		return /rate[_\s]?limit/i.test(error) ||
			/too many requests/i.test(error) ||
			/429/i.test(error) ||
			/quota exceeded/i.test(error) ||
			/token.*exhaust/i.test(error);
	}

	private parseRetrySeconds(error: string): number | null {
		const match = error.match(/(?:retry|try again|wait).*?(\d+)\s*(second|minute|hour|sec|min|hr)/i);
		if (match) {
			const value = parseInt(match[1], 10);
			const unit = match[2].toLowerCase();
			if (unit.startsWith('min')) {
				return value * 60;
			} else if (unit.startsWith('hour') || unit.startsWith('hr')) {
				return value * 3600;
			}
			return value;
		}
		return null;
	}

	private handleRateLimitError(retryAfterSeconds: number, message?: string): void {
		console.log('[ClaudeService][RateLimit] Starting retry timer:', retryAfterSeconds, 'seconds');
		console.log('[ClaudeService][RateLimit] Message:', message);

		// 현재 진행 중인 요청 정보 저장
		if (this._currentMessageId && this._currentSession) {
			// 마지막 사용자 메시지 찾기
			const messages = this._currentSession.messages;
			let lastUserMessage: IClaudeMessage | undefined;
			for (let i = messages.length - 1; i >= 0; i--) {
				if (messages[i].role === 'user') {
					lastUserMessage = messages[i];
					break;
				}
			}

			if (lastUserMessage) {
				console.log('[ClaudeService][RateLimit] Saving pending request for retry');
				this._pendingRetryRequest = {
					prompt: lastUserMessage.content,
					options: {
						model: this.configurationService.getValue<string>('claude.model'),
						systemPrompt: this.configurationService.getValue<string>('claude.systemPrompt'),
						workingDir: this.getWorkspaceRoot(),
						executable: this._localConfig.executable
					}
				};
			}

			// 현재 메시지를 대기 상태로 업데이트
			const waitingMessage: IClaudeMessage = {
				id: this._currentMessageId,
				role: 'assistant',
				content: `⏳ Rate limit reached. Waiting ${this.formatWaitTime(retryAfterSeconds)} before retrying...\n\n${message || ''}`,
				timestamp: Date.now(),
				isStreaming: true
			};

			const msgIndex = this._currentSession.messages.findIndex(m => m.id === this._currentMessageId);
			if (msgIndex !== -1) {
				(this._currentSession.messages as IClaudeMessage[])[msgIndex] = waitingMessage;
				this._onDidUpdateMessage.fire(waitingMessage);
			}
		}

		// 카운트다운 시작
		this._retryCountdown = retryAfterSeconds;
		this._rateLimitInfo = {
			isRateLimited: true,
			retryAfterSeconds,
			message
		};

		this._onDidChangeRateLimitStatus.fire({
			waiting: true,
			countdown: this._retryCountdown,
			message
		});

		// 기존 타이머 정리
		if (this._retryTimer) {
			clearTimeout(this._retryTimer);
		}
		if (this._retryCountdownInterval) {
			clearInterval(this._retryCountdownInterval);
		}

		// 카운트다운 인터벌 (1초마다)
		this._retryCountdownInterval = setInterval(() => {
			this._retryCountdown--;
			console.log('[ClaudeService][RateLimit] Countdown:', this._retryCountdown);

			// 메시지 업데이트
			if (this._currentMessageId && this._currentSession) {
				const countdownMessage: IClaudeMessage = {
					id: this._currentMessageId,
					role: 'assistant',
					content: `⏳ Rate limit reached. Retrying in ${this.formatWaitTime(this._retryCountdown)}...\n\n${message || ''}`,
					timestamp: Date.now(),
					isStreaming: true
				};

				const msgIndex = this._currentSession.messages.findIndex(m => m.id === this._currentMessageId);
				if (msgIndex !== -1) {
					(this._currentSession.messages as IClaudeMessage[])[msgIndex] = countdownMessage;
					this._onDidUpdateMessage.fire(countdownMessage);
				}
			}

			this._onDidChangeRateLimitStatus.fire({
				waiting: true,
				countdown: this._retryCountdown,
				message
			});

			if (this._retryCountdown <= 0) {
				if (this._retryCountdownInterval) {
					clearInterval(this._retryCountdownInterval);
					this._retryCountdownInterval = undefined;
				}
			}
		}, 1000);

		// 재시도 타이머
		this._retryTimer = setTimeout(() => {
			console.log('[ClaudeService][RateLimit] Timer expired, attempting retry...');
			this.retryAfterRateLimit();
		}, retryAfterSeconds * 1000);
	}

	private formatWaitTime(seconds: number): string {
		if (seconds < 60) {
			return `${seconds} seconds`;
		} else if (seconds < 3600) {
			const mins = Math.floor(seconds / 60);
			const secs = seconds % 60;
			return secs > 0 ? `${mins}m ${secs}s` : `${mins} minutes`;
		} else {
			const hours = Math.floor(seconds / 3600);
			const mins = Math.floor((seconds % 3600) / 60);
			return mins > 0 ? `${hours}h ${mins}m` : `${hours} hours`;
		}
	}

	private async retryAfterRateLimit(): Promise<void> {
		console.log('[ClaudeService][RateLimit] Retrying...');

		// 타이머 정리
		this._rateLimitInfo = undefined;
		if (this._retryCountdownInterval) {
			clearInterval(this._retryCountdownInterval);
			this._retryCountdownInterval = undefined;
		}

		this._onDidChangeRateLimitStatus.fire({
			waiting: false,
			countdown: 0
		});

		if (!this._pendingRetryRequest) {
			console.log('[ClaudeService][RateLimit] No pending request to retry');
			this.setState('idle');
			return;
		}

		const { prompt, options } = this._pendingRetryRequest;
		this._pendingRetryRequest = undefined;

		console.log('[ClaudeService][RateLimit] Retrying prompt:', prompt.substring(0, 100));

		// 메시지 업데이트 (재시도 중)
		if (this._currentMessageId && this._currentSession) {
			const retryingMessage: IClaudeMessage = {
				id: this._currentMessageId,
				role: 'assistant',
				content: '🔄 Retrying request...',
				timestamp: Date.now(),
				isStreaming: true
			};

			const msgIndex = this._currentSession.messages.findIndex(m => m.id === this._currentMessageId);
			if (msgIndex !== -1) {
				(this._currentSession.messages as IClaudeMessage[])[msgIndex] = retryingMessage;
				this._onDidUpdateMessage.fire(retryingMessage);
			}
		}

		// 상태 초기화
		this._accumulatedContent = '';
		this._toolActions = [];
		this._currentToolAction = undefined;

		try {
			await this.channel.call('sendPrompt', [prompt, options]);
			console.log('[ClaudeService][RateLimit] Retry successful');
		} catch (error) {
			console.error('[ClaudeService][RateLimit] Retry failed:', error);
		}
	}

	/**
	 * Rate limit 대기 취소
	 */
	cancelRateLimitWait(): void {
		console.log('[ClaudeService][RateLimit] Cancelling wait');

		if (this._retryTimer) {
			clearTimeout(this._retryTimer);
			this._retryTimer = undefined;
		}
		if (this._retryCountdownInterval) {
			clearInterval(this._retryCountdownInterval);
			this._retryCountdownInterval = undefined;
		}

		this._rateLimitInfo = undefined;
		this._pendingRetryRequest = undefined;
		this._retryCountdown = 0;

		this._onDidChangeRateLimitStatus.fire({
			waiting: false,
			countdown: 0
		});

		this.setState('idle');
	}

	/**
	 * Rate limit 상태 조회
	 */
	getRateLimitStatus(): { waiting: boolean; countdown: number; message?: string } {
		return {
			waiting: !!this._rateLimitInfo,
			countdown: this._retryCountdown,
			message: this._rateLimitInfo?.message
		};
	}

	// ========== State ==========

	getState(): ClaudeServiceState {
		return this._state;
	}

	private setState(state: ClaudeServiceState): void {
		if (this._state !== state) {
			this._state = state;
			this._onDidChangeState.fire(state);
		}
	}

	getCurrentSession(): IClaudeSession | undefined {
		return this._currentSession;
	}

	// ========== Chat ==========

	async sendMessage(content: string, options?: IClaudeSendRequestOptions): Promise<IClaudeMessage> {
		// busy 상태면 큐에 추가
		if (this._state !== 'idle' || this._isWaitingForUser) {
			return this.addToQueue(content, options);
		}

		return this.sendMessageInternal(content, options);
	}

	private addToQueue(content: string, options?: IClaudeSendRequestOptions): IClaudeMessage {
		const queuedMessage: IClaudeQueuedMessage = {
			id: generateUuid(),
			content,
			context: options?.context,
			timestamp: Date.now()
		};

		this._messageQueue.push(queuedMessage);
		this._onDidChangeQueue.fire([...this._messageQueue]);

		console.log('[ClaudeService] Message queued:', content.substring(0, 50), 'Queue size:', this._messageQueue.length);

		// 큐에 추가된 메시지를 나타내는 임시 메시지 반환
		return {
			id: queuedMessage.id,
			role: 'user',
			content,
			timestamp: queuedMessage.timestamp,
			context: options?.context
		};
	}

	private async sendMessageInternal(content: string, options?: IClaudeSendRequestOptions): Promise<IClaudeMessage> {
		if (!this._currentSession) {
			this.startNewSession();
		}

		// 사용자 메시지 추가
		const userMessage: IClaudeMessage = {
			id: generateUuid(),
			role: 'user',
			content,
			timestamp: Date.now(),
			context: options?.context
		};

		this._currentSession!.messages.push(userMessage);
		this._onDidReceiveMessage.fire(userMessage);

		// 사용자 메시지 저장
		this.saveSessions();

		// 프롬프트 구성 - 이전 대화 컨텍스트 포함
		let prompt = this.buildPromptWithContext(content, options?.context);

		// 스트리밍 메시지 생성
		this._currentMessageId = generateUuid();
		this._accumulatedContent = '';
		this._toolActions = [];
		this._currentToolAction = undefined;

		const assistantMessage: IClaudeMessage = {
			id: this._currentMessageId,
			role: 'assistant',
			content: '',
			timestamp: Date.now(),
			isStreaming: true
		};

		this._currentSession!.messages.push(assistantMessage);
		this._onDidReceiveMessage.fire(assistantMessage);

		// CLI 호출
		this.setState('streaming');
		console.log('[ClaudeService] Sending prompt to CLI:', prompt.substring(0, 100));

		try {
			// 먼저 채널이 작동하는지 테스트
			console.log('[ClaudeService] Testing channel with isRunning...');
			const isRunning = await Promise.race([
				this.channel.call<boolean>('isRunning'),
				new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Channel timeout')), 5000))
			]);
			console.log('[ClaudeService] Channel test passed, isRunning:', isRunning);

			console.log('[ClaudeService] Calling channel.call sendPrompt...');

			const cliOptions: IClaudeCLIRequestOptions = {
				model: options?.model || this.configurationService.getValue<string>('claude.model'),
				systemPrompt: options?.systemPrompt || this.configurationService.getValue<string>('claude.systemPrompt'),
				workingDir: this._localConfig.workingDirectory
					? (this.getWorkspaceRoot() ? `${this.getWorkspaceRoot()}/${this._localConfig.workingDirectory}` : undefined)
					: this.getWorkspaceRoot(),
				executable: this._localConfig.executable
			};

			// 5분 타임아웃 (CLI는 도구 사용으로 오래 걸릴 수 있음)
			await Promise.race([
				this.channel.call('sendPrompt', [prompt, cliOptions]),
				new Promise<never>((_, reject) => setTimeout(() => reject(new Error('sendPrompt timeout after 5 minutes')), 300000))
			]);
			console.log('[ClaudeService] sendPrompt completed, accumulated content:', this._accumulatedContent.substring(0, 100));

			// 완료 후 최종 메시지 반환
			const finalMessage: IClaudeMessage = {
				id: this._currentMessageId,
				role: 'assistant',
				content: this._accumulatedContent,
				timestamp: Date.now(),
				isStreaming: false
			};

			return finalMessage;
		} catch (error) {
			console.error('[ClaudeService] sendPrompt error:', error);
			// 에러는 handleCLIError에서 처리됨
			throw error;
		}
	}

	cancelRequest(): void {
		this.channel.call('cancelRequest');
		this.setState('idle');
		this._currentMessageId = undefined;
		this._accumulatedContent = '';
	}

	// ========== Context Building ==========

	private buildPromptWithContext(content: string, context?: IClaudeSendRequestOptions['context']): string {
		const parts: string[] = [];

		// 이전 대화 내용 추가 (최근 N개 메시지만)
		const maxHistoryMessages = 10; // 최대 10개의 이전 메시지
		const messages = this._currentSession?.messages || [];

		// 현재 보낸 메시지 제외한 이전 메시지들
		const previousMessages = messages.slice(0, -1); // 마지막은 방금 추가한 사용자 메시지

		if (previousMessages.length > 0) {
			const recentMessages = previousMessages.slice(-maxHistoryMessages);
			const historyParts: string[] = [];

			for (const msg of recentMessages) {
				// 스트리밍 중인 메시지나 에러 메시지 제외
				if (msg.isStreaming || msg.isError) {
					continue;
				}

				const role = msg.role === 'user' ? 'User' : 'Assistant';
				// 너무 긴 메시지는 요약
				let msgContent = msg.content;
				if (msgContent.length > 2000) {
					msgContent = msgContent.substring(0, 2000) + '\n... (truncated)';
				}
				historyParts.push(`${role}: ${msgContent}`);
			}

			if (historyParts.length > 0) {
				parts.push('=== Previous conversation ===');
				parts.push(historyParts.join('\n\n'));
				parts.push('=== End of previous conversation ===\n');
			}
		}

		// 파일 컨텍스트 추가
		if (context) {
			if (context.selection) {
				parts.push(`Selected code:\n\`\`\`${context.language || ''}\n${context.selection}\n\`\`\``);
			}
			if (context.filePath) {
				parts.push(`Current file: ${context.filePath.fsPath}`);
			}
			if (context.attachments && context.attachments.length > 0) {
				for (const attachment of context.attachments) {
					if (attachment.type === 'image' && attachment.imageData) {
						// 이미지 첨부 - base64 데이터 포함
						// Note: Claude CLI가 이미지를 지원하는 경우 별도 처리 필요
						parts.push(`[Image attached: ${attachment.name}]`);
						parts.push(`Image data (base64, ${attachment.mimeType || 'image/png'}):`);
						parts.push(`data:${attachment.mimeType || 'image/png'};base64,${attachment.imageData}`);
					} else if (attachment.content) {
						parts.push(`File: ${attachment.name}\n\`\`\`\n${attachment.content}\n\`\`\``);
					} else {
						parts.push(`Attached: ${attachment.name} (${attachment.type})`);
					}
				}
			}
		}

		// 현재 메시지
		parts.push(content);

		return parts.join('\n\n');
	}

	// ========== History ==========

	getMessages(): IClaudeMessage[] {
		return this._currentSession?.messages ?? [];
	}

	clearHistory(): void {
		if (this._currentSession) {
			this._currentSession.messages.length = 0;
			this._onDidChangeSession.fire(this._currentSession);
			this.saveSessions();
		}
	}

	// ========== Session ==========

	startNewSession(): IClaudeSession {
		const session: IClaudeSession = {
			id: generateUuid(),
			createdAt: Date.now(),
			messages: []
		};

		this._sessions.push(session);
		this._currentSession = session;
		this._onDidChangeSession.fire(session);

		// 세션 저장
		this.saveSessions();

		return session;
	}

	getSessions(): IClaudeSession[] {
		return [...this._sessions];
	}

	/**
	 * 특정 세션으로 전환
	 */
	switchSession(sessionId: string): IClaudeSession | undefined {
		const session = this._sessions.find(s => s.id === sessionId);
		if (!session) {
			console.error('[ClaudeService] Session not found:', sessionId);
			return undefined;
		}

		if (this._currentSession?.id === sessionId) {
			console.log('[ClaudeService] Already on this session');
			return session;
		}

		console.log('[ClaudeService] Switching to session:', sessionId);

		// 진행 중인 요청이 있으면 취소
		if (this._state !== 'idle') {
			this.cancelRequest();
		}

		// 세션 전환
		this._currentSession = session;

		// 상태 초기화
		this._currentMessageId = undefined;
		this._accumulatedContent = '';
		this._toolActions = [];
		this._currentToolAction = undefined;
		this._currentAskUserRequest = undefined;
		this._isWaitingForUser = false;
		this._cliSessionId = undefined;

		// 세션 저장 및 이벤트 발생
		this.saveSessions();
		this._onDidChangeSession.fire(session);

		return session;
	}

	/**
	 * 세션 삭제
	 */
	deleteSession(sessionId: string): boolean {
		const index = this._sessions.findIndex(s => s.id === sessionId);
		if (index === -1) {
			return false;
		}

		// 현재 세션이면 다른 세션으로 전환
		if (this._currentSession?.id === sessionId) {
			const otherSession = this._sessions.find(s => s.id !== sessionId);
			if (otherSession) {
				this.switchSession(otherSession.id);
			} else {
				// 마지막 세션이면 새 세션 생성
				this._sessions.splice(index, 1);
				this.startNewSession();
				this.saveSessions();
				return true;
			}
		}

		// 세션 삭제
		this._sessions.splice(index, 1);
		this.saveSessions();

		console.log('[ClaudeService] Session deleted:', sessionId);
		return true;
	}

	/**
	 * 세션 제목 변경
	 */
	renameSession(sessionId: string, title: string): boolean {
		const session = this._sessions.find(s => s.id === sessionId);
		if (!session) {
			return false;
		}

		(session as { title?: string }).title = title;
		this.saveSessions();

		if (this._currentSession?.id === sessionId) {
			this._onDidChangeSession.fire(session);
		}

		return true;
	}

	// ========== Queue ==========

	getQueuedMessages(): IClaudeQueuedMessage[] {
		return [...this._messageQueue];
	}

	removeFromQueue(id: string): void {
		const index = this._messageQueue.findIndex(m => m.id === id);
		if (index !== -1) {
			this._messageQueue.splice(index, 1);
			this._onDidChangeQueue.fire([...this._messageQueue]);
			console.log('[ClaudeService] Removed from queue:', id);
		}
	}

	clearQueue(): void {
		this._messageQueue = [];
		this._onDidChangeQueue.fire([]);
		console.log('[ClaudeService] Queue cleared');
	}
}
