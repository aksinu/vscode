/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, append, clearNode } from '../../../../../../../base/browser/dom.js';
import { renderMarkdown, MarkdownRenderOptions } from '../../../../../../../base/browser/markdownRenderer.js';
import { Codicon } from '../../../../../../../base/common/codicons.js';
import { DisposableStore } from '../../../../../../../base/common/lifecycle.js';
import { ThemeIcon } from '../../../../../../../base/common/themables.js';
import { IMarkdownString, MarkdownString } from '../../../../../../../base/common/htmlContent.js';
import { localize } from '../../../../../../../nls.js';
import {
	IAssistantMessage,
	IClaudeAskUserRequest,
	IClaudeUsageInfo,
	IClaudeFileChange,
	ChatSessionState
} from '../../../../common/types/claudeTypes.js';
import { ToolInfoRenderer } from './toolInfoRenderer.js';
import { FileChangesRenderer } from './fileChangesRenderer.js';
import { AskUserRenderer } from './askUserRenderer.js';

/**
 * AssistantMessageRenderer 옵션 인터페이스
 * 파일 변경사항 관련 콜백들을 포함
 */
export interface IAssistantMessageRendererOptions {
	readonly onApplyCode?: (code: string, language: string, filePath?: string) => void;
	readonly onRespondToAskUser?: (responses: string[], askRequest?: IClaudeAskUserRequest) => void;
	readonly onShowFileDiff?: (fileChange: IClaudeFileChange) => void;
	readonly onRevertFile?: (fileChange: IClaudeFileChange) => Promise<boolean>;
	readonly onAcceptFile?: (fileChange: IClaudeFileChange) => void;
	readonly onRevertAllFiles?: () => Promise<number>;
	readonly onAcceptAllFiles?: () => void;
	readonly onRevertSelectedFiles?: (fileChanges: IClaudeFileChange[]) => Promise<number>;
	readonly onAcceptSelectedFiles?: (fileChanges: IClaudeFileChange[]) => void;
}

/**
 * 클로드 말풍선 렌더러
 * 상태에 따라 동적으로 내용이 달라짐:
 * - 내용 시간, 진행시간, 사용툴, Ask, 토큰 사용량, 파일 변경사항 등
 * - 시스템메시지 (취소, 오류 등)
 */
export class AssistantMessageRenderer {

	private readonly _options: IAssistantMessageRendererOptions;
	private readonly _toolInfoRenderer: ToolInfoRenderer;
	private readonly _fileChangesRenderer: FileChangesRenderer;
	private readonly _askUserRenderer: AskUserRenderer;

	constructor(options?: IAssistantMessageRendererOptions) {
		this._options = options || {};
		this._toolInfoRenderer = new ToolInfoRenderer();
		this._fileChangesRenderer = new FileChangesRenderer({
			onShowFileDiff: this._options.onShowFileDiff,
			onRevertFile: this._options.onRevertFile,
			onAcceptFile: this._options.onAcceptFile,
			onRevertAllFiles: this._options.onRevertAllFiles,
			onAcceptAllFiles: this._options.onAcceptAllFiles,
		});
		this._askUserRenderer = new AskUserRenderer({
			onRespondToAskUser: this._options.onRespondToAskUser,
		});
	}

	/**
	 * 클로드 메시지 렌더링 (상태 기반 동적 렌더링)
	 */
	renderAssistantMessage(
		message: IAssistantMessage,
		container: HTMLElement,
		currentState: ChatSessionState,
		options?: { readOnly?: boolean }
	): DisposableStore {
		const disposables = new DisposableStore();
		const readOnly = options?.readOnly ?? false;

		// ★ AskUser DOM 보존: clearNode 전에 보존된 요소를 detach
		const reuseAskRequestId = message.askUserRequest?.id;
		const canReuseAskUser = this._askUserRenderer.prepareForReuse(reuseAskRequestId);

		clearNode(container);

		const messageElement = append(container, $('.claude-assistant-message'));

		if (message.isError) {
			messageElement.classList.add('error');
		}

		// 헤더: Claude | 시간 + 진행시간
		this.renderHeader(message, messageElement, currentState, disposables);

		// 메인 컨텐츠
		this.renderContent(message, messageElement, currentState, disposables);

		// 사용 툴 정보 (서브 렌더러에 위임)
		this._toolInfoRenderer.renderToolInfo(message, messageElement, currentState, disposables);

		// Ask 질문 (사용자 선택 대기 중일 때)
		if (message.askUserRequest) {
			if (canReuseAskUser) {
				this._askUserRenderer.reusePreserved(messageElement);
			} else {
				this._askUserRenderer.createNew(message.askUserRequest, messageElement, disposables);
			}
		} else {
			this._askUserRenderer.cleanup();
		}

		// Thinking 인디케이터
		if (message.isStreaming && !message.askUserRequest &&
			(!message.currentToolAction || message.currentToolAction.status !== 'running')) {
			this.renderThinkingIndicator(messageElement);
		}

		// 토큰 사용량 (완료 후)
		if (!message.isStreaming && message.usage) {
			this.renderUsageInfo(message, messageElement);
		}

		// 파일 변경사항 (서브 렌더러에 위임)
		if (!message.isStreaming && message.fileChanges && message.fileChanges.changes.length > 0) {
			this._fileChangesRenderer.renderFileChanges(message.fileChanges, messageElement, disposables, readOnly);
		}

		// 시스템메시지 (취소, 오류 등)
		if (message.systemMessage || message.isCanceled) {
			this.renderSystemMessage(message, messageElement);
		}

		// 우하단 시간 정보
		this.renderFooterTime(message, messageElement, disposables);

		return disposables;
	}

	// ==================== 헤더 / 컨텐츠 / 시스템메시지 ====================

	private renderHeader(
		message: IAssistantMessage,
		container: HTMLElement,
		currentState: ChatSessionState,
		disposables: DisposableStore
	): void {
		const header = append(container, $('.claude-assistant-header'));

		const iconElement = append(header, $('.claude-assistant-icon'));
		iconElement.classList.add(...ThemeIcon.asClassNameArray(Codicon.sparkle));

		const roleElement = append(header, $('.claude-assistant-role'));
		roleElement.textContent = 'Claude';

		if (message.isStreaming && currentState !== 'idle') {
			const stateElement = append(header, $('.claude-assistant-state'));
			stateElement.textContent = this.getStateDisplayText(currentState, message);
		}

		const timeElement = append(header, $('.claude-assistant-time'));
		this.updateTimeDisplay(timeElement, message, disposables);
	}

	private renderContent(
		message: IAssistantMessage,
		container: HTMLElement,
		currentState: ChatSessionState,
		disposables: DisposableStore
	): void {
		const contentElement = append(container, $('.claude-assistant-content'));

		if (message.isError && message.content) {
			const errorElement = append(contentElement, $('.claude-error-message'));
			errorElement.textContent = message.content;
		} else if (message.isCanceled && message.content) {
			this.renderMarkdownContent(message.content, contentElement, disposables);
		} else if (message.content) {
			this.renderMarkdownContent(message.content, contentElement, disposables);
		} else if (message.isStreaming && (currentState === 'responding' || currentState === 'sending')) {
			const waitingElement = append(contentElement, $('.claude-waiting'));
			append(waitingElement, $('.codicon.codicon-loading.codicon-modifier-spin'));
			waitingElement.appendChild(document.createTextNode(' ' + localize('waitingForResponse', "Thinking...")));
		} else if (message.isStreaming && currentState === 'sending') {
			const sendingElement = append(contentElement, $('.claude-sending'));
			append(sendingElement, $('.codicon.codicon-loading.codicon-modifier-spin'));
			sendingElement.appendChild(document.createTextNode(' ' + localize('sendingRequest', "Sending request...")));
		} else if (message.toolActions && message.toolActions.length > 0) {
			const doneElement = append(contentElement, $('.claude-tool-only-message'));
			const toolCount = message.toolActions.length;
			doneElement.textContent = localize('toolOnlyCompleted', "Used {0} tool(s) to complete the task.", toolCount);
		} else if (message.fileChanges && message.fileChanges.changes.length > 0) {
			const doneElement = append(contentElement, $('.claude-tool-only-message'));
			doneElement.textContent = localize('fileChangesCompleted', "Completed file changes.");
		}
	}

	private renderSystemMessage(message: IAssistantMessage, container: HTMLElement): void {
		const systemContainer = append(container, $('.claude-assistant-system'));

		if (message.isCanceled) {
			append(systemContainer, $('.codicon.codicon-close.claude-system-icon'));
			append(systemContainer, $('span.claude-system-text')).textContent = localize('responseCanceled', "Response was canceled by user");
		} else if (message.systemMessage) {
			const iconClass = this.getSystemMessageIcon(message.systemMessage.type);
			append(systemContainer, $(`.codicon.${iconClass}.claude-system-icon`));
			append(systemContainer, $('span.claude-system-text')).textContent = message.systemMessage.message;
		}
	}

	private renderThinkingIndicator(container: HTMLElement): void {
		const thinkingEl = append(container, $('.claude-thinking-indicator'));
		append(thinkingEl, $('.codicon.codicon-loading.codicon-modifier-spin'));
		thinkingEl.appendChild(document.createTextNode(' ' + localize('thinkingIndicator', "Working...")));
	}

	// ==================== 사용량 / 시간 ====================

	private renderUsageInfo(message: IAssistantMessage, container: HTMLElement): void {
		const usageElement = append(container, $('.claude-assistant-usage'));
		if (message.usage) {
			this.renderTokenInfo(message.usage, usageElement);
		}
	}

	private renderTokenInfo(usage: IClaudeUsageInfo, container: HTMLElement): void {
		const tokensElement = append(container, $('.claude-usage-tokens'));

		// 입력 토큰
		const inputItem = append(tokensElement, $('.token-item'));
		const cacheTotal = (usage.cacheReadTokens || 0) + (usage.cacheCreationTokens || 0);
		if (cacheTotal > 0) {
			const cachePercent = Math.round((cacheTotal / usage.inputTokens) * 100);
			inputItem.title = localize('inputTokensWithCache',
				'Input tokens: {0} (cache {1}%: read {2}, create {3})',
				this.formatNumber(usage.inputTokens),
				cachePercent,
				this.formatNumber(usage.cacheReadTokens || 0),
				this.formatNumber(usage.cacheCreationTokens || 0));
		} else {
			inputItem.title = localize('inputTokens', 'Input tokens');
		}
		append(inputItem, $('.codicon.codicon-arrow-right'));
		append(inputItem, $('span')).textContent = this.formatNumber(usage.inputTokens);

		// 출력 토큰
		const outputItem = append(tokensElement, $('.token-item'));
		outputItem.title = localize('outputTokens', 'Output tokens');
		append(outputItem, $('.codicon.codicon-arrow-left'));
		append(outputItem, $('span')).textContent = this.formatNumber(usage.outputTokens);

		// 캐시 토큰
		if (usage.cacheReadTokens && usage.cacheReadTokens > 0) {
			const cacheElement = append(tokensElement, $('.token-item.cache'));
			cacheElement.title = localize('cacheReadTokens',
				'Cache read: {0} (included in input total)',
				this.formatNumber(usage.cacheReadTokens));
			append(cacheElement, $('.codicon.codicon-database'));
			append(cacheElement, $('span')).textContent = this.formatNumber(usage.cacheReadTokens);
		}

		// 서브에이전트
		if (usage.subagents && usage.subagents.length > 0) {
			for (const subagent of usage.subagents) {
				const subagentElement = append(tokensElement, $('.token-item.subagent'));
				const tooltip = subagent.description
					? `${subagent.type}: ${subagent.description}`
					: subagent.type;
				subagentElement.title = tooltip;
				append(subagentElement, $('.codicon.codicon-symbol-method'));
				append(subagentElement, $('span')).textContent = subagent.type;
				if (subagent.status === 'error') {
					subagentElement.classList.add('error');
				}
			}
		}
	}

	private renderFooterTime(message: IAssistantMessage, container: HTMLElement, disposables: DisposableStore): void {
		const footerElement = append(container, $('.claude-message-footer-time'));

		const timeSpan = append(footerElement, $('span.claude-footer-timestamp'));
		timeSpan.textContent = this.formatTime(message.timestamp);

		if (message.workStartTime) {
			const separator = append(footerElement, $('span.claude-footer-separator'));
			separator.textContent = '·';
			this.renderElapsedTimeInline(message, footerElement, disposables);
		}
	}

	private renderElapsedTimeInline(message: IAssistantMessage, container: HTMLElement, disposables: DisposableStore): void {
		const clockIcon = append(container, $('.codicon.codicon-clock'));
		clockIcon.style.fontSize = '11px';
		const timeSpan = append(container, $('span'));

		const updateElapsed = () => {
			timeSpan.textContent = this.calculateWorkDuration(message);
		};

		updateElapsed();

		if (message.isStreaming) {
			const updateInterval = setInterval(() => {
				if (!message.isStreaming) {
					clearInterval(updateInterval);
					updateElapsed();
					return;
				}
				updateElapsed();
			}, 1000);

			disposables.add({ dispose: () => clearInterval(updateInterval) });
		}
	}

	// ==================== Markdown / 코드 블록 ====================

	private renderMarkdownContent(content: string, container: HTMLElement, disposables: DisposableStore): void {
		const markdown: IMarkdownString = new MarkdownString(content, {
			isTrusted: false,
			supportThemeIcons: true
		});

		const renderOptions: MarkdownRenderOptions = {};
		const result = renderMarkdown(markdown, renderOptions);
		disposables.add(result);
		append(container, result.element);

		this.enhanceCodeBlocks(result.element, disposables);
	}

	private enhanceCodeBlocks(element: HTMLElement, disposables: DisposableStore): void {
		const codeBlocks = element.querySelectorAll('pre');
		for (const pre of codeBlocks) {
			const code = pre.querySelector('code');
			if (!code) continue;

			const langClass = Array.from(code.classList).find(c => c.startsWith('language-'));
			const language = langClass ? langClass.replace('language-', '') : '';
			const codeText = code.textContent || '';
			const detectedFilePath = this.detectFilePathFromContext(pre);

			const wrapper = $('.claude-code-block-wrapper');
			pre.parentNode?.insertBefore(wrapper, pre);
			wrapper.appendChild(pre);

			const actions = append(wrapper, $('.claude-code-block-actions'));

			if (detectedFilePath) {
				const fileLabel = append(actions, $('span.claude-code-block-file'));
				const fileName = detectedFilePath.split(/[/\\]/).pop() || detectedFilePath;
				fileLabel.textContent = fileName;
				fileLabel.title = detectedFilePath;
			}

			if (language) {
				const langLabel = append(actions, $('span.claude-code-block-lang'));
				langLabel.textContent = language;
			}

			// 복사 버튼
			const copyBtn = append(actions, $('button.claude-code-block-btn'));
			copyBtn.title = localize('copyCode', "Copy");
			append(copyBtn, $('span.codicon.codicon-copy'));
			const copyLabel = append(copyBtn, $('span'));
			copyLabel.textContent = localize('copy', "Copy");

			const onCopy = () => {
				navigator.clipboard.writeText(codeText).then(() => {
					copyLabel.textContent = localize('copied', "Copied!");
					setTimeout(() => {
						copyLabel.textContent = localize('copy', "Copy");
					}, 2000);
				});
			};
			copyBtn.addEventListener('click', onCopy);
			disposables.add({ dispose: () => copyBtn.removeEventListener('click', onCopy) });

			// Apply 버튼
			if (this._options.onApplyCode) {
				const applyBtn = append(actions, $('button.claude-code-block-btn.apply'));
				const applyTitle = detectedFilePath
					? localize('applyCodeToFile', "Apply to {0}", detectedFilePath.split(/[/\\]/).pop() || detectedFilePath)
					: localize('applyCode', "Apply to editor");
				applyBtn.title = applyTitle;
				append(applyBtn, $('span.codicon.codicon-insert'));
				const applyLabel = append(applyBtn, $('span'));
				applyLabel.textContent = localize('apply', "Apply");

				const onApply = () => {
					this._options.onApplyCode!(codeText, language, detectedFilePath);
				};
				applyBtn.addEventListener('click', onApply);
				disposables.add({ dispose: () => applyBtn.removeEventListener('click', onApply) });
			}
		}
	}

	private detectFilePathFromContext(preElement: HTMLElement): string | undefined {
		let prevElement = preElement.previousElementSibling;
		for (let i = 0; i < 2 && prevElement; i++) {
			const text = prevElement.textContent || '';
			const filePath = this.extractFilePath(text);
			if (filePath) {
				return filePath;
			}
			prevElement = prevElement.previousElementSibling;
		}
		return undefined;
	}

	private extractFilePath(text: string): string | undefined {
		const patterns: RegExp[] = [
			/`([^\s`]+\.[a-zA-Z]{1,10})`/,
			/\*\*([^\s*]+\.[a-zA-Z]{1,10})\*\*/,
			/(?:^|\s)((?:[a-zA-Z]:)?(?:[/\\])?(?:[\w.-]+[/\\])+[\w.-]+\.[a-zA-Z]{1,10})[\s:]/,
			/(?:^|\s)([\w.-]+\.(?:ts|tsx|js|jsx|py|java|go|rs|css|html|json|md|yaml|yml|toml|sh|bash|sql|c|cpp|h|hpp))[\s:]*$/,
		];

		for (const pattern of patterns) {
			const match = text.match(pattern);
			if (match && match[1]) {
				return match[1];
			}
		}
		return undefined;
	}

	// ==================== 헬퍼 ====================

	private getStateDisplayText(state: ChatSessionState, _message: IAssistantMessage): string {
		switch (state) {
			case 'sending': return localize('stateSending', "sending");
			case 'responding': return localize('stateResponding', "responding");
			case 'asking': return localize('stateAsking', "asking");
			case 'rateLimit': return localize('stateRateLimit', "rate limited");
			case 'error': return localize('stateError', "error");
			case 'cancelled': return localize('stateCancelled', "cancelled");
			default: return '';
		}
	}

	private updateTimeDisplay(timeElement: HTMLElement, message: IAssistantMessage, _disposables: DisposableStore): void {
		timeElement.textContent = this.formatTime(message.timestamp);
	}

	private calculateWorkDuration(message: IAssistantMessage): string {
		if (!message.workStartTime) return '';

		const endTime = message.workEndTime || Date.now();
		const durationMs = endTime - message.workStartTime;

		if (durationMs < 1000) return '<1s';

		const seconds = Math.floor(durationMs / 1000);
		const minutes = Math.floor(seconds / 60);

		if (minutes > 0) {
			const remainingSeconds = seconds % 60;
			return `${minutes}m ${remainingSeconds}s`;
		} else {
			return `${seconds}s`;
		}
	}

	private formatTime(timestamp: number): string {
		return new Date(timestamp).toLocaleTimeString(undefined, {
			hour: '2-digit',
			minute: '2-digit'
		});
	}

	private formatNumber(num: number): string {
		if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
		if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
		return num.toString();
	}

	private getSystemMessageIcon(type: string): string {
		switch (type) {
			case 'cancel': return 'codicon-close';
			case 'error': return 'codicon-error';
			case 'timeout': return 'codicon-clock';
			case 'queue-rejected': return 'codicon-circle-slash';
			case 'rate-limit': return 'codicon-watch';
			case 'connection-lost': return 'codicon-debug-disconnect';
			default: return 'codicon-info';
		}
	}
}
