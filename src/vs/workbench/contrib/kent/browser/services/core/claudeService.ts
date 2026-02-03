/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../../../../base/common/event.js';
import { Disposable } from '../../../../../base/common/lifecycle.js';
import { generateUuid } from '../../../../../base/common/uuid.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { IClaudeService, IClaudeSessionChangesHistory, IClaudeChangesHistoryEntry, IClaudeFileChangeSummaryItem } from '../../../common/services/core/claude.js';
import { IClaudeMessageService } from '../../../common/types/claudeMessageService.js';
import { IClaudeQueueService } from '../../../common/types/claudeQueueService.js';
import { IClaudeFileService } from '../../../common/types/claudeFileService.js';
import { IClaudeRateLimitService } from '../../../common/types/claudeRateLimitService.js';
import { IClaudeSessionService } from '../../../common/types/claudeSessionService.js';
import { IClaudeUIService } from '../../../common/types/claudeUIService.js';
import { IClaudeMessage, IClaudeSendRequestOptions, ClaudeServiceState, IClaudeSession, IClaudeToolAction, IClaudeAskUserRequest, IClaudeQueuedMessage, IClaudeStatusInfo, IClaudeUsageInfo, IClaudeFileChange, IClaudeFileChangesSummary, resolveModelName, getModelDisplayName } from '../../../common/types/claudeTypes.js';
import { IClaudeCLIStreamEvent, IClaudeCLIRequestOptions } from '../../../common/claudeCLI.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../../platform/storage/common/storage.js';
import { IFileService, FileChangesEvent } from '../../../../../platform/files/common/files.js';
import { IWorkspaceContextService } from '../../../../../platform/workspace/common/workspace.js';
import { URI } from '../../../../../base/common/uri.js';
import { IClaudeLocalConfig, DEFAULT_LOCAL_CONFIG } from '../../../common/config/claudeLocalConfig.js';
import { ClaudeConnection, ClaudeMultiConnection, ISessionEventCallbacks } from './claudeConnection.js';
import { CLIEventHandler } from './claudeCLIEventHandler.js';
import { ICLIEventHandlerContext } from './cliEventHandlerContext.js';
import { ClaudeContextBuilder } from './claudeContextBuilder.js';
import { ClaudeServiceContextProvider } from './claudeServiceContextProvider.js';
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
// Session state interface is now handled by ClaudeSessionService

/**
 * 기본 세션 상태 생성
 */
// Session state creation is now handled by ClaudeSessionService

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
	private _isProcessingQueue = false;
	private _cliSessionId: string | undefined;
	private _localConfig: IClaudeLocalConfig = DEFAULT_LOCAL_CONFIG;
	private _usage: IClaudeUsageInfo | undefined;

	// Rate limit manager is now handled by ClaudeRateLimitService
	// Session management is now handled by ClaudeSessionService

	// 연결 관리자 (Legacy - 단일 인스턴스)
	private readonly _connection: ClaudeConnection;

	// 멀티 연결 관리자 (Multi-Session)
	private readonly _multiConnection: ClaudeMultiConnection;

	// CLI 이벤트 핸들러
	private readonly _cliEventHandler: CLIEventHandler;

	// 컨텍스트 빌더
	private readonly _contextBuilder: ClaudeContextBuilder;


	// Status 관련
	private _ultrathink = false;
	private _sessionModelOverride: string | undefined;
	private _sessionUltrathinkOverride: boolean | undefined;
	private _sessionAutoAcceptOverride: boolean | undefined;
	private _continueMode = false;

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
		@IFileService private readonly fileService: IFileService,
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
		@IClaudeLogService private readonly logService: IClaudeLogService,
		@IModelService private readonly modelService: IModelService,
		@ITextModelService private readonly textModelService: ITextModelService,
		@IEditorService private readonly editorService: IEditorService,
		@ITextFileService private readonly textFileService: ITextFileService,
		@IClaudeMessageService private readonly _messageService: IClaudeMessageService,
		@IClaudeQueueService private readonly _queueService: IClaudeQueueService,
		@IClaudeFileService private readonly _claudeFileService: IClaudeFileService,
		@IClaudeRateLimitService private readonly _rateLimitService: IClaudeRateLimitService,
		@IClaudeSessionService private readonly _sessionService: IClaudeSessionService,
		@IClaudeUIService private readonly _uiService: IClaudeUIService
	) {
		super();

		// 컨텍스트 빌더 생성
		this._contextBuilder = new ClaudeContextBuilder();

		// SessionService 델리게이트 설정
		this._sessionService.setOnDidChangeStateDelegate((state: ClaudeServiceState) => {
			this._uiService.fireStateChange(state);
		});

		// FileService 델리게이트 설정
		this._fileService.setFileDelegates(
			() => this._sessionService.getCurrentSession(),
			(sessionId: string) => this._sessionService.getCurrentSession()?.id === sessionId ? this._sessionService.getCurrentSession()?.changesHistory : undefined
		);

		// FileService 핵심 기능 델리게이트 설정
		this._fileService.setCoreFileDelegates({
			startCommand: (workingDir?: string) => this.fileService.startCommand(workingDir),
			captureBeforeEdit: (filePath: string) => this.fileService.captureBeforeEdit(filePath),
			captureAfterEdit: (filePath: string) => this.fileService.captureAfterEdit(filePath),
			captureAllPendingModifications: () => this.fileService.captureAllPendingModifications(),
			cleanupInvalidSnapshots: () => this.fileService.cleanupInvalidSnapshots(),
			removeSnapshot: (fileUri: string) => this.fileService.removeSnapshot(fileUri),
			getChangedFiles: () => this.fileService.getChangedFiles(),
			getFileChangesSummary: () => this.fileService.getFileChangesSummary(),
			getSnapshotCount: () => this.fileService.getSnapshotCount(),
			showFileDiff: (fileChange) => this.fileService.showFileDiff(fileChange),
			revertFile: (fileChange) => this.fileService.revertFile(fileChange),
			revertAllFiles: () => this.fileService.revertAllFiles(),
			acceptFile: (fileChange) => this.fileService.acceptFile(fileChange),
			acceptAllFiles: () => this.fileService.acceptAllFiles()
		});

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

		// 연결 관리자 생성 (Legacy 단일 인스턴스)
		this._connection = this._register(new ClaudeConnection(mainProcessService, this.logService));
		this.logService.info(ClaudeService.LOG_CATEGORY, 'Connection manager created');

		// 멀티 연결 관리자 생성 (Multi-Session)
		this._multiConnection = this._register(new ClaudeMultiConnection(mainProcessService, this.logService));
		this.logService.info(ClaudeService.LOG_CATEGORY, 'Multi-connection manager created');

		// 연결 상태 변경 이벤트 전달 (UIService로 위임)
		this._register(this._connection.onDidChangeStatus(() => {
			this._uiService.fireStatusInfoChange(this.getStatusInfo());
		}));

		// 멀티 연결 상태 변경 이벤트 전달 (UIService로 위임)
		this._register(this._multiConnection.onDidChangeStatus(() => {
			this._uiService.fireStatusInfoChange(this.getStatusInfo());
		}));

		// 로컬 설정 로드 (비동기)
		this.loadLocalConfig();

		// 초기화 시 유효하지 않은 스냅샷 정리
		setTimeout(() => {
			this._fileService.cleanupInvalidSnapshots();
		}, 1000); // 1초 후 실행 (초기화 완료 후)

		// CLI 이벤트 핸들러 생성 (최적화된 컨텍스트 패턴 사용)
		const contextProvider = this.createContextProvider();
		this._cliEventHandler = this._register(new CLIEventHandler(contextProvider, this.logService));
		this.logService.info(ClaudeService.LOG_CATEGORY, 'CLI event handler created');

		// CLI 이벤트 구독 (Multi-Session)
		this._register(this._multiConnection.onDidReceiveData(event => {
			const currentSessionId = this._sessionService.getCurrentSession()?.id;
			const isCurrentSession = event.chatId === currentSessionId;

			// 현재 세션: handleData가 컨텐츠 누적 담당 (appendContent 사용)
			// 백그라운드 세션: accumulateSessionContent로 컨텐츠 누적
			// 중복 호출 방지 - 둘 중 하나만 호출
			if (isCurrentSession) {
				console.log('[ClaudeService] Received CLI data for session:', event.chatId, event.data.type);
				this.logService.debug(ClaudeService.LOG_CATEGORY, 'Received CLI data:', event.data.type, event.data);
				this._cliEventHandler.handleData(event.data).catch(error => {
					this.logService.error(ClaudeService.LOG_CATEGORY, 'Error handling CLI data:', error);
				});
			} else {
				// 백그라운드 세션만 accumulateSessionContent 사용
				this.accumulateSessionContent(event.chatId, event.data);
				console.log('[ClaudeService] Background session data:', event.chatId, event.data.type);
			}
		}));

		// Complete 이벤트 - 모든 세션의 상태 업데이트 (중요!)
		this._register(this._multiConnection.onDidCompleteAny(event => {
			const currentSessionId = this._sessionService.getCurrentSession()?.id;
			const isCurrentSession = event.chatId === currentSessionId;
			console.log('[ClaudeService] CLI complete for session:', event.chatId, '(current:', currentSessionId, ')');
			this.logService.debug(ClaudeService.LOG_CATEGORY, 'CLI complete for session:', event.chatId);

			// 세션 상태 가져오기
			const sessionState = this._sessionStates.get(event.chatId);

			// 현재 세션이면 UI 이벤트 핸들러 호출 (await 필수! - 상태 리셋과 큐 처리가 완료된 후에 다음 진행)
			if (isCurrentSession) {
				this._cliEventHandler.handleComplete().then(() => {
					// handleComplete 완료 후 Legacy 상태 업데이트
					this._state = 'idle';
					this._uiService.fireStateChange('idle');
					console.log('[ClaudeService] handleComplete done, legacy state set to idle');
				}).catch(error => {
					this.logService.error(ClaudeService.LOG_CATEGORY, 'Error handling CLI complete:', error);
					// 에러 발생해도 상태 복구
					this._state = 'idle';
					this._uiService.fireStateChange('idle');
					if (sessionState) {
						sessionState.state = 'idle';
						sessionState.isWaitingForUser = false;
					}
				});
			} else if (sessionState) {
				// 백그라운드 세션인 경우: 축적된 컨텐츠를 세션 메시지로 저장
				if (sessionState.currentMessageId && sessionState.accumulatedContent) {
					const session = this._sessionService.getSessionById(event.chatId);
					if (session) {
						const assistantMessage: IClaudeMessage = {
							id: sessionState.currentMessageId,
							role: 'assistant',
							content: sessionState.accumulatedContent,
							timestamp: Date.now(),
							isStreaming: false,
							workEndTime: Date.now()
						};
						this._sessionService.updateMessage(assistantMessage, session);
						console.log('[ClaudeService] Saved background session message:', event.chatId, 'content length:', sessionState.accumulatedContent.length);
					}
				}

				// 백그라운드 세션 상태를 idle로 변경
				sessionState.state = 'idle';
				sessionState.isWaitingForUser = false;
				sessionState.currentMessageId = undefined;
				console.log('[ClaudeService] Background session state reset to idle:', event.chatId);

				// 백그라운드 세션의 큐 처리
				this.processSessionQueue(event.chatId);
			}
		}));

		// Error 이벤트 - 모든 세션의 상태 업데이트
		this._register(this._multiConnection.onDidErrorAny(event => {
			const currentSessionId = this._sessionService.getCurrentSession()?.id;
			console.log('[ClaudeService] CLI error for session:', event.chatId, event.error, '(current:', currentSessionId, ')');
			this.logService.debug(ClaudeService.LOG_CATEGORY, 'CLI error for session:', event.chatId, event.error);

			// 세션 상태를 idle로 변경 (어떤 세션이든)
			const sessionState = this._sessionStates.get(event.chatId);
			if (sessionState) {
				sessionState.state = 'idle';
				sessionState.isWaitingForUser = false;
				console.log('[ClaudeService] Session state reset to idle after error:', event.chatId);
			}

			// 현재 세션이면 UI 이벤트 핸들러도 호출
			if (event.chatId === currentSessionId) {
				// Rate limit 에러인지 먼저 확인
				const isRateLimit = this._rateLimitService.isRateLimitError(event.error);

				if (isRateLimit) {
					// Rate limit 에러: 연결 상태는 유지, rate limit 처리
					console.log('[ClaudeService] Rate limit error detected, keeping connection status');
					this._cliEventHandler.handleError(event.error);
					// Legacy 상태도 업데이트 (rate limit은 idle로)
					this._state = 'idle';
					this._uiService.fireStateChange('idle');
				} else {
					// 일반 에러: 연결 상태를 'error'로 변경 (UI 갱신 트리거)
					this._multiConnection.setError(event.error);
					this._cliEventHandler.handleError(event.error);
					// Legacy 상태도 업데이트 (일반 에러는 'error' 상태 fire)
					this._state = 'error';
					this._uiService.fireStateChange('error');
				}
			}
		}));

		// 세션 초기화 (저장된 세션 로드 + 현재 세션 설정)
		this._sessionService.initialize();

		// 큐 복원 (저장된 큐 로드)
		this.loadQueue();

		// 파일 시스템 이벤트 구독 (파일 변경 시 스냅샷 정리)
		this.setupFileSystemWatcher();

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
				return this.queueService.getQueuedMessages();
			}
		);

		// ClaudeMessageService 핵심 서비스 델리게이트 설정
		this._messageService.setCoreServiceDelegates(
			(content: string, options?: IClaudeSendRequestOptions, sessionId?: string) => sessionId
				? this.sendMessageToSessionInternal(sessionId, content, options)
				: this.sendMessageInternal(content, options),
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

		// ClaudeUIService 델리게이트 설정
		this._uiService.setStateDelegates(
			() => this.state,
			() => this.getStatusInfo(),
			() => this.getCurrentToolAction()
		);

		// ClaudeQueueService 델리게이트 설정
		this.queueService.setQueueDelegates(
			(sessionId: string, queue: IClaudeQueuedMessage[]) => this.saveSessionQueue(sessionId, queue),
			(queue: IClaudeQueuedMessage[]) => this.saveQueue(queue),
			(content: string, options?: IClaudeSendRequestOptions, sessionId?: string) => this.sendMessageInternal(content, options, sessionId)
		);
	}

	// ========== Queue Persistence ==========

	/**
	 * 저장된 큐 로드 (현재 세션의 큐 로드)
	 */
	private loadQueue(): void {
		const sessionId = this._sessionService.getCurrentSession()?.id;
		if (!sessionId) {
			this.logService.debug(ClaudeService.LOG_CATEGORY, 'No current session, skipping queue load');
			return;
		}

		try {
			// 세션별 큐 로드
			const sessionQueueKey = `claude.sessionQueue.${sessionId}`;
			const sessionData = this.storageService.get(sessionQueueKey, StorageScope.WORKSPACE);

			if (sessionData) {
				const parsed = JSON.parse(sessionData) as IClaudeQueuedMessage[];
				if (Array.isArray(parsed)) {
					this.queueService.loadSessionQueue(sessionId, parsed);
				}
			}

			// Legacy: 글로벌 큐도 로드 (마이그레이션 목적)
			const globalData = this.storageService.get(ClaudeService.QUEUE_STORAGE_KEY, StorageScope.WORKSPACE);
			if (globalData) {
				const parsed = JSON.parse(globalData) as IClaudeQueuedMessage[];
				if (Array.isArray(parsed)) {
					this.queueService.loadGlobalQueue(parsed);
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
			const data = JSON.stringify(this.queueService.getGlobalQueue());
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
		// 이미 큐 처리 중이면 스킵 (Race condition 방지)
		if (this._isProcessingQueue) {
			this.logService.debug(ClaudeService.LOG_CATEGORY, 'Queue already being processed, skipping');
			return;
		}

		const sessionId = this._sessionService.getCurrentSession()?.id;

		// AskUser 대기 중이면 큐 처리 안 함
		if (sessionId) {
			const sessionState = this._sessionService.getSessionState(sessionId);
			if (sessionState.isWaitingForUser || (sessionState as any).isProcessingQueue) {
				this.logService.debug(ClaudeService.LOG_CATEGORY, `Waiting for user or processing queue in session ${sessionId}, queue processing paused`);
				return;
			}
			// 세션별 처리 플래그 설정
			(sessionState as any).isProcessingQueue = true;
		} else {
			if (this._isWaitingForUser) {
				this.logService.debug(ClaudeService.LOG_CATEGORY, 'Waiting for user, queue processing paused');
				return;
			}
			this._isProcessingQueue = true;
		}

		try {
			// 큐 처리를 ClaudeQueueService로 위임
			await this.queueService.processQueue(sessionId);
		} catch (error) {
			this.logService.error(ClaudeService.LOG_CATEGORY, 'Error processing queue:', error);
		} finally {
			// 처리 플래그 정리
			if (sessionId) {
				const sessionState = this._sessionService.getSessionState(sessionId);
				(sessionState as any).isProcessingQueue = false;
			} else {
				this._isProcessingQueue = false;
			}
		}
	}

	// ========== Rate Limit Handling ==========

	/**
	 * Rate limit 처리 시작
	 */
	private startRateLimitHandling(retryAfterSeconds: number, message?: string): void {
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
			this._rateLimitService.handleRateLimit(retryAfterSeconds, pendingRequest, message);
		}
	}

	/**
	 * Rate limit 대기 취소
	 */
	cancelRateLimitWait(): void {
		this._rateLimitService.cancel();
	}

	/**
	 * Rate limit 상태 조회
	 */
	getRateLimitStatus(): { waiting: boolean; countdown: number; message?: string } {
		return {
			waiting: this._rateLimitService.isWaiting,
			countdown: this._rateLimitService.countdown,
			message: this._rateLimitService.info?.message
		};
	}

	// ========== Session State Management ==========

	/**
	 * 세션 상태 가져오기 (없으면 생성)
	 */
	// Session state methods are now handled by ClaudeSessionService

	// ========== State ==========

	getState(): ClaudeServiceState {
		return this._sessionService.getState();
	}

	private setState(state: ClaudeServiceState, sessionId?: string): void {
		this._sessionService.setState(state, sessionId);
	}

	getCurrentSession(): IClaudeSession | undefined {
		return this._sessionService.getCurrentSession();
	}

	// ========== Chat ==========

	async sendMessage(content: string, options?: IClaudeSendRequestOptions): Promise<IClaudeMessage> {
		// Delegate to ClaudeMessageService
		return this._messageService.sendMessage(content, options);
	}

	private addToQueue(content: string, options?: IClaudeSendRequestOptions, sessionId?: string): IClaudeMessage {
		// 세션별 큐 사용 (sessionId가 있으면 세션별 큐, 없으면 글로벌 큐)
		if (sessionId) {
			const sessionState = this._sessionService.getSessionState(sessionId);

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
			this._messageService.fireQueueChange([...sessionState.messageQueue]);
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
		if (this.queueService.getGlobalQueue().length >= ClaudeService.MAX_QUEUE_SIZE) {
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

		this.queueService.addToGlobalQueue(queuedMessage);
		this.saveQueue();

		this.logService.debug(ClaudeService.LOG_CATEGORY, 'Message queued:', content.substring(0, 50), 'Queue size:', this.queueService.getGlobalQueue().length);

		return {
			id: queuedMessage.id,
			role: 'user',
			content,
			timestamp: queuedMessage.timestamp,
			context: options?.context
		};
	}

	private async sendMessageInternal(content: string, options?: IClaudeSendRequestOptions): Promise<IClaudeMessage> {
		if (!this._sessionService.hasCurrentSession()) {
			this._sessionService.startNewSession();
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
		this._fileService.startCommand(workingDir);

		// 사용자 메시지 추가 (원본 content 사용)
		const userMessage: IClaudeMessage = {
			id: generateUuid(),
			role: 'user',
			content,
			timestamp: Date.now(),
			context: options?.context
		};

		this._sessionService.addMessage(userMessage);
		this._messageService.fireMessageReceive(userMessage);

		// 사용자 메시지 저장
		this._sessionService.saveSessions();

		// 프롬프트 구성 - continue 모드가 아닐 때만 컨텍스트 포함
		let prompt: string;
		if (continueLastSession) {
			// continue 모드: actualContent만 사용 (빈 문자열 가능)
			prompt = actualContent;
		} else {
			// 일반 모드: 이전 대화 컨텍스트 포함
			prompt = this._contextBuilder.buildPromptWithContext(
				content,
				this._sessionService.getMessages(),
				options?.context
			);
		}

		// 스트리밍 메시지 생성 (헬퍼 메서드로 중복 제거)
		const messageId = generateUuid();
		this.initializeNewMessageState(messageId);

		const now = Date.now();
		const assistantMessage: IClaudeMessage = {
			id: messageId,
			role: 'assistant',
			content: '',
			timestamp: now,
			isStreaming: true,
			workStartTime: now
		};

		this._sessionService.addMessage(assistantMessage);
		this._messageService.fireMessageReceive(assistantMessage);

		// CLI 호출
		this.setState('streaming');
		console.log('[ClaudeService] State set to streaming, calling CLI...');
		this.logService.debug(ClaudeService.LOG_CATEGORY, 'Sending prompt to CLI:', prompt.substring(0, 100));

		try {
			// 먼저 채널이 작동하는지 테스트 (Multi-Session)
			const testSessionId = this._sessionService.getCurrentSession()?.id || 'test';
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

			// 15분 타임아웃 (복잡한 작업은 시간이 오래 걸릴 수 있음)
			// Multi-session: 현재 세션 ID로 전송
			const sessionId = this._sessionService.getCurrentSession()?.id;
			if (!sessionId) {
				throw new Error('No active session');
			}
			console.log('[ClaudeService] Using multi-session sendPrompt for sessionId:', sessionId);
			const timeoutMs = 15 * 60 * 1000; // 15분
			await Promise.race([
				this._multiConnection.sendPrompt(sessionId, prompt, cliOptions),
				new Promise<never>((_, reject) => setTimeout(() => reject(new Error('sendPrompt timeout after 15 minutes')), timeoutMs))
			]);
			this.logService.debug(ClaudeService.LOG_CATEGORY, 'sendPrompt completed, accumulated content:', this._accumulatedContent.substring(0, 100));

			// 완료 후 최종 메시지 반환
			const finalMessage: IClaudeMessage = {
				id: this._currentMessageId,
				role: 'assistant',
				content: this._accumulatedContent,
				timestamp: Date.now(),
				isStreaming: false,
				workEndTime: Date.now()
			};

			return finalMessage;
		} catch (error) {
			this.logService.error(ClaudeService.LOG_CATEGORY, 'sendPrompt error:', error);

			// 타임아웃 에러 시 세션 상태 복구
			const sessionId = this._sessionService.getCurrentSession()?.id;
			if (sessionId) {
				const sessionState = this._sessionStates.get(sessionId);
				if (sessionState) {
					sessionState.state = 'idle';
					sessionState.isWaitingForUser = false;
					console.log('[ClaudeService] Session state reset to idle after timeout:', sessionId);
				}
			}
			this._state = 'idle';
			this._uiService.fireStateChange('idle');

			throw error;
		}
	}

	cancelRequest(): void {
		const sessionId = this._sessionService.getCurrentSession()?.id;
		if (sessionId) {
			this._multiConnection.cancelRequest(sessionId);

			// 세션 상태 초기화
			const sessionState = this._sessionService.getSessionState(sessionId);

			// 현재 스트리밍 중인 메시지 업데이트
			if (sessionState.currentMessageId) {
				const currentSession = this._sessionService.getCurrentSession();
				if (currentSession) {
					const message = currentSession.messages.find(m => m.id === sessionState.currentMessageId);
					if (message && message.isStreaming) {
						const updatedMessage: IClaudeMessage = {
							...message,
							isStreaming: false,
							workEndTime: Date.now()
						};
						if (this._sessionService.updateMessage(updatedMessage)) {
							this._messageService.fireMessageUpdate(updatedMessage);
						}
					}
				}
			}

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

	// ========== History ==========

	getMessages(): IClaudeMessage[] {
		return this.messageService.getMessages();
	}

	clearHistory(): void {
		this._sessionService.clearHistory();
	}

	// ========== Session (SessionManager 위임) ==========

	startNewSession(): IClaudeSession {
		const session = this._sessionService.startNewSession();

		// 새 세션의 상태 초기화
		this._sessionService.getSessionState(session.id);

		// 상태 및 큐 이벤트 발생
		this._uiService.fireStateChange('idle');
		this._messageService.fireQueueChange([]);

		// 연결 상태가 'error'이면 재연결 시도
		const connInfo = this._multiConnection.getInfo();
		if (connInfo.status === 'error' || connInfo.status === 'disconnected') {
			this.logService.info(ClaudeService.LOG_CATEGORY, `Connection status is ${connInfo.status}, attempting reconnect...`);
			// 비동기로 재연결 시도 (UI 블로킹 방지)
			this._multiConnection.connect()
				.then(connected => {
					if (connected) {
						this.logService.info(ClaudeService.LOG_CATEGORY, 'Reconnection successful');
					} else {
						this.logService.warn(ClaudeService.LOG_CATEGORY, 'Reconnection failed');
					}
				})
				.catch(error => {
					this.logService.error(ClaudeService.LOG_CATEGORY, 'Reconnection error:', error);
				})
				.finally(() => {
					// 연결 상태 변경 이벤트 발생 (UI 갱신)
					this._onDidChangeStatusInfo.fire(this.getStatusInfo());
				});
		}

		this.logService.debug(ClaudeService.LOG_CATEGORY, `New session created: ${session.id}`);

		return session;
	}

	getSessions(): IClaudeSession[] {
		return this._sessionService.getSessions();
	}

	/**
	 * 특정 세션으로 전환
	 */
	switchSession(sessionId: string): IClaudeSession | undefined {
		const result = this._sessionService.switchSession(sessionId, () => {
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
			const sessionState = this._sessionService.getSessionState(sessionId);
			this._uiService.fireStateChange(sessionState.state);
			this._messageService.fireQueueChange([...sessionState.messageQueue]);
			this.logService.debug(ClaudeService.LOG_CATEGORY, `Switched to session: ${sessionId}, state: ${sessionState.state}, queue: ${sessionState.messageQueue.length}`);

			// 연결 상태가 'error'이면 재연결 시도
			const connInfo = this._multiConnection.getInfo();
			if (connInfo.status === 'error' || connInfo.status === 'disconnected') {
				this.logService.info(ClaudeService.LOG_CATEGORY, `Connection status is ${connInfo.status}, attempting reconnect on session switch...`);
				this._multiConnection.connect().then(connected => {
					if (connected) {
						this.logService.info(ClaudeService.LOG_CATEGORY, 'Reconnection successful on session switch');
					}
					this._onDidChangeStatusInfo.fire(this.getStatusInfo());
				});
			}
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

		return this._sessionService.deleteSession(sessionId);
	}

	/**
	 * 세션 제목 변경
	 */
	renameSession(sessionId: string, title: string): boolean {
		return this._sessionService.renameSession(sessionId, title);
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
		const sessionId = this._sessionService.getCurrentSession()?.id;
		return this.queueService.getQueuedMessages(sessionId);
	}

	removeFromQueue(id: string): void {
		const sessionId = this._sessionService.getCurrentSession()?.id;
		this.queueService.removeFromQueue(id, sessionId);
	}

	clearQueue(): void {
		const sessionId = this._sessionService.getCurrentSession()?.id;
		this.queueService.clearQueue(sessionId);
	}

	/**
	 * 큐 최대 크기 반환
	 */
	getMaxQueueSize(): number {
		return this.queueService.getMaxQueueSize();
	}

	/**
	 * 큐에 대기 중인 메시지 수정
	 */
	updateQueuedMessage(id: string, newContent: string): boolean {
		const sessionId = this._sessionService.getCurrentSession()?.id;
		return this.queueService.updateQueuedMessage(id, newContent, sessionId);
	}

	/**
	 * 큐 순서 변경
	 */
	reorderQueue(fromIndex: number, toIndex: number): boolean {
		const sessionId = this._sessionService.getCurrentSession()?.id;
		return this.queueService.reorderQueue(fromIndex, toIndex, sessionId);
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
		const execMethod = 'cli'; // Only CLI method supported now
		const scriptPath = undefined; // Script functionality removed
		// Multi-Session 연결 상태 사용 (실제 CLI 통신 상태 반영)
		const connInfo = this._multiConnection.getInfo();

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
		} else {
			this.logService.info(ClaudeService.LOG_CATEGORY, `[FileChanges] Skipping - changes: ${changesSummary.changes.length}, msgId: ${this._currentMessageId}, hasSession: ${this._sessionService.hasCurrentSession()}`);
		}
	}

	/**
	 * 변경된 파일 목록 가져오기
	 */
	getChangedFiles(): IClaudeFileChange[] {
		return this._fileService.getChangedFiles();
	}

	/**
	 * 변경사항 요약 가져오기
	 */
	getFileChangesSummary(): IClaudeFileChangesSummary {
		return this._fileService.getFileChangesSummary();
	}

	/**
	 * 특정 파일의 Diff 표시
	 */
	async showFileDiff(fileChange: IClaudeFileChange): Promise<void> {
		await this._fileService.showFileDiff(fileChange);
	}

	/**
	 * 파일 변경사항 되돌리기
	 */
	async revertFile(fileChange: IClaudeFileChange): Promise<boolean> {
		return this._fileService.revertFile(fileChange);
	}

	/**
	 * 모든 파일 변경사항 되돌리기
	 */
	async revertAllFiles(): Promise<number> {
		return this._fileService.revertAllFiles();
	}

	/**
	 * 파일 변경사항 수락 (스냅샷 제거)
	 */
	acceptFile(fileChange: IClaudeFileChange): void {
		this._fileService.acceptFile(fileChange);
	}

	/**
	 * 모든 파일 변경사항 수락
	 */
	acceptAllFiles(): void {
		this._fileService.acceptAllFiles();
	}

	/**
	 * 선택된 파일들 되돌리기
	 */
	async revertSelectedFiles(fileChanges: IClaudeFileChange[]): Promise<number> {
		const filePaths = fileChanges.map(fc => fc.filePath);
		return this._fileService.revertFiles(filePaths);
	}

	/**
	 * 선택된 파일들 수락
	 */
	acceptSelectedFiles(fileChanges: IClaudeFileChange[]): void {
		const filePaths = fileChanges.map(fc => fc.filePath);
		this._fileService.acceptFiles(filePaths);
	}

	// ========== Session Changes History ==========

	/**
	 * 세션 전체 변경사항 히스토리 가져오기
	 */
	getSessionChangesHistory(): IClaudeSessionChangesHistory {
		const session = this._sessionService.getCurrentSession();
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
		this._messageService.fireQueueChange(sessionState.messageQueue);

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
		const session = this._sessionService.getSessionById(sessionId);
		if (session) {
			this._sessionService.addMessage(userMessage, session);
		}
		this._messageService.fireMessageReceive(userMessage);

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
			this._uiService.fireStateChange(sessionState.state);

		} catch (error) {
			sessionState.state = 'idle';
			this._uiService.fireStateChange(sessionState.state);
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
		this._uiService.fireStateChange(sessionState.state);

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
		this._uiService.fireStateChange(sessionState.state);
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
			isStreaming,
			workEndTime: isStreaming ? undefined : Date.now()
		};

		const session = this._sessionService.getSessionById(sessionId);
		if (session) {
			this._sessionService.updateMessage(message, session);
		}
		this._messageService.fireMessageUpdate(message);
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
	 * 세션 컨텐츠 축적 (백그라운드 세션 포함)
	 * 모든 세션의 CLI 응답을 세션 상태에 저장
	 * 주의: messageId는 sendMessageInternal에서 이미 생성되어 있음
	 */
	private accumulateSessionContent(sessionId: string, event: IClaudeCLIStreamEvent): void {
		const sessionState = this._sessionStates.get(sessionId);
		if (!sessionState) {
			return;
		}

		// assistant 이벤트: 텍스트 컨텐츠 추출
		if (event.type === 'assistant') {
			// 텍스트 컨텐츠 추출 및 축적 (message가 객체인 경우만)
			if (event.message && typeof event.message !== 'string') {
				const messageContent = event.message.content;
				if (messageContent && Array.isArray(messageContent)) {
					for (const block of messageContent) {
						if (block.type === 'text' && block.text) {
							if (sessionState.accumulatedContent) {
								sessionState.accumulatedContent += '\n' + block.text;
							} else {
								sessionState.accumulatedContent = block.text;
							}
						}
					}
				}
			}
		}

		// 스트리밍 텍스트 이벤트
		const text = this.extractTextFromEvent(event);
		if (text) {
			if (sessionState.accumulatedContent) {
				sessionState.accumulatedContent += text;
			} else {
				sessionState.accumulatedContent = text;
			}
		}

		// result 이벤트: 최종 결과
		if (event.type === 'result' && event.result) {
			// result가 문자열이면 최종 컨텐츠로 사용
			if (typeof event.result === 'string' && event.result.trim()) {
				sessionState.accumulatedContent = event.result;
			}
		}
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
				this._messageService.fireQueueChange(sessionState.messageQueue);
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
			this._uiService.fireStateChange(sessionState.state);
		}
	}

	/**
	 * 특정 세션에 사용자 입력 전송
	 */
	sendUserInputToSession(sessionId: string, input: string): void {
		this._multiConnection.sendUserInput(sessionId, input);
	}

	/**
	 * 파일 시스템 이벤트 구독 설정
	 */
	private setupFileSystemWatcher(): void {
		// 파일 변경 이벤트 구독
		// 파일 변경 배칭 최적화 (대량 변경 시 성능 향상)
		this._register(this.fileService.onDidFilesChange((event: FileChangesEvent) => {
			// 변경된 파일들 수집
			const changedFiles = [
				...event.rawAdded,
				...event.rawUpdated,
				...event.rawDeleted
			];

			if (changedFiles.length === 0) {
				return;
			}

			this.logService.debug(ClaudeService.LOG_CATEGORY, '🔍 File change detected:', {
				count: changedFiles.length,
				first3: changedFiles.slice(0, 3).map(f => f.toString())
			});

			// 대량 변경 시 배칭 처리로 UI 블로킹 방지
			if (changedFiles.length > 10) {
				this._batchProcessFileChanges(changedFiles);
			} else {
				this._processFileChangesSync(changedFiles);
			}
		}));

		this.logService.info(ClaudeService.LOG_CATEGORY, '👁️ File system watcher setup completed');
	}

	/**
	 * 소량 파일 변경 시 동기 처리
	 */
	private _processFileChangesSync(changedFiles: URI[]): void {
		this.logService.info(ClaudeService.LOG_CATEGORY, `📝 Sync processing ${changedFiles.length} file changes`);

		for (const fileUri of changedFiles) {
			this._fileService.removeSnapshot(fileUri.toString());
			this.logService.debug(ClaudeService.LOG_CATEGORY, `🗑️ Removed snapshot for: ${fileUri.toString()}`);
		}
	}

	/**
	 * 대량 파일 변경 시 배칭 비동기 처리 (UI 블로킹 방지)
	 */
	private async _batchProcessFileChanges(changedFiles: URI[]): Promise<void> {
		this.logService.info(ClaudeService.LOG_CATEGORY, `📝 Batch processing ${changedFiles.length} file changes`);

		const BATCH_SIZE = 20; // 20개씩 배칭 처리
		const BATCH_DELAY = 10; // 10ms 딜레이 (UI 응답성 유지)

		for (let i = 0; i < changedFiles.length; i += BATCH_SIZE) {
			const batch = changedFiles.slice(i, i + BATCH_SIZE);

			// 배칭 처리
			for (const fileUri of batch) {
				this._fileService.removeSnapshot(fileUri.toString());
			}

			this.logService.debug(ClaudeService.LOG_CATEGORY,
				`🗑️ Processed batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(changedFiles.length / BATCH_SIZE)}`);

			// 다음 배치 전 짧은 대기 (UI 응답성 보장)
			if (i + BATCH_SIZE < changedFiles.length) {
				await new Promise(resolve => setTimeout(resolve, BATCH_DELAY));
			}
		}

		this.logService.info(ClaudeService.LOG_CATEGORY, `✅ Batch processing completed for ${changedFiles.length} files`);
	}

	// ========== Queue Persistence Delegates ==========

	private saveQueue(queue: IClaudeQueuedMessage[]): void {
		try {
			const data = JSON.stringify(queue);
			this.storageService.store(ClaudeService.QUEUE_STORAGE_KEY, data, StorageScope.WORKSPACE, StorageTarget.MACHINE);
		} catch (e) {
			this.logService.error(ClaudeService.LOG_CATEGORY, 'Failed to save global queue:', e);
		}
	}

	private saveSessionQueue(sessionId: string, queue: IClaudeQueuedMessage[]): void {
		try {
			const key = `claude.sessionQueue.${sessionId}`;
			this.storageService.store(key, JSON.stringify(queue), StorageScope.WORKSPACE, StorageTarget.MACHINE);
		} catch (e) {
			this.logService.error(ClaudeService.LOG_CATEGORY, 'Failed to save session queue:', e);
		}
	}

	// ========== 코드 중복 제거 헬퍼 메서드들 ==========

	/**
	 * 새 메시지 시작 시 상태를 초기화하는 헬퍼 메서드
	 * Legacy와 세션별 상태 모두 동기화
	 */
	private initializeNewMessageState(messageId: string): void {
		// Legacy 상태 초기화
		this._currentMessageId = messageId;
		this._accumulatedContent = '';
		this._toolActions = [];
		this._currentToolAction = undefined;

		// 세션 상태 초기화 (있는 경우)
		const sessionState = this._sessionService.getCurrentSessionState();
		if (sessionState) {
			sessionState.currentMessageId = messageId;
			sessionState.accumulatedContent = '';
			sessionState.toolActions = [];
			sessionState.currentToolAction = undefined;
		}
	}

	// ========== Context Provider Implementation ==========

	/**
	 * CLIEventHandler를 위한 컨텍스트 프로바이더 생성
	 * 47개 델리게이트를 대체하는 통합 컨텍스트 제공
	 */
	private createContextProvider(): ICLIEventHandlerContext {
		return {
			session: this._sessionService.getCurrentSession() || undefined,
			getConnection: () => this._connection,

			// Tool actions
			handleToolAction: (toolAction) => {
				this._uiService.setToolAction(toolAction);
			},

			// File operations
			saveFile: async (filePath, content) => {
				await this._fileService.saveFile(filePath, content);
			},

			addMessage: (message) => {
				this._messageService.addMessage(message);
			},

			// Status updates
			updateStatus: (statusInfo) => {
				this._uiService.setStatusInfo(statusInfo);
			},

			// Rate limiting
			checkRateLimit: () => {
				return !this._rateLimitService.isRateLimited();
			},

			// Event subscriptions (델리게이트 대체)
			onStateChange: (callback) => {
				return this._uiService.onDidChangeState(callback);
			},

			onStatusChange: (callback) => {
				return this._uiService.onDidChangeStatusInfo(callback);
			},

			onToolActionChange: (callback) => {
				return this._uiService.onDidChangeToolAction(callback);
			},

			onMessageReceived: (callback) => {
				return this._messageService.onDidReceiveMessage(callback);
			},

			onSessionChange: (callback) => {
				return this._sessionService.onDidChangeSession?.(callback);
			},

			onConnectionChange: (callback) => {
				return this._connection.onDidChangeStatus(callback);
			},

			// Core service access
			getSessionService: () => this._sessionService,
			getMessageService: () => this._messageService,
			getFileService: () => this._fileService,
			getUIService: () => this._uiService,
			getRateLimitService: () => this._rateLimitService
		};
	}
}
