/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, append, clearNode } from '../../../../../base/browser/dom.js';
import { renderMarkdown, MarkdownRenderOptions } from '../../../../../base/browser/markdownRenderer.js';
import { Codicon } from '../../../../../base/common/codicons.js';
import { Disposable, DisposableStore } from '../../../../../base/common/lifecycle.js';
import { IMarkdownString, MarkdownString } from '../../../../../base/common/htmlContent.js';
import { ThemeIcon } from '../../../../../base/common/themables.js';
import { IClipboardService } from '../../../../../platform/clipboard/common/clipboardService.js';
import { INotificationService } from '../../../../../platform/notification/common/notification.js';
import { localize } from '../../../../../nls.js';
import { IClaudeMessage, IClaudeToolAction, IClaudeAskUserRequest, IClaudeUsageInfo, IClaudeFileChange, IClaudeFileChangesSummary } from '../../common/claudeTypes.js';
import { IEditorService } from '../../../../services/editor/common/editorService.js';
import { ITextModel } from '../../../../../editor/common/model.js';
import { ICodeEditor } from '../../../../../editor/browser/editorBrowser.js';

export interface IClaudeMessageRendererOptions {
	readonly onApplyCode?: (code: string, language: string) => void;
	readonly onRespondToAskUser?: (responses: string[]) => void;
	readonly onShowFileDiff?: (fileChange: IClaudeFileChange) => void;
	readonly onRevertFile?: (fileChange: IClaudeFileChange) => Promise<boolean>;
	readonly onRevertAllFiles?: () => Promise<number>;
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

		// 메시지 복사 버튼 (hover 시 표시)
		const copyMessageButton = append(headerElement, $('button.claude-message-copy'));
		copyMessageButton.title = localize('copyMessage', "Copy message");
		const copyIcon = append(copyMessageButton, $('.codicon.codicon-copy'));

		const copyMessageHandler = async () => {
			try {
				await this.clipboardService.writeText(message.content);
				copyIcon.classList.remove('codicon-copy');
				copyIcon.classList.add('codicon-check');
				setTimeout(() => {
					copyIcon.classList.remove('codicon-check');
					copyIcon.classList.add('codicon-copy');
				}, 2000);
			} catch {
				this.notificationService.error(localize('copyMessageFailed', "Failed to copy message"));
			}
		};
		copyMessageButton.addEventListener('click', copyMessageHandler);
		disposables.add({ dispose: () => copyMessageButton.removeEventListener('click', copyMessageHandler) });

		// 현재 도구 액션 표시 (스트리밍 중)
		if (message.currentToolAction || (message.isStreaming && message.toolActions && message.toolActions.length > 0)) {
			this.renderCurrentToolAction(message, messageElement);
		}

		// 컨텐츠
		const contentElement = append(messageElement, $('.claude-message-content'));

		if (message.role === 'assistant' && !message.isError) {
			// Markdown 렌더링
			if (message.content) {
				this.renderMarkdownContent(message.content, contentElement, disposables);
			} else if (message.isStreaming) {
				// 스트리밍 중이고 컨텐츠가 없으면 대기 중 표시
				const waitingElement = append(contentElement, $('.claude-message-waiting'));
				waitingElement.textContent = localize('waitingForResponse', "Waiting for response...");
			}
		} else {
			// 일반 텍스트
			contentElement.textContent = message.content;
		}

		// 완료된 도구 액션 목록 표시
		if (message.toolActions && message.toolActions.length > 0 && !message.isStreaming) {
			this.renderToolActionsSummary(message.toolActions, messageElement);
		}

		// AskUser 질문 표시
		if (message.isWaitingForUser && message.askUserRequest) {
			this.renderAskUserRequest(message.askUserRequest, messageElement, disposables);
		}

		// 컨텍스트 표시 (사용자 메시지에 첨부된 경우)
		if (message.context && message.role === 'user') {
			this.renderContext(message, messageElement);
		}

		// 토큰 사용량 표시 (assistant 메시지, 스트리밍 완료 후)
		if (message.role === 'assistant' && !message.isStreaming && message.usage) {
			this.renderUsageInfo(message.usage, messageElement);
		}

		// 파일 변경사항 표시 (assistant 메시지, 스트리밍 완료 후)
		if (message.role === 'assistant' && !message.isStreaming && message.fileChanges && message.fileChanges.changes.length > 0) {
			this.renderFileChanges(message.fileChanges, messageElement, disposables);
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

	private renderCurrentToolAction(message: IClaudeMessage, container: HTMLElement): void {
		const toolAction = message.currentToolAction;
		const toolActionsContainer = append(container, $('.claude-tool-status'));

		if (toolAction) {
			// 현재 실행 중인 도구 표시
			const statusElement = append(toolActionsContainer, $('.claude-tool-status-item.running'));

			// 스피너
			const spinner = append(statusElement, $('.claude-tool-spinner'));
			spinner.classList.add('codicon', 'codicon-loading', 'codicon-modifier-spin');

			// 도구 이름과 설명
			const toolInfo = append(statusElement, $('.claude-tool-info'));
			const toolName = append(toolInfo, $('.claude-tool-name'));
			toolName.textContent = this.getToolDisplayName(toolAction.tool);

			// 입력 파라미터 표시 (간략하게)
			if (toolAction.input) {
				const toolInput = append(toolInfo, $('.claude-tool-input'));
				toolInput.textContent = this.formatToolInput(toolAction.tool, toolAction.input);
			}
		} else if (message.toolActions && message.toolActions.length > 0) {
			// 도구 액션이 있지만 현재 실행 중인 것이 없을 때 (마지막 도구 완료됨)
			const lastAction = message.toolActions[message.toolActions.length - 1];
			if (lastAction.status === 'completed') {
				const statusElement = append(toolActionsContainer, $('.claude-tool-status-item.completed'));
				const checkIcon = append(statusElement, $('.codicon.codicon-check'));
				checkIcon.classList.add('claude-tool-check');

				const toolInfo = append(statusElement, $('.claude-tool-info'));
				const toolName = append(toolInfo, $('.claude-tool-name'));
				toolName.textContent = `${this.getToolDisplayName(lastAction.tool)} completed`;
			}
		}
	}

	private renderToolActionsSummary(toolActions: IClaudeToolAction[], container: HTMLElement): void {
		if (toolActions.length === 0) {
			return;
		}

		const summaryContainer = append(container, $('.claude-tool-summary'));

		// 접이식 헤더
		const header = append(summaryContainer, $('.claude-tool-summary-header'));
		const toggleIcon = append(header, $('.codicon.codicon-chevron-right'));
		const headerText = append(header, $('span'));
		headerText.textContent = localize('toolActionsUsed', "{0} tool action(s) used", toolActions.length);

		// 도구 목록 (기본 숨김)
		const list = append(summaryContainer, $('.claude-tool-summary-list'));
		list.style.display = 'none';

		for (const action of toolActions) {
			const item = append(list, $('.claude-tool-summary-item'));

			// 상태 아이콘
			const statusIcon = append(item, $('.claude-tool-status-icon'));
			if (action.status === 'completed') {
				statusIcon.classList.add('codicon', 'codicon-check');
			} else if (action.status === 'error') {
				statusIcon.classList.add('codicon', 'codicon-error');
			} else {
				statusIcon.classList.add('codicon', 'codicon-circle-outline');
			}

			// 도구 이름
			const name = append(item, $('.claude-tool-summary-name'));
			name.textContent = this.getToolDisplayName(action.tool);

			// 간략한 설명
			if (action.input) {
				const desc = append(item, $('.claude-tool-summary-desc'));
				desc.textContent = this.formatToolInput(action.tool, action.input);
			}
		}

		// 토글 기능
		header.addEventListener('click', () => {
			const isHidden = list.style.display === 'none';
			list.style.display = isHidden ? 'block' : 'none';
			toggleIcon.classList.toggle('codicon-chevron-right', !isHidden);
			toggleIcon.classList.toggle('codicon-chevron-down', isHidden);
		});
	}

	private renderAskUserRequest(askUserRequest: IClaudeAskUserRequest, container: HTMLElement, disposables: DisposableStore): void {
		const askUserContainer = append(container, $('.claude-ask-user'));

		// 자동 승인된 경우
		if (askUserRequest.autoAccepted && askUserRequest.autoAcceptedOption) {
			askUserContainer.classList.add('auto-accepted');
			const autoAcceptedElement = append(askUserContainer, $('.claude-ask-user-auto-accepted'));

			const icon = append(autoAcceptedElement, $('.codicon.codicon-check'));
			icon.classList.add('claude-auto-accept-icon');

			const text = append(autoAcceptedElement, $('span'));
			text.textContent = localize('autoAccepted', "[Auto] Selected: \"{0}\"", askUserRequest.autoAcceptedOption);

			const hint = append(askUserContainer, $('.claude-ask-user-auto-hint'));
			hint.textContent = localize('autoAcceptHint', "(Auto-accept enabled)");
			return;
		}

		for (const question of askUserRequest.questions) {
			const questionContainer = append(askUserContainer, $('.claude-ask-user-question'));

			// 헤더 (있으면)
			if (question.header) {
				const header = append(questionContainer, $('.claude-ask-user-header'));
				header.textContent = question.header;
			}

			// 질문 텍스트
			const questionText = append(questionContainer, $('.claude-ask-user-text'));
			questionText.textContent = question.question;

			// 옵션 버튼들
			const optionsContainer = append(questionContainer, $('.claude-ask-user-options'));

			for (const option of question.options) {
				const button = append(optionsContainer, $('button.claude-ask-user-option'));

				const label = append(button, $('.claude-ask-user-option-label'));
				label.textContent = option.label;

				if (option.description) {
					const desc = append(button, $('.claude-ask-user-option-desc'));
					desc.textContent = option.description;
				}

				const clickHandler = () => {
					if (this.options.onRespondToAskUser) {
						this.options.onRespondToAskUser([option.label]);
					}
				};
				button.addEventListener('click', clickHandler);
				disposables.add({ dispose: () => button.removeEventListener('click', clickHandler) });
			}

			// "Other" 옵션 (직접 입력 - Enter 키로 제출)
			const otherContainer = append(questionContainer, $('.claude-ask-user-other'));
			const otherInput = append(otherContainer, $('input.claude-ask-user-other-input')) as HTMLInputElement;
			otherInput.type = 'text';
			otherInput.placeholder = localize('otherOption', "Other (type your response and press Enter)...");

			const submitOther = () => {
				const value = otherInput.value.trim();
				if (value && this.options.onRespondToAskUser) {
					this.options.onRespondToAskUser([value]);
				}
			};

			const keydownHandler = (e: KeyboardEvent) => {
				if (e.key === 'Enter') {
					submitOther();
				}
			};
			otherInput.addEventListener('keydown', keydownHandler);

			disposables.add({ dispose: () => {
				otherInput.removeEventListener('keydown', keydownHandler);
			}});
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
			default:
				return '';
		}
	}

	private renderUsageInfo(usage: IClaudeUsageInfo, container: HTMLElement): void {
		const usageElement = append(container, $('.claude-message-usage'));

		// 토큰 정보
		const tokensElement = append(usageElement, $('.claude-usage-tokens'));

		// 입력 토큰
		const inputTokens = append(tokensElement, $('.claude-usage-item'));
		inputTokens.title = localize('inputTokens', "Input tokens");
		append(inputTokens, $('.codicon.codicon-arrow-right'));
		const inputValue = append(inputTokens, $('span'));
		inputValue.textContent = this.formatNumber(usage.inputTokens);

		// 출력 토큰
		const outputTokens = append(tokensElement, $('.claude-usage-item'));
		outputTokens.title = localize('outputTokens', "Output tokens");
		append(outputTokens, $('.codicon.codicon-arrow-left'));
		const outputValue = append(outputTokens, $('span'));
		outputValue.textContent = this.formatNumber(usage.outputTokens);

		// 캐시 토큰 (있으면)
		if (usage.cacheReadTokens && usage.cacheReadTokens > 0) {
			const cacheTokens = append(tokensElement, $('.claude-usage-item.cache'));
			cacheTokens.title = localize('cacheTokens', "Cache read tokens");
			append(cacheTokens, $('.codicon.codicon-database'));
			const cacheValue = append(cacheTokens, $('span'));
			cacheValue.textContent = this.formatNumber(usage.cacheReadTokens);
		}

		// 비용 (있으면)
		if (usage.totalCostUsd !== undefined && usage.totalCostUsd > 0) {
			const costElement = append(usageElement, $('.claude-usage-cost'));
			costElement.title = localize('totalCost', "Estimated cost");
			costElement.textContent = `$${usage.totalCostUsd.toFixed(4)}`;
		}
	}

	private formatNumber(num: number): string {
		if (num >= 1000000) {
			return (num / 1000000).toFixed(1) + 'M';
		} else if (num >= 1000) {
			return (num / 1000).toFixed(1) + 'K';
		}
		return num.toString();
	}

	private renderFileChanges(fileChanges: IClaudeFileChangesSummary, container: HTMLElement, disposables: DisposableStore): void {
		const changesContainer = append(container, $('.claude-file-changes'));

		// 헤더
		const header = append(changesContainer, $('.claude-file-changes-header'));

		// 토글 아이콘
		const toggleIcon = append(header, $('.codicon.codicon-chevron-down'));

		// 요약 정보
		const summary = append(header, $('.claude-file-changes-summary'));
		const summaryParts: string[] = [];

		if (fileChanges.filesCreated > 0) {
			summaryParts.push(localize('filesCreated', "{0} created", fileChanges.filesCreated));
		}
		if (fileChanges.filesModified > 0) {
			summaryParts.push(localize('filesModified', "{0} modified", fileChanges.filesModified));
		}
		if (fileChanges.filesDeleted > 0) {
			summaryParts.push(localize('filesDeleted', "{0} deleted", fileChanges.filesDeleted));
		}

		append(summary, $('.codicon.codicon-files'));
		const summaryText = append(summary, $('span'));
		summaryText.textContent = summaryParts.join(', ');

		// 라인 변경 요약
		const lineStats = append(summary, $('.claude-file-changes-lines'));
		if (fileChanges.totalLinesAdded > 0) {
			const addedSpan = append(lineStats, $('span.added'));
			addedSpan.textContent = `+${fileChanges.totalLinesAdded}`;
		}
		if (fileChanges.totalLinesRemoved > 0) {
			const removedSpan = append(lineStats, $('span.removed'));
			removedSpan.textContent = `-${fileChanges.totalLinesRemoved}`;
		}

		// Revert All 버튼
		if (this.options.onRevertAllFiles && fileChanges.changes.length > 1) {
			const revertAllButton = append(header, $('button.claude-file-changes-revert-all'));
			revertAllButton.title = localize('revertAll', "Revert all changes");
			append(revertAllButton, $('.codicon.codicon-discard'));
			const revertAllText = append(revertAllButton, $('span'));
			revertAllText.textContent = localize('revertAllLabel', "Revert All");

			const revertAllHandler = async (e: MouseEvent) => {
				e.stopPropagation();
				if (this.options.onRevertAllFiles) {
					const count = await this.options.onRevertAllFiles();
					if (count > 0) {
						this.notificationService.info(localize('revertedFiles', "Reverted {0} file(s)", count));
						// UI에서 제거
						changesContainer.remove();
					}
				}
			};
			revertAllButton.addEventListener('click', revertAllHandler);
			disposables.add({ dispose: () => revertAllButton.removeEventListener('click', revertAllHandler) });
		}

		// 파일 목록
		const fileList = append(changesContainer, $('.claude-file-changes-list'));

		for (const change of fileChanges.changes) {
			const fileItem = append(fileList, $('.claude-file-changes-item'));

			// 상태 아이콘
			const statusIcon = append(fileItem, $('.claude-file-status-icon'));
			switch (change.changeType) {
				case 'created':
					statusIcon.classList.add('codicon', 'codicon-diff-added', 'created');
					break;
				case 'modified':
					statusIcon.classList.add('codicon', 'codicon-diff-modified', 'modified');
					break;
				case 'deleted':
					statusIcon.classList.add('codicon', 'codicon-diff-removed', 'deleted');
					break;
			}

			// 파일명
			const fileName = append(fileItem, $('.claude-file-name'));
			fileName.textContent = change.fileName;
			fileName.title = change.filePath;

			// 라인 변경
			const lineChanges = append(fileItem, $('.claude-file-line-changes'));
			if (change.linesAdded > 0) {
				const addedSpan = append(lineChanges, $('span.added'));
				addedSpan.textContent = `+${change.linesAdded}`;
			}
			if (change.linesRemoved > 0) {
				const removedSpan = append(lineChanges, $('span.removed'));
				removedSpan.textContent = `-${change.linesRemoved}`;
			}

			// 버튼 그룹
			const buttons = append(fileItem, $('.claude-file-buttons'));

			// Diff 버튼
			if (this.options.onShowFileDiff) {
				const diffButton = append(buttons, $('button.claude-file-button'));
				diffButton.title = localize('showDiff', "Show diff");
				append(diffButton, $('.codicon.codicon-diff'));

				const diffHandler = (e: MouseEvent) => {
					e.stopPropagation();
					this.options.onShowFileDiff?.(change);
				};
				diffButton.addEventListener('click', diffHandler);
				disposables.add({ dispose: () => diffButton.removeEventListener('click', diffHandler) });
			}

			// Revert 버튼
			if (this.options.onRevertFile && !change.reverted) {
				const revertButton = append(buttons, $('button.claude-file-button.revert')) as HTMLButtonElement;
				revertButton.title = localize('revertFile', "Revert changes");
				append(revertButton, $('.codicon.codicon-discard'));

				const revertHandler = async (e: MouseEvent) => {
					e.stopPropagation();
					if (this.options.onRevertFile) {
						const success = await this.options.onRevertFile(change);
						if (success) {
							fileItem.classList.add('reverted');
							revertButton.disabled = true;
							this.notificationService.info(localize('fileReverted', "Reverted: {0}", change.fileName));
						}
					}
				};
				revertButton.addEventListener('click', revertHandler);
				disposables.add({ dispose: () => revertButton.removeEventListener('click', revertHandler) });
			}

			// 파일 클릭 시 Diff 표시
			if (this.options.onShowFileDiff) {
				const itemClickHandler = () => {
					this.options.onShowFileDiff?.(change);
				};
				fileItem.addEventListener('click', itemClickHandler);
				disposables.add({ dispose: () => fileItem.removeEventListener('click', itemClickHandler) });
			}
		}

		// 토글 기능
		let isCollapsed = false;
		const headerClickHandler = () => {
			isCollapsed = !isCollapsed;
			fileList.style.display = isCollapsed ? 'none' : 'block';
			toggleIcon.classList.toggle('codicon-chevron-down', !isCollapsed);
			toggleIcon.classList.toggle('codicon-chevron-right', isCollapsed);
		};
		header.addEventListener('click', headerClickHandler);
		disposables.add({ dispose: () => header.removeEventListener('click', headerClickHandler) });
	}
}
