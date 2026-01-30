/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../../../../base/common/event.js';
import { Disposable } from '../../../../../base/common/lifecycle.js';
import { generateUuid } from '../../../../../base/common/uuid.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { IClaudeService, IClaudeSessionChangesHistory, IClaudeChangesHistoryEntry, IClaudeFileChangeSummaryItem } from '../../common/claude.js';
import { IClaudeMessage, IClaudeSendRequestOptions, ClaudeServiceState, IClaudeSession, IClaudeToolAction, IClaudeAskUserRequest, IClaudeQueuedMessage, IClaudeStatusInfo, IClaudeUsageInfo, IClaudeFileChange, IClaudeFileChangesSummary, resolveModelName, getModelDisplayName, ClaudeSessionState, IClaudeSessionQueuedMessage } from '../../common/claudeTypes.js';
import { IClaudeCLIStreamEvent, IClaudeCLIRequestOptions } from '../../common/claudeCLI.js';
import { RateLimitManager } from './claudeRateLimitManager.js';
import { IStorageService } from '../../../../../platform/storage/common/storage.js';
import { IFileService } from '../../../../../platform/files/common/files.js';
import { IWorkspaceContextService } from '../../../../../platform/workspace/common/workspace.js';
import { URI } from '../../../../../base/common/uri.js';
import { IClaudeLocalConfig, DEFAULT_LOCAL_CONFIG } from '../../common/claudeLocalConfig.js';
import { ClaudeConnection } from './claudeConnection.js';
import { CLIEventHandler } from './claudeCLIEventHandler.js';
import { ClaudeSessionManager } from './claudeSessionManager.js';
import { ClaudeContextBuilder } from './claudeContextBuilder.js';
import { FileSnapshotManager } from './claudeFileSnapshot.js';
import { IMainProcessService } from '../../../../../platform/ipc/common/mainProcessService.js';
import { IClaudeLogService } from '../../common/claudeLogService.js';
import { IModelService } from '../../../../../editor/common/services/model.js';
import { ITextModelService } from '../../../../../editor/common/services/resolverService.js';
import { IEditorService } from '../../../../services/editor/common/editorService.js';
import { ITextFileService } from '../../../../services/textfile/common/textfiles.js';

export class ClaudeService extends Disposable implements IClaudeService {
	declare readonly _serviceBrand: undefined;

	private static readonly LOG_CATEGORY = 'ClaudeService';
	private static readonly MAX_QUEUE_SIZE = 10;

	// 전역 상태 (CLI 실행 상태) - CLI는 한 번에 하나만 실행
	private _globalCliState: ClaudeServiceState = 'idle';
	private _activeSessionId: string | undefined; // 현재 CLI를 사용 중인 세션 ID

	private _currentMessageId: string | undefined;
	private _accumulatedContent: string = '';
	private _toolActions: IClaudeToolAction[] = [];
	private _currentToolAction: IClaudeToolAction | undefined;
	private _currentAskUserRequest: IClaudeAskUserRequest | undefined;
	private _isWaitingForUser = false;
	private _cliSessionId: string | undefined; // Claude CLI 세션 ID (--resume 용)
	private _localConfig: IClaudeLocalConfig = DEFAULT_LOCAL_CONFIG;
	private _isProcessingGlobalQueue = false; // 전역 세션 큐 처리 중 플래그
	private _usage: IClaudeUsageInfo | undefined;

	// Rate limit 매니저
	private readonly rateLimitManager: RateLimitManager;

	// 연결 관리자
	private readonly _connection: ClaudeConnection;

	// CLI 이벤트 핸들러
	private readonly _cliEventHandler: CLIEventHandler;

	// 세션 관리자
	private readonly _sessionManager: ClaudeSessionManager;

	// 컨텍스트 빌더
	private readonly _contextBuilder: ClaudeContextBuilder;

	// 파일 스냅샷 매니저 (Diff 용)
	private readonly _fileSnapshotManager: FileSnapshotManager;

	// Status 관련
	private _ultrathink = false;
	private _sessionModelOverride: string | undefined;
	private _sessionUltrathinkOverride: boolean | undefined;
	private _sessionAutoAcceptOverride: boolean | undefined;
	private _continueMode = false;

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

	private readonly _onDidChangeStatusInfo = this._register(new Emitter<IClaudeStatusInfo>());
	readonly onDidChangeStatusInfo: Event<IClaudeStatusInfo> = this._onDidChangeStatusInfo.event;

	private readonly _onDidChangeToolAction = this._register(new Emitter<IClaudeToolAction | undefined>());
	readonly onDidChangeToolAction: Event<IClaudeToolAction | undefined> = this._onDidChangeToolAction.event;

	constructor(
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IMainProcessService mainProcessService: IMainProcessService,
		@IStorageService storageService: IStorageService,
		@IFileService private readonly fileService: IFileService,
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
		@IClaudeLogService private readonly logService: IClaudeLogService,
		@IModelService private readonly modelService: IModelService,
		@ITextModelService private readonly textModelService: ITextModelService,
		@IEditorService private readonly editorService: IEditorService,
		@ITextFileService private readonly textFileService: ITextFileService
	) {
		super();

		// 세션 관리자 생성
		this._sessionManager = this._register(new ClaudeSessionManager(storageService));

		// 세션 변경 이벤트 전달
		this._register(this._sessionManager.onDidChangeSession(session => {
			this._onDidChangeSession.fire(session);
		}));

		// 컨텍스트 빌더 생성
		this._contextBuilder = new ClaudeContextBuilder();

		// 파일 스냅샷 매니저 생성
		this._fileSnapshotManager = this._register(new FileSnapshotManager(
			this.fileService,
			this.modelService,
			this.textModelService,
			this.editorService,
			this.textFileService,
			this.logService
		));

		// 연결 관리자 생성
		this._connection = this._register(new ClaudeConnection(mainProcessService, this.logService));
		this.logService.info(ClaudeService.LOG_CATEGORY, 'Connection manager created');

		// 연결 상태 변경 이벤트 전달
		this._register(this._connection.onDidChangeStatus(() => {
			this._onDidChangeStatusInfo.fire(this.getStatusInfo());
		}));

		// Rate limit 매니저 초기화
		const channel = this._connection.getChannel();
		this.rateLimitManager = this._register(new RateLimitManager({
			onRetry: async (request) => {
				this._accumulatedContent = '';
				this._toolActions = [];
				this._currentToolAction = undefined;
				await channel.call('sendPrompt', [request.prompt, request.options]);
			},
			onUpdateMessage: (content, isStreaming) => {
				if (this._currentMessageId && this._sessionManager.hasCurrentSession()) {
					const message: IClaudeMessage = {
						id: this._currentMessageId,
						role: 'assistant',
						content,
						timestamp: Date.now(),
						isStreaming
					};
					if (this._sessionManager.updateMessage(message)) {
						this._onDidUpdateMessage.fire(message);
					}
				}
			},
			onStateChange: (state) => {
				if (state === 'idle') {
					this.setState('idle');
				}
			}
		}, this.logService));

		// Rate limit 상태 변경 이벤트 전달
		this._register(this.rateLimitManager.onDidChangeStatus(status => {
			this._onDidChangeRateLimitStatus.fire(status);
		}));

		// 로컬 설정 로드 (비동기)
		this.loadLocalConfig();

		// CLI 이벤트 핸들러 생성
		this._cliEventHandler = this._register(new CLIEventHandler({
			// 연결
			confirmConnected: () => this._connection.confirmConnected(),

			// 상태
			setState: (state) => this.setState(state),
			getLocalConfig: () => this._localConfig,
			isAutoAcceptEnabled: () => this.isAutoAcceptEnabled(),

			// 메시지
			getCurrentMessageId: () => this._currentMessageId,
			setCurrentMessageId: (id) => { this._currentMessageId = id; },
			getAccumulatedContent: () => this._accumulatedContent,
			setAccumulatedContent: (content) => { this._accumulatedContent = content; },
			appendContent: (text) => {
				if (this._accumulatedContent) {
					this._accumulatedContent += '\n' + text;
				} else {
					this._accumulatedContent = text;
				}
			},

			// 도구 액션
			getToolActions: () => this._toolActions,
			addToolAction: (action) => { this._toolActions.push(action); },
			updateToolAction: (id, update) => {
				const idx = this._toolActions.findIndex(a => a.id === id);
				if (idx !== -1) {
					this._toolActions[idx] = { ...this._toolActions[idx], ...update };
				}
			},
			getCurrentToolAction: () => this._currentToolAction,
			setCurrentToolAction: (action) => {
				this._currentToolAction = action;
				this._onDidChangeToolAction.fire(action);
			},

			// AskUser
			getCurrentAskUserRequest: () => this._currentAskUserRequest,
			setCurrentAskUserRequest: (request) => { this._currentAskUserRequest = request; },
			isWaitingForUser: () => this._isWaitingForUser,
			setWaitingForUser: (waiting) => { this._isWaitingForUser = waiting; },

			// 세션
			getCliSessionId: () => this._cliSessionId,
			setCliSessionId: (id) => { this._cliSessionId = id; },
			hasCurrentSession: () => this._sessionManager.hasCurrentSession(),
			createAssistantMessage: (id) => {
				const assistantMessage: IClaudeMessage = {
					id,
					role: 'assistant',
					content: '',
					timestamp: Date.now(),
					isStreaming: true
				};
				this._sessionManager.addMessage(assistantMessage);
				this._onDidReceiveMessage.fire(assistantMessage);
			},
			updateSessionMessage: (message) => {
				this._sessionManager.updateMessage(message);
			},
			fireMessageUpdate: (message) => this._onDidUpdateMessage.fire(message),
			fireMessageReceive: (message) => {
				this._sessionManager.addMessage(message);
				this._onDidReceiveMessage.fire(message);
			},
			saveSessions: () => this._sessionManager.saveSessions(),

			// Rate limit
			startRateLimitHandling: (retryAfterSeconds, message) => this.startRateLimitHandling(retryAfterSeconds, message),
			isRateLimitError: (error) => this.rateLimitManager.isRateLimitError(error),
			parseRetrySeconds: (error) => this.rateLimitManager.parseRetrySeconds(error) ?? undefined,

			// 큐
			processQueue: () => this.processQueue(),

			// 채널
			getChannel: () => this._connection.getChannel(),

			// Usage
			getUsage: () => this._usage,
			setUsage: (usage) => { this._usage = usage; },

			// File Snapshot (Diff 용)
			captureFileBeforeEdit: (filePath) => this._fileSnapshotManager.captureBeforeEdit(filePath),
			captureFileAfterEdit: (filePath) => this._fileSnapshotManager.captureAfterEdit(filePath),
			onCommandComplete: () => this.handleCommandComplete()
		}, this.logService));
		this.logService.info(ClaudeService.LOG_CATEGORY, 'CLI event handler created');

		// CLI 이벤트 구독 (CLIEventHandler로 위임)
		this._register(channel.listen<IClaudeCLIStreamEvent>('onDidReceiveData')(event => {
			this.logService.debug(ClaudeService.LOG_CATEGORY, 'Received CLI data:', event.type, event);
			this._cliEventHandler.handleData(event).catch(error => {
				this.logService.error(ClaudeService.LOG_CATEGORY, 'Error handling CLI data:', error);
			});
		}));
		this._register(channel.listen<void>('onDidComplete')(() => {
			this.logService.debug(ClaudeService.LOG_CATEGORY, 'CLI complete');
			this._cliEventHandler.handleComplete().catch(error => {
				this.logService.error(ClaudeService.LOG_CATEGORY, 'Error handling CLI complete:', error);
			});
		}));
		this._register(channel.listen<string>('onDidError')(error => {
			this.logService.debug(ClaudeService.LOG_CATEGORY, 'CLI error:', error);
			this._cliEventHandler.handleError(error);
		}));

		// 세션 초기화 (저장된 세션 로드 + 현재 세션 설정)
		this._sessionManager.initialize();
	}

	// ========== Local Config ==========

	private async loadLocalConfig(): Promise<void> {
		try {
			const workspaceFolder = this.workspaceContextService.getWorkspace().folders[0];
			if (!workspaceFolder) {
				this.logService.debug(ClaudeService.LOG_CATEGORY, 'No workspace folder, using default config');
				return;
			}

			const configUri = URI.joinPath(workspaceFolder.uri, '.vscode', 'claude.local.json');
			this.logService.debug(ClaudeService.LOG_CATEGORY, 'Looking for local config at:', configUri.fsPath);

			try {
				const content = await this.fileService.readFile(configUri);
				const configData = JSON.parse(content.value.toString()) as IClaudeLocalConfig;
				this._localConfig = { ...DEFAULT_LOCAL_CONFIG, ...configData };
				this.logService.info(ClaudeService.LOG_CATEGORY, 'Local config loaded:', this._localConfig);
			} catch {
				// 파일이 없으면 기본값 사용
				this.logService.debug(ClaudeService.LOG_CATEGORY, 'No local config file, using defaults');
			}
		} catch (e) {
			this.logService.error(ClaudeService.LOG_CATEGORY, 'Failed to load local config:', e);
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

	// ========== AskUser Response ==========

	/**
	 * AskUser 질문에 응답 (CLIEventHandler로 위임)
	 */
	async respondToAskUser(responses: string[]): Promise<void> {
		return this._cliEventHandler.respondToAskUser(responses);
	}

	private async processQueue(): Promise<void> {
		// 세션 큐 처리 (동시 채팅 지원)
		await this.processAllSessionQueues();
	}

	/**
	 * 모든 세션의 큐를 순차 처리 (동시 채팅 지원)
	 * - CLI가 idle 상태일 때만 처리
	 * - 모든 세션에서 가장 오래된 메시지를 찾아 처리
	 */
	private async processAllSessionQueues(): Promise<void> {
		if (this._isProcessingGlobalQueue || this.isCliBusy() || this._isWaitingForUser) {
			return;
		}

		// 모든 세션에서 가장 오래된 메시지 찾기
		const sessions = this._sessionManager.sessions;
		let oldestMessage: { sessionId: string; message: IClaudeSessionQueuedMessage } | null = null;

		for (const session of sessions) {
			const queue = session.queue || [];
			if (queue.length > 0) {
				const msg = queue[0];
				if (!oldestMessage || msg.timestamp < oldestMessage.message.timestamp) {
					oldestMessage = { sessionId: session.id, message: msg };
				}
			}
		}

		if (!oldestMessage) {
			return;
		}

		this._isProcessingGlobalQueue = true;

		try {
			const { sessionId, message } = oldestMessage;
			this.logService.debug(ClaudeService.LOG_CATEGORY, 'Processing session queue message:', sessionId, message.content.substring(0, 50));

			// 큐에서 메시지 제거
			this._sessionManager.shiftSessionQueue(sessionId);

			// UI 업데이트 (해당 세션이 현재 세션이면)
			if (this._sessionManager.currentSession?.id === sessionId) {
				this._onDidChangeQueue.fire(this._sessionManager.getSessionQueue(sessionId) as IClaudeQueuedMessage[]);
			}

			// 메시지 전송 (targetSessionId 지정)
			await this.sendMessageInternal(message.content, { context: message.context }, sessionId);
		} finally {
			this._isProcessingGlobalQueue = false;
		}
	}

	// ========== Rate Limit Handling ==========

	/**
	 * Rate limit 처리 시작
	 */
	private startRateLimitHandling(retryAfterSeconds: number, message?: string): void {
		// 마지막 사용자 메시지 찾기 (재시도용)
		let pendingRequest: { prompt: string; options?: IClaudeCLIRequestOptions } | undefined;

		if (this._currentMessageId && this._sessionManager.hasCurrentSession()) {
			const messages = this._sessionManager.getMessages();
			let lastUserMessage: IClaudeMessage | undefined;
			for (let i = messages.length - 1; i >= 0; i--) {
				if (messages[i].role === 'user') {
					lastUserMessage = messages[i];
					break;
				}
			}

			if (lastUserMessage) {
				pendingRequest = {
					prompt: lastUserMessage.content,
					options: {
						model: this.configurationService.getValue<string>('claude.model'),
						systemPrompt: this.configurationService.getValue<string>('claude.systemPrompt'),
						workingDir: this.getWorkspaceRoot(),
						executable: this._localConfig.executable
					}
				};
			}
		}

		if (pendingRequest) {
			this.rateLimitManager.handleRateLimit(retryAfterSeconds, pendingRequest, message);
		}
	}

	/**
	 * Rate limit 대기 취소
	 */
	cancelRateLimitWait(): void {
		this.rateLimitManager.cancel();
	}

	/**
	 * Rate limit 상태 조회
	 */
	getRateLimitStatus(): { waiting: boolean; countdown: number; message?: string } {
		return {
			waiting: this.rateLimitManager.isWaiting,
			countdown: this.rateLimitManager.countdown,
			message: this.rateLimitManager.info?.message
		};
	}

	// ========== State ==========

	/**
	 * 현재 세션의 상태 가져오기
	 * 세션이 CLI를 사용 중이면 globalCliState, 아니면 세션별 상태
	 */
	getState(): ClaudeServiceState {
		const currentSession = this._sessionManager.currentSession;
		if (!currentSession) {
			return 'idle';
		}

		// 현재 세션이 활성 CLI 세션이면 전역 CLI 상태 반환
		if (this._activeSessionId === currentSession.id) {
			return this._globalCliState;
		}

		// 그렇지 않으면 세션별 상태 반환 (세션 큐가 있으면 idle로 간주)
		return this._sessionManager.getSessionState(currentSession.id);
	}

	/**
	 * 세션 상태 설정
	 */
	private setState(state: ClaudeServiceState, sessionId?: string): void {
		const targetSessionId = sessionId ?? this._sessionManager.currentSession?.id;

		// 전역 CLI 상태 업데이트 (CLI가 실제로 동작 중인 세션)
		if (this._activeSessionId === targetSessionId || (state !== 'idle' && !this._activeSessionId)) {
			if (state !== 'idle') {
				this._activeSessionId = targetSessionId;
			}
			this._globalCliState = state;

			// idle 상태가 되면 활성 세션 해제
			if (state === 'idle') {
				this._activeSessionId = undefined;
			}
		}

		// 세션별 상태 업데이트
		if (targetSessionId) {
			this._sessionManager.setSessionState(state as ClaudeSessionState, targetSessionId);
		}

		// 현재 세션이면 UI 이벤트 발생
		if (targetSessionId === this._sessionManager.currentSession?.id) {
			this._onDidChangeState.fire(state);
		}
	}

	/**
	 * 특정 세션의 상태 가져오기
	 */
	getSessionState(sessionId: string): ClaudeServiceState {
		// 해당 세션이 활성 CLI 세션이면 전역 CLI 상태 반환
		if (this._activeSessionId === sessionId) {
			return this._globalCliState;
		}
		return this._sessionManager.getSessionState(sessionId);
	}

	/**
	 * CLI가 현재 사용 중인지 확인
	 */
	isCliBusy(): boolean {
		return this._globalCliState !== 'idle';
	}

	getCurrentSession(): IClaudeSession | undefined {
		return this._sessionManager.currentSession;
	}

	// ========== Chat ==========

	async sendMessage(content: string, options?: IClaudeSendRequestOptions): Promise<IClaudeMessage> {
		const currentSession = this._sessionManager.currentSession;

		// CLI가 busy 상태면 세션 큐에 추가
		if (this.isCliBusy() || this._isWaitingForUser) {
			return this.addToSessionQueue(content, options);
		}

		// 현재 세션을 활성 세션으로 설정
		if (currentSession) {
			this._activeSessionId = currentSession.id;
		}

		return this.sendMessageInternal(content, options);
	}

	/**
	 * 세션 큐에 메시지 추가 (동시 채팅 지원)
	 */
	private addToSessionQueue(content: string, options?: IClaudeSendRequestOptions): IClaudeMessage {
		const currentSession = this._sessionManager.currentSession;
		const sessionId = currentSession?.id;

		// 세션 큐에 추가
		const queuedMessage = this._sessionManager.addToSessionQueue(
			content,
			options?.context,
			sessionId,
			ClaudeService.MAX_QUEUE_SIZE
		);

		if (!queuedMessage) {
			this.logService.warn(ClaudeService.LOG_CATEGORY, 'Session queue is full');
			return {
				id: generateUuid(),
				role: 'user',
				content,
				timestamp: Date.now(),
				context: options?.context,
				queueRejected: true
			};
		}

		this.logService.debug(ClaudeService.LOG_CATEGORY, 'Message queued for session:', sessionId, content.substring(0, 50));

		// UI 업데이트를 위해 전역 큐 이벤트 발생 (현재 세션 큐)
		this._onDidChangeQueue.fire(this._sessionManager.getSessionQueue(sessionId) as IClaudeQueuedMessage[]);

		return {
			id: queuedMessage.id,
			role: 'user',
			content,
			timestamp: queuedMessage.timestamp,
			context: options?.context
		};
	}

	private async sendMessageInternal(content: string, options?: IClaudeSendRequestOptions, targetSessionId?: string): Promise<IClaudeMessage> {
		// targetSessionId가 있으면 해당 세션으로 전환
		if (targetSessionId && this._sessionManager.currentSession?.id !== targetSessionId) {
			this.logService.debug(ClaudeService.LOG_CATEGORY, 'Switching to target session for queue message:', targetSessionId);
			this._sessionManager.switchSession(targetSessionId);
		}

		if (!this._sessionManager.hasCurrentSession()) {
			this._sessionManager.startNewSession();
		}

		// --continue 플래그 감지 (텍스트 또는 버튼)
		let continueLastSession = this._continueMode;
		let actualContent = content;

		// 버튼으로 continue 모드 활성화된 경우 초기화
		if (this._continueMode) {
			this._continueMode = false;
			this.logService.info(ClaudeService.LOG_CATEGORY, 'Continue mode (button) activated');
		}

		if (content.trim().startsWith('--continue') || content.trim().startsWith('-c ')) {
			continueLastSession = true;
			// --continue 이후의 텍스트를 프롬프트로 사용
			actualContent = content.trim()
				.replace(/^--continue\s*/, '')
				.replace(/^-c\s*/, '')
				.trim();

			// 프롬프트가 없으면 빈 문자열 (CLI가 이전 대화 로드)
			if (!actualContent) {
				actualContent = '';
			}

			this.logService.info(ClaudeService.LOG_CATEGORY, 'Continue mode detected, prompt:', actualContent || '(empty)');
		}

		// 파일 스냅샷 매니저 초기화 - 새 명령 시작
		const workingDir = this._localConfig.workingDirectory
			? (this.getWorkspaceRoot() ? `${this.getWorkspaceRoot()}/${this._localConfig.workingDirectory}` : undefined)
			: this.getWorkspaceRoot();
		this._fileSnapshotManager.startCommand(workingDir);

		// 사용자 메시지 추가 (원본 content 사용)
		const userMessage: IClaudeMessage = {
			id: generateUuid(),
			role: 'user',
			content,
			timestamp: Date.now(),
			context: options?.context
		};

		this._sessionManager.addMessage(userMessage);
		this._onDidReceiveMessage.fire(userMessage);

		// 사용자 메시지 저장
		this._sessionManager.saveSessions();

		// 프롬프트 구성 - continue 모드가 아닐 때만 컨텍스트 포함
		let prompt: string;
		if (continueLastSession) {
			// continue 모드: actualContent만 사용 (빈 문자열 가능)
			prompt = actualContent;
		} else {
			// 일반 모드: 이전 대화 컨텍스트 포함
			prompt = this._contextBuilder.buildPromptWithContext(
				content,
				this._sessionManager.getMessages(),
				options?.context
			);
		}

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

		this._sessionManager.addMessage(assistantMessage);
		this._onDidReceiveMessage.fire(assistantMessage);

		// CLI 호출
		this.setState('streaming');
		this.logService.debug(ClaudeService.LOG_CATEGORY, 'Sending prompt to CLI:', prompt.substring(0, 100));

		try {
			// 먼저 채널이 작동하는지 테스트
			this.logService.debug(ClaudeService.LOG_CATEGORY, 'Testing channel with isRunning...');
			const isRunning = await Promise.race([
				this._connection.getChannel().call<boolean>('isRunning'),
				new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Channel timeout')), 5000))
			]);
			this.logService.debug(ClaudeService.LOG_CATEGORY, 'Channel test passed, isRunning:', isRunning);

			this.logService.debug(ClaudeService.LOG_CATEGORY, 'Calling channel.call sendPrompt...');

			// 모델 우선순위: options > session override > local config > VS Code config
			// resolveModelName으로 별칭 해석 (예: "opus" → "claude-opus-4-20250514")
			const rawModel = options?.model
				|| this._sessionModelOverride
				|| this._localConfig.model
				|| this.configurationService.getValue<string>('claude.model');
			const effectiveModel = resolveModelName(rawModel);


			//UltraThink 더이상 사용 XXXX
			//Ultrathink no longer does anything. Thinking budget is now max by default.
			// // Ultrathink: session override > local config > instance setting
			// const effectiveUltrathink = this._sessionUltrathinkOverride !== undefined
			// 	? this._sessionUltrathinkOverride
			// 	: (this._localConfig.ultrathink ?? this._ultrathink);

			// // Ultrathink 모드일 경우 프롬프트 앞에 "ultrathink:" 키워드 추가
			// let finalPrompt = prompt;
			// if (effectiveUltrathink && prompt.trim()) {
			// 	finalPrompt = `ultrathink: ${prompt}`;
			// 	this.logService.info(ClaudeService.LOG_CATEGORY, 'Ultrathink mode enabled, prompt prefixed with ultrathink:');
			// }

			// 로컬 설정 > VS Code 설정 우선순위로 옵션 결정
			const maxTurns = this._localConfig.maxTurns
				?? this.configurationService.getValue<number>('claude.maxTurns');
			const maxBudgetUsd = this._localConfig.maxBudgetUsd
				?? this.configurationService.getValue<number>('claude.maxBudgetUsd');
			const fallbackModel = this._localConfig.fallbackModel
				?? this.configurationService.getValue<string>('claude.fallbackModel');
			const appendSystemPrompt = this.configurationService.getValue<string>('claude.appendSystemPrompt');
			const disallowedTools = this._localConfig.disallowedTools
				?? this.configurationService.getValue<string[]>('claude.disallowedTools');
			const permissionMode = this._localConfig.permissionMode
				?? this.configurationService.getValue<'default' | 'plan' | 'accept-edits'>('claude.permissionMode');
			const betas = this._localConfig.betas
				?? this.configurationService.getValue<string[]>('claude.betas');

			const cliOptions: IClaudeCLIRequestOptions = {
				model: effectiveModel,
				systemPrompt: options?.systemPrompt || this.configurationService.getValue<string>('claude.systemPrompt'),
				workingDir: this._localConfig.workingDirectory
					? (this.getWorkspaceRoot() ? `${this.getWorkspaceRoot()}/${this._localConfig.workingDirectory}` : undefined)
					: this.getWorkspaceRoot(),
				executable: this._localConfig.executable,
				continueLastSession,
				// 새 옵션들 (로컬 설정 > VS Code 설정 우선순위)
				maxTurns,
				maxBudgetUsd,
				fallbackModel,
				appendSystemPrompt,
				disallowedTools,
				permissionMode,
				betas,
				// 로컬 설정 전용 옵션
				addDirs: this._localConfig.addDirs,
				mcpConfig: this._localConfig.mcpConfig,
				agents: this._localConfig.agents
			};

			// 5분 타임아웃 (CLI는 도구 사용으로 오래 걸릴 수 있음)
			await Promise.race([
				this._connection.getChannel().call('sendPrompt', [prompt, cliOptions]),
				new Promise<never>((_, reject) => setTimeout(() => reject(new Error('sendPrompt timeout after 5 minutes')), 300000))
			]);
			this.logService.debug(ClaudeService.LOG_CATEGORY, 'sendPrompt completed, accumulated content:', this._accumulatedContent.substring(0, 100));

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
			this.logService.error(ClaudeService.LOG_CATEGORY, 'sendPrompt error:', error);
			// 에러는 handleCLIError에서 처리됨
			throw error;
		}
	}

	cancelRequest(): void {
		this._connection.getChannel().call('cancelRequest');
		this.setState('idle');
		this._currentMessageId = undefined;
		this._accumulatedContent = '';
	}

	// ========== History ==========

	getMessages(): IClaudeMessage[] {
		return this._sessionManager.getMessages();
	}

	clearHistory(): void {
		this._sessionManager.clearHistory();
	}

	// ========== Session (SessionManager 위임) ==========

	startNewSession(): IClaudeSession {
		return this._sessionManager.startNewSession();
	}

	getSessions(): IClaudeSession[] {
		return this._sessionManager.getSessions();
	}

	/**
	 * 특정 세션으로 전환
	 */
	switchSession(sessionId: string): IClaudeSession | undefined {
		const session = this._sessionManager.switchSession(sessionId, () => {
			// 주의: 진행 중인 요청은 취소하지 않음 (동시 채팅 지원)
			// 다른 세션이 CLI를 사용 중이어도 현재 세션을 볼 수 있어야 함

			// 현재 메시지 상태만 초기화 (CLI 상태는 유지)
			if (this._activeSessionId !== sessionId) {
				this._currentMessageId = undefined;
				this._accumulatedContent = '';
				this._toolActions = [];
				this._currentToolAction = undefined;
				this._currentAskUserRequest = undefined;
				// _isWaitingForUser는 전역 상태이므로 유지
			}
		});

		if (session) {
			// 세션 전환 후 해당 세션의 큐로 UI 업데이트
			const queue = this._sessionManager.getSessionQueue(sessionId);
			this._onDidChangeQueue.fire(queue as IClaudeQueuedMessage[]);

			// 해당 세션의 상태로 UI 업데이트
			const sessionState = this.getSessionState(sessionId);
			this._onDidChangeState.fire(sessionState);
		}

		return session;
	}

	/**
	 * 세션 삭제
	 */
	deleteSession(sessionId: string): boolean {
		return this._sessionManager.deleteSession(sessionId);
	}

	/**
	 * 세션 제목 변경
	 */
	renameSession(sessionId: string, title: string): boolean {
		return this._sessionManager.renameSession(sessionId, title);
	}

	/**
	 * 세션별 모델 오버라이드 설정 (별칭 지원)
	 */
	setSessionModel(model: string): void {
		// 별칭 해석 (예: "opus" → "claude-opus-4-20250514")
		const resolvedModel = model ? resolveModelName(model) : undefined;
		this._sessionModelOverride = resolvedModel || undefined;
		const displayName = resolvedModel ? getModelDisplayName(resolvedModel) : '(cleared)';
		this.logService.info(ClaudeService.LOG_CATEGORY, 'Session model override:', displayName, resolvedModel ? `(${resolvedModel})` : '');
		this._onDidChangeStatusInfo.fire(this.getStatusInfo());
	}

	/**
	 * 세션별 Ultrathink 오버라이드 설정
	 */
	setSessionUltrathink(enabled: boolean): void {
		this._sessionUltrathinkOverride = enabled;
		this.logService.info(ClaudeService.LOG_CATEGORY, 'Session ultrathink override:', enabled ? 'ON' : 'OFF');
		this._onDidChangeStatusInfo.fire(this.getStatusInfo());
	}

	/**
	 * 세션별 Auto Accept 오버라이드 설정
	 */
	setSessionAutoAccept(enabled: boolean): void {
		this._sessionAutoAcceptOverride = enabled;
		this.logService.info(ClaudeService.LOG_CATEGORY, 'Session auto-accept override:', enabled ? 'ON' : 'OFF');
	}

	/**
	 * Auto Accept 활성화 여부 (세션 오버라이드 > 로컬 설정)
	 */
	isAutoAcceptEnabled(): boolean {
		return this._sessionAutoAcceptOverride !== undefined
			? this._sessionAutoAcceptOverride
			: (this._localConfig.autoAccept ?? false);
	}

	/**
	 * 마지막 세션 이어서 시작 (--continue)
	 */
	async continueLastSession(): Promise<void> {
		this.logService.info(ClaudeService.LOG_CATEGORY, 'Continuing last session...');
		this._continueMode = true;
		// 다음 sendMessage 호출 시 --continue 플래그 사용됨
	}

	// ========== Queue (세션별 큐) ==========

	/**
	 * 현재 세션의 큐 메시지 가져오기
	 */
	getQueuedMessages(): IClaudeQueuedMessage[] {
		const sessionId = this._sessionManager.currentSession?.id;
		return this._sessionManager.getSessionQueue(sessionId) as IClaudeQueuedMessage[];
	}

	/**
	 * 현재 세션의 큐에서 메시지 제거
	 */
	removeFromQueue(id: string): void {
		const sessionId = this._sessionManager.currentSession?.id;
		if (this._sessionManager.removeFromSessionQueue(id, sessionId)) {
			this._onDidChangeQueue.fire(this._sessionManager.getSessionQueue(sessionId) as IClaudeQueuedMessage[]);
			this.logService.debug(ClaudeService.LOG_CATEGORY, 'Removed from session queue:', id);
		}
	}

	/**
	 * 현재 세션의 큐 클리어
	 */
	clearQueue(): void {
		const sessionId = this._sessionManager.currentSession?.id;
		this._sessionManager.clearSessionQueue(sessionId);
		this._onDidChangeQueue.fire([]);
		this.logService.debug(ClaudeService.LOG_CATEGORY, 'Session queue cleared');
	}

	/**
	 * 큐 최대 크기 반환
	 */
	getMaxQueueSize(): number {
		return ClaudeService.MAX_QUEUE_SIZE;
	}

	/**
	 * 현재 세션의 큐에서 대기 중인 메시지 수정
	 */
	updateQueuedMessage(id: string, newContent: string): boolean {
		const sessionId = this._sessionManager.currentSession?.id;
		const queue = this._sessionManager.getSessionQueue(sessionId);
		const index = queue.findIndex(m => m.id === id);
		if (index === -1) {
			return false;
		}

		// 기존 메시지 교체
		const oldMessage = queue[index];
		queue[index] = {
			...oldMessage,
			content: newContent
		};
		this._onDidChangeQueue.fire([...queue] as IClaudeQueuedMessage[]);
		this.logService.debug(ClaudeService.LOG_CATEGORY, 'Session queue message updated:', id);
		return true;
	}

	/**
	 * 현재 세션의 큐 순서 변경
	 */
	reorderQueue(fromIndex: number, toIndex: number): boolean {
		const sessionId = this._sessionManager.currentSession?.id;
		const queue = this._sessionManager.getSessionQueue(sessionId);

		if (fromIndex < 0 || fromIndex >= queue.length ||
			toIndex < 0 || toIndex >= queue.length ||
			fromIndex === toIndex) {
			return false;
		}

		const [item] = queue.splice(fromIndex, 1);
		queue.splice(toIndex, 0, item);
		this._onDidChangeQueue.fire([...queue] as IClaudeQueuedMessage[]);
		this.logService.debug(ClaudeService.LOG_CATEGORY, 'Session queue reordered:', fromIndex, '->', toIndex);
		return true;
	}

	// ========== Status ==========

	/**
	 * 연결 관리자 가져오기
	 */
	get connection(): ClaudeConnection {
		return this._connection;
	}

	/**
	 * Claude 상태 정보 가져오기
	 */
	getStatusInfo(): IClaudeStatusInfo {
		const execMethod = this._localConfig.executable?.type === 'script' ? 'script' : 'cli';
		const scriptPath = this._localConfig.executable?.type === 'script'
			? this._localConfig.executable.script
			: undefined;
		const connInfo = this._connection.getInfo();

		// Ultrathink 현재 값 계산: session override > local config > instance setting
		const effectiveUltrathink = this._sessionUltrathinkOverride !== undefined
			? this._sessionUltrathinkOverride
			: (this._localConfig.ultrathink ?? this._ultrathink);

		return {
			connectionStatus: connInfo.status,
			model: this.configurationService.getValue<string>('claude.model') || 'claude-sonnet-4',
			ultrathink: effectiveUltrathink,
			executionMethod: execMethod,
			scriptPath,
			lastConnected: connInfo.lastConnected,
			version: connInfo.version
		};
	}

	/**
	 * 연결 테스트 (ClaudeConnection에 위임)
	 */
	async checkConnection(): Promise<boolean> {
		return this._connection.connect();
	}

	/**
	 * Ultrathink 토글
	 */
	async toggleUltrathink(): Promise<void> {
		this._ultrathink = !this._ultrathink;
		// 세션 오버라이드도 함께 토글
		this._sessionUltrathinkOverride = this._ultrathink;
		this.logService.info(ClaudeService.LOG_CATEGORY, 'Ultrathink:', this._ultrathink ? 'ON' : 'OFF');
		this._onDidChangeStatusInfo.fire(this.getStatusInfo());
	}

	/**
	 * Ultrathink 활성화 여부
	 */
	isUltrathinkEnabled(): boolean {
		return this._sessionUltrathinkOverride !== undefined
			? this._sessionUltrathinkOverride
			: (this._localConfig.ultrathink ?? this._ultrathink);
	}

	// ========== File Snapshot / Diff ==========

	/**
	 * 명령 완료 시 호출 - 변경된 파일 정보 수집
	 */
	private async handleCommandComplete(): Promise<void> {
		// tool_result 이벤트가 누락된 경우를 대비해 아직 캡처되지 않은 파일들 캡처
		await this._fileSnapshotManager.captureAllPendingModifications();

		const changesSummary = this._fileSnapshotManager.getChangesSummary();
		this.logService.info(ClaudeService.LOG_CATEGORY, `[FileChanges] Command complete, snapshots: ${this._fileSnapshotManager.snapshotCount}, changes: ${changesSummary.changes.length}`);

		// 디버깅: 스냅샷 상태 출력
		for (const change of changesSummary.changes) {
			this.logService.info(ClaudeService.LOG_CATEGORY, `[FileChanges] - ${change.filePath}: ${change.changeType}, +${change.linesAdded}/-${change.linesRemoved}`);
		}

		// 현재 메시지에 파일 변경사항 추가
		if (changesSummary.changes.length > 0 && this._currentMessageId && this._sessionManager.hasCurrentSession()) {
			const messages = this._sessionManager.getMessages();
			const currentMessage = messages.find(m => m.id === this._currentMessageId);
			this.logService.info(ClaudeService.LOG_CATEGORY, `[FileChanges] currentMessageId: ${this._currentMessageId}, found: ${!!currentMessage}`);

			if (currentMessage) {
				const updatedMessage: IClaudeMessage = {
					...currentMessage,
					fileChanges: changesSummary
				};
				this._sessionManager.updateMessage(updatedMessage);
				this._onDidUpdateMessage.fire(updatedMessage);
				this.logService.info(ClaudeService.LOG_CATEGORY, `[FileChanges] Message updated with ${changesSummary.changes.length} file changes`);
			}
		} else {
			this.logService.info(ClaudeService.LOG_CATEGORY, `[FileChanges] Skipping - changes: ${changesSummary.changes.length}, msgId: ${this._currentMessageId}, hasSession: ${this._sessionManager.hasCurrentSession()}`);
		}
	}

	/**
	 * 변경된 파일 목록 가져오기
	 */
	getChangedFiles(): IClaudeFileChange[] {
		return this._fileSnapshotManager.getChangedFiles();
	}

	/**
	 * 변경사항 요약 가져오기
	 */
	getFileChangesSummary(): IClaudeFileChangesSummary {
		return this._fileSnapshotManager.getChangesSummary();
	}

	/**
	 * 특정 파일의 Diff 표시
	 */
	async showFileDiff(fileChange: IClaudeFileChange): Promise<void> {
		await this._fileSnapshotManager.showDiff(fileChange);
	}

	/**
	 * 파일 변경사항 되돌리기
	 */
	async revertFile(fileChange: IClaudeFileChange): Promise<boolean> {
		return this._fileSnapshotManager.revertFile(fileChange.filePath);
	}

	/**
	 * 모든 파일 변경사항 되돌리기
	 */
	async revertAllFiles(): Promise<number> {
		return this._fileSnapshotManager.revertAll();
	}

	/**
	 * 파일 변경사항 수락 (스냅샷 제거)
	 */
	acceptFile(fileChange: IClaudeFileChange): void {
		this._fileSnapshotManager.acceptFile(fileChange.filePath);
	}

	/**
	 * 모든 파일 변경사항 수락
	 */
	acceptAllFiles(): void {
		this._fileSnapshotManager.acceptAll();
	}

	/**
	 * 선택된 파일들 되돌리기
	 */
	async revertSelectedFiles(fileChanges: IClaudeFileChange[]): Promise<number> {
		const filePaths = fileChanges.map(fc => fc.filePath);
		return this._fileSnapshotManager.revertFiles(filePaths);
	}

	/**
	 * 선택된 파일들 수락
	 */
	acceptSelectedFiles(fileChanges: IClaudeFileChange[]): void {
		const filePaths = fileChanges.map(fc => fc.filePath);
		this._fileSnapshotManager.acceptFiles(filePaths);
	}

	// ========== Session Changes History ==========

	/**
	 * 세션 전체 변경사항 히스토리 가져오기
	 */
	getSessionChangesHistory(): IClaudeSessionChangesHistory {
		const session = this._sessionManager.currentSession;
		if (!session) {
			return {
				sessionId: '',
				totalFilesChanged: 0,
				totalLinesAdded: 0,
				totalLinesRemoved: 0,
				entries: [],
				filesSummary: []
			};
		}

		const entries: IClaudeChangesHistoryEntry[] = [];
		const filesMap = new Map<string, IClaudeFileChangeSummaryItem>();
		let totalLinesAdded = 0;
		let totalLinesRemoved = 0;

		// 메시지를 시간순으로 순회
		const messages = session.messages;
		for (let i = 0; i < messages.length; i++) {
			const msg = messages[i];

			// assistant 메시지에서 fileChanges 추출
			if (msg.role === 'assistant' && msg.fileChanges && msg.fileChanges.changes.length > 0) {
				// 이전 user 메시지에서 프롬프트 가져오기
				let prompt = '';
				for (let j = i - 1; j >= 0; j--) {
					if (messages[j].role === 'user') {
						prompt = messages[j].content;
						// 프롬프트 요약 (100자)
						if (prompt.length > 100) {
							prompt = prompt.substring(0, 100) + '...';
						}
						break;
					}
				}

				entries.push({
					messageId: msg.id,
					timestamp: msg.timestamp,
					prompt,
					changes: msg.fileChanges.changes
				});

				// 파일별 통계 업데이트
				for (const change of msg.fileChanges.changes) {
					const existing = filesMap.get(change.filePath);
					if (existing) {
						filesMap.set(change.filePath, {
							filePath: change.filePath,
							fileName: change.fileName,
							changeCount: existing.changeCount + 1,
							finalState: change.changeType,
							totalLinesAdded: existing.totalLinesAdded + change.linesAdded,
							totalLinesRemoved: existing.totalLinesRemoved + change.linesRemoved,
							lastModified: msg.timestamp
						});
					} else {
						filesMap.set(change.filePath, {
							filePath: change.filePath,
							fileName: change.fileName,
							changeCount: 1,
							finalState: change.changeType,
							totalLinesAdded: change.linesAdded,
							totalLinesRemoved: change.linesRemoved,
							lastModified: msg.timestamp
						});
					}

					totalLinesAdded += change.linesAdded;
					totalLinesRemoved += change.linesRemoved;
				}
			}
		}

		// 파일 요약을 배열로 변환 (수정 횟수 내림차순)
		const filesSummary = Array.from(filesMap.values())
			.sort((a, b) => b.changeCount - a.changeCount);

		return {
			sessionId: session.id,
			totalFilesChanged: filesMap.size,
			totalLinesAdded,
			totalLinesRemoved,
			entries,
			filesSummary
		};
	}
}
