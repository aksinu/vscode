/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../../../../base/common/event.js';
import { Disposable } from '../../../../../base/common/lifecycle.js';
import { generateUuid } from '../../../../../base/common/uuid.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { IClaudeService } from '../../common/claude.js';
import { IClaudeMessage, IClaudeSendRequestOptions, ClaudeServiceState, IClaudeSession, IClaudeToolAction, IClaudeAskUserRequest, IClaudeQueuedMessage, IClaudeStatusInfo } from '../../common/claudeTypes.js';
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
import { IMainProcessService } from '../../../../../platform/ipc/common/mainProcessService.js';
import { IClaudeLogService } from '../../common/claudeLogService.js';

export class ClaudeService extends Disposable implements IClaudeService {
	declare readonly _serviceBrand: undefined;

	private static readonly LOG_CATEGORY = 'ClaudeService';

	private _state: ClaudeServiceState = 'idle';
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

	// Status 관련
	private _extendedThinking = false;

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

	constructor(
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IMainProcessService mainProcessService: IMainProcessService,
		@IStorageService storageService: IStorageService,
		@IFileService private readonly fileService: IFileService,
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
		@IClaudeLogService private readonly logService: IClaudeLogService
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
			setCurrentToolAction: (action) => { this._currentToolAction = action; },

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
			getChannel: () => this._connection.getChannel()
		}, this.logService));
		this.logService.info(ClaudeService.LOG_CATEGORY, 'CLI event handler created');

		// CLI 이벤트 구독 (CLIEventHandler로 위임)
		this._register(channel.listen<IClaudeCLIStreamEvent>('onDidReceiveData')(event => {
			this.logService.debug(ClaudeService.LOG_CATEGORY, 'Received CLI data:', event.type, event);
			this._cliEventHandler.handleData(event);
		}));
		this._register(channel.listen<void>('onDidComplete')(() => {
			this.logService.debug(ClaudeService.LOG_CATEGORY, 'CLI complete');
			this._cliEventHandler.handleComplete();
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
		if (this._isProcessingQueue || this._messageQueue.length === 0) {
			return;
		}

		// AskUser 대기 중이면 큐 처리 안 함
		if (this._isWaitingForUser) {
			this.logService.debug(ClaudeService.LOG_CATEGORY, 'Waiting for user, queue processing paused');
			return;
		}

		this._isProcessingQueue = true;

		try {
			const nextMessage = this._messageQueue.shift();
			if (nextMessage) {
				this._onDidChangeQueue.fire([...this._messageQueue]);
				this.logService.debug(ClaudeService.LOG_CATEGORY, 'Processing queued message:', nextMessage.content.substring(0, 50));

				await this.sendMessageInternal(nextMessage.content, { context: nextMessage.context });
			}
		} finally {
			this._isProcessingQueue = false;
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
		return this._sessionManager.currentSession;
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

		this.logService.debug(ClaudeService.LOG_CATEGORY, 'Message queued:', content.substring(0, 50), 'Queue size:', this._messageQueue.length);

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
		if (!this._sessionManager.hasCurrentSession()) {
			this._sessionManager.startNewSession();
		}

		// 사용자 메시지 추가
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

		// 프롬프트 구성 - 이전 대화 컨텍스트 포함
		const prompt = this._contextBuilder.buildPromptWithContext(
			content,
			this._sessionManager.getMessages(),
			options?.context
		);

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
		return this._sessionManager.switchSession(sessionId, () => {
			// 진행 중인 요청이 있으면 취소
			if (this._state !== 'idle') {
				this.cancelRequest();
			}

			// 상태 초기화
			this._currentMessageId = undefined;
			this._accumulatedContent = '';
			this._toolActions = [];
			this._currentToolAction = undefined;
			this._currentAskUserRequest = undefined;
			this._isWaitingForUser = false;
			this._cliSessionId = undefined;
		});
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

	// ========== Queue ==========

	getQueuedMessages(): IClaudeQueuedMessage[] {
		return [...this._messageQueue];
	}

	removeFromQueue(id: string): void {
		const index = this._messageQueue.findIndex(m => m.id === id);
		if (index !== -1) {
			this._messageQueue.splice(index, 1);
			this._onDidChangeQueue.fire([...this._messageQueue]);
			this.logService.debug(ClaudeService.LOG_CATEGORY, 'Removed from queue:', id);
		}
	}

	clearQueue(): void {
		this._messageQueue = [];
		this._onDidChangeQueue.fire([]);
		this.logService.debug(ClaudeService.LOG_CATEGORY, 'Queue cleared');
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

		return {
			connectionStatus: connInfo.status,
			model: this.configurationService.getValue<string>('claude.model') || 'claude-sonnet-4',
			extendedThinking: this._extendedThinking,
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
	 * Extended Thinking 토글
	 */
	async toggleExtendedThinking(): Promise<void> {
		this._extendedThinking = !this._extendedThinking;
		this.logService.info(ClaudeService.LOG_CATEGORY, 'Extended thinking:', this._extendedThinking ? 'ON' : 'OFF');
		this._onDidChangeStatusInfo.fire(this.getStatusInfo());
	}
}
