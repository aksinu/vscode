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
import { IClaudeMessage, IClaudeAttachment, IClaudeQueuedMessage } from '../common/claudeTypes.js';
import { CONTEXT_CLAUDE_INPUT_FOCUSED, CONTEXT_CLAUDE_PANEL_FOCUSED, CONTEXT_CLAUDE_REQUEST_IN_PROGRESS } from '../common/claudeContextKeys.js';
import { URI } from '../../../../base/common/uri.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { ClaudeMessageRenderer } from './claudeMessageRenderer.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { basename } from '../../../../base/common/resources.js';
import { generateUuid } from '../../../../base/common/uuid.js';

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
		@IFileService private readonly fileService: IFileService
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

		// 입력 wrapper
		const inputWrapper = append(this.inputContainer, $('.claude-input-wrapper'));

		// 툴바 (왼쪽)
		const toolbar = append(inputWrapper, $('.claude-input-toolbar'));

		// 첨부 버튼
		const attachButton = append(toolbar, $('button.claude-toolbar-button'));
		attachButton.title = localize('attachContext', "Attach context (drag & drop files or click)");
		append(attachButton, $('.codicon.codicon-attach'));

		// 첨부 버튼 클릭 - 현재 에디터 파일 첨부
		this._register(addDisposableListener(attachButton, EventType.CLICK, () => {
			this.attachCurrentEditorFile();
		}));

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
		this._register(this.inputEditor.onDidChangeModelContent(updatePlaceholder));
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

		// Enter 키 처리 (Shift+Enter는 줄바꿈)
		this._register(this.inputEditor.onKeyDown(e => {
			if (e.keyCode === 3 /* Enter */ && !e.shiftKey && !e.ctrlKey && !e.altKey) {
				e.preventDefault();
				e.stopPropagation();
				this.submitInput();
			}
		}));

		// 전송 버튼
		const sendButton = append(inputWrapper, $('button.claude-send-button'));
		sendButton.title = localize('sendMessage', "Send message");
		append(sendButton, $('.codicon.codicon-send'));

		this._register({
			dispose: () => sendButton.removeEventListener('click', () => this.submitInput())
		});
		sendButton.addEventListener('click', () => this.submitInput());
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

		const line1 = append(divider, $('.claude-session-divider-line'));
		const text = append(divider, $('.claude-session-divider-text'));
		text.textContent = localize('previousSession', "Previous Session");
		const line2 = append(divider, $('.claude-session-divider-line'));

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

	private applyCode(code: string, language: string): void {
		const editor = this.editorService.activeTextEditorControl;
		if (!editor || !('getModel' in editor)) {
			this.notificationService.info(localize('noActiveEditor', "No active editor to apply code"));
			return;
		}

		// TODO: Diff 뷰로 변경사항 표시 후 Apply/Reject 선택
		// 현재는 단순 삽입
		const codeEditor = editor as ICodeEditor;
		const selection = codeEditor.getSelection();

		if (selection) {
			codeEditor.executeEdits('claude-apply', [{
				range: selection,
				text: code,
				forceMoveMarkers: true
			}]);
			codeEditor.focus();
			this.notificationService.info(localize('codeApplied', "Code applied to editor"));
		}
	}

	private scrollToBottom(): void {
		requestAnimationFrame(() => {
			this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;
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

		if (this.attachments.length === 0) {
			this.attachmentsContainer.style.display = 'none';
			return;
		}

		this.attachmentsContainer.style.display = 'flex';

		for (const attachment of this.attachments) {
			const tag = append(this.attachmentsContainer, $('.claude-attachment-tag'));

			// 아이콘
			const icon = append(tag, $('.claude-attachment-icon'));
			const iconClass = attachment.type === 'folder' ? Codicon.folder : Codicon.file;
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

	protected override layoutBody(height: number, width: number): void {
		super.layoutBody(height, width);

		const inputHeight = Math.min(150, Math.max(80, height * 0.2)); // 동적 입력 높이
		const messagesHeight = height - inputHeight;

		this.welcomeContainer.style.height = `${messagesHeight}px`;
		this.messagesContainer.style.height = `${messagesHeight}px`;
		this.inputContainer.style.height = `${inputHeight}px`;

		this.inputEditor?.layout({ width: width - 100, height: inputHeight - 24 });
	}

	override dispose(): void {
		this.clearMessages();
		super.dispose();
	}
}
