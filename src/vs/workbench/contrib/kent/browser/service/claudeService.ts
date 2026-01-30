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

export class ClaudeService extends Disposable implements IClaudeService {
	declare readonly _serviceBrand: undefined;

	private static readonly LOG_CATEGORY = 'ClaudeService';
	private static readonly MAX_QUEUE_SIZE = 10;
	private static readonly QUEUE_STORAGE_KEY = 'claude.messageQueue';

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
		@IStorageService private readonly storageService: IStorageService,
		@IFileService private readonly fileService: IFileService,
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
		@IClaudeLogService private readonly logService: IClaudeLogService,
		@IModelService private readonly modelService: IModelService,
		@ITextModelService private readonly textModelService: ITextModelService,
		@IEditorService private readonly editorService: IEditorService
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
		// 큐 크기 제한 체크
		if (this._messageQueue.length >= ClaudeService.MAX_QUEUE_SIZE) {
			this.logService.warn(ClaudeService.LOG_CATEGORY, 'Queue is full, cannot add more messages');
			// 큐가 가득 찬 경우에도 메시지 반환 (UI에서 알림 표시용)
			return {
				id: generateUuid(),
				role: 'user',
				content,
				timestamp: Date.now(),
				context: options?.context,
				queueRejected: true // 큐 거부됨 표시
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
		return [...this._messageQueue];
	}

	removeFromQueue(id: string): void {
		const index = this._messageQueue.findIndex(m => m.id === id);
		if (index !== -1) {
			this._messageQueue.splice(index, 1);
			this._onDidChangeQueue.fire([...this._messageQueue]);
			this.saveQueue();
			this.logService.debug(ClaudeService.LOG_CATEGORY, 'Removed from queue:', id);
		}
	}

	clearQueue(): void {
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
		const index = this._messageQueue.findIndex(m => m.id === id);
		if (index === -1) {
			return false;
		}

		// 기존 메시지 교체 (immutable 방식)
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
