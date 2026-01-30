/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, append, addDisposableListener, EventType } from '../../../../../base/browser/dom.js';
import { Codicon } from '../../../../../base/common/codicons.js';
import { ThemeIcon } from '../../../../../base/common/themables.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { URI } from '../../../../../base/common/uri.js';
import { ICodeEditor } from '../../../../../editor/browser/editorBrowser.js';
import { IModelService } from '../../../../../editor/common/services/model.js';
import { ILanguageService } from '../../../../../editor/common/languages/language.js';
import { localize } from '../../../../../nls.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { IContextKeyService } from '../../../../../platform/contextkey/common/contextkey.js';
import { IContextMenuService } from '../../../../../platform/contextview/browser/contextView.js';
import { IHoverService } from '../../../../../platform/hover/browser/hover.js';
import { IInstantiationService } from '../../../../../platform/instantiation/common/instantiation.js';
import { IKeybindingService } from '../../../../../platform/keybinding/common/keybinding.js';
import { IOpenerService } from '../../../../../platform/opener/common/opener.js';
import { IThemeService } from '../../../../../platform/theme/common/themeService.js';
import { IViewPaneOptions, ViewPane } from '../../../../browser/parts/views/viewPane.js';
import { IViewDescriptorService } from '../../../../common/views.js';
import { IClaudeService } from '../../common/claude.js';
import { IClaudeMessage, IClaudeAttachment, IClaudeQueuedMessage, IClaudeToolAction, getAvailableClaudeModels } from '../../common/claudeTypes.js';
import { CONTEXT_CLAUDE_INPUT_FOCUSED, CONTEXT_CLAUDE_PANEL_FOCUSED, CONTEXT_CLAUDE_REQUEST_IN_PROGRESS } from '../../common/claudeContextKeys.js';
import { IEditorService } from '../../../../services/editor/common/editorService.js';
import { ClaudeMessageRenderer } from './claudeMessageRenderer.js';
import { AutocompleteManager } from './claudeAutocomplete.js';
import { StatusBarManager } from './claudeStatusBar.js';
import { AttachmentManager } from './claudeAttachmentManager.js';
import { LocalSettingsManager } from './claudeLocalSettings.js';
import { InputEditorManager } from './claudeInputEditor.js';
import { CodeApplyManager } from './claudeCodeApply.js';
import { SessionPickerUI } from './claudeSessionPicker.js';
import { OpenFilesBar } from './claudeOpenFilesBar.js';
import { ConnectionOverlay } from './claudeConnectionOverlay.js';
import { ClaudeSettingsPanel } from './claudeSettingsPanel.js';
import { SessionSettingsPanel, ISessionSettings } from './claudeSessionSettingsPanel.js';
import { SessionTabs } from './claudeSessionTabs.js';
import { ChangesHistoryPanel } from './claudeChangesHistoryPanel.js';
import { INotificationService, Severity } from '../../../../../platform/notification/common/notification.js';
import { IFileService } from '../../../../../platform/files/common/files.js';
import { IWorkspaceContextService } from '../../../../../platform/workspace/common/workspace.js';
import { IQuickInputService } from '../../../../../platform/quickinput/common/quickInput.js';
import { ITextModelService } from '../../../../../editor/common/services/resolverService.js';

export class ClaudeChatViewPane extends ViewPane {

	static readonly ID = 'workbench.panel.claude.chat';
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
	private toolStatusContainer!: HTMLElement;
	private sendButton!: HTMLButtonElement;
	private autocompleteContainer!: HTMLElement;
	private autocompleteManager!: AutocompleteManager;
	private statusBarManager!: StatusBarManager;
	private attachmentManager!: AttachmentManager;
	private localSettingsManager!: LocalSettingsManager;
	private inputEditorManager!: InputEditorManager;
	private codeApplyManager!: CodeApplyManager;
	private sessionPicker!: SessionPickerUI;
	private openFilesBar!: OpenFilesBar;
	private connectionOverlay!: ConnectionOverlay;
	private settingsPanel!: ClaudeSettingsPanel;
	private sessionSettingsPanel!: SessionSettingsPanel;
	private sessionTabs!: SessionTabs;
	private sessionSettings: ISessionSettings = { name: '' };
	private changesHistoryPanel!: ChangesHistoryPanel;

	private messageRenderer!: ClaudeMessageRenderer;
	private messageDisposables = new Map<string, DisposableStore>();

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
		@ITextModelService private readonly textModelService: ITextModelService
	) {
		super(options, keybindingService, contextMenuService, configurationService, contextKeyService, viewDescriptorService, instantiationService, openerService, themeService, hoverService);

		// 코드 적용 매니저 생성
		this.codeApplyManager = this._register(new CodeApplyManager(
			this.editorService,
			this.notificationService,
			this.quickInputService,
			this.modelService,
			this.textModelService,
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
				clearMessages: () => this.clearMessages(),
				appendMessage: (message) => this.appendMessage(message),
				updateWelcomeVisibility: () => this.updateWelcomeVisibility()
			}
		);

		// 메시지 렌더러 생성
		this.messageRenderer = this._register(this.instantiationService.createInstance(ClaudeMessageRenderer, {
			onApplyCode: (code, language) => this.codeApplyManager.apply(code, language),
			onRespondToAskUser: (responses) => this.claudeService.respondToAskUser(responses),
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
			this.appendMessage(message);
			this.updateWelcomeVisibility();
		}));

		this._register(this.claudeService.onDidUpdateMessage(message => {
			this.updateMessage(message);
		}));

		this._register(this.claudeService.onDidChangeState(state => {
			const inProgress = state === 'sending' || state === 'streaming';
			this.requestInProgressKey.set(inProgress);
			this.updateLoadingState(state === 'sending'); // 스트리밍 중에는 로딩 숨김
			this.updateSendButton(inProgress);

			// 에러 상태 시 연결 오버레이 표시 및 입력 비활성화
			if (state === 'error') {
				this.handleConnectionLost();
			}
		}));

		this._register(this.claudeService.onDidChangeSession((session) => {
			this.clearMessages();
			// 세션의 메시지들 렌더링
			if (session) {
				for (const message of session.messages) {
					this.appendMessage(message);
				}
			}
			this.updateWelcomeVisibility();
			// 세션 탭 갱신
			this.sessionTabs?.render();
		}));

		let previousQueueLength = 0;
		this._register(this.claudeService.onDidChangeQueue(queue => {
			// 큐에 새 메시지가 추가되면 알림
			if (queue.length > previousQueueLength) {
				const position = queue.length;
				this.notificationService.info(
					localize('messageQueued', "Message queued (#{0}). Will be sent when current request completes.", position)
				);
			}
			previousQueueLength = queue.length;
			this.updateQueueUI(queue);
		}));

		// 도구 실행 상태 변경 이벤트
		const onToolActionChanged = this.claudeService.onDidChangeToolAction;
		if (onToolActionChanged) {
			this._register(onToolActionChanged(action => {
				this.updateToolStatus(action);
			}));
		}
	}

	protected override renderBody(container: HTMLElement): void {
		super.renderBody(container);

		this.container = append(container, $('.claude-chat-container'));

		// 연결 오버레이 (가장 먼저 생성 - z-index가 높아서 위에 표시됨)
		this.connectionOverlay = this._register(new ConnectionOverlay(this.container, {
			onRetry: () => this.initializeConnection()
		}));

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

		// 기존 메시지 렌더링
		const messages = this.claudeService.getMessages();
		const session = this.claudeService.getCurrentSession();
		const previousMessageCount = session?.previousMessageCount || 0;

		for (let i = 0; i < messages.length; i++) {
			// 이전 세션과 현재 세션 구분선
			if (previousMessageCount > 0 && i === previousMessageCount) {
				this.appendSessionDivider();
			}
			this.appendMessage(messages[i]);
		}

		// 큐 표시 영역 (입력창 위)
		this.queueContainer = append(this.container, $('.claude-queue-container'));
		this.queueContainer.style.display = 'none';

		// 도구 실행 상태 표시 영역 (입력창 위)
		this.toolStatusContainer = append(this.container, $('.claude-tool-status-bar'));
		this.toolStatusContainer.style.display = 'none';

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
		this.sessionSettingsPanel = this._register(new SessionSettingsPanel({
			getCurrentSettings: () => this.sessionSettings,
			onSave: (settings) => this.applySessionSettings(settings),
			onContinue: () => this.continueLastSession(),
			getAvailableModels: () => this.getAvailableModels()
		}));

		// 상태 바 (입력창 위)
		this.statusBarContainer = append(this.container, $('.claude-status-bar'));
		this.statusBarManager = this._register(new StatusBarManager(
			this.statusBarContainer,
			{
				getStatusInfo: () => this.claudeService.getStatusInfo?.(),
				checkConnection: () => this.claudeService.checkConnection?.() ?? Promise.resolve(false),
				toggleUltrathink: () => this.claudeService.toggleUltrathink?.() ?? Promise.resolve(),
				openLocalSettings: () => this.localSettingsManager.open(),
				openSessionSettings: () => this.sessionSettingsPanel.open(this.container),
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
		this.initializeConnection();

		// 드래그/드롭 이벤트 설정
		this.setupDragAndDrop();

		// 환영 메시지 표시 여부
		this.updateWelcomeVisibility();

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
				getAvailableModels: () => this.getAvailableModels()
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

		// 모델 오버라이드 적용
		if (settings.model) {
			this.claudeService.setSessionModel?.(settings.model);
		}

		// Ultrathink 오버라이드 적용
		if (settings.ultrathink !== undefined) {
			this.claudeService.setSessionUltrathink?.(settings.ultrathink);
		}

		// Auto Accept 오버라이드 적용
		if (settings.autoAccept !== undefined) {
			this.claudeService.setSessionAutoAccept?.(settings.autoAccept);
		}

		this.notificationService.info(localize('sessionSettingsSaved', "Session settings saved"));
	}

	/**
	 * 마지막 세션 이어서 시작 (--continue)
	 */
	private continueLastSession(): void {
		this.claudeService.continueLastSession?.();
		this.notificationService.info(localize('continuingSession', "Continuing last session..."));
	}

	/**
	 * 컨테이너 상단에 설정 버튼 및 세션 탭 추가
	 */
	private setupHeaderActions(): void {
		// 헤더 바 생성 (컨테이너 최상단)
		const headerBar = append(this.container, $('.claude-header-bar'));

		// Changes History 버튼
		const changesButton = append(headerBar, $('button.claude-changes-history-btn'));
		changesButton.title = localize('showChangesHistory', "Show Session Changes");
		const changesIcon = append(changesButton, $('span.codicon.codicon-git-compare'));
		changesIcon.setAttribute('aria-hidden', 'true');
		const changesLabel = append(changesButton, $('span'));
		changesLabel.textContent = localize('changes', "Changes");

		this._register(addDisposableListener(changesButton, EventType.CLICK, () => {
			this.toggleChangesHistory();
		}));

		// 설정 버튼
		const settingsButton = append(headerBar, $('button.claude-header-settings-btn'));
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

		// 세션 탭 생성 (헤더 바 다음)
		this.sessionTabs = this._register(new SessionTabs(this.container, {
			getSessions: () => this.claudeService.getSessions(),
			getCurrentSession: () => this.claudeService.getCurrentSession(),
			onNewSession: () => this.createNewSession(),
			onSwitchSession: (sessionId) => this.switchToSession(sessionId),
			onDeleteSession: (sessionId) => this.deleteSession(sessionId),
			onRenameSession: (sessionId, newName) => this.renameSession(sessionId, newName)
		}));

		// 세션 탭을 헤더 바 다음으로 이동
		if (headerBar.nextSibling) {
			this.container.insertBefore(this.sessionTabs['container'], headerBar.nextSibling);
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
			this.scrollToBottom();
		}
	}

	private updateToolStatus(action: IClaudeToolAction | undefined): void {
		// 기존 내용 초기화
		while (this.toolStatusContainer.firstChild) {
			this.toolStatusContainer.removeChild(this.toolStatusContainer.firstChild);
		}

		if (!action || action.status !== 'running') {
			this.toolStatusContainer.style.display = 'none';
			return;
		}

		this.toolStatusContainer.style.display = 'flex';

		// 스피너
		const spinner = append(this.toolStatusContainer, $('.claude-tool-status-spinner'));
		spinner.classList.add('codicon', 'codicon-loading', 'codicon-modifier-spin');

		// 도구 이름
		const toolName = append(this.toolStatusContainer, $('.claude-tool-status-name'));
		toolName.textContent = this.getToolDisplayName(action.tool);

		// 입력 파라미터 (있으면)
		if (action.input) {
			const toolInput = append(this.toolStatusContainer, $('.claude-tool-status-input'));
			toolInput.textContent = this.formatToolInput(action.tool, action.input);
		}
	}

	private getToolDisplayName(tool: string): string {
		const toolNames: Record<string, string> = {
			'Read': 'Reading file',
			'Write': 'Writing file',
			'Edit': 'Editing file',
			'Bash': 'Running command',
			'Grep': 'Searching code',
			'Glob': 'Finding files',
			'WebFetch': 'Fetching URL',
			'WebSearch': 'Searching web',
			'Task': 'Running task',
			'TodoWrite': 'Writing todos',
			'TaskCreate': 'Creating task',
			'TaskUpdate': 'Updating task',
			'AskUser': 'Asking question'
		};
		return toolNames[tool] || tool;
	}

	private formatToolInput(tool: string, input: Record<string, unknown>): string {
		switch (tool) {
			case 'Read':
				return String(input['file_path'] || input['path'] || '').split(/[/\\]/).pop() || '';
			case 'Write':
			case 'Edit':
				return String(input['file_path'] || input['path'] || '').split(/[/\\]/).pop() || '';
			case 'Bash':
				const cmd = String(input['command'] || '');
				return cmd.length > 50 ? cmd.substring(0, 50) + '...' : cmd;
			case 'Grep':
				return `"${input['pattern'] || ''}"`;
			case 'Glob':
				return String(input['pattern'] || '');
			case 'WebFetch':
			case 'WebSearch':
				return String(input['url'] || input['query'] || '');
			case 'TodoWrite':
			case 'TaskCreate':
				return String(input['subject'] || '');
			default:
				return '';
		}
	}

	private updateQueueUI(queue: IClaudeQueuedMessage[]): void {
		// 기존 내용 초기화
		while (this.queueContainer.firstChild) {
			this.queueContainer.removeChild(this.queueContainer.firstChild);
		}

		if (queue.length === 0) {
			this.queueContainer.style.display = 'none';
			return;
		}

		this.queueContainer.style.display = 'block';

		// 헤더
		const header = append(this.queueContainer, $('.claude-queue-header'));
		const headerIcon = append(header, $('.codicon.codicon-loading.claude-queue-spinner'));
		headerIcon.setAttribute('aria-hidden', 'true');
		const headerText = append(header, $('span.claude-queue-title'));
		headerText.textContent = localize('pendingMessages', "{0} message(s) pending", queue.length);

		// 전체 취소 버튼
		const clearButton = append(header, $('button.claude-queue-clear'));
		clearButton.title = localize('clearQueue', "Clear all pending");
		append(clearButton, $('.codicon.codicon-close-all'));

		this._register(addDisposableListener(clearButton, EventType.CLICK, () => {
			this.claudeService.clearQueue();
		}));

		// 상태 메시지
		const statusMessage = append(this.queueContainer, $('.claude-queue-status'));
		statusMessage.textContent = localize('waitingForPrevious', "Waiting for current request to complete...");

		// 큐 아이템들
		const list = append(this.queueContainer, $('.claude-queue-list'));

		// 드래그 앤 드롭 상태
		let draggedIndex: number | null = null;

		queue.forEach((item, index) => {
			const itemElement = append(list, $('.claude-queue-item'));
			itemElement.dataset.index = String(index);

			// 드래그 앤 드롭 활성화
			itemElement.draggable = true;

			// 드래그 핸들
			const dragHandle = append(itemElement, $('.claude-queue-item-drag'));
			dragHandle.title = localize('dragToReorder', "Drag to reorder");
			append(dragHandle, $('.codicon.codicon-gripper'));

			// 순서 번호
			const orderBadge = append(itemElement, $('.claude-queue-item-order'));
			orderBadge.textContent = `#${index + 1}`;

			// 대기 아이콘
			const waitIcon = append(itemElement, $('.codicon.codicon-clock.claude-queue-item-icon'));
			waitIcon.setAttribute('aria-hidden', 'true');

			// 메시지 내용 (요약) - 클릭하여 편집
			const content = append(itemElement, $('.claude-queue-item-content'));
			const preview = item.content.length > 60 ? item.content.substring(0, 60) + '...' : item.content;
			content.textContent = preview;
			content.title = localize('clickToEdit', "Click to edit: {0}", item.content);

			// 컨텍스트 미리보기 (첨부파일이 있으면 표시)
			if (item.context?.attachments && item.context.attachments.length > 0) {
				const contextBadge = append(itemElement, $('.claude-queue-item-context'));
				contextBadge.title = localize('attachments', "{0} attachment(s)", item.context.attachments.length);
				append(contextBadge, $('.codicon.codicon-attach'));
				const countSpan = append(contextBadge, $('span'));
				countSpan.textContent = String(item.context.attachments.length);
			}

			// 편집 버튼
			const editButton = append(itemElement, $('button.claude-queue-item-edit'));
			editButton.title = localize('editMessage', "Edit message");
			append(editButton, $('.codicon.codicon-edit'));

			// 개별 삭제 버튼
			const removeButton = append(itemElement, $('button.claude-queue-item-remove'));
			removeButton.title = localize('removeFromQueue', "Remove from queue");
			append(removeButton, $('.codicon.codicon-close'));

			// 편집 클릭 이벤트
			this._register(addDisposableListener(editButton, EventType.CLICK, (e) => {
				e.stopPropagation();
				this.showQueueItemEditDialog(item);
			}));

			// 내용 클릭 이벤트 (편집)
			this._register(addDisposableListener(content, EventType.CLICK, (e) => {
				e.stopPropagation();
				this.showQueueItemEditDialog(item);
			}));

			// 삭제 클릭 이벤트
			this._register(addDisposableListener(removeButton, EventType.CLICK, (e) => {
				e.stopPropagation();
				this.claudeService.removeFromQueue(item.id);
			}));

			// 드래그 시작
			this._register(addDisposableListener(itemElement, EventType.DRAG_START, (e: DragEvent) => {
				draggedIndex = index;
				itemElement.classList.add('dragging');
				if (e.dataTransfer) {
					e.dataTransfer.effectAllowed = 'move';
					e.dataTransfer.setData('text/plain', String(index));
				}
			}));

			// 드래그 종료
			this._register(addDisposableListener(itemElement, EventType.DRAG_END, () => {
				draggedIndex = null;
				itemElement.classList.remove('dragging');
				// 모든 드롭 인디케이터 제거
				list.querySelectorAll('.drop-target').forEach(el => el.classList.remove('drop-target'));
			}));

			// 드래그 오버
			this._register(addDisposableListener(itemElement, EventType.DRAG_OVER, (e: DragEvent) => {
				e.preventDefault();
				if (e.dataTransfer) {
					e.dataTransfer.dropEffect = 'move';
				}
				if (draggedIndex !== null && draggedIndex !== index) {
					itemElement.classList.add('drop-target');
				}
			}));

			// 드래그 리브
			this._register(addDisposableListener(itemElement, EventType.DRAG_LEAVE, () => {
				itemElement.classList.remove('drop-target');
			}));

			// 드롭
			this._register(addDisposableListener(itemElement, EventType.DROP, (e: DragEvent) => {
				e.preventDefault();
				itemElement.classList.remove('drop-target');

				const fromIndexStr = e.dataTransfer?.getData('text/plain');
				if (fromIndexStr !== undefined) {
					const fromIndex = parseInt(fromIndexStr, 10);
					if (!isNaN(fromIndex) && fromIndex !== index) {
						this.claudeService.reorderQueue?.(fromIndex, index);
					}
				}
			}));
		});
	}

	/**
	 * 큐 아이템 편집 다이얼로그 표시
	 */
	private async showQueueItemEditDialog(item: IClaudeQueuedMessage): Promise<void> {
		const result = await this.quickInputService.input({
			title: localize('editQueuedMessage', "Edit Queued Message"),
			value: item.content,
			prompt: localize('editPrompt', "Modify the message content"),
			validateInput: async (value) => {
				if (!value.trim()) {
					return localize('emptyMessage', "Message cannot be empty");
				}
				return null;
			}
		});

		if (result !== undefined && result.trim() !== item.content) {
			const success = this.claudeService.updateQueuedMessage?.(item.id, result.trim());
			if (success) {
				this.notificationService.info(localize('messageUpdated', "Message updated"));
			}
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
				onFocusChange: (focused) => this.inputFocusedKey.set(focused),
				onContentChange: () => this.autocompleteManager.check(),
				onPaste: (e) => this.handlePaste(e),
				onKeyDown: (keyCode) => this.autocompleteManager.handleKeyDown(keyCode),
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
				onCommandSelected: (prompt) => this.inputEditorManager.setCommandPrompt(prompt),
				registerDisposable: (d) => this._register(d)
			}
		));

		// 전송/취소 버튼
		this.sendButton = append(inputWrapper, $('button.claude-send-button')) as HTMLButtonElement;
		this.sendButton.title = localize('sendMessage', "Send message");
		append(this.sendButton, $('.codicon.codicon-send'));

		this._register(addDisposableListener(this.sendButton, EventType.CLICK, () => {
			this.handleSendButtonClick();
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
		const content = this.inputEditorManager.getValue().trim();
		if (!content) {
			return;
		}

		// 입력 초기화 (요청 진행 중이면 큐에 추가됨)
		this.inputEditorManager.setValue('');

		// 컨텍스트: 수동 첨부파일만 포함 (자동 컨텍스트 비활성화)
		let context: { attachments?: IClaudeAttachment[] } | undefined;

		// 첨부파일이 있을 때만 컨텍스트 생성
		if (this.attachmentManager.count > 0) {
			context = {
				attachments: [...this.attachmentManager.attachments]
			};
		}

		// 첨부파일 초기화
		this.attachmentManager.clear();

		try {
			const result = await this.claudeService.sendMessage(content, { context });

			// 큐가 가득 찬 경우 경고
			if (result.queueRejected) {
				const maxSize = this.claudeService.getMaxQueueSize?.() ?? 10;
				this.notificationService.warn(
					localize('queueFull', "Queue is full (max {0} messages). Please wait for current request to complete.", maxSize)
				);
				// 입력창에 내용 복원
				this.inputEditorManager.setValue(content);
				return;
			}

			this.scrollToBottom();
		} catch (error) {
			// 에러는 서비스에서 처리됨
		}
	}

	private appendMessage(message: IClaudeMessage): void {
		// 이미 DOM에 있으면 중복 추가 방지
		const existing = this.messagesContainer.querySelector(`[data-message-id="${message.id}"]`);
		if (existing) {
			return;
		}

		const messageContainer = $('.claude-message-wrapper');
		messageContainer.dataset.messageId = message.id;

		// 스트리밍 상태에 따라 클래스 토글
		if (message.isStreaming) {
			messageContainer.classList.add('streaming');
		}

		const disposables = this.messageRenderer.renderMessage(message, messageContainer);
		this.messageDisposables.set(message.id, disposables);

		// 로딩 인디케이터 앞에 삽입
		this.messagesContainer.insertBefore(messageContainer, this.loadingElement);
		this.scrollToBottom();
	}

	private appendSessionDivider(): void {
		const divider = $('.claude-session-divider');

		append(divider, $('.claude-session-divider-line'));
		const text = append(divider, $('.claude-session-divider-text'));
		text.textContent = localize('previousSession', "Previous Session");
		append(divider, $('.claude-session-divider-line'));

		// 로딩 인디케이터 앞에 삽입
		this.messagesContainer.insertBefore(divider, this.loadingElement);
	}

	private updateMessage(message: IClaudeMessage): void {
		// 기존 메시지 컨테이너 찾기
		const existingContainer = this.messagesContainer.querySelector(`[data-message-id="${message.id}"]`) as HTMLElement;
		if (!existingContainer) {
			// 기존 컨테이너가 없으면 새로 추가 (타이밍 이슈 대응)
			this.appendMessage(message);
			return;
		}

		// 스트리밍 상태에 따라 클래스 토글 (애니메이션 제어)
		existingContainer.classList.toggle('streaming', !!message.isStreaming);

		// 기존 disposables 정리
		const oldDisposables = this.messageDisposables.get(message.id);
		if (oldDisposables) {
			oldDisposables.dispose();
		}

		// 컨테이너 내용 초기화
		while (existingContainer.firstChild) {
			existingContainer.removeChild(existingContainer.firstChild);
		}

		// 새로운 내용 렌더링
		const disposables = this.messageRenderer.renderMessage(message, existingContainer);
		this.messageDisposables.set(message.id, disposables);

		// 스트리밍 중이면 스크롤
		if (message.isStreaming) {
			this.scrollToBottom();
		}
	}

	private clearMessages(): void {
		// 기존 메시지 dispose
		for (const disposables of this.messageDisposables.values()) {
			disposables.dispose();
		}
		this.messageDisposables.clear();

		// DOM 초기화 (로딩 인디케이터 유지)
		const children = Array.from(this.messagesContainer.children);
		for (const child of children) {
			if (child !== this.loadingElement) {
				child.remove();
			}
		}
	}

	private scrollToBottom(): void {
		requestAnimationFrame(() => {
			this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;
		});
	}

	// ========== 클립보드 붙여넣기 ==========

	private async handlePaste(e: ClipboardEvent): Promise<void> {
		const clipboardData = e.clipboardData;
		if (!clipboardData) {
			return;
		}

		// 1. 이미지 파일 체크 (동기적으로 먼저 확인)
		let imageFile: File | null = null;

		// DataTransferItemList에서 이미지 찾기
		for (const item of clipboardData.items) {
			if (item.type.startsWith('image/')) {
				imageFile = item.getAsFile();
				break;
			}
		}

		// FileList에서 이미지 찾기 (일부 브라우저)
		if (!imageFile) {
			for (const file of clipboardData.files) {
				if (file.type.startsWith('image/')) {
					imageFile = file;
					break;
				}
			}
		}

		// 이미지가 있으면 즉시 기본 동작 차단 (텍스트 삽입 방지)
		if (imageFile) {
			e.preventDefault();
			e.stopPropagation();
			// 비동기 작업은 이벤트 차단 후 수행
			await this.attachmentManager.addImage(imageFile);
			return;
		}

		// 2. VS Code 에디터에서 복사한 코드인지 확인 (코드 참조 기능)
		const vsCodeData = clipboardData.getData('vscode-editor-data');
		if (vsCodeData) {
			try {
				const metadata = JSON.parse(vsCodeData);
				const plainText = clipboardData.getData('text/plain');

				// 코드 참조로 변환할 수 있는지 확인
				if (this.tryAddCodeReference(metadata, plainText)) {
					e.preventDefault();
					e.stopPropagation();
					return;
				}
			} catch {
				// 파싱 실패 시 기본 텍스트 붙여넣기
			}
		}

		// 3. 일반 텍스트는 기본 동작 유지
	}

	/**
	 * VS Code 에디터 메타데이터에서 코드 참조 생성 시도
	 * @returns 코드 참조로 변환 성공 여부
	 */
	private tryAddCodeReference(metadata: unknown, content: string): boolean {
		// VS Code 클립보드 메타데이터 구조 확인
		if (!metadata || typeof metadata !== 'object') {
			return false;
		}

		const meta = metadata as Record<string, unknown>;

		// mode (언어 ID)가 있어야 에디터에서 복사한 것
		if (!meta.mode || typeof meta.mode !== 'string') {
			return false;
		}

		// 현재 활성 에디터에서 선택 영역 정보 가져오기
		const activeEditor = this.editorService.activeTextEditorControl;
		if (!activeEditor || !('getModel' in activeEditor) || !('getSelection' in activeEditor)) {
			return false;
		}

		const model = (activeEditor as { getModel: () => { uri?: URI } | null }).getModel();
		const selection = (activeEditor as { getSelection: () => { startLineNumber: number; endLineNumber: number } | null }).getSelection();

		if (!model?.uri || !selection) {
			return false;
		}

		// 파일 경로와 라인 범위 추출
		const filePath = model.uri.fsPath;
		const fileName = filePath.split(/[/\\]/).pop() || filePath;
		const startLine = selection.startLineNumber;
		const endLine = selection.endLineNumber;

		// 코드 참조로 첨부
		this.attachmentManager.addCodeReference?.({
			type: 'code-reference',
			filePath,
			fileName,
			startLine,
			endLine,
			content,
			languageId: meta.mode as string
		});

		return true;
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
		this.inputEditorManager?.focus();
	}

	protected override layoutBody(height: number, width: number): void {
		super.layoutBody(height, width);

		// CSS flexbox가 레이아웃을 처리하도록 컨테이너 높이만 설정
		this.container.style.height = `${height}px`;

		// 에디터 레이아웃은 DOM 렌더링 후 계산
		requestAnimationFrame(() => {
			this.inputEditorManager?.layout();
		});
	}

	override dispose(): void {
		this.clearMessages();
		super.dispose();
	}

	// ========== 자동완성 헬퍼 ==========

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

	// ========== 전송/취소 버튼 ==========

	private handleSendButtonClick(): void {
		const state = this.claudeService.getState();
		if (state === 'sending' || state === 'streaming') {
			// 취소
			this.claudeService.cancelRequest();
			this.notificationService.info(localize('requestCancelled', "Request cancelled"));
		} else {
			// 전송
			this.submitInput();
		}
	}

	private updateSendButton(inProgress: boolean): void {
		if (!this.sendButton) {
			return;
		}

		// 아이콘 변경
		const icon = this.sendButton.querySelector('.codicon');
		if (icon) {
			icon.classList.remove('codicon-send', 'codicon-stop-circle');
			icon.classList.add(inProgress ? 'codicon-stop-circle' : 'codicon-send');
		}

		// 타이틀 변경
		this.sendButton.title = inProgress
			? localize('cancelRequest', "Cancel request")
			: localize('sendMessage', "Send message");

		// 스타일 변경
		this.sendButton.classList.toggle('cancel-mode', inProgress);
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

	/**
	 * Claude CLI 연결 초기화
	 * 최대 3회 자동 재시도, 실패 시 수동 재시도 버튼 표시
	 */
	private async initializeConnection(): Promise<void> {
		const maxRetries = this.connectionOverlay.maxRetries;

		// 연결 시도
		this.connectionOverlay.setConnecting();

		for (let attempt = 1; attempt <= maxRetries; attempt++) {
			// 재시도 상태 표시 (첫 시도 제외)
			if (attempt > 1) {
				this.connectionOverlay.setRetrying(attempt);
				// 재시도 전 잠시 대기
				await new Promise(resolve => setTimeout(resolve, 1000));
			}

			try {
				const connected = await this.claudeService.checkConnection?.() ?? false;

				if (connected) {
					// 연결 성공
					this.connectionOverlay.setConnected();
					this.setInputEnabled(true);
					return;
				}
			} catch (error) {
				// 에러 발생 - 계속 재시도
			}

			// 마지막 시도가 아니면 계속
			if (attempt < maxRetries) {
				continue;
			}
		}

		// 모든 재시도 실패 - 수동 재시도 버튼 표시
		this.connectionOverlay.setFailed(
			localize('connectionFailedDetail', "Could not connect to Claude CLI.\nMake sure Claude CLI is installed and you are logged in.\nRun 'claude login' in terminal.")
		);
	}

	/**
	 * 연결 끊김 처리
	 * CLI 세션이 비정상 종료되었을 때 호출
	 */
	private handleConnectionLost(): void {
		// 입력 비활성화
		this.setInputEnabled(false);

		// 알림 표시 (액션 버튼 포함)
		this.notificationService.prompt(
			Severity.Warning,
			localize('connectionLost', "Claude CLI session terminated unexpectedly."),
			[
				{
					label: localize('reconnect', "Reconnect"),
					run: () => this.initializeConnection()
				}
			]
		);
	}

	// ========== 세션 관리 ==========

	/**
	 * 새 세션 생성
	 */
	private createNewSession(): void {
		this.claudeService.startNewSession();
		this.notificationService.info(localize('newSessionCreated', "New session created"));
	}

	/**
	 * 세션 전환
	 */
	private switchToSession(sessionId: string): void {
		const currentSession = this.claudeService.getCurrentSession();
		if (currentSession?.id === sessionId) {
			return;
		}

		const session = this.claudeService.switchSession?.(sessionId);
		if (!session) {
			this.notificationService.error(localize('sessionNotFound', "Session not found"));
			return;
		}
	}

	/**
	 * 세션 삭제
	 */
	private deleteSession(sessionId: string): void {
		const sessions = this.claudeService.getSessions();

		// 마지막 세션은 삭제 불가
		if (sessions.length <= 1) {
			this.notificationService.warn(localize('cannotDeleteLastSession', "Cannot delete the last session"));
			return;
		}

		const success = this.claudeService.deleteSession?.(sessionId);
		if (success) {
			this.notificationService.info(localize('sessionDeleted', "Session deleted"));
			this.sessionTabs?.render();
		}
	}

	/**
	 * 세션 이름 변경
	 */
	private renameSession(sessionId: string, newName: string): void {
		const success = this.claudeService.renameSession?.(sessionId, newName);
		if (success) {
			this.sessionTabs?.render();

			// 현재 세션이면 타이틀도 업데이트
			const currentSession = this.claudeService.getCurrentSession();
			if (currentSession?.id === sessionId) {
				this.updateTitle(newName);
			}
		}
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
		this.inputEditorManager?.focus();
	}

	/**
	 * 선택 영역을 컨텍스트로 설정 (에디터 컨텍스트 메뉴에서 호출)
	 * @param selectedText 선택된 텍스트
	 * @param fileName 파일 이름
	 */
	public setInputWithContext(selectedText: string, fileName: string): void {
		if (!this.inputEditorManager) {
			return;
		}

		// 프롬프트 생성: 선택 영역에 대해 질문할 수 있도록
		const prompt = `\`${fileName}\`의 다음 코드에 대해:\n\n\`\`\`\n${selectedText}\n\`\`\`\n\n`;

		this.inputEditorManager.setValue(prompt);
		this.inputEditorManager.focus();

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
}
