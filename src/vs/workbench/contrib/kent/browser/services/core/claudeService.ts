/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../../../../base/common/event.js';
import { Disposable } from '../../../../../../base/common/lifecycle.js';
import { generateUuid } from '../../../../../../base/common/uuid.js';
import { IConfigurationService } from '../../../../../../platform/configuration/common/configuration.js';
import { IClaudeService, IClaudeSessionChangesHistory } from '../../../common/services/core/claude.js';
import { IClaudeMessageService } from '../../../common/types/claudeMessageService.js';
import { IClaudeQueueService } from '../../../common/types/claudeQueueService.js';
import { IClaudeFileService } from '../../../common/types/claudeFileService.js';
import { IClaudeRateLimitService } from '../../../common/types/claudeRateLimitService.js';
import { IClaudeSessionService } from '../../../common/types/claudeSessionService.js';
import { IClaudeUIService } from '../../../common/types/claudeUIService.js';
import { IClaudeMessage, IClaudeSendRequestOptions, ClaudeServiceState, IClaudeSession, IClaudeToolAction, IClaudeQueuedMessage, IClaudeStatusInfo, IClaudeFileChange, IClaudeFileChangesSummary, IClaudeAskUserRequest, IClaudeUsageInfo, resolveModelName, getModelDisplayName } from '../../../common/types/claudeTypes.js';
import { IClaudeCLIRequestOptions } from '../../../common/claudeCLI.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../../../platform/storage/common/storage.js';
import { IFileService } from '../../../../../../platform/files/common/files.js';
import { IWorkspaceContextService } from '../../../../../../platform/workspace/common/workspace.js';
import { IClaudeLocalConfig } from '../../../common/config/claudeLocalConfig.js';
import { ClaudeConnection, ClaudeMultiConnection } from './claudeConnection.js';
import { CLIEventHandler } from './claudeCLIEventHandler.js';
import { ClaudeServiceContextProvider } from './claudeServiceContextProvider.js';
import { IMainProcessService } from '../../../../../../platform/ipc/common/mainProcessService.js';
import { IChannel } from '../../../../../../base/parts/ipc/common/ipc.js';
import { IClaudeLogService } from '../../../common/claudeLogService.js';
import { IModelService } from '../../../../../../editor/common/services/model.js';
import { ITextModelService } from '../../../../../../editor/common/services/resolverService.js';
import { IEditorService } from '../../../../../services/editor/common/editorService.js';
import { ITextFileService } from '../../../../../services/textfile/common/textfiles.js';

// Manager imports
import { ConfigManager, HistoryManager, FileWatcherManager, MultiSessionManager, ChatManager, ChatStateManager } from './managers/index.js';

export class ClaudeService extends Disposable implements IClaudeService {
	declare readonly _serviceBrand: undefined;

	private static readonly LOG_CATEGORY = 'ClaudeService';
	private static readonly MAX_QUEUE_SIZE = 10;
	private static readonly QUEUE_STORAGE_KEY = 'claude.messageQueue';

	// ========== Managers ==========
	private readonly _configManager: ConfigManager;
	private readonly _historyManager: HistoryManager;
	private readonly _fileWatcherManager: FileWatcherManager;
	private readonly _multiSessionManager: MultiSessionManager;
	private readonly _chatManager: ChatManager;
	private readonly _chatStateManager: ChatStateManager;

	// ========== Legacy 단일 상태 (하위 호환성 + ContextProvider 접근용) ==========
	private _state: ClaudeServiceState = 'idle';
	_currentToolAction: IClaudeToolAction | undefined;
	_isWaitingForUser = false;
	private _isProcessingQueue = false;
	_currentMessageId: string | undefined;
	_accumulatedContent: string = '';
	_toolActions: IClaudeToolAction[] = [];
	_currentAskUserRequest: IClaudeAskUserRequest | undefined;
	_cliSessionId: string | undefined;
	_usage: IClaudeUsageInfo | undefined;

	// 연결 관리자 (Legacy - 단일 인스턴스)
	private readonly _connection: ClaudeConnection;

	// 멀티 연결 관리자 (Multi-Session)
	readonly _multiConnection: ClaudeMultiConnection;

	// CLI 이벤트 핸들러
	private readonly _cliEventHandler: CLIEventHandler;

	// Status 관련
	private _ultrathink = false;
	private _sessionAutoAcceptOverride: boolean | undefined;

	// Expose _localConfig for ContextProvider (delegate to ConfigManager)
	get _localConfig(): IClaudeLocalConfig {
		return this._configManager.getLocalConfig();
	}

	// Message events are now delegated to ClaudeMessageService
	readonly onDidReceiveMessage: Event<IClaudeMessage> = this._messageService.onDidReceiveMessage;
	readonly onDidUpdateMessage: Event<IClaudeMessage> = this._messageService.onDidUpdateMessage;

	// State events are now delegated to ClaudeUIService
	readonly onDidChangeState: Event<ClaudeServiceState> = this._uiService.onDidChangeState;

	// Session events are now delegated to ClaudeSessionService
	readonly onDidChangeSession: Event<IClaudeSession | undefined> = this._sessionService.onDidChangeSession;

	// Queue events are now delegated to ClaudeQueueService
	readonly onDidChangeQueue: Event<IClaudeQueuedMessage[]> = this._queueService.onDidChangeQueue;

	// Rate Limit events are now delegated to ClaudeRateLimitService
	readonly onDidChangeRateLimitStatus: Event<{ waiting: boolean; countdown: number; message?: string }> = this._rateLimitService.onDidChangeStatus;

	// Status and ToolAction events are now delegated to ClaudeUIService
	readonly onDidChangeStatusInfo: Event<IClaudeStatusInfo> = this._uiService.onDidChangeStatusInfo;
	readonly onDidChangeToolAction: Event<IClaudeToolAction | undefined> = this._uiService.onDidChangeToolAction;

	constructor(
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IMainProcessService mainProcessService: IMainProcessService,
		@IStorageService private readonly storageService: IStorageService,
		@IFileService _platformFileService: IFileService,
		@IWorkspaceContextService _workspaceContextService: IWorkspaceContextService,
		@IClaudeLogService private readonly logService: IClaudeLogService,
		@IModelService _modelService: IModelService,
		@ITextModelService _textModelService: ITextModelService,
		@IEditorService _editorService: IEditorService,
		@ITextFileService _textFileService: ITextFileService,
		@IClaudeMessageService private readonly _messageService: IClaudeMessageService,
		@IClaudeQueueService private readonly _queueService: IClaudeQueueService,
		@IClaudeFileService private readonly _fileService: IClaudeFileService,
		@IClaudeRateLimitService private readonly _rateLimitService: IClaudeRateLimitService,
		@IClaudeSessionService private readonly _sessionService: IClaudeSessionService,
		@IClaudeUIService private readonly _uiService: IClaudeUIService
	) {
		super();

		// ========== Manager 생성 ==========
		this._configManager = this._register(new ConfigManager(
			_platformFileService,
			_workspaceContextService,
			logService
		));

		this._historyManager = this._register(new HistoryManager(
			_sessionService
		));

		this._fileWatcherManager = this._register(new FileWatcherManager(
			_platformFileService,
			_fileService,
			logService
		));

		this._multiSessionManager = this._register(new MultiSessionManager(
			_sessionService,
			_messageService,
			logService
		));

		// ChatStateManager 생성 (중앙 집중식 상태 관리)
		this._chatStateManager = this._register(new ChatStateManager(logService));

		// ========== 연결 관리자 생성 ==========
		this._connection = this._register(new ClaudeConnection(mainProcessService, this.logService));
		this.logService.info(ClaudeService.LOG_CATEGORY, 'Connection manager created');

		this._multiConnection = this._register(new ClaudeMultiConnection(mainProcessService, this.logService));
		this.logService.info(ClaudeService.LOG_CATEGORY, 'Multi-connection manager created');

		// ChatManager는 multiConnection 생성 후 생성
		this._chatManager = this._register(new ChatManager(
			configurationService,
			_sessionService,
			_messageService,
			_fileService,
			_uiService,
			logService,
			this._queueService,
			this._configManager,
			this._multiSessionManager,
			this._multiConnection,
			this._chatStateManager
		));

		// ========== 델리게이트 설정 ==========
		this.setupDelegates();

		// QueueService가 ChatStateManager 구독 (상태 기반 큐 처리)
		this._register(this._queueService.subscribeToStateManager(this._chatStateManager));

		// ========== 이벤트 구독 ==========
		this.setupEventSubscriptions();

		// ========== 초기화 ==========
		this._configManager.loadLocalConfig();

		// 초기화 시 유효하지 않은 스냅샷 정리
		setTimeout(() => {
			this._fileService.cleanupInvalidSnapshots();
		}, 1000);

		// CLI 이벤트 핸들러 생성
		const contextProvider = new ClaudeServiceContextProvider(this);
		this._cliEventHandler = this._register(new CLIEventHandler(contextProvider, this.logService));
		this.logService.info(ClaudeService.LOG_CATEGORY, 'CLI event handler created');

		// CLI 이벤트 구독
		this.setupCLIEventSubscriptions();

		// 세션 초기화
		this._sessionService.initialize();

		// 큐 복원
		this.loadQueue();

		// 파일 시스템 워처 설정
		this._register(this._fileWatcherManager.setupFileSystemWatcher());
	}

	// ========== 델리게이트 설정 ==========
	private setupDelegates(): void {
		// SessionService 델리게이트 설정
		this._sessionService.setOnDidChangeStateDelegate((state: ClaudeServiceState) => {
			this._uiService.fireStateChange(state);
		});

		// FileService 델리게이트 설정
		this._fileService.setFileDelegates(
			() => this._sessionService.getCurrentSession(),
			(_sessionId: string) => undefined
		);

		// RateLimitService 델리게이트 설정
		this._rateLimitService.setCoreRateLimitDelegates({
			retryPendingRequest: async (request) => {
				const sessionId = this._sessionService.getCurrentSession()?.id;
				if (!sessionId) {
					throw new Error('No active session for retry');
				}
				this._sessionService.setAccumulatedContent('');
				this._sessionService.clearToolActions();
				await this._multiConnection.sendPrompt(sessionId, request.prompt, request.options);
			}
		});

		// ClaudeMessageService 델리게이트 설정
		this._messageService.setSessionDelegates(
			(sessionId?: string) => {
				if (sessionId) {
					const session = this._sessionService.getSessionById(sessionId);
					return session?.messages || [];
				}
				return this._sessionService.getMessages();
			},
			(message: IClaudeMessage, session?: IClaudeSession) => this._sessionService.updateMessage(message, session),
			(sessionId?: string) => {
				if (sessionId) {
					return this._sessionService.getSessionQueue(sessionId);
				}
				return this._queueService.getQueuedMessages();
			}
		);

		// ClaudeMessageService 핵심 서비스 델리게이트 설정
		this._messageService.setCoreServiceDelegates(
			(content: string, options?: IClaudeSendRequestOptions, sessionId?: string) => sessionId
				? this._chatManager.sendMessageToSessionInternal(sessionId, content, options)
				: this._chatManager.sendMessageInternal(content, options),
			(id: string) => {
				const assistantMessage: IClaudeMessage = {
					id,
					content: '',
					role: 'assistant',
					timestamp: Date.now(),
					isStreaming: true
				};
				return assistantMessage;
			},
			() => this._sessionService.getCurrentSession(),
			() => this._sessionService.hasCurrentSession()
		);

		// ClaudeMessageService 큐 델리게이트 설정
		this._messageService.setQueueDelegates(
			() => {
				// Check if currently streaming
				const currentSessionId = this._multiSessionManager.getCurrentSessionId();
				if (currentSessionId) {
					const sessionState = this._multiSessionManager.getSessionState(currentSessionId);
					return sessionState ? sessionState.state === 'streaming' : false;
				}
				// Fallback to legacy single session
				return this.getState() === 'streaming';
			},
			(content: string, options?: IClaudeSendRequestOptions, sessionId?: string) => {
				// Add to appropriate queue and return a user message placeholder
				if (sessionId) {
					const queuedMessage = this._multiSessionManager.addToSessionQueue(sessionId, content, options, ClaudeService.MAX_QUEUE_SIZE);
					if (queuedMessage) {
						// Return a user message placeholder for immediate UI display
						return {
							id: queuedMessage.id,
							role: 'user' as const,
							content,
							timestamp: queuedMessage.timestamp,
							context: options?.context,
							isQueued: true
						};
					}
				} else {
					const queuedMessage = this._queueService.addToQueue(content, options);
					// Return a user message placeholder for immediate UI display
					return {
						id: queuedMessage.id,
						role: 'user' as const,
						content,
						timestamp: queuedMessage.timestamp,
						context: options?.context,
						isQueued: true
					};
				}

				// Fallback: create a temporary user message
				return {
					id: generateUuid(),
					role: 'user' as const,
					content,
					timestamp: Date.now(),
					context: options?.context,
					isQueued: true
				};
			}
		);

		// ClaudeUIService 델리게이트 설정
		this._uiService.setStateDelegates(
			() => this.state,
			() => this.getStatusInfo(),
			() => this.getCurrentToolAction()
		);

		// ClaudeQueueService 델리게이트 설정
		this._queueService.setQueueDelegates(
			(sessionId: string, queue: IClaudeQueuedMessage[]) => this.saveSessionQueue(sessionId, queue),
			(queue: IClaudeQueuedMessage[]) => this.saveQueue(queue),
			async (content: string, options?: IClaudeSendRequestOptions, sessionId?: string) => {
				if (sessionId) {
					await this._chatManager.sendMessageToSessionInternal(sessionId, content, options);
				} else {
					await this._chatManager.sendMessageInternal(content, options);
				}
			}
		);
	}

	// ========== 이벤트 구독 설정 ==========
	private setupEventSubscriptions(): void {
		// 연결 상태 변경 이벤트 전달
		this._register(this._connection.onDidChangeStatus(() => {
			this._uiService.fireStatusInfoChange(this.getStatusInfo());
		}));

		this._register(this._multiConnection.onDidChangeStatus(() => {
			this._uiService.fireStatusInfoChange(this.getStatusInfo());
		}));
	}

	// ========== CLI 이벤트 구독 ==========
	private setupCLIEventSubscriptions(): void {
		// CLI 이벤트 구독 (Multi-Session)
		this._register(this._multiConnection.onDidReceiveData(event => {
			const currentSessionId = this._sessionService.getCurrentSession()?.id;
			const isCurrentSession = event.chatId === currentSessionId;

			if (isCurrentSession) {
				console.log('[ClaudeService] Received CLI data for session:', event.chatId, event.data.type);
				this.logService.debug(ClaudeService.LOG_CATEGORY, 'Received CLI data:', event.data.type, event.data);
				this._cliEventHandler.handleData(event.data).catch(error => {
					this.logService.error(ClaudeService.LOG_CATEGORY, 'Error handling CLI data:', error);
				});
			} else {
				// 백그라운드 세션만 accumulateSessionContent 사용
				this._multiSessionManager.accumulateSessionContent(event.chatId, event.data);
				console.log('[ClaudeService] Background session data:', event.chatId, event.data.type);
			}
		}));

		// Complete 이벤트
		this._register(this._multiConnection.onDidCompleteAny(event => {
			const currentSessionId = this._sessionService.getCurrentSession()?.id;
			const isCurrentSession = event.chatId === currentSessionId;
			console.log('[ClaudeService] CLI complete for session:', event.chatId, '(current:', currentSessionId, ')');

			if (isCurrentSession) {
				this._cliEventHandler.handleComplete().then(() => {
					this._state = 'idle';
					this._uiService.fireStateChange('idle');
					// ChatStateManager에도 상태 반영
					this._chatStateManager.completeStreaming(event.chatId);
				}).catch(error => {
					this.logService.error(ClaudeService.LOG_CATEGORY, 'Error handling CLI complete:', error);
					this._state = 'idle';
					this._uiService.fireStateChange('idle');
					this._chatStateManager.setError(event.chatId, String(error));
					this._multiSessionManager.handleSessionError(event.chatId);
				});
			} else {
				// 백그라운드 세션 완료 처리
				this._multiSessionManager.handleBackgroundSessionComplete(event.chatId);
				// ChatStateManager에도 상태 반영 -> 자동 큐 처리 트리거
				this._chatStateManager.completeStreaming(event.chatId);
			}
		}));

		// Error 이벤트
		this._register(this._multiConnection.onDidErrorAny(event => {
			const currentSessionId = this._sessionService.getCurrentSession()?.id;
			console.log('[ClaudeService] CLI error for session:', event.chatId, event.error);

			this._multiSessionManager.handleSessionError(event.chatId);

			if (event.chatId === currentSessionId) {
				const isRateLimit = this._rateLimitService.isRateLimitError(event.error);

				if (isRateLimit) {
					this._cliEventHandler.handleError(event.error);
					this._state = 'idle';
					this._uiService.fireStateChange('idle');
					// Rate limit은 별도 상태로 처리
					this._chatStateManager.startRateLimitWait(event.chatId, 60); // 기본 60초
				} else {
					this._multiConnection.setError(event.error);
					this._cliEventHandler.handleError(event.error);
					this._state = 'error';
					this._uiService.fireStateChange('error');
					this._chatStateManager.setError(event.chatId, event.error);
				}
			} else {
				// 백그라운드 세션 에러
				this._chatStateManager.setError(event.chatId, event.error);
			}
		}));
	}

	// ========== Queue Persistence ==========

	private loadQueue(): void {
		const sessionId = this._sessionService.getCurrentSession()?.id;
		if (!sessionId) {
			this.logService.debug(ClaudeService.LOG_CATEGORY, 'No current session, skipping queue load');
			return;
		}

		try {
			const sessionQueueKey = `claude.sessionQueue.${sessionId}`;
			const sessionData = this.storageService.get(sessionQueueKey, StorageScope.WORKSPACE);

			if (sessionData) {
				const parsed = JSON.parse(sessionData) as IClaudeQueuedMessage[];
				if (Array.isArray(parsed)) {
					for (const msg of parsed) {
						this._sessionService.addPendingRequest(msg);
					}
				}
			}

			const globalData = this.storageService.get(ClaudeService.QUEUE_STORAGE_KEY, StorageScope.WORKSPACE);
			if (globalData) {
				const parsed = JSON.parse(globalData) as IClaudeQueuedMessage[];
				if (Array.isArray(parsed)) {
					for (const msg of parsed) {
						this._queueService.addToGlobalQueue(msg);
					}
				}
			}
		} catch (e) {
			this.logService.error(ClaudeService.LOG_CATEGORY, 'Failed to load queue:', e);
		}
	}

	private saveQueue(queue?: IClaudeQueuedMessage[]): void {
		try {
			const data = JSON.stringify(queue ?? this._queueService.getGlobalQueue());
			this.storageService.store(ClaudeService.QUEUE_STORAGE_KEY, data, StorageScope.WORKSPACE, StorageTarget.MACHINE);
		} catch (e) {
			this.logService.error(ClaudeService.LOG_CATEGORY, 'Failed to save queue:', e);
		}
	}

	private saveSessionQueue(sessionId: string, queue?: IClaudeQueuedMessage[]): void {
		const queueToSave = queue || this._multiSessionManager.getSessionQueue(sessionId);
		if (!queueToSave) return;

		try {
			const key = `claude.sessionQueue.${sessionId}`;
			this.storageService.store(key, JSON.stringify(queueToSave), StorageScope.WORKSPACE, StorageTarget.MACHINE);
		} catch (e) {
			this.logService.error(ClaudeService.LOG_CATEGORY, 'Failed to save session queue:', e);
		}
	}

	// ========== Config (ConfigManager로 위임) ==========

	getLocalConfig(): IClaudeLocalConfig {
		return this._configManager.getLocalConfig();
	}

	async reloadLocalConfig(): Promise<void> {
		await this._configManager.reloadLocalConfig();
	}

	// ========== AskUser Response ==========

	async respondToAskUser(responses: string[]): Promise<void> {
		return this._cliEventHandler.respondToAskUser(responses);
	}

	// ========== Rate Limit Handling ==========

	cancelRateLimitWait(): void {
		this._rateLimitService.cancelRateLimitWait();
	}

	getRateLimitStatus(): { waiting: boolean; countdown: number; message?: string } {
		return this._rateLimitService.getRateLimitStatus();
	}

	// ========== State ==========

	get state(): ClaudeServiceState {
		return this._state;
	}

	getState(): ClaudeServiceState {
		return this._sessionService.getState();
	}

	getCurrentSession(): IClaudeSession | undefined {
		return this._sessionService.getCurrentSession();
	}

	getCurrentToolAction(): IClaudeToolAction | undefined {
		return this._currentToolAction;
	}

	// ========== Chat (ChatManager로 위임) ==========

	async sendMessage(content: string, options?: IClaudeSendRequestOptions): Promise<IClaudeMessage> {
		return this._messageService.sendMessage(content, options);
	}

	cancelRequest(): void {
		this._chatManager.cancelRequest();
	}

	// ========== History ==========

	getMessages(): IClaudeMessage[] {
		return this._messageService.getMessages();
	}

	clearHistory(): void {
		this._sessionService.clearHistory();
	}

	// ========== Session ==========

	startNewSession(): IClaudeSession {
		const session = this._sessionService.startNewSession();
		this._sessionService.getSessionState(session.id);
		this._uiService.fireStateChange('idle');
		this._messageService.fireQueueChange([]);

		const connInfo = this._multiConnection.getInfo();
		if (connInfo.status === 'error' || connInfo.status === 'disconnected') {
			this._multiConnection.connect()
				.then(connected => {
					if (connected) {
						this.logService.info(ClaudeService.LOG_CATEGORY, 'Reconnection successful');
					}
				})
				.finally(() => {
					this._uiService.fireStatusInfoChange(this.getStatusInfo());
				});
		}

		return session;
	}

	getSessions(): IClaudeSession[] {
		return this._sessionService.getSessions();
	}

	switchSession(sessionId: string): IClaudeSession | undefined {
		const success = this._sessionService.switchSession(sessionId, () => {
			this._currentToolAction = undefined;
			this._isWaitingForUser = false;
		});

		if (success) {
			const sessionState = this._sessionService.getSessionState(sessionId);
			this._uiService.fireStateChange(sessionState.state);
			this._messageService.fireQueueChange([...sessionState.pendingRequests]);

			const connInfo = this._multiConnection.getInfo();
			if (connInfo.status === 'error' || connInfo.status === 'disconnected') {
				this._multiConnection.connect().then(() => {
					this._uiService.fireStatusInfoChange(this.getStatusInfo());
				});
			}

			return this._sessionService.getSessionById(sessionId);
		}

		return undefined;
	}

	deleteSession(sessionId: string): boolean {
		this._multiConnection.destroySession(sessionId);
		this._multiSessionManager.deleteSessionState(sessionId);

		const key = `claude.sessionQueue.${sessionId}`;
		this.storageService.remove(key, StorageScope.WORKSPACE);

		return this._sessionService.deleteSession(sessionId);
	}

	renameSession(sessionId: string, title: string): boolean {
		return this._sessionService.renameSession(sessionId, title);
	}

	setSessionModel(model: string): void {
		const resolvedModel = model ? resolveModelName(model) : undefined;
		this._chatManager.setSessionModelOverride(resolvedModel || undefined);
		const displayName = resolvedModel ? getModelDisplayName(resolvedModel) : '(cleared)';
		this.logService.info(ClaudeService.LOG_CATEGORY, 'Session model override:', displayName);
		this._uiService.fireStatusInfoChange(this.getStatusInfo());
	}

	setSessionUltrathink(enabled: boolean): void {
		this._chatManager.setSessionUltrathinkOverride(enabled);
		this.logService.info(ClaudeService.LOG_CATEGORY, 'Session ultrathink override:', enabled ? 'ON' : 'OFF');
		this._uiService.fireStatusInfoChange(this.getStatusInfo());
	}

	setSessionAutoAccept(enabled: boolean): void {
		this._sessionAutoAcceptOverride = enabled;
		this.logService.info(ClaudeService.LOG_CATEGORY, 'Session auto-accept override:', enabled ? 'ON' : 'OFF');
	}

	isAutoAcceptEnabled(): boolean {
		return this._sessionAutoAcceptOverride !== undefined
			? this._sessionAutoAcceptOverride
			: (this._configManager.getLocalConfig().autoAccept ?? false);
	}

	async continueLastSession(): Promise<void> {
		this.logService.info(ClaudeService.LOG_CATEGORY, 'Continuing last session...');
		this._chatManager.continueMode = true;
	}

	isSessionRunning(sessionId: string): boolean {
		// ChatStateManager를 통해 상태 확인
		return !this._chatStateManager.isInputEnabled(sessionId);
	}

	isWaitingForUser(): boolean {
		const sessionId = this._sessionService.getCurrentSession()?.id;
		if (sessionId) {
			// ChatStateManager를 통해 상태 확인 (중앙 집중)
			return this._chatStateManager.isWaitingForUser(sessionId);
		}
		// Legacy fallback
		return this._isWaitingForUser;
	}

	// ========== Queue ==========

	getQueuedMessages(): IClaudeQueuedMessage[] {
		const sessionId = this._sessionService.getCurrentSession()?.id;
		return this._queueService.getQueuedMessages(sessionId);
	}

	removeFromQueue(id: string): void {
		const sessionId = this._sessionService.getCurrentSession()?.id;
		this._queueService.removeFromQueue(id, sessionId);
	}

	clearQueue(): void {
		const sessionId = this._sessionService.getCurrentSession()?.id;
		this._queueService.clearQueue(sessionId);
	}

	getMaxQueueSize(): number {
		return this._queueService.getMaxQueueSize();
	}

	updateQueuedMessage(id: string, newContent: string): boolean {
		const sessionId = this._sessionService.getCurrentSession()?.id;
		return this._queueService.updateQueuedMessage(id, newContent, sessionId);
	}

	reorderQueue(fromIndex: number, toIndex: number): boolean {
		const sessionId = this._sessionService.getCurrentSession()?.id;
		return this._queueService.reorderQueue(fromIndex, toIndex, sessionId);
	}

	// ========== Status ==========

	get connection(): ClaudeConnection {
		return this._connection;
	}

	getStatusInfo(): IClaudeStatusInfo {
		const connInfo = this._multiConnection.getInfo();
		const effectiveUltrathink = this._chatManager.getSessionUltrathinkOverride() !== undefined
			? this._chatManager.getSessionUltrathinkOverride()!
			: (this._configManager.getLocalConfig().ultrathink ?? this._ultrathink);

		return {
			connectionStatus: connInfo.status,
			model: this.configurationService.getValue<string>('claude.model') || 'claude-sonnet-4',
			ultrathink: effectiveUltrathink,
			executionMethod: 'cli',
			scriptPath: undefined,
			lastConnected: connInfo.lastConnected,
			version: connInfo.version
		};
	}

	async checkConnection(): Promise<boolean> {
		return this._multiConnection.connect();
	}

	async toggleUltrathink(): Promise<void> {
		this._ultrathink = !this._ultrathink;
		this._chatManager.setSessionUltrathinkOverride(this._ultrathink);
		this.logService.info(ClaudeService.LOG_CATEGORY, 'Ultrathink:', this._ultrathink ? 'ON' : 'OFF');
		this._uiService.fireStatusInfoChange(this.getStatusInfo());
	}

	isUltrathinkEnabled(): boolean {
		return this._chatManager.getSessionUltrathinkOverride() !== undefined
			? this._chatManager.getSessionUltrathinkOverride()!
			: (this._configManager.getLocalConfig().ultrathink ?? this._ultrathink);
	}

	// ========== File Snapshot / Diff ==========

	getChangedFiles(): IClaudeFileChange[] {
		return this._fileService.getChangedFiles();
	}

	getFileChangesSummary(): IClaudeFileChangesSummary {
		return this._fileService.getFileChangesSummary();
	}

	async showFileDiff(fileChange: IClaudeFileChange): Promise<void> {
		await this._fileService.showFileDiff(fileChange);
	}

	async revertFile(fileChange: IClaudeFileChange): Promise<boolean> {
		return this._fileService.revertFile(fileChange);
	}

	async revertAllFiles(): Promise<number> {
		return this._fileService.revertAllFiles();
	}

	acceptFile(fileChange: IClaudeFileChange): void {
		this._fileService.acceptFile(fileChange);
	}

	acceptAllFiles(): void {
		this._fileService.acceptAllFiles();
	}

	async revertSelectedFiles(fileChanges: IClaudeFileChange[]): Promise<number> {
		const filePaths = fileChanges.map(fc => fc.filePath);
		return this._fileService.revertFiles(filePaths);
	}

	acceptSelectedFiles(fileChanges: IClaudeFileChange[]): void {
		const filePaths = fileChanges.map(fc => fc.filePath);
		this._fileService.acceptFiles(filePaths);
	}

	// ========== Session Changes History (HistoryManager로 위임) ==========

	getSessionChangesHistory(): IClaudeSessionChangesHistory {
		return this._historyManager.getSessionChangesHistory();
	}

	// ========== Multi-Session Support Methods ==========

	getMultiConnection(): ClaudeMultiConnection {
		return this._multiConnection;
	}

	async sendMessageToSession(sessionId: string, content: string, options?: IClaudeSendRequestOptions): Promise<IClaudeMessage> {
		// ChatStateManager를 통해 상태 확인 (중앙 집중)
		if (this._chatStateManager.isWaitingForUser(sessionId)) {
			this.logService.warn(ClaudeService.LOG_CATEGORY, 'Cannot send message while waiting for user response');
			return {
				id: generateUuid(),
				role: 'user',
				content,
				timestamp: Date.now(),
				context: options?.context,
				queueRejected: true // UI에서 경고 표시용
			};
		}

		// 입력 가능 상태가 아니면 큐에 추가
		if (!this._chatStateManager.canSendMessage(sessionId)) {
			return this.addToSessionQueue(sessionId, content, options);
		}

		return this._chatManager.sendMessageToSessionInternal(sessionId, content, options);
	}

	private async addToSessionQueue(sessionId: string, content: string, options?: IClaudeSendRequestOptions): Promise<IClaudeMessage> {
		const queuedMessage = this._multiSessionManager.addToSessionQueue(sessionId, content, options, ClaudeService.MAX_QUEUE_SIZE);

		if (!queuedMessage) {
			return {
				id: generateUuid(),
				role: 'user',
				content,
				timestamp: Date.now(),
				context: options?.context,
				queueRejected: true
			};
		}

		this.saveSessionQueue(sessionId);
		this._messageService.fireQueueChange(this._multiSessionManager.getSessionQueue(sessionId));

		return {
			id: queuedMessage.id,
			role: 'user',
			content,
			timestamp: queuedMessage.timestamp,
			context: options?.context
		};
	}

	// processSessionQueue는 ChatStateManager의 onDidBecomeIdle 이벤트로 대체됨
	// QueueService가 자동으로 큐 처리를 시작함

	getSessionQueue(sessionId: string): IClaudeQueuedMessage[] {
		return this._multiSessionManager.getSessionQueue(sessionId);
	}

	getSessionState(sessionId: string): ClaudeServiceState {
		const state = this._multiSessionManager.getSessionState(sessionId);
		return state?.state || 'idle';
	}

	cancelSessionRequest(sessionId: string): void {
		this._multiConnection.cancelRequest(sessionId);
		// ChatStateManager를 통해 상태 전이
		this._chatStateManager.cancelRequest(sessionId);
		this._uiService.fireStateChange('idle');
	}

	sendUserInputToSession(sessionId: string, input: string): void {
		this._multiConnection.sendUserInput(sessionId, input);
	}

	// ========== ContextProvider 접근용 메서드들 ==========

	/**
	 * 상태 설정 (ContextProvider용)
	 */
	setState(state: ClaudeServiceState, sessionId?: string): void {
		this._state = state;
		this._sessionService.setState(state, sessionId);
	}

	/**
	 * Rate limit 처리 시작 (ContextProvider용)
	 */
	startRateLimitHandling(retryAfterSeconds: number, message?: string): void {
		// 마지막 사용자 메시지 찾기 (재시도용)
		let pendingRequest: { prompt: string; options?: IClaudeCLIRequestOptions } | undefined;

		if (this._currentMessageId && this._sessionService.hasCurrentSession()) {
			const messages = this._sessionService.getMessages();
			let lastUserMessage: IClaudeMessage | undefined;
			for (let i = messages.length - 1; i >= 0; i--) {
				if (messages[i].role === 'user') {
					lastUserMessage = messages[i];
					break;
				}
			}

			if (lastUserMessage) {
				const localConfig = this._configManager.getLocalConfig();
				pendingRequest = {
					prompt: lastUserMessage.content,
					options: {
						model: this.configurationService.getValue<string>('claude.model'),
						systemPrompt: this.configurationService.getValue<string>('claude.systemPrompt'),
						workingDir: this._configManager.getWorkspaceRoot(),
						executable: localConfig.executable
					}
				};
			}
		}

		if (pendingRequest) {
			this._rateLimitService.handleRateLimit(retryAfterSeconds, pendingRequest, message);
		}
	}

	/**
	 * 큐 처리 (ContextProvider용)
	 */
	async processQueue(): Promise<void> {
		// 이미 큐 처리 중이면 스킵
		if (this._isProcessingQueue) {
			this.logService.debug(ClaudeService.LOG_CATEGORY, 'Queue already being processed, skipping');
			return;
		}

		const sessionId = this._sessionService.getCurrentSession()?.id;

		// AskUser 대기 중이면 큐 처리 안 함
		if (sessionId) {
			const sessionState = this._sessionService.getSessionState(sessionId);
			if (sessionState.isWaitingForUser || (sessionState as any).isProcessingQueue) {
				return;
			}
			(sessionState as any).isProcessingQueue = true;
		} else {
			if (this._isWaitingForUser) {
				return;
			}
			this._isProcessingQueue = true;
		}

		try {
			await this._queueService.processQueue(sessionId);
		} catch (error) {
			this.logService.error(ClaudeService.LOG_CATEGORY, 'Error processing queue:', error);
		} finally {
			if (sessionId) {
				const sessionState = this._multiSessionManager.getOrCreateSessionState(sessionId);
				sessionState.isProcessingQueue = false;
			} else {
				this._isProcessingQueue = false;
			}
		}
	}

	/**
	 * 명령 완료 시 호출 (ContextProvider용)
	 */
	async handleCommandComplete(): Promise<void> {
		// tool_result 이벤트가 누락된 경우를 대비해 아직 캡처되지 않은 파일들 캡처
		await this._fileService.captureAllPendingModifications();

		const changesSummary = this._fileService.getFileChangesSummary();

		// 디버깅: 스냅샷 상태 출력
		for (const change of changesSummary.changes) {
			this.logService.info(ClaudeService.LOG_CATEGORY, `[FileChanges] - ${change.filePath}: ${change.changeType}, +${change.linesAdded}/-${change.linesRemoved}`);
		}

		// 현재 메시지에 파일 변경사항 추가
		if (changesSummary.changes.length > 0 && this._currentMessageId && this._sessionService.hasCurrentSession()) {
			const messages = this._sessionService.getMessages();
			const currentMessage = messages.find(m => m.id === this._currentMessageId);
			this.logService.info(ClaudeService.LOG_CATEGORY, `[FileChanges] currentMessageId: ${this._currentMessageId}, found: ${!!currentMessage}`);

			if (currentMessage) {
				const updatedMessage: IClaudeMessage = {
					...currentMessage,
					fileChanges: changesSummary
				};
				this._sessionService.updateMessage(updatedMessage);
				this._messageService.fireMessageUpdate(updatedMessage);
				this.logService.info(ClaudeService.LOG_CATEGORY, `[FileChanges] Message updated with ${changesSummary.changes.length} file changes`);
			}
		}
	}

	/**
	 * 파일 서비스 접근용 getter (ContextProvider용)
	 */
	get fileService(): IClaudeFileService {
		return this._fileService;
	}

	/**
	 * Multi-Session 채널 래퍼 생성 (ContextProvider용)
	 */
	_createMultiSessionChannelWrapper(): IChannel {
		return {
			call: async <T>(command: string, args?: unknown[]): Promise<T> => {
				const sessionId = this._sessionService.getCurrentSession()?.id;
				if (!sessionId) {
					throw new Error('No active session for channel call');
				}

				switch (command) {
					case 'sendPrompt': {
						const [prompt, options] = args as [string, unknown];
						return this._multiConnection.sendPrompt(sessionId, prompt, options as any) as Promise<T>;
					}
					case 'sendUserInput': {
						const [input] = args as [string];
						this._multiConnection.sendUserInput(sessionId, input);
						return undefined as T;
					}
					case 'cancelRequest':
						this._multiConnection.cancelRequest(sessionId);
						return undefined as T;
					case 'isRunning':
						return this._multiConnection.isRunning(sessionId) as Promise<T>;
					default:
						throw new Error(`Unknown command: ${command}`);
				}
			},
			listen: <T>(_event: string, _arg?: unknown): Event<T> => {
				// Multi-session에서는 직접 이벤트 구독하므로 여기선 no-op
				return Event.None as Event<T>;
			}
		};
	}
}
