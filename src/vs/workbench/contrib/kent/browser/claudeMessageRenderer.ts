/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, append, clearNode } from '../../../../base/browser/dom.js';
import { renderMarkdown, MarkdownRenderOptions } from '../../../../base/browser/markdownRenderer.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { Disposable, DisposableStore } from '../../../../base/common/lifecycle.js';
import { IMarkdownString, MarkdownString } from '../../../../base/common/htmlContent.js';
import { ThemeIcon } from '../../../../base/common/themables.js';
import { IClipboardService } from '../../../../platform/clipboard/common/clipboardService.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { localize } from '../../../../nls.js';
import { IClaudeMessage } from '../common/claudeTypes.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { ITextModel } from '../../../../editor/common/model.js';
import { ICodeEditor } from '../../../../editor/browser/editorBrowser.js';

export interface IClaudeMessageRendererOptions {
	readonly onApplyCode?: (code: string, language: string) => void;
}

export class ClaudeMessageRenderer extends Disposable {

	constructor(
		private readonly options: IClaudeMessageRendererOptions,
		@IClipboardService private readonly clipboardService: IClipboardService,
		@INotificationService private readonly notificationService: INotificationService,
		@IEditorService private readonly editorService: IEditorService
	) {
		super();
	}

	renderMessage(message: IClaudeMessage, container: HTMLElement): DisposableStore {
		const disposables = new DisposableStore();

		clearNode(container);

		const messageElement = append(container, $('.claude-message'));
		messageElement.classList.add(`claude-message-${message.role}`);

		if (message.isError) {
			messageElement.classList.add('claude-message-error');
		}

		// 역할 헤더
		const headerElement = append(messageElement, $('.claude-message-header'));
		const iconElement = append(headerElement, $('.claude-message-icon'));

		if (message.role === 'user') {
			iconElement.classList.add(...ThemeIcon.asClassNameArray(Codicon.account));
		} else {
			iconElement.classList.add(...ThemeIcon.asClassNameArray(Codicon.sparkle));
		}

		const roleElement = append(headerElement, $('.claude-message-role'));
		roleElement.textContent = message.role === 'user' ? 'You' : 'Claude';

		// 타임스탬프
		const timeElement = append(headerElement, $('.claude-message-time'));
		timeElement.textContent = this.formatTime(message.timestamp);

		// 컨텐츠
		const contentElement = append(messageElement, $('.claude-message-content'));

		if (message.role === 'assistant' && !message.isError) {
			// Markdown 렌더링
			this.renderMarkdownContent(message.content, contentElement, disposables);
		} else {
			// 일반 텍스트
			contentElement.textContent = message.content;
		}

		// 컨텍스트 표시 (사용자 메시지에 첨부된 경우)
		if (message.context && message.role === 'user') {
			this.renderContext(message, messageElement);
		}

		return disposables;
	}

	private renderMarkdownContent(content: string, container: HTMLElement, disposables: DisposableStore): void {
		const markdown: IMarkdownString = new MarkdownString(content, {
			isTrusted: false,
			supportThemeIcons: true
		});

		const renderOptions: MarkdownRenderOptions = {
			codeBlockRendererSync: (languageId, value) => {
				return this.renderCodeBlock(languageId, value, disposables);
			}
		};

		const result = renderMarkdown(markdown, renderOptions);
		disposables.add(result);
		append(container, result.element);
	}

	private renderCodeBlock(languageId: string, code: string, disposables: DisposableStore): HTMLElement {
		const wrapper = $('.claude-code-block');

		// 코드 블록 헤더
		const header = append(wrapper, $('.claude-code-block-header'));

		// 언어 표시
		const languageLabel = append(header, $('.claude-code-block-language'));
		languageLabel.textContent = languageId || 'plaintext';

		// 버튼 그룹
		const buttons = append(header, $('.claude-code-block-buttons'));

		// Copy 버튼
		const copyButton = append(buttons, $('button.claude-code-block-button'));
		copyButton.title = localize('copyCode', "Copy code");
		const copyIcon = append(copyButton, $('.codicon.codicon-copy'));

		const copyHandler = async () => {
			try {
				await this.clipboardService.writeText(code);
				// 복사 성공 피드백
				copyIcon.classList.remove('codicon-copy');
				copyIcon.classList.add('codicon-check');
				setTimeout(() => {
					copyIcon.classList.remove('codicon-check');
					copyIcon.classList.add('codicon-copy');
				}, 2000);
			} catch {
				this.notificationService.error(localize('copyFailed', "Failed to copy code"));
			}
		};
		copyButton.addEventListener('click', copyHandler);
		disposables.add({ dispose: () => copyButton.removeEventListener('click', copyHandler) });

		// Insert 버튼
		const insertButton = append(buttons, $('button.claude-code-block-button'));
		insertButton.title = localize('insertCode', "Insert at cursor");
		append(insertButton, $('.codicon.codicon-insert'));

		const insertHandler = () => {
			this.insertCodeAtCursor(code);
		};
		insertButton.addEventListener('click', insertHandler);
		disposables.add({ dispose: () => insertButton.removeEventListener('click', insertHandler) });

		// Apply 버튼 (콜백이 있는 경우)
		if (this.options.onApplyCode) {
			const applyButton = append(buttons, $('button.claude-code-block-button.claude-code-block-apply'));
			applyButton.title = localize('applyCode', "Apply to file");
			append(applyButton, $('.codicon.codicon-git-pull-request'));
			const applyText = append(applyButton, $('span'));
			applyText.textContent = 'Apply';

			const applyHandler = () => {
				this.options.onApplyCode?.(code, languageId);
			};
			applyButton.addEventListener('click', applyHandler);
			disposables.add({ dispose: () => applyButton.removeEventListener('click', applyHandler) });
		}

		// 코드 내용
		const codeContainer = append(wrapper, $('.claude-code-block-content'));
		const pre = append(codeContainer, $('pre'));
		const codeElement = append(pre, $('code'));

		// 언어 클래스 추가
		if (languageId) {
			codeElement.classList.add(`language-${languageId}`);
		}

		codeElement.textContent = code;

		return wrapper;
	}

	private insertCodeAtCursor(code: string): void {
		const editor = this.editorService.activeTextEditorControl;
		if (!editor || !('getModel' in editor)) {
			this.notificationService.info(localize('noActiveEditor', "No active editor"));
			return;
		}

		const codeEditor = editor as ICodeEditor;
		const model = codeEditor.getModel() as ITextModel;
		const selection = codeEditor.getSelection();

		if (!model || !selection) {
			return;
		}

		// 커서 위치에 코드 삽입
		codeEditor.executeEdits('claude', [{
			range: selection,
			text: code,
			forceMoveMarkers: true
		}]);

		// 에디터에 포커스
		codeEditor.focus();

		this.notificationService.info(localize('codeInserted', "Code inserted"));
	}

	private renderContext(message: IClaudeMessage, container: HTMLElement): void {
		const context = message.context;
		if (!context) {
			return;
		}

		const contextElement = append(container, $('.claude-message-context'));

		if (context.filePath) {
			const fileTag = append(contextElement, $('.claude-context-tag'));
			append(fileTag, $('.codicon.codicon-file'));
			const fileName = append(fileTag, $('span'));
			fileName.textContent = context.filePath.fsPath.split(/[/\\]/).pop() || 'file';
		}

		if (context.selection) {
			const selectionTag = append(contextElement, $('.claude-context-tag'));
			append(selectionTag, $('.codicon.codicon-selection'));
			const selectionText = append(selectionTag, $('span'));
			const lines = context.selection.split('\n').length;
			selectionText.textContent = `${lines} line${lines > 1 ? 's' : ''} selected`;
		}
	}

	private formatTime(timestamp: number): string {
		const date = new Date(timestamp);
		return date.toLocaleTimeString(undefined, {
			hour: '2-digit',
			minute: '2-digit'
		});
	}
}
