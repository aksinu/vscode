/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, append, addDisposableListener, EventType } from '../../../../../../base/browser/dom.js';
import { Codicon } from '../../../../../../base/common/codicons.js';
import { ThemeIcon } from '../../../../../../base/common/themables.js';
import { URI } from '../../../../../../base/common/uri.js';
import { VSBuffer } from '../../../../../../base/common/buffer.js';
import { ICodeEditor } from '../../../../../../editor/browser/editorBrowser.js';
import { IModelService } from '../../../../../../editor/common/services/model.js';
import { ILanguageService } from '../../../../../../editor/common/languages/language.js';
import { localize } from '../../../../../../nls.js';
import { IConfigurationService } from '../../../../../../platform/configuration/common/configuration.js';
import { IContextKeyService } from '../../../../../../platform/contextkey/common/contextkey.js';
import { IContextMenuService } from '../../../../../../platform/contextview/browser/contextView.js';
import { IHoverService } from '../../../../../../platform/hover/browser/hover.js';
import { IInstantiationService } from '../../../../../../platform/instantiation/common/instantiation.js';
import { IKeybindingService } from '../../../../../../platform/keybinding/common/keybinding.js';
import { IOpenerService } from '../../../../../../platform/opener/common/opener.js';
import { IThemeService } from '../../../../../../platform/theme/common/themeService.js';
import { IViewPaneOptions, ViewPane } from '../../../../../browser/parts/views/viewPane.js';
import { IViewDescriptorService } from '../../../../../common/views.js';
import { IClaudeService } from '../../../common/services/core/claude.js';
import { IClaudeCodebaseService } from '../../../common/types/claudeCodebaseService.js';
import { generateUuid } from '../../../../../../base/common/uuid.js';
import { IAssistantMessage, IClaudeAttachment, IClaudeAskUserRequest, IClaudeQueuedMessage, ChatSessionState, getAvailableClaudeModels, getModelDisplayName } from '../../../common/types/claudeTypes.js';
import { CONTEXT_CLAUDE_INPUT_FOCUSED, CONTEXT_CLAUDE_PANEL_FOCUSED, CONTEXT_CLAUDE_REQUEST_IN_PROGRESS } from '../../../common/config/claudeContextKeys.js';
import { IEditorService } from '../../../../../services/editor/common/editorService.js';
import { ClaudeMessageRenderer } from './claudeMessageRenderer.js';
import { AutocompleteManager } from '../ui/claudeAutocomplete.js';
import { StatusBarManager } from '../ui/claudeStatusBar.js';
import { AttachmentManager } from './claudeAttachmentManager.js';
import { LocalSettingsManager } from '../settings/claudeLocalSettings.js';
import { InputEditorManager } from './claudeInputEditor.js';
import { SessionInputManager } from './sessionInputManager.js';
import { CodeApplyManager } from '../ui/claudeCodeApply.js';
import { SessionPickerUI } from '../session/claudeSessionPicker.js';
import { OpenFilesBar } from '../ui/claudeOpenFilesBar.js';
import { ConnectionOverlay } from '../ui/claudeConnectionOverlay.js';
import { ClaudeSettingsPanel } from '../settings/claudeSettingsPanel.js';
import { SessionSettingsPanel, ISessionSettings } from '../settings/claudeSessionSettingsPanel.js';
import { SessionTabs } from '../session/claudeSessionTabs.js';
import { ChangesHistoryPanel } from '../ui/claudeChangesHistoryPanel.js';
import { INotificationService } from '../../../../../../platform/notification/common/notification.js';
import { ITerminalService } from '../../../../terminal/browser/terminal.js';
import { IWorkspaceContextService } from '../../../../../../platform/workspace/common/workspace.js';
import { IFileService } from '../../../../../../platform/files/common/files.js';
import { IQuickInputService } from '../../../../../../platform/quickinput/common/quickInput.js';
import { ITextModelService } from '../../../../../../editor/common/services/resolverService.js';
import { ISCMService } from '../../../../scm/common/scm.js';
import { ClaudePermissionMode } from '../../../common/config/claudeLocalConfig.js';
import {
	GitCommitManager,
	QueueUIManager,
	ClipboardManager,
	MessageListManager,
	ViewConnectionManager
} from './managers/index.js';

export class ClaudeChatViewPane extends ViewPane {

	static readonly ID = 'workbench.view.kent.claudeChat';
	static readonly TITLE = localize('claudeChat', "Claude Chat");

	private container!: HTMLElement;
	private messagesContainer!: HTMLElement;
	private welcomeContainer!: HTMLElement;
	private inputContainer!: HTMLElement;
	private inputEditor!: ICodeEditor;
	private loadingElement!: HTMLElement;
	private attachmentsContainer!: HTMLElement;
	private queueContainer!: HTMLElement;
	private dropOverlay!: HTMLElement;
	private openFilesContainer!: HTMLElement;
	private statusBarContainer!: HTMLElement;
	private sendButton!: HTMLButtonElement;
	private stopButton!: HTMLButtonElement;
	private autocompleteContainer!: HTMLElement;
	private autocompleteManager!: AutocompleteManager;
	private statusBarManager!: StatusBarManager;
	private attachmentManager!: AttachmentManager;
	private localSettingsManager!: LocalSettingsManager;
	private inputEditorManager!: InputEditorManager;
	private sessionInputManager!: SessionInputManager;
	private codeApplyManager!: CodeApplyManager;
	private sessionPicker!: SessionPickerUI;
	private openFilesBar!: OpenFilesBar;
	private connectionOverlay!: ConnectionOverlay;
	private settingsPanel!: ClaudeSettingsPanel;
	private sessionSettingsPanel!: SessionSettingsPanel;
	private sessionSettings: ISessionSettings = { name: '' };
	private sessionTabs!: SessionTabs;
	private changesHistoryPanel!: ChangesHistoryPanel;

	private messageRenderer!: ClaudeMessageRenderer;

	// Managers (모듈화된 로직)
	private gitCommitManager!: GitCommitManager;
	private queueUIManager!: QueueUIManager;
	private clipboardManager!: ClipboardManager;
	private messageListManager!: MessageListManager;
	private viewConnectionManager!: ViewConnectionManager;

	// 이전 세션 메시지 ID 추적 (읽기 전용 처리용)
	private _previousSessionMessageIds: Set<string> = new Set();

	private readonly panelFocusedKey = CONTEXT_CLAUDE_PANEL_FOCUSED.bindTo(this.contextKeyService);
	private readonly inputFocusedKey = CONTEXT_CLAUDE_INPUT_FOCUSED.bindTo(this.contextKeyService);
	private readonly requestInProgressKey = CONTEXT_CLAUDE_REQUEST_IN_PROGRESS.bindTo(this.contextKeyService);

	constructor(
		options: IViewPaneOptions,
		@IKeybindingService keybindingService: IKeybindingService,
		@IContextMenuService contextMenuService: IContextMenuService,
		@IConfigurationService configurationService: IConfigurationService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IViewDescriptorService viewDescriptorService: IViewDescriptorService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IOpenerService openerService: IOpenerService,
		@IThemeService themeService: IThemeService,
		@IHoverService hoverService: IHoverService,
		@IClaudeService private readonly claudeService: IClaudeService,
		@IModelService private readonly modelService: IModelService,
		@ILanguageService private readonly languageService: ILanguageService,
		@IEditorService private readonly editorService: IEditorService,
		@INotificationService private readonly notificationService: INotificationService,
		@IFileService private readonly fileService: IFileService,
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
		@IQuickInputService private readonly quickInputService: IQuickInputService,
		@ITextModelService private readonly textModelService: ITextModelService,
		@ISCMService private readonly scmService: ISCMService,
		@ITerminalService private readonly terminalService: ITerminalService,
		@IClaudeCodebaseService private readonly codebaseService: IClaudeCodebaseService
	) {
		super(options, keybindingService, contextMenuService, configurationService, contextKeyService, viewDescriptorService, instantiationService, openerService, themeService, hoverService);

		// 코드 적용 매니저 생성
		this.codeApplyManager = this._register(new CodeApplyManager(
			this.editorService,
			this.notificationService,
			this.quickInputService,
			this.modelService,
			this.textModelService,
			this.fileService,
			this.workspaceContextService,
			{
				registerDisposable: (d) => this._register(d)
			}
		));

		// 세션 선택 UI 생성
		this.sessionPicker = new SessionPickerUI(
			this.claudeService,
			this.quickInputService,
			this.notificationService,
			{
				clearMessages: () => this.messageListManager?.clearMessages(),
				appendMessage: (message) => this.messageListManager?.appendMessage(message),
				updateWelcomeVisibility: () => this.updateWelcomeVisibility()
			}
		);

		// 메시지 렌더러 생성
		this.messageRenderer = this._register(this.instantiationService.createInstance(ClaudeMessageRenderer, {
			onApplyCode: (code, language, filePath) => this.codeApplyManager.apply(code, language, filePath),
			onRespondToAskUser: (responses: string[], askRequest?: IClaudeAskUserRequest) => this.claudeService.respondToAskUser(responses, askRequest),
			onShowFileDiff: (fileChange) => this.claudeService.showFileDiff?.(fileChange),
			onRevertFile: async (fileChange) => {
				if (this.claudeService.revertFile) {
					return this.claudeService.revertFile(fileChange);
				}
				return false;
			},
			onRevertAllFiles: async () => {
				if (this.claudeService.revertAllFiles) {
					return this.claudeService.revertAllFiles();
				}
				return 0;
			},
			onAcceptFile: (fileChange) => {
				this.claudeService.acceptFile?.(fileChange);
			},
			onAcceptAllFiles: () => {
				this.claudeService.acceptAllFiles?.();
			},
			onRevertSelectedFiles: async (fileChanges) => {
				if (this.claudeService.revertSelectedFiles) {
					return this.claudeService.revertSelectedFiles(fileChanges);
				}
				return 0;
			},
			onAcceptSelectedFiles: (fileChanges) => {
				this.claudeService.acceptSelectedFiles?.(fileChanges);
			}
		}));

		// 서비스 이벤트 구독
		this._register(this.claudeService.onDidReceiveMessage(message => {
			this.messageListManager?.appendMessage(message);
			this.updateWelcomeVisibility();
		}));

		this._register(this.claudeService.onDidUpdateMessage(message => {
			this.messageListManager?.updateMessage(message);
		}));

		this._register(this.claudeService.onDidChangeState((state: string) => {
			console.log('[ClaudeChatView] State changed:', state);
			const inProgress = state === 'sending' || state === 'streaming';
			console.log('[ClaudeChatView] inProgress:', inProgress, 'state:', state);
			this.requestInProgressKey.set(inProgress);
			this.updateLoadingState(state === 'sending'); // 스트리밍 중에는 로딩 숨김
			this.updateSendButton(inProgress);

			// 메시지 렌더러에 세션 상태 동기화
			const sessionState: ChatSessionState = state === 'streaming' ? 'responding' : (state as ChatSessionState);
			this.messageRenderer.updateSessionState(sessionState);

			// 에러 상태 시 연결 오버레이 표시 및 입력 비활성화
			if (state === 'error') {
				this.viewConnectionManager?.handleConnectionLost();
			}

			// idle 상태로 변경 시 추가 확인
			if (state === 'idle') {
				// AskUser 대기 중이면 idle 전환을 무시 (UI 리셋 방지)
				if (this.claudeService.isWaitingForUser?.()) {
					console.log('[ClaudeChatView] State is idle but isWaitingForUser=true, skipping UI reset');
					return;
				}
				console.log('[ClaudeChatView] State is idle, ensuring UI is reset');
				// Cancel 버튼이 확실히 숨겨지도록 강제 업데이트
				if (this.stopButton) {
					this.stopButton.style.display = 'none';
				}
			}

			// 세션 탭 업데이트 (running indicator 반영)
			this.sessionTabs?.render();
		}));

		this._register(this.claudeService.onDidChangeSession(async (session: any) => {
			// SessionInputManager에 새 세션 알림 (중복 호출 방지를 위해 조건부)
			if (session?.id && this.sessionInputManager) {
				const currentSessionId = this.sessionInputManager.getCurrentSessionId();
				if (currentSessionId !== session.id) {
					await this.sessionInputManager.switchToSession(session.id);
				}
			}

			this.messageListManager?.clearMessages();
			// 세션의 메시지들 렌더링
			if (session) {
				for (const message of session.messages) {
					this.messageListManager?.appendMessage(message);
				}
			}
			this.updateWelcomeVisibility();
			// 세션 탭 업데이트
			this.sessionTabs?.render();
		}));

		this._register(this.claudeService.onDidChangeQueue((queue: IClaudeQueuedMessage[]) => {
			this.queueUIManager?.updateQueueUI(queue);
		}));

	}

	protected override renderBody(container: HTMLElement): void {
		super.renderBody(container);

		this.container = append(container, $('.claude-chat-container'));

		// 연결 오버레이 (가장 먼저 생성 - z-index가 높아서 위에 표시됨)
		this.connectionOverlay = this._register(new ConnectionOverlay(this.container, {
			onRetry: () => this.viewConnectionManager?.initializeConnection()
		}));

		// ViewConnectionManager 생성
		this.viewConnectionManager = new ViewConnectionManager(
			this.connectionOverlay,
			this.claudeService,
			this.notificationService,
			{
				setInputEnabled: (enabled) => this.setInputEnabled(enabled)
			}
		);

		// 드롭 오버레이
		this.dropOverlay = append(this.container, $('.claude-drop-overlay'));
		this.dropOverlay.textContent = localize('dropFilesHere', "Drop files here to attach");

		// 환영 메시지
		this.welcomeContainer = append(this.container, $('.claude-welcome'));
		this.renderWelcome();

		// 메시지 영역
		this.messagesContainer = append(this.container, $('.claude-messages'));

		// 로딩 인디케이터
		this.loadingElement = append(this.messagesContainer, $('.claude-loading'));
		this.loadingElement.style.display = 'none';
		append(this.loadingElement, $('.claude-loading-spinner'));
		const loadingText = append(this.loadingElement, $('span'));
		loadingText.textContent = localize('claudeThinking', "Claude is thinking...");

		// 기존 메시지 정보 수집 (MessageListManager 생성 전에 필요)
		const messages = this.claudeService.getMessages();
		const session = this.claudeService.getCurrentSession();
		const previousMessageCount = session?.previousMessageCount || 0;

		// 이전 세션 메시지 ID 수집
		this._previousSessionMessageIds.clear();
		for (let i = 0; i < previousMessageCount; i++) {
			if (messages[i]) {
				this._previousSessionMessageIds.add(messages[i].id);
			}
		}

		// MessageListManager 생성 - isMessageReadOnly 콜백 전달
		this.messageListManager = new MessageListManager(
			this.messagesContainer,
			this.loadingElement,
			this.messageRenderer,
			(messageId) => this._previousSessionMessageIds.has(messageId)
		);

		// 기존 메시지 렌더링
		for (let i = 0; i < messages.length; i++) {
			// 이전 세션과 현재 세션 구분선
			if (previousMessageCount > 0 && i === previousMessageCount) {
				this.messageListManager.appendSessionDivider();
			}
			this.messageListManager.appendMessage(messages[i]);
		}

		// 큐 표시 영역 (입력창 위)
		this.queueContainer = append(this.container, $('.claude-queue-container'));
		this.queueContainer.style.display = 'none';

		// QueueUIManager 생성
		this.queueUIManager = new QueueUIManager(
			this.queueContainer,
			this.claudeService,
			this.quickInputService,
			this.notificationService,
			{
				registerDisposable: (d) => this._register(d)
			}
		);

		// 로컬 설정 매니저
		this.localSettingsManager = new LocalSettingsManager(
			this.workspaceContextService,
			this.fileService,
			this.quickInputService,
			this.notificationService,
			this.editorService,
			{
				reloadLocalConfig: () => this.claudeService.reloadLocalConfig?.()
			}
		);

		// 세션 설정 패널 초기화
		// GitCommitManager 생성
		this.gitCommitManager = new GitCommitManager(
			this.claudeService,
			this.scmService,
			this.terminalService,
			this.workspaceContextService,
			this.notificationService
		);

		this.sessionSettingsPanel = this._register(new SessionSettingsPanel({
			getCurrentSettings: () => this.sessionSettings,
			onSave: (settings) => this.applySessionSettings(settings),
			getAvailableModels: () => this.getAvailableModels(),
			onCommit: (message) => this.gitCommitManager.handleCommitChanges(message),
			hasChangesToCommit: () => this.gitCommitManager.hasChangesToCommit(),
			onPush: () => this.gitCommitManager.handlePush(),
			hasPushableCommits: () => this.gitCommitManager.hasPushableCommits(),
			validateModel: (model) => this.claudeService.validateModel?.(model) ?? Promise.resolve({ valid: true })
		}));

		// 상태 바 (입력창 위)
		this.statusBarContainer = append(this.container, $('.claude-status-bar'));
		this.statusBarManager = this._register(new StatusBarManager(
			this.statusBarContainer,
			{
				getStatusInfo: () => this.claudeService.getStatusInfo?.(),
				checkConnection: () => this.claudeService.checkConnection?.() ?? Promise.resolve(false),
				openLocalSettings: () => this.localSettingsManager.open(),
				openSessionSettings: () => this.sessionSettingsPanel.open(this.container),
				cyclePermissionMode: () => this.cyclePermissionMode(),
				getPermissionMode: () => this.getPermissionMode(),
				toggleThinking: () => this.toggleThinking(),
				isThinkingEnabled: () => this.claudeService.isThinkingEnabled?.() ?? false,
				cycleEffort: () => this.cycleEffort(),
				getEffort: () => this.claudeService.getSessionEffort?.(),
				registerDisposable: (d) => this._register(d)
			}
		));

		// 변경 후 (옵셔널 체이닝 사용)
		const initialStatus = this.claudeService.getStatusInfo?.();
		if (initialStatus) {
			this.statusBarManager.update(initialStatus);
		}

		// 생성 직후 현재 상태로 UI 초기화
		const onStatusChanged = this.claudeService.onDidChangeStatusInfo;
		if (onStatusChanged) {
			this._register(onStatusChanged(status => {
				this.statusBarManager.update(status);
			}));
		}

		// 열린 파일 버튼 영역 (입력창 바로 위)
		this.openFilesContainer = append(this.container, $('.claude-open-files'));

		// 입력 영역
		this.inputContainer = append(this.container, $('.claude-input-container'));
		this.createInputEditor();

		// 초기 연결 시도 (UI 비활성화 상태로 시작)
		this.setInputEnabled(false);
		this.viewConnectionManager.initializeConnection();

		// 드래그/드롭 이벤트 설정
		this.setupDragAndDrop();

		// 환영 메시지 표시 여부
		this.updateWelcomeVisibility();

		// 초기 큐 상태 로드 (현재 세션의 큐)
		const initialQueue = this.claudeService.getQueuedMessages?.() ?? [];
		if (initialQueue.length > 0) {
			this.queueUIManager.updateQueueUI(initialQueue);
		}

		// 포커스 이벤트
		this._register(this.onDidFocus(() => {
			this.panelFocusedKey.set(true);
		}));

		this._register(this.onDidBlur(() => {
			this.panelFocusedKey.set(false);
		}));

		// 전체 설정 패널 초기화
		this.settingsPanel = this._register(new ClaudeSettingsPanel(
			this.fileService,
			this.workspaceContextService,
			this.notificationService,
			{
				reloadLocalConfig: () => this.claudeService.reloadLocalConfig?.(),
				getAvailableModels: () => this.getAvailableModels(),
				onModelSaved: (model) => this.claudeService.saveGlobalModel?.(model),
				validateModel: (model) => this.claudeService.validateModel?.(model) ?? Promise.resolve({ valid: true })
			}
		));

		// 헤더 액션 설정 (설정 버튼)
		this.setupHeaderActions();
	}

	/**
	 * 사용 가능한 모델 목록 반환
	 */
	private getAvailableModels(): string[] {
		return getAvailableClaudeModels();
	}

	/**
	 * 세션 설정 적용
	 */
	private applySessionSettings(settings: ISessionSettings): void {
		this.sessionSettings = settings;

		// 세션 이름이 있으면 제목 업데이트
		if (settings.name) {
			this.updateTitle(settings.name);
		}

		// 모델 오버라이드 적용 (undefined = 기본 모델로 복원, 빈 문자열로 전달하여 오버라이드 제거)
		this.claudeService.setSessionModel?.(settings.model || '');

		// Auto Accept 오버라이드 적용
		if (settings.autoAccept !== undefined) {
			this.claudeService.setSessionAutoAccept?.(settings.autoAccept);
		}

		this.notificationService.info(localize('sessionSettingsSaved', "Session settings saved"));
	}

	/**
	 * 컨테이너 상단에 설정 버튼 및 세션 탭 추가
	 */
	private setupHeaderActions(): void {
		// 헤더 바 생성 (컨테이너 최상단)
		const headerBar = append(this.container, $('.claude-header-bar'));

		// 세션 탭 (헤더 바 왼쪽)
		this.sessionTabs = this._register(new SessionTabs(headerBar, {
			getSessions: () => this.claudeService.getSessions(),
			getCurrentSession: () => this.claudeService.getCurrentSession(),
			isSessionRunning: (sessionId) => this.claudeService.isSessionRunning?.(sessionId) ?? false,
			onNewSession: () => this.createNewSession(),
			onSwitchSession: (sessionId) => this.switchToSession(sessionId),
			onDeleteSession: (sessionId) => this.deleteSession(sessionId),
			onRenameSession: (sessionId, newName) => this.renameSessionById(sessionId, newName)
		}));

		// 오른쪽 버튼들을 담을 컨테이너
		const headerActions = append(headerBar, $('.claude-header-actions'));

		// Clear 버튼 (채팅 기록 삭제)
		const clearButton = append(headerActions, $('button.claude-header-btn'));
		clearButton.title = localize('clearHistory', "Clear Chat History");
		const clearIcon = append(clearButton, $('span.codicon.codicon-clear-all'));
		clearIcon.setAttribute('aria-hidden', 'true');

		this._register(addDisposableListener(clearButton, EventType.CLICK, () => {
			this.claudeService.clearHistory();
			this.messageListManager?.clearMessages();
			this.updateWelcomeVisibility();
			this.sessionTabs?.render();
		}));

		// Changes History 버튼
		const changesButton = append(headerActions, $('button.claude-changes-history-btn'));
		changesButton.title = localize('showChangesHistory', "Show Session Changes");
		const changesIcon = append(changesButton, $('span.codicon.codicon-git-compare'));
		changesIcon.setAttribute('aria-hidden', 'true');
		const changesLabel = append(changesButton, $('span'));
		changesLabel.textContent = localize('changes', "Changes");

		this._register(addDisposableListener(changesButton, EventType.CLICK, () => {
			this.toggleChangesHistory();
		}));

		// 설정 버튼
		const settingsButton = append(headerActions, $('button.claude-header-settings-btn'));
		settingsButton.title = localize('openGlobalSettings', "Global Settings");
		const settingsIcon = append(settingsButton, $('span.codicon.codicon-settings-gear'));
		settingsIcon.setAttribute('aria-hidden', 'true');

		this._register(addDisposableListener(settingsButton, EventType.CLICK, async () => {
			await this.settingsPanel.open(this.container);
		}));

		// 헤더 바를 컨테이너 최상단으로 이동
		if (this.container.firstChild !== headerBar) {
			this.container.insertBefore(headerBar, this.container.firstChild);
		}

		// Changes History 패널 생성
		this.changesHistoryPanel = this._register(new ChangesHistoryPanel(this.container, {
			onShowDiff: (change) => this.claudeService.showFileDiff?.(change),
			onRevertFile: (change) => this.claudeService.revertFile?.(change),
			onClose: () => this.changesHistoryPanel.hide()
		}));

		// 초기 세션 설정 (SessionInputManager와 동기화)
		const currentSession = this.claudeService.getCurrentSession();
		if (currentSession?.id && this.sessionInputManager) {
			this.sessionInputManager.switchToSession(currentSession.id);
		}
	}

	private renderWelcome(): void {
		const iconElement = append(this.welcomeContainer, $('.claude-welcome-icon'));
		iconElement.classList.add(...ThemeIcon.asClassNameArray(Codicon.sparkle));

		const titleElement = append(this.welcomeContainer, $('.claude-welcome-title'));
		titleElement.textContent = localize('claudeWelcomeTitle', "Welcome to Claude");

		const descElement = append(this.welcomeContainer, $('.claude-welcome-description'));
		descElement.textContent = localize('claudeWelcomeDesc', "Ask me anything about your code. I can help you understand, debug, refactor, and write code.");

		// 힌트
		const hintsElement = append(this.welcomeContainer, $('.claude-welcome-hints'));

		const hints = [
			{ icon: Codicon.lightbulb, text: localize('hintExplain', "Explain this code") },
			{ icon: Codicon.bug, text: localize('hintDebug', "Help me debug this error") },
			{ icon: Codicon.edit, text: localize('hintRefactor', "Refactor this function") },
			{ icon: Codicon.add, text: localize('hintWrite', "Write a unit test") }
		];

		for (const hint of hints) {
			const hintElement = append(hintsElement, $('.claude-welcome-hint'));
			const hintIcon = append(hintElement, $('.claude-welcome-hint-icon'));
			hintIcon.classList.add(...ThemeIcon.asClassNameArray(hint.icon));
			const hintText = append(hintElement, $('span'));
			hintText.textContent = hint.text;
		}
	}

	private updateWelcomeVisibility(): void {
		const hasMessages = this.claudeService.getMessages().length > 0;
		this.welcomeContainer.style.display = hasMessages ? 'none' : 'flex';
		this.messagesContainer.style.display = hasMessages ? 'flex' : 'none';
	}

	private updateLoadingState(loading: boolean): void {
		this.loadingElement.style.display = loading ? 'flex' : 'none';
		if (loading) {
			this.messageListManager?.scrollToBottom();
		}
	}

	private createInputEditor(): void {
		// 첨부파일 컨테이너 (입력창 위에)
		this.attachmentsContainer = append(this.inputContainer, $('.claude-attachments'));

		// AttachmentManager 초기화
		this.attachmentManager = this._register(new AttachmentManager(
			this.attachmentsContainer,
			this.dropOverlay,
			this.fileService,
			this.notificationService,
			{
				onAttachmentsChanged: () => this.openFilesBar?.update(),
				registerDisposable: (d) => this._register(d)
			}
		));

		// ClipboardManager 생성
		this.clipboardManager = new ClipboardManager(
			this.attachmentManager,
			this.editorService
		);

		// OpenFilesBar 초기화
		this.openFilesBar = new OpenFilesBar(
			this.openFilesContainer,
			this.editorService,
			{
				isFileAttached: (uri) => this.attachmentManager?.has(uri) ?? false,
				onFileClick: (uri) => this.attachmentManager.addFile(uri),
				registerDisposable: (d) => this._register(d)
			}
		);
		this.openFilesBar.update();

		// 보이는 에디터 변경 시 업데이트
		this._register(this.editorService.onDidVisibleEditorsChange(() => {
			this.openFilesBar.update();
		}));
		this._register(this.editorService.onDidActiveEditorChange(() => {
			this.openFilesBar.update();
		}));

		// 자동완성 팝업 (입력창 위에)
		this.autocompleteContainer = append(this.inputContainer, $('.claude-autocomplete'));
		this.autocompleteContainer.style.display = 'none';

		// 입력 wrapper
		const inputWrapper = append(this.inputContainer, $('.claude-input-wrapper'));

		// InputEditorManager 초기화
		this.inputEditorManager = this._register(new InputEditorManager(
			inputWrapper,
			this.instantiationService,
			this.modelService,
			this.languageService,
			this.configurationService,
			{
				onSubmit: () => this.submitInput(),
				onFocusChange: (focused: boolean) => this.inputFocusedKey.set(focused),
				onContentChange: () => this.autocompleteManager.check(),
				onPaste: (e: ClipboardEvent) => this.clipboardManager.handlePaste(e),
				onKeyDown: (keyCode: number) => this.handleInputKeyDown(keyCode),
				registerDisposable: (d: any) => this._register(d)
			}
		));

		// SessionInputManager 초기화 (InputEditorManager와 AttachmentManager 조합)
		this.sessionInputManager = this._register(new SessionInputManager(
			this.inputEditorManager,
			this.attachmentManager,
			{
				onSubmit: () => this.submitInput(),
				onFocusChange: (focused) => this.inputFocusedKey.set(focused),
				onContentChange: () => this.autocompleteManager.check(),
				onPaste: (e) => this.clipboardManager.handlePaste(e),
				onKeyDown: (keyCode) => this.handleInputKeyDown(keyCode),
				onSessionStateChanged: (sessionId, hasContent) => this.onSessionInputStateChanged(sessionId, hasContent),
				registerDisposable: (d) => this._register(d)
			}
		));

		// 이전 inputEditor 참조 유지 (하위 호환성)
		this.inputEditor = this.inputEditorManager.editorInstance;

		// AutocompleteManager 초기화
		this.autocompleteManager = this._register(new AutocompleteManager(
			this.autocompleteContainer,
			this.inputEditor,
			this.editorService,
			{
				onAttachFile: (uri) => this.attachmentManager.addFile(uri),
				onAttachWorkspace: () => this.attachWorkspaceContext(),
				onAttachSelection: () => this.attachEditorSelection(),
				onAttachCodebase: () => this.attachCodebaseContext(),
				onCommandSelected: (prompt) => this.sessionInputManager.setCommandPrompt(prompt),
				onBuiltinCommand: (commandId) => this.handleBuiltinCommand(commandId),
				registerDisposable: (d) => this._register(d)
			}
		));

		// 중지 버튼 (스트리밍 중에만 표시)
		this.stopButton = append(inputWrapper, $('button.claude-stop-button')) as HTMLButtonElement;
		this.stopButton.title = localize('cancelRequest', "Cancel request");
		append(this.stopButton, $('.codicon.codicon-stop-circle'));
		this.stopButton.style.display = 'none';

		this._register(addDisposableListener(this.stopButton, EventType.CLICK, () => {
			console.log('[ClaudeChatView] Stop button clicked');
			this.claudeService.cancelRequest();
		}));

		// 전송 버튼
		this.sendButton = append(inputWrapper, $('button.claude-send-button')) as HTMLButtonElement;
		this.sendButton.title = localize('sendMessage', "Send message");
		append(this.sendButton, $('.codicon.codicon-send'));

		this._register(addDisposableListener(this.sendButton, EventType.CLICK, () => {
			this.submitInput();
		}));

		// 하단 툴바 (입력창 아래, 오른쪽 정렬)
		const inputFooter = append(this.inputContainer, $('.claude-input-footer'));

		// 첨부 버튼
		const attachButton = append(inputFooter, $('button.claude-footer-button'));
		attachButton.title = localize('attachContext', "Attach context (drag & drop files or click)");
		append(attachButton, $('.codicon.codicon-attach'));

		this._register(addDisposableListener(attachButton, EventType.CLICK, () => {
			this.attachCurrentEditorFile();
		}));

		// 세션 관리 버튼
		const sessionButton = append(inputFooter, $('button.claude-footer-button'));
		sessionButton.title = localize('manageSessions', "Manage sessions");
		append(sessionButton, $('.codicon.codicon-layers'));

		this._register(addDisposableListener(sessionButton, EventType.CLICK, () => {
			this.sessionPicker.show();
		}));

		// 설정 버튼
		const settingsButton = append(inputFooter, $('button.claude-footer-button'));
		settingsButton.title = localize('openLocalSettings', "Open local settings (.vscode/claude.local.json)");
		append(settingsButton, $('.codicon.codicon-settings-gear'));

		this._register(addDisposableListener(settingsButton, EventType.CLICK, () => {
			this.localSettingsManager.open();
		}));
	}

	private async submitInput(): Promise<void> {
		const content = this.sessionInputManager.getValue().trim();
		if (!content) {
			return;
		}

		// 컨텍스트: 수동 첨부파일만 포함 (자동 컨텍스트 비활성화)
		// 중요: clearCurrentSessionState() 호출 전에 첨부파일을 먼저 복사해야 함!
		let context: { attachments?: IClaudeAttachment[] } | undefined;

		// 첨부파일이 있을 때만 컨텍스트 생성
		if (this.sessionInputManager.attachments.count > 0) {
			context = {
				attachments: [...this.sessionInputManager.attachments.attachments]
			};
		}

		// @codebase 첨부 처리: 플레이스홀더를 실제 검색 결과로 변환
		if (context?.attachments?.some(a => a.type === 'codebase')) {
			context = await this.resolveCodebaseAttachments(content, context);
		}

		// 입력 초기화 (첨부파일 복사 후에 호출)
		this.sessionInputManager.clearCurrentSessionState();

		try {
			// 상태 체크는 sendMessage 내부에서 처리 (idle 아니면 큐에 추가)
			const result = await this.claudeService.sendMessage(content, { context });

			// 큐가 가득 찬 경우 경고
			if (result.queueRejected) {
				const maxSize = this.claudeService.getMaxQueueSize?.() ?? 10;
				this.notificationService.warn(
					localize('queueFull', "Queue is full (max {0} messages). Please wait for current request to complete.", maxSize)
				);
				// 입력창에 내용 복원
				this.sessionInputManager.setValue(content);
				return;
			}

			this.messageListManager?.scrollToBottom();
		} catch (error) {
			// 에러는 서비스에서 처리됨
		}
	}

	// ========== 드래그/드롭 ==========

	private setupDragAndDrop(): void {
		let dragCounter = 0;

		this._register(addDisposableListener(this.container, EventType.DRAG_ENTER, (e: DragEvent) => {
			e.preventDefault();
			e.stopPropagation();
			dragCounter++;

			if (e.dataTransfer?.types.includes('Files') || e.dataTransfer?.types.includes('text/uri-list')) {
				this.attachmentManager.showDropOverlay();
			}
		}));

		this._register(addDisposableListener(this.container, EventType.DRAG_LEAVE, (e: DragEvent) => {
			e.preventDefault();
			e.stopPropagation();
			dragCounter--;

			if (dragCounter === 0) {
				this.attachmentManager.hideDropOverlay();
			}
		}));

		this._register(addDisposableListener(this.container, EventType.DRAG_OVER, (e: DragEvent) => {
			e.preventDefault();
			e.stopPropagation();
			if (e.dataTransfer) {
				e.dataTransfer.dropEffect = 'copy';
			}
		}));

		this._register(addDisposableListener(this.container, EventType.DROP, async (e: DragEvent) => {
			e.preventDefault();
			e.stopPropagation();
			dragCounter = 0;
			this.attachmentManager.hideDropOverlay();

			await this.attachmentManager.handleDrop(e);
		}));
	}

	// ========== 첨부파일 관리 ==========

	private attachCurrentEditorFile(): void {
		const editor = this.editorService.activeTextEditorControl;
		if (!editor || !('getModel' in editor)) {
			this.notificationService.info(localize('noActiveEditorToAttach', "No active editor to attach"));
			return;
		}

		const codeEditor = editor as ICodeEditor;
		const model = codeEditor.getModel();

		if (model?.uri) {
			this.attachmentManager.addFile(model.uri);
		}
	}

	override focus(): void {
		super.focus();
		this.sessionInputManager?.focus();
	}

	protected override layoutBody(height: number, width: number): void {
		super.layoutBody(height, width);

		// CSS flexbox가 레이아웃을 처리하도록 컨테이너 높이만 설정
		this.container.style.height = `${height}px`;

		// 에디터 레이아웃은 DOM 렌더링 후 계산
		requestAnimationFrame(() => {
			this.sessionInputManager?.layout();
		});
	}

	override dispose(): void {
		this.messageListManager?.dispose();
		this.queueUIManager?.dispose();
		super.dispose();
	}

	// ========== 자동완성 헬퍼 ==========

	/**
	 * 에디터 선택 영역 첨부 (@selection)
	 */
	private attachEditorSelection(): void {
		const editor = this.editorService.activeTextEditorControl;
		if (!editor || !('getModel' in editor)) {
			this.notificationService.info(localize('noActiveEditor', "No active editor"));
			return;
		}

		const codeEditor = editor as ICodeEditor;
		const selection = codeEditor.getSelection();
		const model = codeEditor.getModel();

		if (!selection || !model || selection.isEmpty()) {
			this.notificationService.info(localize('noSelection', "No text selected in the editor"));
			return;
		}

		const selectedText = model.getValueInRange(selection);
		const fileName = model.uri.path.split('/').pop() || 'unknown';

		this.attachmentManager.addSelection(
			fileName,
			selectedText,
			model.uri,
			model.getLanguageId(),
			selection.startLineNumber,
			selection.endLineNumber
		);
	}

	/**
	 * 워크스페이스 컨텍스트 첨부
	 */
	private attachWorkspaceContext(): void {
		const workspaceFolder = this.workspaceContextService.getWorkspace().folders[0];
		if (!workspaceFolder) {
			this.notificationService.warn(localize('noWorkspaceToAttach', "No workspace folder open"));
			return;
		}

		this.attachmentManager.addWorkspace(workspaceFolder.name, workspaceFolder.uri);
	}

	/**
	 * 코드베이스 검색 컨텍스트 첨부
	 * @codebase 멘션 시 호출 — 플레이스홀더 첨부 추가, 전송 시 BM25 검색 실행
	 */
	private attachCodebaseContext(): void {
		this.attachmentManager.addCodebaseSearch();
	}

	/**
	 * @codebase 플레이스홀더를 실제 검색 결과 파일 첨부로 변환
	 */
	private async resolveCodebaseAttachments(
		query: string,
		context: { attachments?: IClaudeAttachment[] }
	): Promise<{ attachments?: IClaudeAttachment[] }> {
		const attachments = context.attachments || [];
		const resolved: IClaudeAttachment[] = [];

		for (const attachment of attachments) {
			if (attachment.type === 'codebase') {
				// BM25 검색 실행
				try {
					const results = await this.codebaseService.search(query, 8);
					for (const result of results) {
						// 검색 결과 파일을 file 첨부로 변환
						try {
							const fileContent = await this.fileService.readFile(result.uri);
							let content = fileContent.value.toString();
							if (content.length > 30000) {
								content = content.substring(0, 30000) + '\n... (truncated)';
							}
							resolved.push({
								id: generateUuid(),
								type: 'file',
								uri: result.uri,
								name: `[codebase] ${result.relativePath}`,
								content
							});
						} catch {
							// 파일 읽기 실패 시 무시
						}
					}
				} catch {
					// 검색 실패 시 codebase 첨부 무시
				}
			} else {
				resolved.push(attachment);
			}
		}

		return { attachments: resolved.length > 0 ? resolved : undefined };
	}

	// ========== 전송/취소 버튼 ==========

	private updateSendButton(inProgress: boolean): void {
		// 중지 버튼: 스트리밍 중에만 표시
		if (this.stopButton) {
			console.log('[ClaudeChatView] Updating stop button visibility:', inProgress);
			this.stopButton.style.display = inProgress ? 'flex' : 'none';
		}
	}

	// ========== 연결 초기화 ==========

	/**
	 * 입력 영역 활성화/비활성화
	 */
	private setInputEnabled(enabled: boolean): void {
		if (this.inputContainer) {
			this.inputContainer.classList.toggle('disabled', !enabled);
			if (this.sendButton) {
				this.sendButton.disabled = !enabled;
			}
		}
	}

	// ========== 세션 관리 ==========

	/**
	 * 새 세션 생성
	 */
	private async createNewSession(): Promise<void> {
		// 새 세션으로 전환 (현재 세션 상태 자동 저장됨)
		const newSession = this.claudeService.startNewSession();

		// SessionInputManager에 새 세션 알림
		if (newSession?.id) {
			await this.sessionInputManager.switchToSession(newSession.id);
		}

		this.sessionTabs?.render();

		// 연결 상태 확인 및 UI 갱신
		const statusInfo = this.claudeService.getStatusInfo?.();
		if (statusInfo?.connectionStatus === 'error' || statusInfo?.connectionStatus === 'disconnected') {
			// 연결 끊긴 상태면 재연결 시도
			this.setInputEnabled(false);
			this.connectionOverlay.setConnecting();
			await this.viewConnectionManager.initializeConnection();
		} else if (statusInfo?.connectionStatus === 'connected') {
			// 연결된 상태면 입력 활성화
			this.setInputEnabled(true);
			this.connectionOverlay.setConnected();
		}
	}

	/**
	 * 세션 전환
	 */
	private async switchToSession(sessionId: string): Promise<void> {
		// SessionInputManager에서 세션 전환 (현재 세션 상태 저장 후 새 세션 상태 복원)
		await this.sessionInputManager.switchToSession(sessionId);

		// Claude 서비스에서 세션 전환
		this.claudeService.switchSession?.(sessionId);
		this.sessionTabs?.render();

		// 연결 상태 확인 및 UI 갱신
		const statusInfo = this.claudeService.getStatusInfo?.();
		if (statusInfo?.connectionStatus === 'error' || statusInfo?.connectionStatus === 'disconnected') {
			// 연결 끊긴 상태면 재연결 시도
			this.setInputEnabled(false);
			this.connectionOverlay.setConnecting();
			await this.viewConnectionManager.initializeConnection();
		} else if (statusInfo?.connectionStatus === 'connected') {
			// 연결된 상태면 입력 활성화
			this.setInputEnabled(true);
			this.connectionOverlay.setConnected();
		}
	}

	/**
	 * 세션 삭제
	 */
	private deleteSession(sessionId: string): void {
		// SessionInputManager에서 세션 상태 정리
		this.sessionInputManager.removeSession(sessionId);

		// Claude 서비스에서 세션 삭제
		this.claudeService.deleteSession?.(sessionId);
		this.sessionTabs?.render();
	}

	/**
	 * 세션 이름 변경
	 */
	private renameSessionById(sessionId: string, newName: string): void {
		this.claudeService.renameSession?.(sessionId, newName);
		this.sessionTabs?.render();
	}

	// ========== 외부 API (컨텍스트 메뉴에서 호출) ==========

	/**
	 * 파일 첨부 (컨텍스트 메뉴에서 호출)
	 * @param files 첨부할 파일 URI 목록
	 */
	public attachFiles(files: URI[]): void {
		if (!this.attachmentManager) {
			return;
		}

		for (const file of files) {
			this.attachmentManager.addFile(file);
		}

		// 입력창에 포커스
		this.sessionInputManager?.focus();
	}

	/**
	 * 선택 영역을 컨텍스트로 설정 (에디터 컨텍스트 메뉴에서 호출)
	 * @param selectedText 선택된 텍스트
	 * @param fileName 파일 이름
	 */
	public setInputWithContext(selectedText: string, fileName: string): void {
		if (!this.sessionInputManager) {
			return;
		}

		// 프롬프트 생성: 선택 영역에 대해 질문할 수 있도록
		const prompt = `\`${fileName}\`의 다음 코드에 대해:\n\n\`\`\`\n${selectedText}\n\`\`\`\n\n`;

		this.sessionInputManager.setValue(prompt);
		this.sessionInputManager.focus();

		// 커서를 끝으로 이동
		const editor = this.inputEditor;
		if (editor) {
			const model = editor.getModel();
			if (model) {
				const lastLine = model.getLineCount();
				const lastColumn = model.getLineMaxColumn(lastLine);
				editor.setPosition({ lineNumber: lastLine, column: lastColumn });
			}
		}
	}

	/**
	 * 선택 영역 + 프롬프트로 바로 전송 (컨텍스트 메뉴 Explain/Refactor/FindIssues)
	 * @param selectedText 선택된 텍스트
	 * @param fileName 파일 이름
	 * @param language 언어 ID
	 * @param prompt 전송할 프롬프트
	 */
	public sendWithContext(selectedText: string, fileName: string, language: string, prompt: string): void {
		const message = `${prompt}\n\n\`${fileName}\`:\n\`\`\`${language}\n${selectedText}\n\`\`\``;
		this.claudeService.sendMessage(message);
	}

	// ========== Changes History ==========

	/**
	 * Changes History 패널 토글
	 */
	private toggleChangesHistory(): void {
		if (!this.changesHistoryPanel) {
			return;
		}

		const history = this.claudeService.getSessionChangesHistory?.();
		if (!history) {
			this.notificationService.info(localize('noChangesHistory', "No changes history available"));
			return;
		}

		this.changesHistoryPanel.toggle(history);
	}

	// ========== Permission Mode ==========

	/**
	 * 현재 Permission Mode 가져오기
	 */
	private getPermissionMode(): ClaudePermissionMode {
		const localConfig = this.claudeService.getLocalConfig?.();
		return localConfig?.permissionMode
			?? this.configurationService.getValue<ClaudePermissionMode>('claude.permissionMode')
			?? 'default';
	}

	/**
	 * Permission Mode 순환 (default → plan → accept-edits → bypass-permissions → default)
	 */
	private async cyclePermissionMode(): Promise<void> {
		const modes: ClaudePermissionMode[] = ['default', 'plan', 'accept-edits', 'bypass-permissions'];
		const current = this.getPermissionMode();
		// bypassPermissions → bypass-permissions 정규화
		const normalizedCurrent = current === 'bypassPermissions' ? 'bypass-permissions' : current;
		const nextIndex = (modes.indexOf(normalizedCurrent) + 1) % modes.length;
		const nextMode = modes[nextIndex];

		// 로컬 설정 파일 업데이트
		await this.updateLocalConfigPermissionMode(nextMode);
	}

	/**
	 * 로컬 설정 파일에 permissionMode 업데이트
	 */
	private async updateLocalConfigPermissionMode(mode: ClaudePermissionMode): Promise<void> {
		const workspaceFolder = this.workspaceContextService.getWorkspace().folders[0];
		if (!workspaceFolder) {
			return;
		}

		const configPath = URI.joinPath(workspaceFolder.uri, '.vscode', 'claude.local.json');

		try {
			// 기존 설정 읽기
			let config: Record<string, unknown> = {};
			try {
				const content = await this.fileService.readFile(configPath);
				config = JSON.parse(content.value.toString());
			} catch {
				// 파일이 없으면 빈 객체로 시작
			}

			// permissionMode 업데이트
			config['permissionMode'] = mode;

			// 파일 쓰기
			const newContent = JSON.stringify(config, null, '\t');
			await this.fileService.writeFile(configPath, VSBuffer.fromString(newContent));

			// 설정 리로드
			await this.claudeService.reloadLocalConfig?.();
		} catch (error) {
			this.notificationService.error(
				localize('failedToUpdatePermissionMode', "Failed to update permission mode: {0}", String(error))
			);
		}
	}

	// ========== Extended Thinking ==========

	/**
	 * Extended Thinking 토글
	 */
	private toggleThinking(): void {
		const current = this.claudeService.isThinkingEnabled?.() ?? false;
		this.claudeService.setSessionThinking?.(!current);
	}

	/**
	 * Effort 레벨 순환: Auto → Low → Medium → High → Auto
	 */
	private cycleEffort(): void {
		const current = this.claudeService.getSessionEffort?.();
		let next: 'low' | 'medium' | 'high' | undefined;
		switch (current) {
			case undefined: next = 'low'; break;
			case 'low': next = 'medium'; break;
			case 'medium': next = 'high'; break;
			case 'high': next = undefined; break;
		}
		this.claudeService.setSessionEffort?.(next);
	}

	// ========== 입력 키 핸들링 ==========

	/**
	 * 입력 에디터 키 이벤트 처리
	 * @returns 이벤트가 처리되었으면 true
	 */
	private handleInputKeyDown(keyCode: number): boolean {
		// 1. Autocomplete가 열려있으면 우선 처리
		if (this.autocompleteManager.handleKeyDown(keyCode)) {
			return true;
		}

		// 2. ↑↓ 키로 히스토리 탐색 (입력이 비어있거나 한 줄일 때만)
		const editor = this.inputEditorManager.editorInstance;
		const model = editor.getModel();
		const position = editor.getPosition();

		if (keyCode === 16 /* UpArrow */ && model && position) {
			// 첫 번째 줄에서만 히스토리 위로
			if (position.lineNumber === 1) {
				return this.sessionInputManager.navigateHistoryUp();
			}
		}

		if (keyCode === 18 /* DownArrow */ && model && position) {
			// 마지막 줄에서만 히스토리 아래로
			if (position.lineNumber === model.getLineCount()) {
				return this.sessionInputManager.navigateHistoryDown();
			}
		}

		return false;
	}

	// ========== 내장 커맨드 처리 ==========

	/**
	 * 내장 커맨드 처리 (프롬프트 삽입이 아닌 직접 실행)
	 */
	private handleBuiltinCommand(commandId: string): void {
		switch (commandId) {
			case 'cost':
				this.showCostSummary();
				break;
			case 'compact':
				this.compactConversation();
				break;
			case 'help':
				this.showHelp();
				break;
			case 'clear':
				this.clearConversation();
				break;
			case 'model':
				this.showModelPicker();
				break;
			case 'config':
				this.openConfig();
				break;
			case 'context':
				this.showContext();
				break;
			case 'export':
				this.exportConversation();
				break;
			case 'resume':
				this.resumeSession();
				break;
			case 'rename':
				this.renameSession();
				break;
			case 'plan':
				this.switchToPlanMode();
				break;
			case 'agent':
				this.toggleAgentMode();
				break;
			case 'status':
				this.showStatus();
				break;
		}
	}

	/**
	 * /cost - 세션 토큰 사용량 및 비용 요약 표시
	 */
	private showCostSummary(): void {
		const messages = this.claudeService.getMessages();

		let totalInputTokens = 0;
		let totalOutputTokens = 0;
		let totalCacheReadTokens = 0;
		let totalCacheCreationTokens = 0;
		let totalCostUsd = 0;
		let messageCount = 0;

		for (const msg of messages) {
			if (msg.role === 'assistant') {
				const assistantMsg = msg as IAssistantMessage;
				if (assistantMsg.usage) {
					totalInputTokens += assistantMsg.usage.inputTokens || 0;
					totalOutputTokens += assistantMsg.usage.outputTokens || 0;
					totalCacheReadTokens += assistantMsg.usage.cacheReadTokens || 0;
					totalCacheCreationTokens += assistantMsg.usage.cacheCreationTokens || 0;
					totalCostUsd += assistantMsg.usage.totalCostUsd || 0;
					messageCount++;
				}
			}
		}

		// 모델 정보
		const statusInfo = this.claudeService.getStatusInfo?.();
		const modelName = statusInfo?.model ? getModelDisplayName(statusInfo.model) : 'Unknown';

		// 포맷팅
		const formatTokens = (n: number): string => {
			if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
			if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
			return String(n);
		};

		let html = `<strong>Session Cost Summary</strong><br>`;
		html += `Model: ${modelName}<br>`;
		html += `Turns: ${messageCount}<br>`;
		html += `───────────────<br>`;
		html += `Input tokens: ${formatTokens(totalInputTokens)}<br>`;
		html += `Output tokens: ${formatTokens(totalOutputTokens)}<br>`;
		if (totalCacheReadTokens > 0) {
			html += `Cache read: ${formatTokens(totalCacheReadTokens)}<br>`;
		}
		if (totalCacheCreationTokens > 0) {
			html += `Cache creation: ${formatTokens(totalCacheCreationTokens)}<br>`;
		}
		html += `───────────────<br>`;
		if (totalCostUsd > 0) {
			html += `<strong>Total cost: $${totalCostUsd.toFixed(4)}</strong>`;
		} else {
			html += `<strong>Total tokens: ${formatTokens(totalInputTokens + totalOutputTokens)}</strong>`;
		}

		this.messageListManager?.appendInfoMessage(html);
	}

	/**
	 * /compact - 대화 압축
	 * 기존 대화를 요약하여 컨텍스트 토큰 절약
	 */
	private async compactConversation(): Promise<void> {
		const messages = this.claudeService.getMessages();

		if (messages.length < 4) {
			this.messageListManager?.appendInfoMessage(
				localize('compactTooFew', "Not enough messages to compact (minimum 4 messages needed).")
			);
			return;
		}

		// 대화 요약 프롬프트 생성
		const conversationText = messages
			.map(m => `[${m.role}]: ${m.content.substring(0, 500)}${m.content.length > 500 ? '...' : ''}`)
			.join('\n\n');

		const totalTokensBefore = messages
			.filter(m => m.role === 'assistant')
			.reduce((sum, m) => {
				const assistantMsg = m as IAssistantMessage;
				return sum + (assistantMsg.usage?.inputTokens || 0) + (assistantMsg.usage?.outputTokens || 0);
			}, 0);

		// 압축 중 표시
		this.messageListManager?.appendInfoMessage(
			`⏳ ${localize('compacting', "Compacting conversation...")} (${messages.length} messages)`
		);

		try {
			// Claude에게 요약 요청
			const compactPrompt = [
				'Please provide a concise summary of our conversation so far.',
				'Focus on: key decisions, code changes made, current state, and pending tasks.',
				'Keep it structured and actionable. This summary will replace the conversation history to save context tokens.',
				'',
				'Conversation to summarize:',
				conversationText
			].join('\n');

			await this.claudeService.sendMessage(compactPrompt, {
				systemPrompt: 'You are a conversation summarizer. Provide a structured, concise summary. Use bullet points. Focus on facts and decisions, not pleasantries.'
			});

			// 완료 메시지
			const formatTokens = (n: number): string => {
				if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
				if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
				return String(n);
			};

			this.messageListManager?.appendInfoMessage(
				`✅ ${localize('compactDone', "Conversation compacted")} — ${messages.length} messages summarized. Previous tokens: ${formatTokens(totalTokensBefore)}`
			);
		} catch (error) {
			this.messageListManager?.appendInfoMessage(
				`❌ ${localize('compactError', "Compact failed: {0}", String(error))}`
			);
		}
	}

	/**
	 * /help - 사용 가능한 명령어 및 단축키 표시
	 */
	private showHelp(): void {
		let html = `<strong>Available Commands</strong><br>`;
		html += `───────────────<br>`;
		html += `<strong>Prompts</strong><br>`;
		html += `<strong>/explain</strong> — Explain selected code<br>`;
		html += `<strong>/fix</strong> — Find and fix bugs<br>`;
		html += `<strong>/test</strong> — Generate unit tests<br>`;
		html += `<strong>/refactor</strong> — Refactor code<br>`;
		html += `<strong>/docs</strong> — Generate documentation<br>`;
		html += `<strong>/optimize</strong> — Optimize performance<br>`;
		html += `───────────────<br>`;
		html += `<strong>Session</strong><br>`;
		html += `<strong>/cost</strong> — Show session token usage<br>`;
		html += `<strong>/compact</strong> — Compress conversation<br>`;
		html += `<strong>/clear</strong> — Clear conversation<br>`;
		html += `<strong>/model</strong> — Change model<br>`;
		html += `<strong>/export</strong> — Export conversation to clipboard<br>`;
		html += `<strong>/resume</strong> — Resume a previous session<br>`;
		html += `<strong>/rename</strong> — Rename current session<br>`;
		html += `<strong>/context</strong> — Show context usage<br>`;
		html += `<strong>/status</strong> — Show connection and model info<br>`;
		html += `───────────────<br>`;
		html += `<strong>Settings</strong><br>`;
		html += `<strong>/config</strong> — Open settings panel<br>`;
		html += `<strong>/plan</strong> — Switch to plan mode<br>`;
		html += `<strong>/agent</strong> — Toggle agent mode (autonomous)<br>`;
		html += `<strong>/help</strong> — Show this help<br>`;
		html += `───────────────<br>`;
		html += `<strong>Mentions</strong><br>`;
		html += `<strong>@file</strong> — Attach a file<br>`;
		html += `<strong>@selection</strong> — Attach editor selection<br>`;
		html += `<strong>@workspace</strong> — Include workspace context<br>`;
		html += `───────────────<br>`;
		html += `<strong>Shortcuts</strong><br>`;
		html += `<strong>↑/↓</strong> — Navigate prompt history<br>`;
		html += `<strong>Enter</strong> — Send message<br>`;
		html += `<strong>Shift+Enter</strong> — New line<br>`;

		this.messageListManager?.appendInfoMessage(html);
	}

	/**
	 * /clear - 대화 초기화
	 */
	private clearConversation(): void {
		const messages = this.claudeService.getMessages();
		if (messages.length === 0) {
			this.messageListManager?.appendInfoMessage(
				localize('clearEmpty', "Conversation is already empty.")
			);
			return;
		}

		// 메시지 목록 UI 클리어
		this.messageListManager?.clearMessages();

		// 세션 메시지 클리어
		this.claudeService.clearMessages?.();

		this.messageListManager?.appendInfoMessage(
			`✅ ${localize('clearDone', "Conversation cleared")} — ${messages.length} messages removed.`
		);
	}

	/**
	 * /model - QuickPick으로 모델 변경
	 */
	private async showModelPicker(): Promise<void> {
		const models = getAvailableClaudeModels();
		const statusInfo = this.claudeService.getStatusInfo?.();
		const currentModel = statusInfo?.model || '';

		const items = models.map(m => ({
			label: getModelDisplayName(m) || m,
			description: m === currentModel ? '(current)' : undefined,
			id: m
		}));

		const picked = await this.quickInputService.pick(items, {
			placeHolder: localize('pickModel', "Select a model for this session"),
			canPickMany: false
		});

		if (picked) {
			const selectedId = (picked as { id: string }).id;
			this.claudeService.setSessionModel?.(selectedId);
			const displayName = getModelDisplayName(selectedId);
			this.messageListManager?.appendInfoMessage(
				`✅ ${localize('modelChanged', "Model changed to {0}", displayName)}`
			);
		}
	}

	/**
	 * /config - 설정 패널 열기
	 */
	private openConfig(): void {
		if (this.settingsPanel && this.container) {
			this.settingsPanel.open(this.container);
		}
	}

	/**
	 * /context - 현재 컨텍스트 사용량 표시
	 */
	private showContext(): void {
		const messages = this.claudeService.getMessages();
		const statusInfo = this.claudeService.getStatusInfo?.();

		let totalInputTokens = 0;
		let totalOutputTokens = 0;
		let totalCacheReadTokens = 0;
		let totalCacheCreationTokens = 0;

		for (const msg of messages) {
			if (msg.role === 'assistant') {
				const assistantMsg = msg as IAssistantMessage;
				if (assistantMsg.usage) {
					totalInputTokens += assistantMsg.usage.inputTokens || 0;
					totalOutputTokens += assistantMsg.usage.outputTokens || 0;
					totalCacheReadTokens += assistantMsg.usage.cacheReadTokens || 0;
					totalCacheCreationTokens += assistantMsg.usage.cacheCreationTokens || 0;
				}
			}
		}

		const totalTokens = totalInputTokens + totalOutputTokens;
		const maxContext = 200000; // Claude 기본 컨텍스트 윈도우
		const usagePercent = Math.min(100, (totalInputTokens / maxContext) * 100);

		// 시각적 바 생성
		const barLength = 20;
		const filledLength = Math.round((usagePercent / 100) * barLength);
		const bar = '█'.repeat(filledLength) + '░'.repeat(barLength - filledLength);

		const formatTokens = (n: number): string => {
			if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
			if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
			return String(n);
		};

		let html = `<strong>Context Usage</strong><br>`;
		html += `Model: ${statusInfo?.model ? getModelDisplayName(statusInfo.model) : 'Unknown'}<br>`;
		html += `───────────────<br>`;
		html += `[${bar}] ${usagePercent.toFixed(1)}%<br>`;
		html += `Input: ${formatTokens(totalInputTokens)} / ${formatTokens(maxContext)}<br>`;
		html += `Output: ${formatTokens(totalOutputTokens)}<br>`;
		if (totalCacheReadTokens > 0) {
			html += `Cache read: ${formatTokens(totalCacheReadTokens)}<br>`;
		}
		if (totalCacheCreationTokens > 0) {
			html += `Cache creation: ${formatTokens(totalCacheCreationTokens)}<br>`;
		}
		html += `Total: ${formatTokens(totalTokens)}<br>`;
		html += `Messages: ${messages.length}`;

		this.messageListManager?.appendInfoMessage(html);
	}

	/**
	 * /export - 대화 내보내기 (클립보드)
	 */
	private async exportConversation(): Promise<void> {
		const messages = this.claudeService.getMessages();

		if (messages.length === 0) {
			this.messageListManager?.appendInfoMessage(
				localize('exportEmpty', "No messages to export.")
			);
			return;
		}

		// 마크다운 형식으로 변환
		const lines: string[] = [];
		const statusInfo = this.claudeService.getStatusInfo?.();
		lines.push(`# Claude Conversation`);
		lines.push(`Model: ${statusInfo?.model ? getModelDisplayName(statusInfo.model) : 'Unknown'}`);
		lines.push(`Date: ${new Date().toISOString()}`);
		lines.push(`Messages: ${messages.length}`);
		lines.push('');
		lines.push('---');
		lines.push('');

		for (const msg of messages) {
			const role = msg.role === 'user' ? '**User**' : '**Claude**';
			lines.push(`### ${role}`);
			lines.push('');
			lines.push(msg.content);
			lines.push('');
		}

		const exportText = lines.join('\n');

		try {
			await navigator.clipboard.writeText(exportText);
			this.messageListManager?.appendInfoMessage(
				`✅ ${localize('exportDone', "Conversation exported to clipboard")} — ${messages.length} messages`
			);
		} catch {
			this.messageListManager?.appendInfoMessage(
				`❌ ${localize('exportFailed', "Failed to copy to clipboard")}`
			);
		}
	}

	/**
	 * /resume - 이전 세션 재개
	 */
	private async resumeSession(): Promise<void> {
		const sessions = this.claudeService.getSessions();

		if (sessions.length <= 1) {
			this.messageListManager?.appendInfoMessage(
				localize('resumeNoSessions', "No other sessions available to resume.")
			);
			return;
		}

		const activeSessionId = this.claudeService.getCurrentSession?.()?.id;
		const items = sessions
			.filter(s => s.id !== activeSessionId)
			.map(s => ({
				label: s.title || s.id.substring(0, 8),
				description: `${s.messages?.length || 0} messages`,
				id: s.id
			}));

		const picked = await this.quickInputService.pick(items, {
			placeHolder: localize('pickSession', "Select a session to resume"),
			canPickMany: false
		});

		if (picked) {
			const sessionId = (picked as { id: string }).id;
			this.claudeService.switchSession?.(sessionId);
			this.messageListManager?.clearMessages();

			// 선택된 세션의 메시지 복원
			const messages = this.claudeService.getMessages();
			for (const msg of messages) {
				this.messageListManager?.appendMessage(msg);
			}

			this.updateWelcomeVisibility();
			this.messageListManager?.appendInfoMessage(
				`✅ ${localize('resumeDone', "Resumed session: {0}", (picked as { label: string }).label)}`
			);
		}
	}

	/**
	 * /rename - 현재 세션 이름 변경
	 */
	private async renameSession(): Promise<void> {
		const currentSession = this.claudeService.getCurrentSession?.();

		if (!currentSession) {
			this.messageListManager?.appendInfoMessage(
				localize('renameNoSession', "No active session to rename.")
			);
			return;
		}

		const newName = await this.quickInputService.input({
			placeHolder: localize('enterSessionName', "Enter new session name"),
			value: currentSession.title || '',
			prompt: localize('renamePrompt', "Rename session")
		});

		if (newName !== undefined && newName.trim()) {
			const success = this.claudeService.renameSession?.(currentSession.id, newName.trim());
			if (success) {
				this.messageListManager?.appendInfoMessage(
					`✅ ${localize('renameDone', "Session renamed to \"{0}\"", newName.trim())}`
				);
			}
		}
	}

	/**
	 * /plan - Plan 모드로 전환
	 */
	private async switchToPlanMode(): Promise<void> {
		const currentMode = this.getPermissionMode();

		if (currentMode === 'plan') {
			this.messageListManager?.appendInfoMessage(
				localize('alreadyPlanMode', "Already in Plan mode.")
			);
			return;
		}

		await this.updateLocalConfigPermissionMode('plan');

		this.messageListManager?.appendInfoMessage(
			`✅ ${localize('planMode', "Switched to Plan mode")} — Claude will show plans before executing.`
		);
	}

	/**
	 * /agent - Agent 모드 토글 (bypass-permissions)
	 */
	private async toggleAgentMode(): Promise<void> {
		const currentMode = this.getPermissionMode();
		const isAgent = currentMode === 'bypass-permissions' || currentMode === 'bypassPermissions';

		if (isAgent) {
			// Agent 모드 해제 → default로 복귀
			await this.updateLocalConfigPermissionMode('default');
			this.messageListManager?.appendInfoMessage(
				`✅ ${localize('agentModeOff', "Agent mode OFF")} — Switched to Default mode.`
			);
		} else {
			// Agent 모드 활성화
			await this.updateLocalConfigPermissionMode('bypass-permissions');
			this.messageListManager?.appendInfoMessage(
				`⚡ ${localize('agentModeOn', "Agent mode ON")} — Claude will autonomously edit files and run commands.`
			);
		}
	}

	/**
	 * /status - 상태 정보 표시
	 */
	private showStatus(): void {
		const statusInfo = this.claudeService.getStatusInfo?.();
		const sessions = this.claudeService.getSessions();
		const currentSession = this.claudeService.getCurrentSession?.();
		const messages = this.claudeService.getMessages();

		let html = `<strong>Status</strong><br>`;
		html += `───────────────<br>`;
		html += `<strong>Connection:</strong> ${statusInfo?.connectionStatus || 'unknown'}<br>`;
		html += `<strong>Model:</strong> ${statusInfo?.model ? getModelDisplayName(statusInfo.model) : 'not set'}<br>`;
		html += `<strong>Execution:</strong> ${statusInfo?.executionMethod || 'CLI'}<br>`;
		html += `───────────────<br>`;
		html += `<strong>Session:</strong> ${currentSession?.title || currentSession?.id?.substring(0, 8) || 'none'}<br>`;
		html += `<strong>Messages:</strong> ${messages.length}<br>`;
		html += `<strong>Sessions:</strong> ${sessions.length}<br>`;

		// Permission Mode 상태
		const permMode = this.getPermissionMode();
		const permModeDisplay = (permMode === 'bypass-permissions' || permMode === 'bypassPermissions') ? 'Agent' :
			permMode === 'accept-edits' ? 'Accept-Edits' :
				permMode === 'plan' ? 'Plan' : 'Default';
		html += `<strong>Mode:</strong> ${permModeDisplay}<br>`;

		// Thinking 상태
		const thinkingEnabled = this.claudeService.isThinkingEnabled?.() || false;
		html += `<strong>Thinking:</strong> ${thinkingEnabled ? 'ON' : 'OFF'}<br>`;

		// Effort 상태
		const effort = this.claudeService.getSessionEffort?.();
		html += `<strong>Effort:</strong> ${effort || 'Auto'}<br>`;

		this.messageListManager?.appendInfoMessage(html);
	}

	/**
	 * 세션 입력 상태 변경 콜백
	 * 세션 탭에 미완성 내용 표시 등을 위해 사용
	 */
	private onSessionInputStateChanged(sessionId: string, hasContent: boolean): void {
		// 세션 탭에 "•" 표시 등의 UI 업데이트
		// 현재는 빈 구현, 추후 세션 탭 UI 개선 시 활용
		console.log(`[ClaudeChatView] Session ${sessionId} input state changed: hasContent=${hasContent}`);
	}

}
