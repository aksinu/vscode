/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, append, addDisposableListener, EventType } from '../../../../base/browser/dom.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { ThemeIcon } from '../../../../base/common/themables.js';
import { DisposableStore } from '../../../../base/common/lifecycle.js';
import { ICodeEditor } from '../../../../editor/browser/editorBrowser.js';
import { CodeEditorWidget } from '../../../../editor/browser/widget/codeEditor/codeEditorWidget.js';
import { IEditorConstructionOptions } from '../../../../editor/browser/config/editorConfiguration.js';
import { EditorExtensionsRegistry } from '../../../../editor/browser/editorExtensions.js';
import { IModelService } from '../../../../editor/common/services/model.js';
import { ILanguageService } from '../../../../editor/common/languages/language.js';
import { localize } from '../../../../nls.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IContextMenuService } from '../../../../platform/contextview/browser/contextView.js';
import { IHoverService } from '../../../../platform/hover/browser/hover.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IKeybindingService } from '../../../../platform/keybinding/common/keybinding.js';
import { IOpenerService } from '../../../../platform/opener/common/opener.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { IViewPaneOptions, ViewPane } from '../../../browser/parts/views/viewPane.js';
import { IViewDescriptorService } from '../../../common/views.js';
import { IClaudeService } from '../common/claude.js';
import { IClaudeMessage, IClaudeAttachment, IClaudeQueuedMessage, IClaudeStatusInfo } from '../common/claudeTypes.js';
import { CONTEXT_CLAUDE_INPUT_FOCUSED, CONTEXT_CLAUDE_PANEL_FOCUSED, CONTEXT_CLAUDE_REQUEST_IN_PROGRESS } from '../common/claudeContextKeys.js';
import { URI } from '../../../../base/common/uri.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { ClaudeMessageRenderer } from './claudeMessageRenderer.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { basename } from '../../../../base/common/resources.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { VSBuffer } from '../../../../base/common/buffer.js';
import { IQuickInputService, IQuickPickItem } from '../../../../platform/quickinput/common/quickInput.js';
import { IClaudeLocalConfig } from '../common/claudeLocalConfig.js';
import { ITextModelService } from '../../../../editor/common/services/resolverService.js';
import { Range } from '../../../../editor/common/core/range.js';

interface IAutocompleteItem {
	id: string;
	icon: string;
	label: string;
	description?: string;
	type: 'mention' | 'command' | 'file';
	data?: unknown;
}

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
	private sendButton!: HTMLButtonElement;
	private autocompleteContainer!: HTMLElement;
	private autocompleteItems: IAutocompleteItem[] = [];
	private selectedAutocompleteIndex = 0;
	private autocompleteVisible = false;
	private autocompletePrefix = '';
	private autocompleteTriggerChar = '';

	private messageRenderer!: ClaudeMessageRenderer;
	private messageDisposables = new Map<string, DisposableStore>();
	private attachments: IClaudeAttachment[] = [];

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

		// 메시지 렌더러 생성
		this.messageRenderer = this._register(this.instantiationService.createInstance(ClaudeMessageRenderer, {
			onApplyCode: (code, language) => this.applyCode(code, language),
			onRespondToAskUser: (responses) => this.claudeService.respondToAskUser(responses)
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
		}));

		this._register(this.claudeService.onDidChangeSession(() => {
			this.clearMessages();
			this.updateWelcomeVisibility();
		}));

		this._register(this.claudeService.onDidChangeQueue(queue => {
			this.updateQueueUI(queue);
		}));
	}

	protected override renderBody(container: HTMLElement): void {
		super.renderBody(container);

		this.container = append(container, $('.claude-chat-container'));

		// 드롭 오버레이
		this.dropOverlay = append(this.container, $('.claude-drop-overlay'));
		this.dropOverlay.textContent = localize('dropFilesHere', "Drop files here to attach");

		// 열린 파일 버튼 영역
		this.openFilesContainer = append(this.container, $('.claude-open-files'));
		this.updateOpenFilesUI();

		// 열린 에디터 변경 시 업데이트
		this._register(this.editorService.onDidVisibleEditorsChange(() => {
			this.updateOpenFilesUI();
		}));

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

		// 상태 바 (입력창 위)
		this.statusBarContainer = append(this.container, $('.claude-status-bar'));
		this.createStatusBar();

		// 상태 변경 이벤트 구독
		if (this.claudeService.onDidChangeStatusInfo) {
			this._register(this.claudeService.onDidChangeStatusInfo(status => {
				this.updateStatusBar(status);
			}));
		}

		// 초기 연결 체크 (비동기)
		this.claudeService.checkConnection?.();

		// 입력 영역
		this.inputContainer = append(this.container, $('.claude-input-container'));
		this.createInputEditor();

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
		const headerText = append(header, $('span'));
		headerText.textContent = localize('queuedMessages', "Queued ({0}):", queue.length);

		// 전체 취소 버튼
		const clearButton = append(header, $('button.claude-queue-clear'));
		clearButton.title = localize('clearQueue', "Clear queue");
		append(clearButton, $('.codicon.codicon-close-all'));

		this._register(addDisposableListener(clearButton, EventType.CLICK, () => {
			this.claudeService.clearQueue();
		}));

		// 큐 아이템들
		const list = append(this.queueContainer, $('.claude-queue-list'));

		for (const item of queue) {
			const itemElement = append(list, $('.claude-queue-item'));

			// 메시지 내용 (요약)
			const content = append(itemElement, $('.claude-queue-item-content'));
			const preview = item.content.length > 50 ? item.content.substring(0, 50) + '...' : item.content;
			content.textContent = preview;
			content.title = item.content;

			// 개별 삭제 버튼
			const removeButton = append(itemElement, $('button.claude-queue-item-remove'));
			removeButton.title = localize('removeFromQueue', "Remove from queue");
			append(removeButton, $('.codicon.codicon-close'));

			this._register(addDisposableListener(removeButton, EventType.CLICK, () => {
				this.claudeService.removeFromQueue(item.id);
			}));
		}
	}

	private createInputEditor(): void {
		// 첨부파일 컨테이너 (입력창 위에)
		this.attachmentsContainer = append(this.inputContainer, $('.claude-attachments'));
		this.updateAttachmentsUI();

		// 자동완성 팝업 (입력창 위에)
		this.autocompleteContainer = append(this.inputContainer, $('.claude-autocomplete'));
		this.autocompleteContainer.style.display = 'none';

		// 입력 wrapper
		const inputWrapper = append(this.inputContainer, $('.claude-input-wrapper'));

		// 에디터 영역
		const editorWrapper = append(inputWrapper, $('.claude-input-editor-wrapper'));
		const editorContainer = append(editorWrapper, $('.claude-input-editor'));

		// 플레이스홀더
		const placeholder = append(editorWrapper, $('.claude-input-placeholder'));
		placeholder.textContent = localize('claudeInputPlaceholder', "Ask Claude anything... (Enter to send, Shift+Enter for new line)");

		const editorOptions: IEditorConstructionOptions = {
			lineNumbers: 'off',
			glyphMargin: false,
			lineDecorationsWidth: 0,
			lineNumbersMinChars: 0,
			folding: false,
			minimap: { enabled: false },
			scrollbar: {
				vertical: 'auto',
				horizontal: 'hidden',
				alwaysConsumeMouseWheel: false
			},
			overviewRulerLanes: 0,
			overviewRulerBorder: false,
			hideCursorInOverviewRuler: true,
			renderLineHighlight: 'none',
			wordWrap: 'on',
			wrappingStrategy: 'advanced',
			scrollBeyondLastLine: false,
			automaticLayout: true,
			padding: { top: 8, bottom: 8 },
			fontSize: 13,
			fontFamily: this.configurationService.getValue<string>('editor.fontFamily'),
			ariaLabel: localize('claudeInputAriaLabel', "Claude chat input")
		};

		// 에디터 위젯 생성
		const codeEditorWidgetOptions = {
			contributions: EditorExtensionsRegistry.getSomeEditorContributions([
				'editor.contrib.bracketMatching',
				'editor.contrib.wordHighlighter'
			])
		};

		this.inputEditor = this._register(this.instantiationService.createInstance(
			CodeEditorWidget,
			editorContainer,
			editorOptions,
			codeEditorWidgetOptions
		));

		// 빈 모델 설정
		const model = this.modelService.createModel('', this.languageService.createById('plaintext'), URI.parse('claude-input://input'));
		this.inputEditor.setModel(model);

		// 플레이스홀더 표시/숨김
		const updatePlaceholder = () => {
			const hasText = this.inputEditor.getValue().length > 0;
			placeholder.style.display = hasText ? 'none' : 'block';
		};
		this._register(this.inputEditor.onDidChangeModelContent(() => {
			updatePlaceholder();
			this.checkAutocomplete();
		}));
		updatePlaceholder();

		// 포커스 이벤트
		this._register(this.inputEditor.onDidFocusEditorText(() => {
			this.inputFocusedKey.set(true);
			inputWrapper.classList.add('focused');
		}));

		this._register(this.inputEditor.onDidBlurEditorText(() => {
			this.inputFocusedKey.set(false);
			inputWrapper.classList.remove('focused');
		}));

		// 클립보드 붙여넣기 이벤트 (이미지 지원)
		this._register(addDisposableListener(editorContainer, EventType.PASTE, (e: ClipboardEvent) => {
			this.handlePaste(e);
		}));

		// 키보드 이벤트 처리
		this._register(this.inputEditor.onKeyDown(e => {
			// 자동완성 팝업이 열려있을 때
			if (this.autocompleteVisible) {
				if (e.keyCode === 9 /* Escape */) {
					e.preventDefault();
					e.stopPropagation();
					this.hideAutocomplete();
					return;
				}
				if (e.keyCode === 16 /* UpArrow */) {
					e.preventDefault();
					e.stopPropagation();
					this.selectAutocompleteItem(this.selectedAutocompleteIndex - 1);
					return;
				}
				if (e.keyCode === 18 /* DownArrow */) {
					e.preventDefault();
					e.stopPropagation();
					this.selectAutocompleteItem(this.selectedAutocompleteIndex + 1);
					return;
				}
				if (e.keyCode === 3 /* Enter */ || e.keyCode === 2 /* Tab */) {
					e.preventDefault();
					e.stopPropagation();
					this.acceptAutocompleteItem();
					return;
				}
			}

			// Enter 키 처리 (Shift+Enter는 줄바꿈)
			if (e.keyCode === 3 /* Enter */ && !e.shiftKey && !e.ctrlKey && !e.altKey) {
				e.preventDefault();
				e.stopPropagation();
				this.submitInput();
			}
		}));

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
			this.showSessionManager();
		}));

		// 설정 버튼
		const settingsButton = append(inputFooter, $('button.claude-footer-button'));
		settingsButton.title = localize('openLocalSettings', "Open local settings (.vscode/claude.local.json)");
		append(settingsButton, $('.codicon.codicon-settings-gear'));

		this._register(addDisposableListener(settingsButton, EventType.CLICK, () => {
			this.openLocalSettings();
		}));
	}

	private async submitInput(): Promise<void> {
		const content = this.inputEditor.getValue().trim();
		if (!content) {
			return;
		}

		// 요청 진행 중이면 무시
		if (this.claudeService.getState() !== 'idle') {
			return;
		}

		// 입력 초기화
		this.inputEditor.setValue('');

		// 현재 에디터 컨텍스트 가져오기
		const context = this.getEditorContext();

		// 첨부파일 추가
		if (this.attachments.length > 0) {
			if (context) {
				(context as { attachments?: IClaudeAttachment[] }).attachments = [...this.attachments];
			}
		}

		// 첨부파일 초기화
		this.clearAttachments();

		try {
			await this.claudeService.sendMessage(content, { context });
			this.scrollToBottom();
		} catch (error) {
			// 에러는 서비스에서 처리됨
		}
	}

	private getEditorContext(): { selection?: string; filePath?: URI; language?: string } | undefined {
		const editor = this.editorService.activeTextEditorControl;
		if (!editor || !('getModel' in editor)) {
			return undefined;
		}

		const codeEditor = editor as ICodeEditor;
		const model = codeEditor.getModel();
		const selection = codeEditor.getSelection();

		if (!model) {
			return undefined;
		}

		const selectedText = selection && !selection.isEmpty()
			? model.getValueInRange(selection)
			: undefined;

		return {
			selection: selectedText,
			filePath: model.uri,
			language: model.getLanguageId()
		};
	}

	private appendMessage(message: IClaudeMessage): void {
		const messageContainer = $('.claude-message-wrapper');
		messageContainer.dataset.messageId = message.id;

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
		const existingContainer = this.messagesContainer.querySelector(`[data-message-id="${message.id}"]`);
		if (!existingContainer) {
			return;
		}

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
		const disposables = this.messageRenderer.renderMessage(message, existingContainer as HTMLElement);
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

	private async applyCode(code: string, _language: string): Promise<void> {
		const editor = this.editorService.activeTextEditorControl;
		if (!editor || !('getModel' in editor)) {
			this.notificationService.info(localize('noActiveEditor', "No active editor to apply code"));
			return;
		}

		const codeEditor = editor as ICodeEditor;
		const model = codeEditor.getModel();
		const selection = codeEditor.getSelection();

		if (!model || !selection) {
			return;
		}

		// 선택 영역이 없으면 전체 파일로 처리
		const hasSelection = !selection.isEmpty();
		const targetRange = hasSelection ? selection : model.getFullModelRange();
		const originalText = model.getValueInRange(targetRange);

		// 변경사항이 없으면 알림
		if (originalText === code) {
			this.notificationService.info(localize('noChanges', "No changes to apply"));
			return;
		}

		// QuickPick으로 적용 방식 선택
		interface IApplyQuickPickItem extends IQuickPickItem {
			id: string;
		}

		const items: IApplyQuickPickItem[] = [
			{
				id: 'preview',
				label: '$(diff) ' + localize('previewDiff', "Preview Diff"),
				description: localize('previewDiffDesc', "Review changes before applying")
			},
			{
				id: 'apply',
				label: '$(check) ' + localize('applyDirectly', "Apply Directly"),
				description: localize('applyDirectlyDesc', "Apply changes immediately")
			}
		];

		const selected = await this.quickInputService.pick(items, {
			placeHolder: localize('selectApplyMethod', "How would you like to apply the code?")
		});

		if (!selected) {
			return;
		}

		const selectedItem = selected as IApplyQuickPickItem;

		if (selectedItem.id === 'apply') {
			// 바로 적용
			this.executeCodeApply(codeEditor, targetRange, code);
		} else {
			// Diff 미리보기
			await this.showDiffPreview(model.uri, targetRange, originalText, code);
		}
	}

	private executeCodeApply(editor: ICodeEditor, range: Range, code: string): void {
		editor.executeEdits('claude-apply', [{
			range,
			text: code,
			forceMoveMarkers: true
		}]);
		editor.focus();
		this.notificationService.info(localize('codeApplied', "Code applied to editor"));
	}

	private async showDiffPreview(uri: URI, range: Range, originalText: string, modifiedText: string): Promise<void> {
		// 임시 URI 생성
		const originalUri = uri.with({ scheme: 'claude-diff-original', query: `range=${range.startLineNumber}-${range.endLineNumber}` });
		const modifiedUri = uri.with({ scheme: 'claude-diff-modified', query: `range=${range.startLineNumber}-${range.endLineNumber}` });

		// 텍스트 콘텐츠 프로바이더에 등록
		const originalDisposable = this.textModelService.registerTextModelContentProvider('claude-diff-original', {
			provideTextContent: async () => {
				return this.modelService.createModel(originalText, null, originalUri);
			}
		});

		const modifiedDisposable = this.textModelService.registerTextModelContentProvider('claude-diff-modified', {
			provideTextContent: async () => {
				return this.modelService.createModel(modifiedText, null, modifiedUri);
			}
		});

		this._register(originalDisposable);
		this._register(modifiedDisposable);

		// Diff 에디터 열기
		const fileName = basename(uri);
		await this.editorService.openEditor({
			original: { resource: originalUri },
			modified: { resource: modifiedUri },
			label: localize('diffLabel', "Claude: {0} (Preview)", fileName),
			description: localize('diffDescription', "Review changes and use 'Accept' to apply")
		});

		// Accept/Reject 버튼을 위한 알림 표시
		await this.notificationService.prompt(
			2, // Info severity
			localize('diffPreviewPrompt', "Review the changes in the diff editor. Do you want to apply them?"),
			[
				{
					label: localize('accept', "Accept"),
					run: () => {
						// 원본 파일에 적용
						this.applyDiffChanges(uri, range, modifiedText);
					}
				},
				{
					label: localize('reject', "Reject"),
					run: () => {
						this.notificationService.info(localize('changesRejected', "Changes rejected"));
					}
				}
			]
		);

		// 정리
		originalDisposable.dispose();
		modifiedDisposable.dispose();
	}

	private async applyDiffChanges(uri: URI, range: Range, modifiedText: string): Promise<void> {
		// 원본 파일 열기
		const editor = await this.editorService.openEditor({ resource: uri });
		if (!editor) {
			return;
		}

		const control = editor.getControl();
		if (control && 'getModel' in control) {
			const codeEditor = control as ICodeEditor;
			this.executeCodeApply(codeEditor, range, modifiedText);
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

		// 이미지 파일 확인
		const items = clipboardData.items;
		for (let i = 0; i < items.length; i++) {
			const item = items[i];

			// 이미지 타입 확인
			if (item.type.startsWith('image/')) {
				e.preventDefault();
				e.stopPropagation();

				const file = item.getAsFile();
				if (file) {
					await this.handlePastedImage(file);
				}
				return;
			}
		}

		// 파일 확인 (일부 브라우저에서는 files로 제공)
		const files = clipboardData.files;
		if (files && files.length > 0) {
			for (let i = 0; i < files.length; i++) {
				const file = files[i];
				if (file.type.startsWith('image/')) {
					e.preventDefault();
					e.stopPropagation();
					await this.handlePastedImage(file);
					return;
				}
			}
		}

		// 텍스트는 기본 동작 유지
	}

	private async handlePastedImage(file: File): Promise<void> {
		try {
			console.log('[ClaudeChatView] Pasted image:', file.name, file.type, file.size);

			// 파일을 base64로 변환
			const base64 = await this.fileToBase64(file);

			// 파일명 생성
			const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
			const extension = file.type.split('/')[1] || 'png';
			const fileName = `screenshot-${timestamp}.${extension}`;

			// 첨부파일로 추가
			const attachment: IClaudeAttachment = {
				id: generateUuid(),
				type: 'image',
				name: fileName,
				content: `[Image: ${fileName}] (${Math.round(file.size / 1024)}KB)`,
				imageData: base64,
				mimeType: file.type
			};

			this.attachments.push(attachment);
			this.updateAttachmentsUI();

			this.notificationService.info(localize('imagePasted', "Image pasted: {0}", fileName));
		} catch (error) {
			console.error('[ClaudeChatView] Failed to paste image:', error);
			this.notificationService.error(localize('imagePasteError', "Failed to paste image: {0}", (error as Error).message));
		}
	}

	private fileToBase64(file: File): Promise<string> {
		return new Promise((resolve, reject) => {
			const reader = new FileReader();
			reader.onload = () => {
				const result = reader.result as string;
				// data:image/png;base64, 부분 제거
				const base64 = result.split(',')[1] || result;
				resolve(base64);
			};
			reader.onerror = () => reject(reader.error);
			reader.readAsDataURL(file);
		});
	}

	// ========== 드래그/드롭 ==========

	private setupDragAndDrop(): void {
		let dragCounter = 0;

		this._register(addDisposableListener(this.container, EventType.DRAG_ENTER, (e: DragEvent) => {
			e.preventDefault();
			e.stopPropagation();
			dragCounter++;

			if (e.dataTransfer?.types.includes('Files') || e.dataTransfer?.types.includes('text/uri-list')) {
				this.dropOverlay.classList.add('visible');
			}
		}));

		this._register(addDisposableListener(this.container, EventType.DRAG_LEAVE, (e: DragEvent) => {
			e.preventDefault();
			e.stopPropagation();
			dragCounter--;

			if (dragCounter === 0) {
				this.dropOverlay.classList.remove('visible');
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
			this.dropOverlay.classList.remove('visible');

			await this.handleDrop(e);
		}));
	}

	private async handleDrop(e: DragEvent): Promise<void> {
		const dataTransfer = e.dataTransfer;
		if (!dataTransfer) {
			return;
		}

		// VS Code 내부 드래그 (탐색기에서)
		const uriList = dataTransfer.getData('text/uri-list');
		if (uriList) {
			const uris = uriList.split('\n').filter(line => line.trim() && !line.startsWith('#'));
			for (const uriStr of uris) {
				try {
					const uri = URI.parse(uriStr.trim());
					await this.addFileAttachment(uri);
				} catch {
					// 무효한 URI 무시
				}
			}
			return;
		}

		// 외부 파일 드롭
		if (dataTransfer.files && dataTransfer.files.length > 0) {
			for (let i = 0; i < dataTransfer.files.length; i++) {
				const file = dataTransfer.files[i];
				// File 객체에서 경로를 가져올 수 없으므로 알림
				// Electron에서는 path 속성이 있음
				const filePath = (file as File & { path?: string }).path;
				if (filePath) {
					const uri = URI.file(filePath);
					await this.addFileAttachment(uri);
				}
			}
		}
	}

	// ========== 첨부파일 관리 ==========

	private async addFileAttachment(uri: URI): Promise<void> {
		// 중복 체크
		if (this.attachments.some(a => a.uri?.toString() === uri.toString())) {
			this.notificationService.info(localize('fileAlreadyAttached', "File is already attached"));
			return;
		}

		try {
			const stat = await this.fileService.stat(uri);
			const isDirectory = stat.isDirectory;

			// 파일 내용 읽기 (디렉토리가 아닌 경우)
			let content: string | undefined;
			if (!isDirectory) {
				try {
					const fileContent = await this.fileService.readFile(uri);
					content = fileContent.value.toString();

					// 너무 큰 파일은 내용을 자름
					if (content.length > 50000) {
						content = content.substring(0, 50000) + '\n... (truncated)';
					}
				} catch {
					// 바이너리 파일 등
					content = undefined;
				}
			}

			const attachment: IClaudeAttachment = {
				id: generateUuid(),
				type: isDirectory ? 'folder' : 'file',
				uri,
				name: basename(uri),
				content
			};

			this.attachments.push(attachment);
			this.updateAttachmentsUI();

			this.notificationService.info(localize('fileAttached', "Attached: {0}", attachment.name));
		} catch (error) {
			this.notificationService.error(localize('attachError', "Failed to attach file: {0}", (error as Error).message));
		}
	}

	private attachCurrentEditorFile(): void {
		const editor = this.editorService.activeTextEditorControl;
		if (!editor || !('getModel' in editor)) {
			this.notificationService.info(localize('noActiveEditorToAttach', "No active editor to attach"));
			return;
		}

		const codeEditor = editor as ICodeEditor;
		const model = codeEditor.getModel();

		if (model?.uri) {
			this.addFileAttachment(model.uri);
		}
	}

	private removeAttachment(id: string): void {
		const index = this.attachments.findIndex(a => a.id === id);
		if (index !== -1) {
			this.attachments.splice(index, 1);
			this.updateAttachmentsUI();
		}
	}

	private clearAttachments(): void {
		this.attachments = [];
		this.updateAttachmentsUI();
	}

	private updateAttachmentsUI(): void {
		// 기존 UI 초기화 (innerHTML 대신 DOM 메서드 사용)
		while (this.attachmentsContainer.firstChild) {
			this.attachmentsContainer.removeChild(this.attachmentsContainer.firstChild);
		}

		// 열린 파일 버튼 상태도 업데이트
		this.updateOpenFilesUI();

		if (this.attachments.length === 0) {
			this.attachmentsContainer.style.display = 'none';
			return;
		}

		this.attachmentsContainer.style.display = 'flex';

		for (const attachment of this.attachments) {
			const tag = append(this.attachmentsContainer, $('.claude-attachment-tag'));

			// 아이콘
			const icon = append(tag, $('.claude-attachment-icon'));
			let iconClass = Codicon.file;
			if (attachment.type === 'folder') {
				iconClass = Codicon.folder;
			} else if (attachment.type === 'workspace') {
				iconClass = Codicon.folderLibrary;
			} else if (attachment.type === 'image') {
				iconClass = Codicon.fileMedia;
			}
			icon.classList.add(...ThemeIcon.asClassNameArray(iconClass));

			// 파일명
			const name = append(tag, $('.claude-attachment-name'));
			name.textContent = attachment.name;
			name.title = attachment.uri?.fsPath || attachment.name;

			// 삭제 버튼
			const removeBtn = append(tag, $('.claude-attachment-remove'));
			removeBtn.classList.add(...ThemeIcon.asClassNameArray(Codicon.close));
			removeBtn.title = localize('removeAttachment', "Remove attachment");

			this._register(addDisposableListener(removeBtn, EventType.CLICK, (e) => {
				e.stopPropagation();
				this.removeAttachment(attachment.id);
			}));
		}
	}

	override focus(): void {
		super.focus();
		this.inputEditor?.focus();
	}

	// ========== 로컬 설정 ==========

	private async openLocalSettings(): Promise<void> {
		const workspaceFolder = this.workspaceContextService.getWorkspace().folders[0];
		if (!workspaceFolder) {
			this.notificationService.warn(localize('noWorkspace', "No workspace folder open. Please open a folder first."));
			return;
		}

		const vscodeFolder = URI.joinPath(workspaceFolder.uri, '.vscode');
		const configUri = URI.joinPath(vscodeFolder, 'claude.local.json');

		// 현재 설정 로드
		let config: IClaudeLocalConfig = {};
		try {
			const content = await this.fileService.readFile(configUri);
			config = JSON.parse(content.value.toString());
		} catch {
			// 파일 없음 - 기본값 사용
		}

		// 현재 상태 표시용
		const autoAcceptStatus = config.autoAccept ? '$(check) ON' : '$(close) OFF';
		const scriptPath = config.executable?.type === 'script' ? config.executable.script : undefined;
		const scriptStatus = scriptPath ? `$(file) ${scriptPath}` : '$(terminal) claude (default)';

		interface ISettingsQuickPickItem extends IQuickPickItem {
			id: string;
		}

		const items: ISettingsQuickPickItem[] = [
			{
				id: 'autoAccept',
				label: `$(symbol-boolean) Auto Accept`,
				description: autoAcceptStatus,
				detail: localize('autoAcceptDetail', "Automatically accept Claude's questions (AskUser)")
			},
			{
				id: 'script',
				label: `$(file-code) Claude Script`,
				description: scriptStatus,
				detail: localize('scriptDetail', "Custom script to run Claude CLI (e.g., set API key)")
			},
			{
				id: 'separator',
				label: '',
				kind: 1 // separator
			} as ISettingsQuickPickItem,
			{
				id: 'editJson',
				label: `$(json) Edit JSON directly`,
				detail: localize('editJsonDetail', "Open claude.local.json in editor")
			}
		];

		const selected = await this.quickInputService.pick(items, {
			placeHolder: localize('selectSetting', "Claude Local Settings"),
			canPickMany: false
		});

		if (!selected) {
			return;
		}

		const selectedItem = selected as ISettingsQuickPickItem;

		switch (selectedItem.id) {
			case 'autoAccept':
				await this.toggleAutoAccept(configUri, config);
				break;
			case 'script':
				await this.selectClaudeScript(configUri, config, workspaceFolder.uri);
				break;
			case 'editJson':
				await this.openOrCreateConfigFile(configUri, vscodeFolder, config);
				break;
		}
	}

	private async toggleAutoAccept(configUri: URI, config: IClaudeLocalConfig): Promise<void> {
		const newValue = !config.autoAccept;
		const newConfig = { ...config, autoAccept: newValue };

		await this.saveConfig(configUri, newConfig);

		const status = newValue ? 'ON' : 'OFF';
		this.notificationService.info(localize('autoAcceptChanged', "Auto Accept: {0}", status));

		// 서비스에 알림 (설정 다시 로드하도록)
		this.claudeService.reloadLocalConfig?.();
	}

	private async selectClaudeScript(configUri: URI, config: IClaudeLocalConfig, workspaceUri: URI): Promise<void> {
		interface IScriptQuickPickItem extends IQuickPickItem {
			id: string;
		}

		const items: IScriptQuickPickItem[] = [
			{
				id: 'default',
				label: '$(terminal) Use default claude command',
				description: config.executable?.type !== 'script' ? '(current)' : ''
			},
			{
				id: 'browse',
				label: '$(folder-opened) Browse for script file...',
				detail: localize('browseDetail', "Select .bat, .sh, .ps1, .js, or .py file")
			}
		];

		// 현재 스크립트가 있으면 표시
		if (config.executable?.type === 'script' && config.executable.script) {
			items.splice(1, 0, {
				id: 'current',
				label: `$(file) ${config.executable.script}`,
				description: '(current)',
				detail: localize('currentScript', "Currently configured script")
			});
		}

		const selected = await this.quickInputService.pick(items, {
			placeHolder: localize('selectScript', "Select Claude execution method")
		});

		if (!selected) {
			return;
		}

		const selectedItem = selected as IScriptQuickPickItem;

		if (selectedItem.id === 'default') {
			// 기본 명령어로 변경
			const newConfig: IClaudeLocalConfig = {
				...config,
				executable: { type: 'command', command: 'claude' }
			};
			await this.saveConfig(configUri, newConfig);
			this.notificationService.info(localize('usingDefaultClaude', "Using default 'claude' command"));
			this.claudeService.reloadLocalConfig?.();

		} else if (selectedItem.id === 'browse') {
			// 파일 선택 다이얼로그
			const result = await this.fileService.resolve(workspaceUri);
			if (!result) {
				return;
			}

			// QuickPick으로 파일 입력 받기 (간단한 방식)
			const scriptPath = await this.quickInputService.input({
				placeHolder: localize('enterScriptPath', "Enter script path (relative to workspace)"),
				prompt: localize('scriptPathPrompt', "e.g., ./scripts/claude.bat or scripts/run-claude.sh"),
				value: config.executable?.script || './scripts/claude.bat'
			});

			if (scriptPath) {
				const newConfig: IClaudeLocalConfig = {
					...config,
					executable: { type: 'script', script: scriptPath }
				};
				await this.saveConfig(configUri, newConfig);
				this.notificationService.info(localize('scriptConfigured', "Script configured: {0}", scriptPath));
				this.claudeService.reloadLocalConfig?.();
			}
		}
	}

	private async saveConfig(configUri: URI, config: IClaudeLocalConfig): Promise<void> {
		// .vscode 폴더 확인/생성
		const vscodeFolder = URI.joinPath(configUri, '..');
		try {
			await this.fileService.stat(vscodeFolder);
		} catch {
			await this.fileService.createFolder(vscodeFolder);
		}

		const content = JSON.stringify(config, null, 2);
		await this.fileService.writeFile(configUri, VSBuffer.fromString(content));
	}

	private async openOrCreateConfigFile(configUri: URI, vscodeFolder: URI, existingConfig: IClaudeLocalConfig): Promise<void> {
		try {
			await this.fileService.stat(configUri);
		} catch {
			// 파일 없으면 생성
			try {
				await this.fileService.stat(vscodeFolder);
			} catch {
				await this.fileService.createFolder(vscodeFolder);
			}

			const defaultConfig = {
				...existingConfig,
				executable: existingConfig.executable || { type: 'command', command: 'claude' },
				autoAccept: existingConfig.autoAccept ?? false
			};

			await this.fileService.writeFile(configUri, VSBuffer.fromString(JSON.stringify(defaultConfig, null, 2)));
		}

		await this.editorService.openEditor({ resource: configUri });
	}

	// ========== 세션 관리 ==========

	private async showSessionManager(): Promise<void> {
		const sessions = this.claudeService.getSessions();
		const currentSession = this.claudeService.getCurrentSession();

		interface ISessionQuickPickItem extends IQuickPickItem {
			id: string;
			action?: 'switch' | 'new' | 'delete' | 'rename';
		}

		const items: ISessionQuickPickItem[] = [];

		// 새 세션 옵션
		items.push({
			id: 'new',
			label: '$(add) ' + localize('newSession', "New Session"),
			description: localize('newSessionDesc', "Start a fresh conversation"),
			action: 'new'
		});

		// 구분선
		items.push({
			id: 'separator-1',
			label: '',
			kind: 1 // separator
		} as ISessionQuickPickItem);

		// 세션 목록
		for (const session of sessions) {
			const isCurrent = currentSession?.id === session.id;
			const messageCount = session.messages.length;
			const lastMessage = session.messages[session.messages.length - 1];
			const preview = lastMessage?.content.substring(0, 50) || localize('emptySession', "Empty session");

			// 세션 제목 (없으면 첫 메시지 또는 생성 시간)
			let title = session.title;
			if (!title) {
				const firstUserMsg = session.messages.find(m => m.role === 'user');
				title = firstUserMsg?.content.substring(0, 30) || new Date(session.createdAt).toLocaleString();
			}

			items.push({
				id: session.id,
				label: (isCurrent ? '$(check) ' : '$(comment-discussion) ') + title,
				description: isCurrent ? localize('currentSession', "(current)") : `${messageCount} messages`,
				detail: preview + (preview.length >= 50 ? '...' : ''),
				action: 'switch'
			});
		}

		const selected = await this.quickInputService.pick(items, {
			placeHolder: localize('selectSession', "Select a session or create new"),
			canPickMany: false
		});

		if (!selected) {
			return;
		}

		const selectedItem = selected as ISessionQuickPickItem;

		if (selectedItem.action === 'new') {
			this.claudeService.startNewSession();
			this.clearMessages();
			this.updateWelcomeVisibility();
			this.notificationService.info(localize('newSessionCreated', "New session created"));
		} else if (selectedItem.action === 'switch') {
			await this.switchToSession(selectedItem.id);
		}
	}

	private async switchToSession(sessionId: string): Promise<void> {
		const currentSession = this.claudeService.getCurrentSession();
		if (currentSession?.id === sessionId) {
			return;
		}

		// 세션 전환
		const session = this.claudeService.switchSession?.(sessionId);
		if (!session) {
			this.notificationService.error(localize('sessionNotFound', "Session not found"));
			return;
		}

		// UI 갱신
		this.clearMessages();

		// 세션의 메시지들 다시 렌더링
		for (const message of session.messages) {
			this.appendMessage(message);
		}

		this.updateWelcomeVisibility();

		const title = session.title || localize('session', "Session");
		this.notificationService.info(localize('switchedToSession', "Switched to: {0}", title));
	}

	protected override layoutBody(height: number, width: number): void {
		super.layoutBody(height, width);

		// CSS flexbox가 레이아웃을 처리하도록 컨테이너 높이만 설정
		this.container.style.height = `${height}px`;

		// 에디터 레이아웃은 DOM 렌더링 후 계산
		requestAnimationFrame(() => {
			const editorWrapper = this.inputContainer.querySelector('.claude-input-editor-wrapper') as HTMLElement;
			if (editorWrapper && this.inputEditor) {
				const rect = editorWrapper.getBoundingClientRect();
				if (rect.width > 0 && rect.height > 0) {
					this.inputEditor.layout({ width: rect.width, height: rect.height });
				}
			}
		});
	}

	override dispose(): void {
		this.clearMessages();
		super.dispose();
	}

	// ========== 자동완성 (@ 멘션, / 커맨드) ==========

	private checkAutocomplete(): void {
		const position = this.inputEditor.getPosition();
		if (!position) {
			this.hideAutocomplete();
			return;
		}

		const model = this.inputEditor.getModel();
		if (!model) {
			this.hideAutocomplete();
			return;
		}

		// 현재 커서 위치까지의 텍스트
		const lineContent = model.getLineContent(position.lineNumber);
		const textBeforeCursor = lineContent.substring(0, position.column - 1);

		// @ 또는 / 패턴 찾기 (단어 시작에서)
		const mentionMatch = textBeforeCursor.match(/@(\w*)$/);
		const commandMatch = textBeforeCursor.match(/^\/(\w*)$/);

		if (mentionMatch) {
			this.autocompleteTriggerChar = '@';
			this.autocompletePrefix = mentionMatch[1].toLowerCase();
			this.showMentionAutocomplete();
		} else if (commandMatch) {
			this.autocompleteTriggerChar = '/';
			this.autocompletePrefix = commandMatch[1].toLowerCase();
			this.showCommandAutocomplete();
		} else {
			this.hideAutocomplete();
		}
	}

	private showMentionAutocomplete(): void {
		const items: IAutocompleteItem[] = [];
		const prefix = this.autocompletePrefix;

		// 고정 항목들
		const staticItems: IAutocompleteItem[] = [
			{
				id: 'file',
				icon: 'codicon-file-add',
				label: '@file',
				description: localize('mentionFile', "Browse and attach a file"),
				type: 'mention'
			},
			{
				id: 'workspace',
				icon: 'codicon-folder-library',
				label: '@workspace',
				description: localize('mentionWorkspace', "Include workspace context"),
				type: 'mention'
			}
		];

		// 필터링된 고정 항목
		for (const item of staticItems) {
			if (!prefix || item.label.toLowerCase().includes(prefix)) {
				items.push(item);
			}
		}

		// 열린 에디터 파일 목록
		const openEditors = this.editorService.editors;
		for (const editor of openEditors) {
			const resource = editor.resource;
			if (resource) {
				const fileName = basename(resource);
				if (!prefix || fileName.toLowerCase().includes(prefix)) {
					items.push({
						id: `file:${resource.toString()}`,
						icon: 'codicon-file',
						label: `@${fileName}`,
						description: resource.fsPath,
						type: 'file',
						data: resource
					});
				}
			}
		}

		this.showAutocomplete(items, localize('mentionHeader', "Mention"));
	}

	private showCommandAutocomplete(): void {
		const prefix = this.autocompletePrefix;

		const commands: IAutocompleteItem[] = [
			{
				id: 'explain',
				icon: 'codicon-lightbulb',
				label: '/explain',
				description: localize('cmdExplain', "Explain the selected code"),
				type: 'command'
			},
			{
				id: 'fix',
				icon: 'codicon-bug',
				label: '/fix',
				description: localize('cmdFix', "Fix bugs in the selected code"),
				type: 'command'
			},
			{
				id: 'test',
				icon: 'codicon-beaker',
				label: '/test',
				description: localize('cmdTest', "Generate tests for the code"),
				type: 'command'
			},
			{
				id: 'refactor',
				icon: 'codicon-edit',
				label: '/refactor',
				description: localize('cmdRefactor', "Refactor the selected code"),
				type: 'command'
			},
			{
				id: 'docs',
				icon: 'codicon-book',
				label: '/docs',
				description: localize('cmdDocs', "Generate documentation"),
				type: 'command'
			},
			{
				id: 'optimize',
				icon: 'codicon-rocket',
				label: '/optimize',
				description: localize('cmdOptimize', "Optimize for performance"),
				type: 'command'
			}
		];

		const filtered = commands.filter(cmd =>
			!prefix || cmd.label.toLowerCase().includes(prefix)
		);

		this.showAutocomplete(filtered, localize('commandHeader', "Commands"));
	}

	private showAutocomplete(items: IAutocompleteItem[], header: string): void {
		if (items.length === 0) {
			this.hideAutocomplete();
			return;
		}

		this.autocompleteItems = items;
		this.selectedAutocompleteIndex = 0;
		this.autocompleteVisible = true;

		// DOM 초기화
		while (this.autocompleteContainer.firstChild) {
			this.autocompleteContainer.removeChild(this.autocompleteContainer.firstChild);
		}

		// 헤더
		const headerEl = append(this.autocompleteContainer, $('.claude-autocomplete-header'));
		headerEl.textContent = header;

		// 리스트
		const list = append(this.autocompleteContainer, $('.claude-autocomplete-list'));

		for (let i = 0; i < items.length; i++) {
			const item = items[i];
			const itemEl = append(list, $('.claude-autocomplete-item'));
			itemEl.dataset.index = String(i);

			if (i === 0) {
				itemEl.classList.add('selected');
			}

			// 아이콘
			const iconEl = append(itemEl, $('.claude-autocomplete-item-icon'));
			append(iconEl, $(`.codicon.${item.icon}`));

			// 내용
			const contentEl = append(itemEl, $('.claude-autocomplete-item-content'));
			const labelEl = append(contentEl, $('.claude-autocomplete-item-label'));
			labelEl.textContent = item.label;

			if (item.description) {
				const descEl = append(contentEl, $('.claude-autocomplete-item-desc'));
				descEl.textContent = item.description;
			}

			// 클릭 이벤트
			this._register(addDisposableListener(itemEl, EventType.CLICK, () => {
				this.selectedAutocompleteIndex = i;
				this.acceptAutocompleteItem();
			}));

			// 호버 이벤트
			this._register(addDisposableListener(itemEl, EventType.MOUSE_ENTER, () => {
				this.selectAutocompleteItem(i);
			}));
		}

		this.autocompleteContainer.style.display = 'block';
	}

	private hideAutocomplete(): void {
		this.autocompleteVisible = false;
		this.autocompleteContainer.style.display = 'none';
		this.autocompleteItems = [];
	}

	private selectAutocompleteItem(index: number): void {
		if (this.autocompleteItems.length === 0) {
			return;
		}

		// 범위 제한
		if (index < 0) {
			index = this.autocompleteItems.length - 1;
		} else if (index >= this.autocompleteItems.length) {
			index = 0;
		}

		// 이전 선택 해제
		const prevSelected = this.autocompleteContainer.querySelector('.claude-autocomplete-item.selected');
		if (prevSelected) {
			prevSelected.classList.remove('selected');
		}

		// 새 선택
		const newSelected = this.autocompleteContainer.querySelector(`[data-index="${index}"]`);
		if (newSelected) {
			newSelected.classList.add('selected');
			newSelected.scrollIntoView({ block: 'nearest' });
		}

		this.selectedAutocompleteIndex = index;
	}

	private async acceptAutocompleteItem(): Promise<void> {
		const item = this.autocompleteItems[this.selectedAutocompleteIndex];
		if (!item) {
			this.hideAutocomplete();
			return;
		}

		this.hideAutocomplete();

		if (item.type === 'mention') {
			await this.handleMentionItem(item);
		} else if (item.type === 'command') {
			this.handleCommandItem(item);
		} else if (item.type === 'file') {
			await this.handleFileItem(item);
		}
	}

	private async handleMentionItem(item: IAutocompleteItem): Promise<void> {
		// 입력창에서 @xxx 제거
		this.removeAutocompleteText();

		if (item.id === 'file') {
			// 파일 선택기 열기
			await this.attachCurrentEditorFile();
		} else if (item.id === 'workspace') {
			// 워크스페이스 컨텍스트 첨부
			await this.attachWorkspaceContext();
		}
	}

	private handleCommandItem(item: IAutocompleteItem): void {
		// 입력창에서 /xxx를 커맨드 프롬프트로 교체
		const model = this.inputEditor.getModel();
		if (!model) {
			return;
		}

		const commandPrompts: Record<string, string> = {
			'explain': localize('promptExplain', "Explain this code in detail:"),
			'fix': localize('promptFix', "Find and fix bugs in this code:"),
			'test': localize('promptTest', "Write unit tests for this code:"),
			'refactor': localize('promptRefactor', "Refactor this code to be cleaner and more maintainable:"),
			'docs': localize('promptDocs', "Generate documentation for this code:"),
			'optimize': localize('promptOptimize', "Optimize this code for better performance:")
		};

		const prompt = commandPrompts[item.id] || '';

		// 전체 텍스트 교체
		model.setValue(prompt + '\n');

		// 커서를 끝으로
		const lineCount = model.getLineCount();
		const lastLineLength = model.getLineLength(lineCount);
		this.inputEditor.setPosition({ lineNumber: lineCount, column: lastLineLength + 1 });
		this.inputEditor.focus();
	}

	private async handleFileItem(item: IAutocompleteItem): Promise<void> {
		// 입력창에서 @filename 제거
		this.removeAutocompleteText();

		// 파일 첨부
		const uri = item.data as URI;
		if (uri) {
			await this.addFileAttachment(uri);
		}
	}

	private removeAutocompleteText(): void {
		const model = this.inputEditor.getModel();
		const position = this.inputEditor.getPosition();
		if (!model || !position) {
			return;
		}

		const lineContent = model.getLineContent(position.lineNumber);
		const textBeforeCursor = lineContent.substring(0, position.column - 1);

		// @ 또는 / 위치 찾기
		let triggerIndex = textBeforeCursor.lastIndexOf(this.autocompleteTriggerChar);
		if (triggerIndex === -1) {
			return;
		}

		// @ 또는 / 부터 커서까지 삭제
		const range = {
			startLineNumber: position.lineNumber,
			startColumn: triggerIndex + 1,
			endLineNumber: position.lineNumber,
			endColumn: position.column
		};

		model.pushEditOperations([], [{
			range,
			text: ''
		}], () => null);
	}

	private async attachWorkspaceContext(): Promise<void> {
		const workspaceFolder = this.workspaceContextService.getWorkspace().folders[0];
		if (!workspaceFolder) {
			this.notificationService.warn(localize('noWorkspaceToAttach', "No workspace folder open"));
			return;
		}

		// 워크스페이스 정보를 첨부로 추가
		const attachment: IClaudeAttachment = {
			id: generateUuid(),
			type: 'workspace',
			uri: workspaceFolder.uri,
			name: `Workspace: ${workspaceFolder.name}`,
			content: `Workspace: ${workspaceFolder.name}\nPath: ${workspaceFolder.uri.fsPath}`
		};

		this.attachments.push(attachment);
		this.updateAttachmentsUI();
		this.notificationService.info(localize('workspaceAttached', "Workspace context attached"));
	}

	// ========== 열린 파일 버튼 ==========

	private updateOpenFilesUI(): void {
		// 초기화 전이면 무시
		if (!this.openFilesContainer) {
			return;
		}

		// 기존 UI 초기화
		while (this.openFilesContainer.firstChild) {
			this.openFilesContainer.removeChild(this.openFilesContainer.firstChild);
		}

		// 열린 에디터 목록 가져오기
		const openEditors = this.editorService.editors;
		const uniqueFiles = new Map<string, URI>();

		for (const editor of openEditors) {
			const resource = editor.resource;
			if (resource && resource.scheme === 'file') {
				const key = resource.toString();
				if (!uniqueFiles.has(key)) {
					uniqueFiles.set(key, resource);
				}
			}
		}

		// 열린 파일이 없으면 숨김
		if (uniqueFiles.size === 0) {
			this.openFilesContainer.style.display = 'none';
			return;
		}

		this.openFilesContainer.style.display = 'flex';

		// 각 파일에 대해 버튼 생성
		for (const [, uri] of uniqueFiles) {
			const fileName = basename(uri);

			// 이미 첨부된 파일인지 확인
			const isAttached = this.attachments.some(a => a.uri?.toString() === uri.toString());

			const button = append(this.openFilesContainer, $('button.claude-open-file-button')) as HTMLButtonElement;
			button.title = uri.fsPath;

			if (isAttached) {
				button.classList.add('attached');
				button.disabled = true;
			}

			// + 아이콘
			const plusIcon = append(button, $('span.claude-open-file-plus'));
			plusIcon.textContent = '+';

			// 파일명
			const nameSpan = append(button, $('span.claude-open-file-name'));
			nameSpan.textContent = fileName;

			if (!isAttached) {
				this._register(addDisposableListener(button, EventType.CLICK, async () => {
					await this.addFileAttachment(uri);
					this.updateOpenFilesUI(); // 버튼 상태 업데이트
				}));
			}
		}
	}

	// ========== 상태 바 ==========

	private createStatusBar(): void {
		// 연결 상태
		const connectionStatus = append(this.statusBarContainer, $('.claude-status-item.connection'));

		const connectionIcon = append(connectionStatus, $('.claude-status-icon'));
		connectionIcon.classList.add('codicon', 'codicon-circle-filled');

		const connectionText = append(connectionStatus, $('.claude-status-text'));
		connectionText.textContent = 'Checking...';

		// 구분자
		append(this.statusBarContainer, $('.claude-status-separator'));

		// 모델
		const modelStatus = append(this.statusBarContainer, $('.claude-status-item.model'));
		const modelText = append(modelStatus, $('.claude-status-text'));
		modelText.textContent = 'Loading...';

		// 구분자
		append(this.statusBarContainer, $('.claude-status-separator'));

		// 실행 방식
		const execStatus = append(this.statusBarContainer, $('.claude-status-item.execution'));
		const execText = append(execStatus, $('.claude-status-text'));
		execText.textContent = 'CLI';

		// 설정 버튼 (오른쪽)
		const settingsButton = append(this.statusBarContainer, $('button.claude-status-settings'));
		settingsButton.title = localize('openSettings', "Open Settings");
		append(settingsButton, $('.codicon.codicon-settings-gear'));

		this._register(addDisposableListener(settingsButton, EventType.CLICK, () => {
			this.showSettingsQuickPick();
		}));

		// 초기 상태 업데이트
		const initialStatus = this.claudeService.getStatusInfo?.();
		if (initialStatus) {
			this.updateStatusBar(initialStatus);
		}
	}

	private updateStatusBar(status: IClaudeStatusInfo): void {
		// 연결 상태 업데이트
		const connectionItem = this.statusBarContainer.querySelector('.claude-status-item.connection');
		if (connectionItem) {
			const icon = connectionItem.querySelector('.claude-status-icon');
			const text = connectionItem.querySelector('.claude-status-text');

			// 아이콘 색상 클래스 초기화
			icon?.classList.remove('connected', 'disconnected', 'connecting', 'error');

			switch (status.connectionStatus) {
				case 'connected':
					icon?.classList.add('connected');
					if (text) text.textContent = 'Connected';
					break;
				case 'disconnected':
					icon?.classList.add('disconnected');
					if (text) text.textContent = 'Disconnected';
					break;
				case 'connecting':
					icon?.classList.add('connecting');
					if (text) text.textContent = 'Connecting...';
					break;
				case 'error':
					icon?.classList.add('error');
					if (text) text.textContent = 'Error';
					break;
			}
		}

		// 모델 업데이트
		const modelItem = this.statusBarContainer.querySelector('.claude-status-item.model .claude-status-text');
		if (modelItem) {
			// 모델명 축약 (claude-sonnet-4-xxx -> sonnet-4)
			const shortModel = status.model.replace(/^claude-/, '').replace(/-\d{8}$/, '');
			modelItem.textContent = shortModel;
		}

		// 실행 방식 업데이트
		const execItem = this.statusBarContainer.querySelector('.claude-status-item.execution .claude-status-text');
		if (execItem) {
			if (status.executionMethod === 'script' && status.scriptPath) {
				const scriptName = status.scriptPath.split(/[/\\]/).pop() || 'Script';
				execItem.textContent = `Script: ${scriptName}`;
			} else {
				execItem.textContent = 'CLI';
			}
		}
	}

	private async showSettingsQuickPick(): Promise<void> {
		const status = this.claudeService.getStatusInfo?.() || {
			connectionStatus: 'disconnected',
			model: 'unknown',
			extendedThinking: false,
			executionMethod: 'cli'
		} as IClaudeStatusInfo;

		// 현재 상태 표시
		const connectionIcon = status.connectionStatus === 'connected' ? '$(check)' : '$(close)';
		const thinkingIcon = status.extendedThinking ? '$(check)' : '$(close)';
		const execIcon = status.executionMethod === 'script' ? '$(file-code)' : '$(terminal)';

		interface ISettingsQuickPickItem extends IQuickPickItem {
			id: string;
		}

		const items: ISettingsQuickPickItem[] = [
			{
				id: 'connection',
				label: `${connectionIcon} Connection`,
				description: status.connectionStatus === 'connected'
					? `Connected (v${status.version || 'unknown'})`
					: status.connectionStatus,
				detail: status.lastConnected
					? `Last connected: ${new Date(status.lastConnected).toLocaleString()}`
					: undefined
			},
			{
				id: 'model',
				label: `$(symbol-method) Model`,
				description: status.model
			},
			{
				id: 'execution',
				label: `${execIcon} Execution Method`,
				description: status.executionMethod === 'script'
					? `Script: ${status.scriptPath}`
					: 'CLI (default)'
			},
			{
				id: 'thinking',
				label: `${thinkingIcon} Extended Thinking`,
				description: status.extendedThinking ? 'ON' : 'OFF'
			},
			{
				id: 'separator',
				label: '',
				kind: 1 // separator
			} as ISettingsQuickPickItem,
			{
				id: 'changeModel',
				label: '$(symbol-method) Change Model',
				detail: `Current: ${status.model}`
			},
			{
				id: 'testConnection',
				label: '$(sync) Test Connection',
				detail: 'Check if Claude CLI is available'
			},
			{
				id: 'toggleThinking',
				label: '$(lightbulb) Toggle Extended Thinking',
				detail: `Currently ${status.extendedThinking ? 'ON' : 'OFF'}`
			},
			{
				id: 'configureScript',
				label: '$(file-code) Configure Script',
				detail: 'Set custom execution script'
			},
			{
				id: 'openJson',
				label: '$(json) Open claude.local.json',
				detail: 'Edit local settings directly'
			}
		];

		const selected = await this.quickInputService.pick(items, {
			placeHolder: localize('claudeSettings', "Claude Settings"),
			canPickMany: false
		});

		if (!selected) {
			return;
		}

		const selectedItem = selected as ISettingsQuickPickItem;

		switch (selectedItem.id) {
			case 'changeModel':
				await this.showModelPicker();
				break;

			case 'testConnection':
				this.notificationService.info(localize('testingConnection', "Testing connection..."));
				const connected = await this.claudeService.checkConnection?.();
				if (connected) {
					this.notificationService.info(localize('connectionSuccess', "Connection successful!"));
				} else {
					this.notificationService.error(localize('connectionFailed', "Connection failed. Make sure Claude CLI is installed."));
				}
				break;

			case 'toggleThinking':
				await this.claudeService.toggleExtendedThinking?.();
				const newStatus = this.claudeService.getStatusInfo?.();
				this.notificationService.info(
					localize('thinkingToggled', "Extended Thinking: {0}", newStatus?.extendedThinking ? 'ON' : 'OFF')
				);
				break;

			case 'configureScript':
			case 'openJson':
				await this.openLocalSettings();
				break;
		}
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

	private async showModelPicker(): Promise<void> {
		const currentModel = this.configurationService.getValue<string>('claude.model') || 'claude-sonnet-4-20250514';

		interface IModelQuickPickItem extends IQuickPickItem {
			modelId: string;
		}

		const models: IModelQuickPickItem[] = [
			{
				modelId: 'claude-opus-4-20250514',
				label: '$(star) Claude Opus 4',
				description: 'Most capable model',
				detail: 'Best for complex tasks, coding, and analysis'
			},
			{
				modelId: 'claude-sonnet-4-20250514',
				label: 'Claude Sonnet 4',
				description: 'Balanced performance',
				detail: 'Good balance of speed and capability'
			},
			{
				modelId: 'claude-3-5-sonnet-20241022',
				label: 'Claude 3.5 Sonnet',
				description: 'Previous generation',
				detail: 'Fast and capable'
			},
			{
				modelId: 'claude-3-5-haiku-20241022',
				label: 'Claude 3.5 Haiku',
				description: 'Fastest model',
				detail: 'Best for simple tasks and quick responses'
			}
		];

		// 현재 모델 표시
		for (const model of models) {
			if (model.modelId === currentModel) {
				model.label = `$(check) ${model.label}`;
				model.description = `${model.description} (current)`;
			}
		}

		const selected = await this.quickInputService.pick(models, {
			placeHolder: localize('selectModel', "Select Claude Model")
		});

		if (selected && (selected as IModelQuickPickItem).modelId !== currentModel) {
			const newModel = (selected as IModelQuickPickItem).modelId;
			await this.configurationService.updateValue('claude.model', newModel);
			this.notificationService.info(localize('modelChanged', "Model changed to {0}", newModel));

			// 상태 바 업데이트
			if (this.claudeService.onDidChangeStatusInfo) {
				const status = this.claudeService.getStatusInfo?.();
				if (status) {
					this.updateStatusBar({ ...status, model: newModel });
				}
			}
		}
	}
}
