/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../../../../base/common/event.js';
import { Disposable } from '../../../../../base/common/lifecycle.js';
import { generateUuid } from '../../../../../base/common/uuid.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { IClaudeService, IClaudeSessionChangesHistory, IClaudeChangesHistoryEntry, IClaudeFileChangeSummaryItem } from '../../common/claude.js';
import { IClaudeMessage, IClaudeSendRequestOptions, ClaudeServiceState, IClaudeSession, IClaudeToolAction, IClaudeAskUserRequest, IClaudeQueuedMessage, IClaudeStatusInfo, IClaudeUsageInfo, IClaudeFileChange, IClaudeFileChangesSummary, resolveModelName, getModelDisplayName } from '../../common/claudeTypes.js';
import { IClaudeCLIStreamEvent, IClaudeCLIRequestOptions } from '../../common/claudeCLI.js';
import { RateLimitManager } from './claudeRateLimitManager.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../../platform/storage/common/storage.js';
import { IFileService } from '../../../../../platform/files/common/files.js';
import { IWorkspaceContextService } from '../../../../../platform/workspace/common/workspace.js';
import { URI } from '../../../../../base/common/uri.js';
import { IClaudeLocalConfig, DEFAULT_LOCAL_CONFIG } from '../../common/claudeLocalConfig.js';
import { ClaudeConnection, ClaudeMultiConnection, ISessionEventCallbacks } from './claudeConnection.js';
import { CLIEventHandler } from './claudeCLIEventHandler.js';
import { ClaudeSessionManager } from './claudeSessionManager.js';
import { ClaudeContextBuilder } from './claudeContextBuilder.js';
import { FileSnapshotManager } from './claudeFileSnapshot.js';
import { IMainProcessService } from '../../../../../platform/ipc/common/mainProcessService.js';
import { IChannel } from '../../../../../base/parts/ipc/common/ipc.js';
import { IClaudeLogService } from '../../common/claudeLogService.js';
import { IModelService } from '../../../../../editor/common/services/model.js';
import { ITextModelService } from '../../../../../editor/common/services/resolverService.js';
import { IEditorService } from '../../../../services/editor/common/editorService.js';
import { ITextFileService } from '../../../../services/textfile/common/textfiles.js';

/**
 * 세션별 상태 인터페이스
 */
interface ISessionState {
	state: ClaudeServiceState;
	currentMessageId: string | undefined;
	accumulatedContent: string;
	toolActions: IClaudeToolAction[];
	currentToolAction: IClaudeToolAction | undefined;
	currentAskUserRequest: IClaudeAskUserRequest | undefined;
	isWaitingForUser: boolean;
	cliSessionId: string | undefined;
	messageQueue: IClaudeQueuedMessage[];
	isProcessingQueue: boolean;
	usage: IClaudeUsageInfo | undefined;
	// 세션별 설정
	modelOverride: string | undefined;
	ultrathinkOverride: boolean | undefined;
	autoAcceptOverride: boolean | undefined;
}

/**
 * 기본 세션 상태 생성
 */
function createDefaultSessionState(): ISessionState {
	return {
		state: 'idle',
		currentMessageId: undefined,
		accumulatedContent: '',
		toolActions: [],
		currentToolAction: undefined,
		currentAskUserRequest: undefined,
		isWaitingForUser: false,
		cliSessionId: undefined,
		messageQueue: [],
		isProcessingQueue: false,
		usage: undefined,
		modelOverride: undefined,
		ultrathinkOverride: undefined,
		autoAcceptOverride: undefined
	};
}

export class ClaudeService extends Disposable implements IClaudeService {
	declare readonly _serviceBrand: undefined;

	private static readonly LOG_CATEGORY = 'ClaudeService';
	private static readonly MAX_QUEUE_SIZE = 10;
	private static readonly QUEUE_STORAGE_KEY = 'claude.messageQueue';

	// ========== Legacy 단일 상태 (하위 호환성) ==========
	private _state: ClaudeServiceState = 'idle';
	private _currentMessageId: string | undefined;
	private _accumulatedContent: string = '';
	private _toolActions: IClaudeToolAction[] = [];
	private _currentToolAction: IClaudeToolAction | undefined;
	private _currentAskUserRequest: IClaudeAskUserRequest | undefined;
	private _isWaitingForUser = false;
	private _cliSessionId: string | undefined;
	private _localConfig: IClaudeLocalConfig = DEFAULT_LOCAL_CONFIG;
	private _messageQueue: IClaudeQueuedMessage[] = [];
	private _isProcessingQueue = false;
	private _usage: IClaudeUsageInfo | undefined;

	// ========== Multi-Session 상태 ==========
	private readonly _sessionStates = new Map<string, ISessionState>();

	// Rate limit 매니저
	private readonly rateLimitManager: RateLimitManager;

	// 연결 관리자 (Legacy - 단일 인스턴스)
	private readonly _connection: ClaudeConnection;

	// 멀티 연결 관리자 (Multi-Session)
	private readonly _multiConnection: ClaudeMultiConnection;

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
		@IStorageService private readonly storageService: IStorageService,
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

		// 연결 관리자 생성 (Legacy 단일 인스턴스)
		this._connection = this._register(new ClaudeConnection(mainProcessService, this.logService));
		this.logService.info(ClaudeService.LOG_CATEGORY, 'Connection manager created');

		// 멀티 연결 관리자 생성 (Multi-Session)
		this._multiConnection = this._register(new ClaudeMultiConnection(mainProcessService, this.logService));
		this.logService.info(ClaudeService.LOG_CATEGORY, 'Multi-connection manager created');

		// 연결 상태 변경 이벤트 전달
		this._register(this._connection.onDidChangeStatus(() => {
			this._onDidChangeStatusInfo.fire(this.getStatusInfo());
		}));

		// 멀티 연결 상태 변경 이벤트 전달
		this._register(this._multiConnection.onDidChangeStatus(() => {
			this._onDidChangeStatusInfo.fire(this.getStatusInfo());
		}));

		// Rate limit 매니저 초기화 (Multi-Session 사용)
		this.rateLimitManager = this._register(new RateLimitManager({
			onRetry: async (request) => {
				const sessionId = this._sessionManager.currentSession?.id;
				if (!sessionId) {
					throw new Error('No active session for retry');
				}
				this._accumulatedContent = '';
				this._toolActions = [];
				this._currentToolAction = undefined;
				await this._multiConnection.sendPrompt(sessionId, request.prompt, request.options);
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

		// CLI 이벤트 핸들러 생성 (세션별 상태 사용)
		this._cliEventHandler = this._register(new CLIEventHandler({
			// 연결 (Multi-Session)
			confirmConnected: () => this._multiConnection.confirmConnected(),

			// 상태
			setState: (state) => this.setState(state),
			getLocalConfig: () => this._localConfig,
			isAutoAcceptEnabled: () => this.isAutoAcceptEnabled(),

			// 메시지 (세션별 상태 사용)
			getCurrentMessageId: () => {
				const sessionState = this._getCurrentSessionState();
				return sessionState?.currentMessageId ?? this._currentMessageId;
			},
			setCurrentMessageId: (id) => {
				const sessionState = this._getCurrentSessionState();
				if (sessionState) {
					sessionState.currentMessageId = id;
				}
				this._currentMessageId = id; // Legacy 호환
			},
			getAccumulatedContent: () => {
				const sessionState = this._getCurrentSessionState();
				return sessionState?.accumulatedContent ?? this._accumulatedContent;
			},
			setAccumulatedContent: (content) => {
				const sessionState = this._getCurrentSessionState();
				if (sessionState) {
					sessionState.accumulatedContent = content;
				}
				this._accumulatedContent = content; // Legacy 호환
			},
			appendContent: (text) => {
				const sessionState = this._getCurrentSessionState();
				if (sessionState) {
					if (sessionState.accumulatedContent) {
						sessionState.accumulatedContent += '\n' + text;
					} else {
						sessionState.accumulatedContent = text;
					}
				}
				// Legacy 호환
				if (this._accumulatedContent) {
					this._accumulatedContent += '\n' + text;
				} else {
					this._accumulatedContent = text;
				}
			},

			// 도구 액션 (세션별 상태 사용)
			getToolActions: () => {
				const sessionState = this._getCurrentSessionState();
				return sessionState?.toolActions ?? this._toolActions;
			},
			addToolAction: (action) => {
				const sessionState = this._getCurrentSessionState();
				if (sessionState) {
					sessionState.toolActions.push(action);
				}
				this._toolActions.push(action); // Legacy 호환
			},
			updateToolAction: (id, update) => {
				const sessionState = this._getCurrentSessionState();
				if (sessionState) {
					const idx = sessionState.toolActions.findIndex(a => a.id === id);
					if (idx !== -1) {
						sessionState.toolActions[idx] = { ...sessionState.toolActions[idx], ...update };
					}
				}
				// Legacy 호환
				const idx = this._toolActions.findIndex(a => a.id === id);
				if (idx !== -1) {
					this._toolActions[idx] = { ...this._toolActions[idx], ...update };
				}
			},
			getCurrentToolAction: () => {
				const sessionState = this._getCurrentSessionState();
				return sessionState?.currentToolAction ?? this._currentToolAction;
			},
			setCurrentToolAction: (action) => {
				const sessionState = this._getCurrentSessionState();
				if (sessionState) {
					sessionState.currentToolAction = action;
				}
				this._currentToolAction = action; // Legacy 호환
				this._onDidChangeToolAction.fire(action);
			},

			// AskUser (세션별 상태 사용)
			getCurrentAskUserRequest: () => {
				const sessionState = this._getCurrentSessionState();
				return sessionState?.currentAskUserRequest ?? this._currentAskUserRequest;
			},
			setCurrentAskUserRequest: (request) => {
				const sessionState = this._getCurrentSessionState();
				if (sessionState) {
					sessionState.currentAskUserRequest = request;
				}
				this._currentAskUserRequest = request; // Legacy 호환
			},
			isWaitingForUser: () => {
				const sessionState = this._getCurrentSessionState();
				return sessionState?.isWaitingForUser ?? this._isWaitingForUser;
			},
			setWaitingForUser: (waiting) => {
				const sessionState = this._getCurrentSessionState();
				if (sessionState) {
					sessionState.isWaitingForUser = waiting;
				}
				this._isWaitingForUser = waiting; // Legacy 호환
			},

			// 세션 (세션별 상태 사용)
			getCliSessionId: () => {
				const sessionState = this._getCurrentSessionState();
				return sessionState?.cliSessionId ?? this._cliSessionId;
			},
			setCliSessionId: (id) => {
				const sessionState = this._getCurrentSessionState();
				if (sessionState) {
					sessionState.cliSessionId = id;
				}
				this._cliSessionId = id; // Legacy 호환
			},
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

			// 채널 (Multi-Session 래퍼)
			getChannel: () => this._createMultiSessionChannelWrapper(),

			// Usage (세션별 상태 사용)
			getUsage: () => {
				const sessionState = this._getCurrentSessionState();
				return sessionState?.usage ?? this._usage;
			},
			setUsage: (usage) => {
				const sessionState = this._getCurrentSessionState();
				if (sessionState) {
					sessionState.usage = usage;
				}
				this._usage = usage; // Legacy 호환
			},

			// File Snapshot (Diff 용)
			captureFileBeforeEdit: (filePath) => this._fileSnapshotManager.captureBeforeEdit(filePath),
			captureFileAfterEdit: (filePath) => this._fileSnapshotManager.captureAfterEdit(filePath),
			onCommandComplete: () => this.handleCommandComplete()
		}, this.logService));
		this.logService.info(ClaudeService.LOG_CATEGORY, 'CLI event handler created');

		// CLI 이벤트 구독 (Multi-Session - chatId로 필터링)
		this._register(this._multiConnection.onDidReceiveData(event => {
			const currentSessionId = this._sessionManager.currentSession?.id;
			// 현재 세션의 이벤트만 처리
			if (event.chatId === currentSessionId) {
				console.log('[ClaudeService] Received CLI data for session:', event.chatId, event.data.type);
				this.logService.debug(ClaudeService.LOG_CATEGORY, 'Received CLI data:', event.data.type, event.data);
				this._cliEventHandler.handleData(event.data).catch(error => {
					this.logService.error(ClaudeService.LOG_CATEGORY, 'Error handling CLI data:', error);
				});
			} else {
				console.log('[ClaudeService] Ignoring CLI data for different session:', event.chatId, '(current:', currentSessionId, ')');
			}
		}));
		this._register(this._multiConnection.onDidCompleteAny(event => {
			const currentSessionId = this._sessionManager.currentSession?.id;
			if (event.chatId === currentSessionId) {
				this.logService.debug(ClaudeService.LOG_CATEGORY, 'CLI complete for session:', event.chatId);
				this._cliEventHandler.handleComplete().catch(error => {
					this.logService.error(ClaudeService.LOG_CATEGORY, 'Error handling CLI complete:', error);
				});
			}
		}));
		this._register(this._multiConnection.onDidErrorAny(event => {
			const currentSessionId = this._sessionManager.currentSession?.id;
			if (event.chatId === currentSessionId) {
				this.logService.debug(ClaudeService.LOG_CATEGORY, 'CLI error for session:', event.chatId, event.error);
				this._cliEventHandler.handleError(event.error);
			}
		}));

		// 세션 초기화 (저장된 세션 로드 + 현재 세션 설정)
		this._sessionManager.initialize();

		// 큐 복원 (저장된 큐 로드)
		this.loadQueue();
	}

	// ========== Queue Persistence ==========

	/**
	 * 저장된 큐 로드
	 */
	private loadQueue(): void {
		try {
			const data = this.storageService.get(ClaudeService.QUEUE_STORAGE_KEY, StorageScope.WORKSPACE);
			if (data) {
				const parsed = JSON.parse(data) as IClaudeQueuedMessage[];
				if (Array.isArray(parsed)) {
					this._messageQueue = parsed;
					this.logService.info(ClaudeService.LOG_CATEGORY, 'Queue loaded:', this._messageQueue.length, 'messages');
					// UI에 알림
					if (this._messageQueue.length > 0) {
						this._onDidChangeQueue.fire([...this._messageQueue]);
					}
				}
			}
		} catch (e) {
			this.logService.error(ClaudeService.LOG_CATEGORY, 'Failed to load queue:', e);
		}
	}

	/**
	 * 큐 저장
	 */
	private saveQueue(): void {
		try {
			const data = JSON.stringify(this._messageQueue);
			this.storageService.store(ClaudeService.QUEUE_STORAGE_KEY, data, StorageScope.WORKSPACE, StorageTarget.MACHINE);
		} catch (e) {
			this.logService.error(ClaudeService.LOG_CATEGORY, 'Failed to save queue:', e);
		}
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
		const sessionId = this._sessionManager.currentSession?.id;

		// 세션별 큐 처리
		if (sessionId) {
			const sessionState = this._getSessionState(sessionId);

			if (sessionState.isProcessingQueue || sessionState.messageQueue.length === 0) {
				return;
			}

			// AskUser 대기 중이면 큐 처리 안 함
			if (sessionState.isWaitingForUser) {
				this.logService.debug(ClaudeService.LOG_CATEGORY, `Waiting for user in session ${sessionId}, queue processing paused`);
				return;
			}

			sessionState.isProcessingQueue = true;

			try {
				const nextMessage = sessionState.messageQueue.shift();
				if (nextMessage) {
					this._onDidChangeQueue.fire([...sessionState.messageQueue]);
					this.saveSessionQueue(sessionId);
					this.logService.debug(ClaudeService.LOG_CATEGORY, `Processing queued message for session ${sessionId}:`, nextMessage.content.substring(0, 50));

					await this.sendMessageInternal(nextMessage.content, { context: nextMessage.context });
				}
			} finally {
				sessionState.isProcessingQueue = false;
			}
			return;
		}

		// Legacy: 글로벌 큐 처리
		if (this._isProcessingQueue || this._messageQueue.length === 0) {
			return;
		}

		if (this._isWaitingForUser) {
			this.logService.debug(ClaudeService.LOG_CATEGORY, 'Waiting for user, queue processing paused');
			return;
		}

		this._isProcessingQueue = true;

		try {
			const nextMessage = this._messageQueue.shift();
			if (nextMessage) {
				this._onDidChangeQueue.fire([...this._messageQueue]);
				this.saveQueue();
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

	// ========== Session State Management ==========

	/**
	 * 세션 상태 가져오기 (없으면 생성)
	 */
	private _getSessionState(sessionId: string): ISessionState {
		let state = this._sessionStates.get(sessionId);
		if (!state) {
			state = createDefaultSessionState();
			this._sessionStates.set(sessionId, state);
			console.log('[ClaudeService] Created new session state for:', sessionId);
		}
		return state;
	}

	/**
	 * 현재 세션의 상태 가져오기
	 */
	private _getCurrentSessionState(): ISessionState | undefined {
		const sessionId = this._sessionManager.currentSession?.id;
		if (!sessionId) {
			return undefined;
		}
		return this._getSessionState(sessionId);
	}

	// ========== State ==========

	getState(): ClaudeServiceState {
		// 현재 세션의 상태 반환
		const sessionState = this._getCurrentSessionState();
		return sessionState?.state ?? 'idle';
	}

	private setState(state: ClaudeServiceState, sessionId?: string): void {
		const targetSessionId = sessionId ?? this._sessionManager.currentSession?.id;
		if (!targetSessionId) {
			// 레거시: 전역 상태 업데이트
			if (this._state !== state) {
				this._state = state;
				this._onDidChangeState.fire(state);
			}
			return;
		}

		const sessionState = this._getSessionState(targetSessionId);
		if (sessionState.state !== state) {
			sessionState.state = state;
			// 현재 세션이면 UI 업데이트
			if (targetSessionId === this._sessionManager.currentSession?.id) {
				this._onDidChangeState.fire(state);
			}
		}
	}

	getCurrentSession(): IClaudeSession | undefined {
		return this._sessionManager.currentSession;
	}

	// ========== Chat ==========

	async sendMessage(content: string, options?: IClaudeSendRequestOptions): Promise<IClaudeMessage> {
		const sessionId = this._sessionManager.currentSession?.id;
		const sessionState = sessionId ? this._getSessionState(sessionId) : undefined;

		console.log('[ClaudeService] sendMessage called, sessionId:', sessionId, 'sessionState:', sessionState?.state, 'content:', content.substring(0, 50));

		// 현재 세션의 상태 확인 (세션별 독립)
		if (sessionState && (sessionState.state !== 'idle' || sessionState.isWaitingForUser)) {
			console.log('[ClaudeService] Session not idle, adding to session queue');
			return this.addToQueue(content, options, sessionId);
		}

		console.log('[ClaudeService] Calling sendMessageInternal');
		return this.sendMessageInternal(content, options);
	}

	private addToQueue(content: string, options?: IClaudeSendRequestOptions, sessionId?: string): IClaudeMessage {
		// 세션별 큐 사용 (sessionId가 있으면 세션별 큐, 없으면 글로벌 큐)
		if (sessionId) {
			const sessionState = this._getSessionState(sessionId);

			// 큐 크기 제한 체크
			if (sessionState.messageQueue.length >= ClaudeService.MAX_QUEUE_SIZE) {
				this.logService.warn(ClaudeService.LOG_CATEGORY, `Session queue is full for ${sessionId}`);
				return {
					id: generateUuid(),
					role: 'user',
					content,
					timestamp: Date.now(),
					context: options?.context,
					queueRejected: true
				};
			}

			const queuedMessage: IClaudeQueuedMessage = {
				id: generateUuid(),
				content,
				context: options?.context,
				timestamp: Date.now()
			};

			sessionState.messageQueue.push(queuedMessage);
			this._onDidChangeQueue.fire([...sessionState.messageQueue]);
			this.saveSessionQueue(sessionId);

			this.logService.debug(ClaudeService.LOG_CATEGORY, `Message queued for session ${sessionId}:`, content.substring(0, 50), 'Queue size:', sessionState.messageQueue.length);

			return {
				id: queuedMessage.id,
				role: 'user',
				content,
				timestamp: queuedMessage.timestamp,
				context: options?.context
			};
		}

		// Legacy: 글로벌 큐 (하위 호환성)
		if (this._messageQueue.length >= ClaudeService.MAX_QUEUE_SIZE) {
			this.logService.warn(ClaudeService.LOG_CATEGORY, 'Queue is full, cannot add more messages');
			return {
				id: generateUuid(),
				role: 'user',
				content,
				timestamp: Date.now(),
				context: options?.context,
				queueRejected: true
			};
		}

		const queuedMessage: IClaudeQueuedMessage = {
			id: generateUuid(),
			content,
			context: options?.context,
			timestamp: Date.now()
		};

		this._messageQueue.push(queuedMessage);
		this._onDidChangeQueue.fire([...this._messageQueue]);
		this.saveQueue();

		this.logService.debug(ClaudeService.LOG_CATEGORY, 'Message queued:', content.substring(0, 50), 'Queue size:', this._messageQueue.length);

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

		// 스트리밍 메시지 생성 (세션 상태도 업데이트)
		const messageId = generateUuid();
		this._currentMessageId = messageId;
		this._accumulatedContent = '';
		this._toolActions = [];
		this._currentToolAction = undefined;

		// 세션 상태 업데이트
		const sessionState = this._getCurrentSessionState();
		if (sessionState) {
			sessionState.currentMessageId = messageId;
			sessionState.accumulatedContent = '';
			sessionState.toolActions = [];
			sessionState.currentToolAction = undefined;
		}

		const assistantMessage: IClaudeMessage = {
			id: messageId,
			role: 'assistant',
			content: '',
			timestamp: Date.now(),
			isStreaming: true
		};

		this._sessionManager.addMessage(assistantMessage);
		this._onDidReceiveMessage.fire(assistantMessage);

		// CLI 호출
		this.setState('streaming');
		console.log('[ClaudeService] State set to streaming, calling CLI...');
		this.logService.debug(ClaudeService.LOG_CATEGORY, 'Sending prompt to CLI:', prompt.substring(0, 100));

		try {
			// 먼저 채널이 작동하는지 테스트 (Multi-Session)
			const testSessionId = this._sessionManager.currentSession?.id || 'test';
			console.log('[ClaudeService] Testing channel with isRunning for session:', testSessionId);
			this.logService.debug(ClaudeService.LOG_CATEGORY, 'Testing channel with isRunning...');
			const isRunning = await Promise.race([
				this._multiConnection.isRunning(testSessionId),
				new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Channel timeout')), 5000))
			]);
			console.log('[ClaudeService] Channel test passed, isRunning:', isRunning);
			this.logService.debug(ClaudeService.LOG_CATEGORY, 'Channel test passed, isRunning:', isRunning);

			console.log('[ClaudeService] Calling sendPrompt...');
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
			// Multi-session: 현재 세션 ID로 전송
			const sessionId = this._sessionManager.currentSession?.id;
			if (!sessionId) {
				throw new Error('No active session');
			}
			console.log('[ClaudeService] Using multi-session sendPrompt for sessionId:', sessionId);
			await Promise.race([
				this._multiConnection.sendPrompt(sessionId, prompt, cliOptions),
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
		const sessionId = this._sessionManager.currentSession?.id;
		if (sessionId) {
			this._multiConnection.cancelRequest(sessionId);

			// 세션 상태 초기화
			const sessionState = this._getSessionState(sessionId);
			sessionState.state = 'idle';
			sessionState.currentMessageId = undefined;
			sessionState.accumulatedContent = '';
		}

		// Legacy 상태 초기화
		this.setState('idle');
		this._currentMessageId = undefined;
		this._accumulatedContent = '';
	}

	/**
	 * Multi-Session 채널 래퍼 생성
	 * CLI EventHandler에서 sendPrompt 호출 시 사용
	 */
	private _createMultiSessionChannelWrapper(): IChannel {
		return {
			call: async <T>(command: string, args?: unknown[]): Promise<T> => {
				const sessionId = this._sessionManager.currentSession?.id;
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

	// ========== History ==========

	getMessages(): IClaudeMessage[] {
		return this._sessionManager.getMessages();
	}

	clearHistory(): void {
		this._sessionManager.clearHistory();
	}

	// ========== Session (SessionManager 위임) ==========

	startNewSession(): IClaudeSession {
		const session = this._sessionManager.startNewSession();

		// 새 세션의 상태 초기화
		this._getSessionState(session.id);

		// 상태 및 큐 이벤트 발생
		this._onDidChangeState.fire('idle');
		this._onDidChangeQueue.fire([]);

		this.logService.debug(ClaudeService.LOG_CATEGORY, `New session created: ${session.id}`);

		return session;
	}

	getSessions(): IClaudeSession[] {
		return this._sessionManager.getSessions();
	}

	/**
	 * 특정 세션으로 전환
	 */
	switchSession(sessionId: string): IClaudeSession | undefined {
		const result = this._sessionManager.switchSession(sessionId, () => {
			// Legacy 상태 초기화 (현재 세션의 상태는 보존됨)
			this._currentMessageId = undefined;
			this._accumulatedContent = '';
			this._toolActions = [];
			this._currentToolAction = undefined;
			this._currentAskUserRequest = undefined;
			this._isWaitingForUser = false;
			this._cliSessionId = undefined;
		});

		if (result) {
			// 새 세션의 상태와 큐 반영
			const sessionState = this._getSessionState(sessionId);
			this._onDidChangeState.fire(sessionState.state);
			this._onDidChangeQueue.fire([...sessionState.messageQueue]);
			this.logService.debug(ClaudeService.LOG_CATEGORY, `Switched to session: ${sessionId}, state: ${sessionState.state}, queue: ${sessionState.messageQueue.length}`);
		}

		return result;
	}

	/**
	 * 세션 삭제
	 */
	deleteSession(sessionId: string): boolean {
		// CLI 인스턴스 정리
		this._multiConnection.destroySession(sessionId);

		// 세션 상태 정리
		this._sessionStates.delete(sessionId);

		// 스토리지에서 세션 큐 삭제
		const key = `claude.sessionQueue.${sessionId}`;
		this.storageService.remove(key, StorageScope.WORKSPACE);

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

	// ========== Queue ==========

	getQueuedMessages(): IClaudeQueuedMessage[] {
		// 현재 세션의 큐 반환
		const sessionId = this._sessionManager.currentSession?.id;
		if (sessionId) {
			const sessionState = this._sessionStates.get(sessionId);
			return sessionState?.messageQueue ? [...sessionState.messageQueue] : [];
		}
		// Legacy: 글로벌 큐
		return [...this._messageQueue];
	}

	removeFromQueue(id: string): void {
		const sessionId = this._sessionManager.currentSession?.id;
		if (sessionId) {
			const sessionState = this._getSessionState(sessionId);
			const index = sessionState.messageQueue.findIndex(m => m.id === id);
			if (index !== -1) {
				sessionState.messageQueue.splice(index, 1);
				this._onDidChangeQueue.fire([...sessionState.messageQueue]);
				this.saveSessionQueue(sessionId);
				this.logService.debug(ClaudeService.LOG_CATEGORY, `Removed from session queue ${sessionId}:`, id);
			}
			return;
		}

		// Legacy: 글로벌 큐
		const index = this._messageQueue.findIndex(m => m.id === id);
		if (index !== -1) {
			this._messageQueue.splice(index, 1);
			this._onDidChangeQueue.fire([...this._messageQueue]);
			this.saveQueue();
			this.logService.debug(ClaudeService.LOG_CATEGORY, 'Removed from queue:', id);
		}
	}

	clearQueue(): void {
		const sessionId = this._sessionManager.currentSession?.id;
		if (sessionId) {
			const sessionState = this._getSessionState(sessionId);
			sessionState.messageQueue = [];
			this._onDidChangeQueue.fire([]);
			this.saveSessionQueue(sessionId);
			this.logService.debug(ClaudeService.LOG_CATEGORY, `Session queue cleared: ${sessionId}`);
			return;
		}

		// Legacy: 글로벌 큐
		this._messageQueue = [];
		this._onDidChangeQueue.fire([]);
		this.saveQueue();
		this.logService.debug(ClaudeService.LOG_CATEGORY, 'Queue cleared');
	}

	/**
	 * 큐 최대 크기 반환
	 */
	getMaxQueueSize(): number {
		return ClaudeService.MAX_QUEUE_SIZE;
	}

	/**
	 * 큐에 대기 중인 메시지 수정
	 */
	updateQueuedMessage(id: string, newContent: string): boolean {
		const sessionId = this._sessionManager.currentSession?.id;
		if (sessionId) {
			const sessionState = this._getSessionState(sessionId);
			const index = sessionState.messageQueue.findIndex(m => m.id === id);
			if (index === -1) {
				return false;
			}

			const oldMessage = sessionState.messageQueue[index];
			sessionState.messageQueue[index] = {
				...oldMessage,
				content: newContent
			};
			this._onDidChangeQueue.fire([...sessionState.messageQueue]);
			this.saveSessionQueue(sessionId);
			this.logService.debug(ClaudeService.LOG_CATEGORY, `Session queue message updated ${sessionId}:`, id);
			return true;
		}

		// Legacy: 글로벌 큐
		const index = this._messageQueue.findIndex(m => m.id === id);
		if (index === -1) {
			return false;
		}

		const oldMessage = this._messageQueue[index];
		this._messageQueue[index] = {
			...oldMessage,
			content: newContent
		};
		this._onDidChangeQueue.fire([...this._messageQueue]);
		this.saveQueue();
		this.logService.debug(ClaudeService.LOG_CATEGORY, 'Queue message updated:', id);
		return true;
	}

	/**
	 * 큐 순서 변경
	 */
	reorderQueue(fromIndex: number, toIndex: number): boolean {
		const sessionId = this._sessionManager.currentSession?.id;
		if (sessionId) {
			const sessionState = this._getSessionState(sessionId);
			if (fromIndex < 0 || fromIndex >= sessionState.messageQueue.length ||
				toIndex < 0 || toIndex >= sessionState.messageQueue.length ||
				fromIndex === toIndex) {
				return false;
			}

			const [item] = sessionState.messageQueue.splice(fromIndex, 1);
			sessionState.messageQueue.splice(toIndex, 0, item);
			this._onDidChangeQueue.fire([...sessionState.messageQueue]);
			this.saveSessionQueue(sessionId);
			this.logService.debug(ClaudeService.LOG_CATEGORY, `Session queue reordered ${sessionId}:`, fromIndex, '->', toIndex);
			return true;
		}

		// Legacy: 글로벌 큐
		if (fromIndex < 0 || fromIndex >= this._messageQueue.length ||
			toIndex < 0 || toIndex >= this._messageQueue.length ||
			fromIndex === toIndex) {
			return false;
		}

		const [item] = this._messageQueue.splice(fromIndex, 1);
		this._messageQueue.splice(toIndex, 0, item);
		this._onDidChangeQueue.fire([...this._messageQueue]);
		this.saveQueue();
		this.logService.debug(ClaudeService.LOG_CATEGORY, 'Queue reordered:', fromIndex, '->', toIndex);
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
	 * 연결 테스트 (Multi-Session에 위임)
	 */
	async checkConnection(): Promise<boolean> {
		return this._multiConnection.connect();
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

	// ========== Multi-Session Support Methods ==========

	/**
	 * 특정 세션의 상태 가져오기 (없으면 생성)
	 */
	private getOrCreateSessionState(sessionId: string): ISessionState {
		let state = this._sessionStates.get(sessionId);
		if (!state) {
			state = createDefaultSessionState();
			this._sessionStates.set(sessionId, state);
			this.logService.debug(ClaudeService.LOG_CATEGORY, `Created session state for: ${sessionId}`);
		}
		return state;
	}

	/**
	 * 멀티 연결 관리자 가져오기
	 */
	getMultiConnection(): ClaudeMultiConnection {
		return this._multiConnection;
	}

	/**
	 * 특정 세션에 프롬프트 전송 (멀티 세션용)
	 */
	async sendMessageToSession(sessionId: string, content: string, options?: IClaudeSendRequestOptions): Promise<IClaudeMessage> {
		const sessionState = this.getOrCreateSessionState(sessionId);

		// 세션이 busy 상태면 큐에 추가
		if (sessionState.state !== 'idle' || sessionState.isWaitingForUser) {
			return this.addToSessionQueue(sessionId, content, options);
		}

		return this.sendMessageToSessionInternal(sessionId, content, options);
	}

	/**
	 * 특정 세션의 큐에 메시지 추가
	 */
	private async addToSessionQueue(sessionId: string, content: string, options?: IClaudeSendRequestOptions): Promise<IClaudeMessage> {
		const sessionState = this.getOrCreateSessionState(sessionId);

		if (sessionState.messageQueue.length >= ClaudeService.MAX_QUEUE_SIZE) {
			throw new Error(`Message queue is full (max ${ClaudeService.MAX_QUEUE_SIZE} messages)`);
		}

		const queuedMessage: IClaudeQueuedMessage = {
			id: generateUuid(),
			content,
			context: options?.context,
			timestamp: Date.now()
		};

		sessionState.messageQueue.push(queuedMessage);
		this.saveSessionQueue(sessionId);
		this._onDidChangeQueue.fire(sessionState.messageQueue);

		this.logService.debug(ClaudeService.LOG_CATEGORY, `Added message to session queue: ${sessionId}, queue size: ${sessionState.messageQueue.length}`);

		// 사용자 메시지 반환
		const userMessage: IClaudeMessage = {
			id: queuedMessage.id,
			role: 'user',
			content,
			timestamp: queuedMessage.timestamp
		};

		return userMessage;
	}

	/**
	 * 특정 세션에 실제로 메시지 전송
	 */
	private async sendMessageToSessionInternal(sessionId: string, content: string, options?: IClaudeSendRequestOptions): Promise<IClaudeMessage> {
		const sessionState = this.getOrCreateSessionState(sessionId);

		// 상태 업데이트
		sessionState.state = 'sending';
		sessionState.accumulatedContent = '';
		sessionState.toolActions = [];
		sessionState.currentToolAction = undefined;

		// 사용자 메시지 생성
		const userMessage: IClaudeMessage = {
			id: generateUuid(),
			role: 'user',
			content,
			timestamp: Date.now()
		};

		// 세션에 메시지 추가
		const session = this._sessionManager.getSessionById(sessionId);
		if (session) {
			this._sessionManager.addMessage(userMessage, session);
		}
		this._onDidReceiveMessage.fire(userMessage);

		// 어시스턴트 메시지 ID 생성
		sessionState.currentMessageId = generateUuid();

		try {
			// 멀티 연결로 이벤트 구독
			const callbacks: ISessionEventCallbacks = {
				onData: (event) => this.handleSessionData(sessionId, event),
				onComplete: () => this.handleSessionComplete(sessionId),
				onError: (error) => this.handleSessionError(sessionId, error)
			};
			this._multiConnection.subscribeToSession(sessionId, callbacks);

			// CLI 옵션 구성
			const workingDir = this._localConfig.workingDirectory
				? (this.getWorkspaceRoot() ? `${this.getWorkspaceRoot()}/${this._localConfig.workingDirectory}` : undefined)
				: this.getWorkspaceRoot();
			const rawModel = sessionState.modelOverride || this._localConfig.model;
			const cliOptions: IClaudeCLIRequestOptions = {
				workingDir,
				model: rawModel ? resolveModelName(rawModel) : undefined,
				resumeSessionId: sessionState.cliSessionId
			};

			// 프롬프트 전송
			await this._multiConnection.sendPrompt(sessionId, content, cliOptions);

			sessionState.state = 'streaming';
			this._onDidChangeState.fire(sessionState.state);

		} catch (error) {
			sessionState.state = 'idle';
			this._onDidChangeState.fire(sessionState.state);
			throw error;
		}

		return userMessage;
	}

	/**
	 * 세션 데이터 이벤트 핸들러
	 */
	private handleSessionData(sessionId: string, event: IClaudeCLIStreamEvent): void {
		const sessionState = this._sessionStates.get(sessionId);
		if (!sessionState) return;

		// 연결 확인
		this._multiConnection.confirmConnected();

		// 텍스트 추출 및 축적
		const text = this.extractTextFromEvent(event);
		if (text) {
			sessionState.accumulatedContent += text;
			this.updateSessionMessage(sessionId);
		}

		// system 이벤트에서 CLI 세션 ID 추출
		if (event.type === 'system' && event.content) {
			const sessionIdMatch = event.content.match(/Session:\s*([a-f0-9-]+)/i);
			if (sessionIdMatch) {
				sessionState.cliSessionId = sessionIdMatch[1];
				this.logService.debug(ClaudeService.LOG_CATEGORY, `CLI session ID for ${sessionId}: ${sessionState.cliSessionId}`);
			}
		}
	}

	/**
	 * 세션 완료 이벤트 핸들러
	 */
	private handleSessionComplete(sessionId: string): void {
		const sessionState = this._sessionStates.get(sessionId);
		if (!sessionState) return;

		this.logService.debug(ClaudeService.LOG_CATEGORY, `Session completed: ${sessionId}`);

		// 최종 메시지 업데이트
		this.updateSessionMessage(sessionId, false);

		// 상태 리셋
		sessionState.state = 'idle';
		sessionState.currentMessageId = undefined;
		this._onDidChangeState.fire(sessionState.state);

		// 큐 처리
		this.processSessionQueue(sessionId);
	}

	/**
	 * 세션 에러 이벤트 핸들러
	 */
	private handleSessionError(sessionId: string, error: string): void {
		const sessionState = this._sessionStates.get(sessionId);
		if (!sessionState) return;

		this.logService.error(ClaudeService.LOG_CATEGORY, `Session error: ${sessionId}`, error);

		sessionState.state = 'idle';
		this._onDidChangeState.fire(sessionState.state);
	}

	/**
	 * 세션 메시지 업데이트
	 */
	private updateSessionMessage(sessionId: string, isStreaming: boolean = true): void {
		const sessionState = this._sessionStates.get(sessionId);
		if (!sessionState || !sessionState.currentMessageId) return;

		const message: IClaudeMessage = {
			id: sessionState.currentMessageId,
			role: 'assistant',
			content: sessionState.accumulatedContent,
			timestamp: Date.now(),
			isStreaming
		};

		const session = this._sessionManager.getSessionById(sessionId);
		if (session) {
			this._sessionManager.updateMessage(message, session);
		}
		this._onDidUpdateMessage.fire(message);
	}

	/**
	 * 이벤트에서 텍스트 추출
	 */
	private extractTextFromEvent(event: IClaudeCLIStreamEvent): string {
		if (event.type === 'content_block_delta' && event.delta?.text) {
			return event.delta.text;
		}
		if (event.type === 'text' && event.content) {
			return event.content;
		}
		return '';
	}

	/**
	 * 세션 큐 처리
	 */
	private async processSessionQueue(sessionId: string): Promise<void> {
		const sessionState = this._sessionStates.get(sessionId);
		if (!sessionState || sessionState.isProcessingQueue || sessionState.messageQueue.length === 0) {
			return;
		}

		sessionState.isProcessingQueue = true;

		try {
			const nextMessage = sessionState.messageQueue.shift();
			if (nextMessage) {
				this.saveSessionQueue(sessionId);
				this._onDidChangeQueue.fire(sessionState.messageQueue);
				await this.sendMessageToSessionInternal(sessionId, nextMessage.content, {
					context: nextMessage.context
				});
			}
		} finally {
			sessionState.isProcessingQueue = false;
		}
	}

	/**
	 * 세션 큐 저장
	 */
	private saveSessionQueue(sessionId: string): void {
		const sessionState = this._sessionStates.get(sessionId);
		if (!sessionState) return;

		const key = `claude.sessionQueue.${sessionId}`;
		this.storageService.store(key, JSON.stringify(sessionState.messageQueue), StorageScope.WORKSPACE, StorageTarget.MACHINE);
	}

	/**
	 * 특정 세션의 큐 가져오기
	 */
	getSessionQueue(sessionId: string): IClaudeQueuedMessage[] {
		const sessionState = this._sessionStates.get(sessionId);
		return sessionState?.messageQueue || [];
	}

	/**
	 * 특정 세션의 상태 가져오기
	 */
	getSessionState(sessionId: string): ClaudeServiceState {
		const sessionState = this._sessionStates.get(sessionId);
		return sessionState?.state || 'idle';
	}

	/**
	 * 특정 세션이 실행 중인지 확인
	 */
	isSessionRunning(sessionId: string): boolean {
		const sessionState = this._sessionStates.get(sessionId);
		return sessionState?.state !== 'idle';
	}

	/**
	 * 특정 세션의 요청 취소
	 */
	cancelSessionRequest(sessionId: string): void {
		this._multiConnection.cancelRequest(sessionId);
		const sessionState = this._sessionStates.get(sessionId);
		if (sessionState) {
			sessionState.state = 'idle';
			this._onDidChangeState.fire(sessionState.state);
		}
	}

	/**
	 * 특정 세션에 사용자 입력 전송
	 */
	sendUserInputToSession(sessionId: string, input: string): void {
		this._multiConnection.sendUserInput(sessionId, input);
	}
}
