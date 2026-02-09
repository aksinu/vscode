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
	IClaudeToolAction,
	IClaudeAskUserRequest,
	IClaudeUsageInfo,
	IClaudeFileChangesSummary,
	IClaudeFileChange,
	ChatSessionState
} from '../../../../common/types/claudeTypes.js';

/**
 * AssistantMessageRenderer 옵션 인터페이스
 * 파일 변경사항 관련 콜백들을 포함
 */
export interface IAssistantMessageRendererOptions {
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

	constructor(options?: IAssistantMessageRendererOptions) {
		this._options = options || {};
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

		clearNode(container);

		const messageElement = append(container, $('.claude-assistant-message'));

		if (message.isError) {
			messageElement.classList.add('error');
		}

		// 헤더: Claude | 시간 + 진행시간
		this.renderHeader(message, messageElement, currentState, disposables);

		// 메인 컨텐츠
		this.renderContent(message, messageElement, currentState, disposables);

		// 사용 툴 정보 (현재 실행 중 또는 완료된 툴들)
		this.renderToolInfo(message, messageElement, currentState, disposables);

		// Ask 질문 (사용자 선택 대기 중일 때)
		if (message.isWaitingForUser && message.askUserRequest) {
			this.renderAskUser(message.askUserRequest, messageElement, disposables);
		}

		// 토큰 사용량 및 작업시간 (완료 후)
		if (!message.isStreaming && (message.usage || message.workStartTime)) {
			this.renderUsageInfo(message, messageElement);
		}

		// 파일 변경사항 (완료 후)
		console.log('[DEBUG] AssistantMessageRenderer - fileChanges check:', {
			isStreaming: message.isStreaming,
			hasFileChanges: !!message.fileChanges,
			changesLength: message.fileChanges?.changes?.length || 0,
			fileChanges: message.fileChanges
		});

		if (!message.isStreaming && message.fileChanges && message.fileChanges.changes.length > 0) {
			console.log('[DEBUG] AssistantMessageRenderer - Rendering fileChanges!', message.fileChanges);
			this.renderFileChanges(message.fileChanges, messageElement, disposables, readOnly);
		}

		// 시스템메시지 (취소, 오류 등)
		if (message.systemMessage || message.isCanceled) {
			this.renderSystemMessage(message, messageElement);
		}

		return disposables;
	}

	/**
	 * 헤더: Claude | 시간 + 진행시간
	 */
	private renderHeader(
		message: IAssistantMessage,
		container: HTMLElement,
		currentState: ChatSessionState,
		disposables: DisposableStore
	): void {
		const header = append(container, $('.claude-assistant-header'));

		// Claude 아이콘
		const iconElement = append(header, $('.claude-assistant-icon'));
		iconElement.classList.add(...ThemeIcon.asClassNameArray(Codicon.sparkle));

		// "Claude" 텍스트
		const roleElement = append(header, $('.claude-assistant-role'));
		roleElement.textContent = 'Claude';

		// 상태 표시 (responding, asking 등)
		if (message.isStreaming || currentState !== 'idle') {
			const stateElement = append(header, $('.claude-assistant-state'));
			stateElement.textContent = this.getStateDisplayText(currentState, message);
		}

		// 시간 + 진행시간
		const timeElement = append(header, $('.claude-assistant-time'));
		this.updateTimeDisplay(timeElement, message, disposables);
	}

	/**
	 * 메인 컨텐츠 (Markdown 또는 대기 메시지)
	 */
	private renderContent(
		message: IAssistantMessage,
		container: HTMLElement,
		currentState: ChatSessionState,
		disposables: DisposableStore
	): void {
		const contentElement = append(container, $('.claude-assistant-content'));

		if (message.isError && message.content) {
			// 에러 메시지
			const errorElement = append(contentElement, $('.claude-error-message'));
			errorElement.textContent = message.content;
		} else if (message.isCanceled && message.content) {
			// 취소된 메시지 (부분 컨텐츠 + 취소 알림)
			this.renderMarkdownContent(message.content, contentElement, disposables);
		} else if (message.content) {
			// 정상 Markdown 컨텐츠
			this.renderMarkdownContent(message.content, contentElement, disposables);
		} else if (message.isStreaming || currentState === 'responding') {
			// 응답 대기 중
			const waitingElement = append(contentElement, $('.claude-waiting'));
			append(waitingElement, $('.codicon.codicon-loading.codicon-modifier-spin'));
			waitingElement.appendChild(document.createTextNode(' ' + localize('waitingForResponse', "Thinking...")));
		} else if (currentState === 'sending') {
			// 전송 중
			const sendingElement = append(contentElement, $('.claude-sending'));
			append(sendingElement, $('.codicon.codicon-loading.codicon-modifier-spin'));
			sendingElement.appendChild(document.createTextNode(' ' + localize('sendingRequest', "Sending request...")));
		}
	}

	/**
	 * 사용 툴 정보 (현재 실행 중 + 완료된 툴들)
	 */
	private renderToolInfo(
		message: IAssistantMessage,
		container: HTMLElement,
		currentState: ChatSessionState,
		disposables: DisposableStore
	): void {
		// 현재 실행 중인 툴
		if (message.currentToolAction && (message.isStreaming || currentState === 'responding')) {
			this.renderCurrentTool(message.currentToolAction, container);
		}

		// 완료된 툴들의 요약 (스트리밍 완료 후)
		if (message.toolActions && message.toolActions.length > 0 && !message.isStreaming) {
			this.renderToolSummary(message.toolActions, container, disposables);
		}
	}

	/**
	 * 현재 실행 중인 툴 표시
	 */
	private renderCurrentTool(toolAction: IClaudeToolAction, container: HTMLElement): void {
		const toolContainer = append(container, $('.claude-current-tool'));

		// 스피너
		const spinner = append(toolContainer, $('.claude-tool-spinner'));
		spinner.classList.add('codicon', 'codicon-loading', 'codicon-modifier-spin');

		// 툴 이름
		const toolName = append(toolContainer, $('.claude-tool-name'));
		toolName.textContent = this.getToolDisplayName(toolAction.tool);

		// 간략한 입력 정보
		if (toolAction.input) {
			const toolInput = append(toolContainer, $('.claude-tool-input'));
			toolInput.textContent = this.formatToolInput(toolAction.tool, toolAction.input);
		}
	}

	/**
	 * 완료된 툴들의 요약
	 */
	private renderToolSummary(toolActions: IClaudeToolAction[], container: HTMLElement, disposables: DisposableStore): void {
		const summaryContainer = append(container, $('.claude-tool-summary'));

		// 접이식 헤더
		const header = append(summaryContainer, $('.claude-tool-summary-header'));
		const toggleIcon = append(header, $('.codicon.codicon-chevron-right'));
		const headerText = append(header, $('span'));
		headerText.textContent = localize('toolsUsed', "{0} tool(s) used", toolActions.length);

		// 툴 목록 (기본 숨김)
		const list = append(summaryContainer, $('.claude-tool-summary-list'));
		list.style.display = 'none';

		for (const action of toolActions) {
			const item = append(list, $('.claude-tool-summary-item'));

			// 상태 아이콘
			const statusIcon = append(item, $('.claude-tool-status-icon'));
			statusIcon.classList.add('codicon');
			if (action.status === 'completed') {
				statusIcon.classList.add('codicon-check');
			} else if (action.status === 'error') {
				statusIcon.classList.add('codicon-error');
			} else {
				statusIcon.classList.add('codicon-circle-outline');
			}

			// 툴 이름과 간략한 설명
			const name = append(item, $('.claude-tool-name'));
			name.textContent = this.getToolDisplayName(action.tool);

			if (action.input) {
				const desc = append(item, $('.claude-tool-desc'));
				desc.textContent = this.formatToolInput(action.tool, action.input);
			}
		}

		// 토글 기능
		const toggleHandler = () => {
			const isHidden = list.style.display === 'none';
			list.style.display = isHidden ? 'block' : 'none';
			toggleIcon.classList.toggle('codicon-chevron-right', !isHidden);
			toggleIcon.classList.toggle('codicon-chevron-down', isHidden);
		};
		header.addEventListener('click', toggleHandler);
		disposables.add({ dispose: () => header.removeEventListener('click', toggleHandler) });
	}

	/**
	 * Ask 질문 렌더링
	 */
	private renderAskUser(askRequest: IClaudeAskUserRequest, container: HTMLElement, disposables: DisposableStore): void {
		const askContainer = append(container, $('.claude-ask-user'));

		// 자동 승인된 경우
		if (askRequest.autoAccepted && askRequest.autoAcceptedOption) {
			const autoElement = append(askContainer, $('.claude-ask-auto-accepted'));
			append(autoElement, $('.codicon.codicon-check'));
			autoElement.appendChild(document.createTextNode(' ' + localize('autoSelected', "[Auto] Selected: \"{0}\"", askRequest.autoAcceptedOption)));
			return;
		}

		// 질문들 렌더링
		for (const question of askRequest.questions) {
			const questionContainer = append(askContainer, $('.claude-ask-question'));

			// 질문 텍스트
			const questionText = append(questionContainer, $('.claude-ask-text'));
			questionText.textContent = question.question;

			// 옵션 버튼들
			const optionsContainer = append(questionContainer, $('.claude-ask-options'));
			for (const option of question.options) {
				const button = append(optionsContainer, $('button.claude-ask-option'));
				button.textContent = option.label;
				if (option.description) {
					button.title = option.description;
				}

				const clickHandler = () => {
					// TODO: 옵션 선택 처리
				};
				button.addEventListener('click', clickHandler);
				disposables.add({ dispose: () => button.removeEventListener('click', clickHandler) });
			}
		}
	}

	/**
	 * 사용량 정보 (토큰, 작업시간)
	 */
	private renderUsageInfo(message: IAssistantMessage, container: HTMLElement): void {
		const usageElement = append(container, $('.claude-assistant-usage'));

		// 작업 시간
		if (message.workStartTime) {
			const workTimeElement = append(usageElement, $('.claude-usage-worktime'));
			const duration = this.calculateWorkDuration(message);
			append(workTimeElement, $('.codicon.codicon-clock'));
			append(workTimeElement, $('span')).textContent = duration;
		}

		// 토큰 정보
		if (message.usage) {
			this.renderTokenInfo(message.usage, usageElement);
		}
	}

	/**
	 * 파일 변경사항
	 */
	private renderFileChanges(
		fileChanges: IClaudeFileChangesSummary,
		container: HTMLElement,
		disposables: DisposableStore,
		readOnly: boolean
	): void {
		const changesContainer = append(container, $('.claude-file-changes'));

		if (readOnly) {
			changesContainer.classList.add('read-only');
		}

		// 접이식 헤더
		const header = append(changesContainer, $('.claude-file-changes-header'));

		// 토글 아이콘 (chevron-right → chevron-down)
		const toggleIcon = append(header, $('.codicon.codicon-chevron-right'));

		// 변경사항 요약
		const summary = append(header, $('.claude-file-changes-summary'));
		append(summary, $('.codicon.codicon-files'));
		const totalFiles = fileChanges.filesCreated + fileChanges.filesModified + fileChanges.filesDeleted;
		append(summary, $('span')).textContent = localize('filesChanged', "{0} file(s) changed", totalFiles);

		// 라인 변경 정보
		const linesInfo = append(summary, $('.claude-file-changes-lines'));
		const addedSpan = append(linesInfo, $('span.added'));
		addedSpan.textContent = `+${fileChanges.totalLinesAdded}`;
		const removedSpan = append(linesInfo, $('span.removed'));
		removedSpan.textContent = `-${fileChanges.totalLinesRemoved}`;

		// Revert All 버튼 (readOnly가 아닐 때만)
		if (!readOnly && this._options.onRevertAllFiles) {
			const revertAllBtn = append(header, $('button.claude-file-changes-revert-all'));
			append(revertAllBtn, $('.codicon.codicon-discard'));
			revertAllBtn.appendChild(document.createTextNode(localize('revertAll', "Revert All")));

			const revertAllHandler = async (e: Event) => {
				e.stopPropagation(); // 헤더 클릭 이벤트 전파 방지
				if (this._options.onRevertAllFiles) {
					const revertedCount = await this._options.onRevertAllFiles();
					if (revertedCount > 0) {
						// 모든 항목에 reverted 클래스 추가
						const items = fileList.querySelectorAll('.claude-file-changes-item');
						items.forEach(item => item.classList.add('reverted'));
					}
				}
			};
			revertAllBtn.addEventListener('click', revertAllHandler);
			disposables.add({ dispose: () => revertAllBtn.removeEventListener('click', revertAllHandler) });
		}

		// 파일 목록 (기본 숨김)
		const fileList = append(changesContainer, $('.claude-file-changes-list'));
		fileList.style.display = 'none';

		// 각 파일 항목 렌더링
		for (const change of fileChanges.changes) {
			this.renderFileChangeItem(change, fileList, disposables, readOnly);
		}

		// 헤더 클릭으로 목록 펼치기/접기
		const toggleHandler = () => {
			const isHidden = fileList.style.display === 'none';
			fileList.style.display = isHidden ? 'flex' : 'none';
			toggleIcon.classList.toggle('codicon-chevron-right', !isHidden);
			toggleIcon.classList.toggle('codicon-chevron-down', isHidden);
		};
		header.addEventListener('click', toggleHandler);
		disposables.add({ dispose: () => header.removeEventListener('click', toggleHandler) });
	}

	/**
	 * 개별 파일 변경 항목 렌더링
	 */
	private renderFileChangeItem(
		change: IClaudeFileChange,
		container: HTMLElement,
		disposables: DisposableStore,
		readOnly: boolean
	): void {
		const item = append(container, $('.claude-file-changes-item'));

		// reverted 상태 처리
		if (change.reverted) {
			item.classList.add('reverted');
		}

		// 상태 아이콘 (created/modified/deleted)
		const statusIcon = append(item, $('.claude-file-status-icon'));
		statusIcon.classList.add('codicon');
		statusIcon.classList.add(change.changeType);
		switch (change.changeType) {
			case 'created':
				statusIcon.classList.add('codicon-new-file');
				statusIcon.title = localize('fileCreated', "Created");
				break;
			case 'modified':
				statusIcon.classList.add('codicon-edit');
				statusIcon.title = localize('fileModified', "Modified");
				break;
			case 'deleted':
				statusIcon.classList.add('codicon-trash');
				statusIcon.title = localize('fileDeleted', "Deleted");
				break;
		}

		// 파일 이름
		const fileName = append(item, $('.claude-file-name'));
		fileName.textContent = change.fileName;
		fileName.title = change.filePath;

		// 라인 변경 (+N / -N)
		const lineChanges = append(item, $('.claude-file-line-changes'));
		if (change.linesAdded > 0) {
			const added = append(lineChanges, $('span.added'));
			added.textContent = `+${change.linesAdded}`;
		}
		if (change.linesRemoved > 0) {
			const removed = append(lineChanges, $('span.removed'));
			removed.textContent = `-${change.linesRemoved}`;
		}

		// 액션 버튼들 (호버 시 표시, readOnly가 아닐 때만)
		if (!readOnly) {
			const buttons = append(item, $('.claude-file-buttons'));

			// Accept 버튼
			if (this._options.onAcceptFile) {
				const acceptBtn = append(buttons, $('button.claude-file-button.accept'));
				acceptBtn.title = localize('acceptFile', "Accept this change");
				append(acceptBtn, $('.codicon.codicon-check'));

				const acceptHandler = (e: Event) => {
					e.stopPropagation();
					if (this._options.onAcceptFile) {
						this._options.onAcceptFile(change);
						item.classList.add('accepted');
					}
				};
				acceptBtn.addEventListener('click', acceptHandler);
				disposables.add({ dispose: () => acceptBtn.removeEventListener('click', acceptHandler) });
			}

			// Revert 버튼
			if (this._options.onRevertFile) {
				const revertBtn = append(buttons, $('button.claude-file-button.revert'));
				revertBtn.title = localize('revertFile', "Revert this change");
				append(revertBtn, $('.codicon.codicon-discard'));

				const revertHandler = async (e: Event) => {
					e.stopPropagation();
					if (this._options.onRevertFile) {
						const success = await this._options.onRevertFile(change);
						if (success) {
							item.classList.add('reverted');
							change.reverted = true;
						}
					}
				};
				revertBtn.addEventListener('click', revertHandler);
				disposables.add({ dispose: () => revertBtn.removeEventListener('click', revertHandler) });
			}
		}

		// 항목 클릭 시 Diff 뷰어 열기
		if (this._options.onShowFileDiff) {
			const itemClickHandler = () => {
				if (this._options.onShowFileDiff) {
					this._options.onShowFileDiff(change);
				}
			};
			item.addEventListener('click', itemClickHandler);
			disposables.add({ dispose: () => item.removeEventListener('click', itemClickHandler) });
		}
	}

	/**
	 * 시스템메시지 (취소, 오류 등)
	 */
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

	// ==================== 헬퍼 메서드들 ====================

	private renderMarkdownContent(content: string, container: HTMLElement, disposables: DisposableStore): void {
		const markdown: IMarkdownString = new MarkdownString(content, {
			isTrusted: false,
			supportThemeIcons: true
		});

		const renderOptions: MarkdownRenderOptions = {};
		const result = renderMarkdown(markdown, renderOptions);
		disposables.add(result);
		append(container, result.element);
	}

	private getStateDisplayText(state: ChatSessionState, message: IAssistantMessage): string {
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

	private updateTimeDisplay(timeElement: HTMLElement, message: IAssistantMessage, disposables: DisposableStore): void {
		const baseTime = this.formatTime(message.timestamp);

		const updateTimeContent = (workTime: string) => {
			clearNode(timeElement);
			timeElement.appendChild(document.createTextNode(baseTime + ' '));
			const workTimeSpan = append(timeElement, $('.work-time'));
			workTimeSpan.textContent = '• ' + workTime;
		};

		if (message.workStartTime) {
			const workTime = this.calculateWorkDuration(message);
			updateTimeContent(workTime);

			// 실시간 업데이트 (스트리밍 중일 때)
			if (message.isStreaming) {
				const updateInterval = setInterval(() => {
					if (!message.isStreaming) {
						clearInterval(updateInterval);
						return;
					}
					const currentWorkTime = this.calculateWorkDuration(message);
					updateTimeContent(currentWorkTime);
				}, 1000);

				disposables.add({ dispose: () => clearInterval(updateInterval) });
			}
		} else {
			timeElement.textContent = baseTime;
		}
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

	private renderTokenInfo(usage: IClaudeUsageInfo, container: HTMLElement): void {
		const tokensElement = append(container, $('.claude-usage-tokens'));

		// 입력 토큰
		const inputItem = append(tokensElement, $('.token-item'));
		inputItem.title = localize('inputTokens', 'Input tokens');
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
			cacheElement.title = localize('cacheTokens', 'Cache tokens');
			append(cacheElement, $('.codicon.codicon-database'));
			append(cacheElement, $('span')).textContent = this.formatNumber(usage.cacheReadTokens);
		}
	}

	private formatNumber(num: number): string {
		if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
		if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
		return num.toString();
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