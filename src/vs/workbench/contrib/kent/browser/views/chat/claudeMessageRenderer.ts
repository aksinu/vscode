/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, append, clearNode } from '../../../../../../base/browser/dom.js';
import { renderMarkdown, MarkdownRenderOptions } from '../../../../../../base/browser/markdownRenderer.js';
import { Codicon } from '../../../../../../base/common/codicons.js';
import { Disposable, DisposableStore } from '../../../../../../base/common/lifecycle.js';
import { IMarkdownString, MarkdownString } from '../../../../../../base/common/htmlContent.js';
import { ThemeIcon } from '../../../../../../base/common/themables.js';
import { IClipboardService } from '../../../../../../platform/clipboard/common/clipboardService.js';
import { INotificationService } from '../../../../../../platform/notification/common/notification.js';
import { localize } from '../../../../../../nls.js';
import { IClaudeMessage, IClaudeToolAction, IClaudeAskUserRequest, IClaudeUsageInfo, IClaudeFileChange, IClaudeFileChangesSummary } from '../../../common/types/claudeTypes.js';
import { IEditorService } from '../../../../../services/editor/common/editorService.js';
import { ITextModel } from '../../../../../../editor/common/model.js';
import { ICodeEditor } from '../../../../../../editor/browser/editorBrowser.js';

export interface IClaudeMessageRendererOptions {
	readonly onApplyCode?: (code: string, language: string) => void;
	readonly onRespondToAskUser?: (responses: string[]) => void;
	readonly onShowFileDiff?: (fileChange: IClaudeFileChange) => void;
	readonly onRevertFile?: (fileChange: IClaudeFileChange) => Promise<boolean>;
	readonly onRevertAllFiles?: () => Promise<number>;
	/** 변경사항 수락 (스냅샷 정리) */
	readonly onAcceptFile?: (fileChange: IClaudeFileChange) => void;
	/** 모든 변경사항 수락 */
	readonly onAcceptAllFiles?: () => void;
	/** 선택된 파일들 Revert */
	readonly onRevertSelectedFiles?: (fileChanges: IClaudeFileChange[]) => Promise<number>;
	/** 선택된 파일들 Accept */
	readonly onAcceptSelectedFiles?: (fileChanges: IClaudeFileChange[]) => void;
}

export class ClaudeMessageRenderer extends Disposable {

	// Event Delegation을 위한 핸들러 맵
	private readonly _eventHandlers = new Map<string, (element: HTMLElement, event: Event) => void>();

	constructor(
		private readonly options: IClaudeMessageRendererOptions,
		@IClipboardService private readonly clipboardService: IClipboardService,
		@INotificationService private readonly notificationService: INotificationService,
		@IEditorService private readonly editorService: IEditorService
	) {
		super();
		this._setupEventHandlers();
	}

	/**
	 * Event Delegation 패턴을 위한 핸들러 초기화
	 * 개별 요소마다 리스너를 등록하는 대신, 컨테이너에서 이벤트를 처리
	 */
	private _setupEventHandlers(): void {
		// Copy 메시지 핸들러 (아이콘 피드백 포함)
		this._eventHandlers.set('copy-message', (element, event) => {
			const messageText = element.getAttribute('data-message-content');
			if (messageText) {
				// 아이콘 요소 찾기
				const copyIcon = element.querySelector('.codicon.codicon-copy') as HTMLElement;

				this.clipboardService.writeText(messageText).then(() => {
					this.notificationService.info(localize('messageCopied', "Message copied to clipboard"));

					// 복사 성공 피드백 - 아이콘 변경
					if (copyIcon) {
						copyIcon.classList.remove('codicon-copy');
						copyIcon.classList.add('codicon-check');
						setTimeout(() => {
							copyIcon.classList.remove('codicon-check');
							copyIcon.classList.add('codicon-copy');
						}, 2000);
					}
				}).catch(() => {
					this.notificationService.error(localize('copyMessageFailed', "Failed to copy message"));
				});
			}
		});

		// Copy 코드 핸들러
		this._eventHandlers.set('copy-code', (element, event) => {
			const code = element.getAttribute('data-code');
			if (code) {
				this.clipboardService.writeText(code).then(() => {
					this.notificationService.info(localize('codeCopied', "Code copied to clipboard"));
				});
			}
		});

		// Apply 코드 핸들러
		this._eventHandlers.set('apply-code', (element, event) => {
			const code = element.getAttribute('data-code');
			const language = element.getAttribute('data-language');
			if (code && this.options.onApplyCode) {
				this.options.onApplyCode(code, language || 'text');
			}
		});

		// File Diff 핸들러
		this._eventHandlers.set('show-file-diff', (element, event) => {
			const fileChangeData = element.getAttribute('data-file-change');
			if (fileChangeData && this.options.onShowFileDiff) {
				try {
					const fileChange = JSON.parse(fileChangeData);
					this.options.onShowFileDiff(fileChange);
				} catch (e) {
					console.error('Failed to parse file change data:', e);
				}
			}
		});

		// File Revert 핸들러
		this._eventHandlers.set('revert-file', (element, event) => {
			const fileChangeData = element.getAttribute('data-file-change');
			if (fileChangeData && this.options.onRevertFile) {
				try {
					const fileChange = JSON.parse(fileChangeData);
					this.options.onRevertFile(fileChange);
				} catch (e) {
					console.error('Failed to parse file change data:', e);
				}
			}
		});

		// File Accept 핸들러
		this._eventHandlers.set('accept-file', (element, event) => {
			const fileChangeData = element.getAttribute('data-file-change');
			if (fileChangeData && this.options.onAcceptFile) {
				try {
					const fileChange = JSON.parse(fileChangeData);
					this.options.onAcceptFile(fileChange);
				} catch (e) {
					console.error('Failed to parse file change data:', e);
				}
			}
		});

		// AskUser 응답 핸들러
		this._eventHandlers.set('askuser-response', (element, event) => {
			const responseData = element.getAttribute('data-response');
			if (responseData && this.options.onRespondToAskUser) {
				try {
					const responses = JSON.parse(responseData);
					this.options.onRespondToAskUser(responses);
				} catch (e) {
					console.error('Failed to parse response data:', e);
				}
			}
		});
	}

	/**
	 * 컨테이너에 Event Delegation 리스너 설정
	 * 단일 리스너가 모든 버튼 클릭을 처리하여 메모리 효율성 향상
	 */
	private _setupEventDelegation(container: HTMLElement, disposables: DisposableStore): void {
		const clickHandler = (event: Event) => {
			const target = event.target as HTMLElement;
			const actionElement = target.closest('[data-action]') as HTMLElement;

			if (actionElement) {
				const action = actionElement.getAttribute('data-action');
				if (action && this._eventHandlers.has(action)) {
					event.preventDefault();
					event.stopPropagation();
					this._eventHandlers.get(action)!(actionElement, event);
				}
			}
		};

		container.addEventListener('click', clickHandler);
		disposables.add({
			dispose: () => container.removeEventListener('click', clickHandler)
		});
	}

	renderMessage(message: IClaudeMessage, container: HTMLElement, options?: { readOnly?: boolean }): DisposableStore {
		const disposables = new DisposableStore();
		const readOnly = options?.readOnly ?? false;

		clearNode(container);

		// Event Delegation 설정 (단일 리스너로 모든 클릭 처리)
		this._setupEventDelegation(container, disposables);

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

		// 타임스탬프와 작업 시간
		const timeElement = append(headerElement, $('.claude-message-time'));
		this.updateTimeDisplay(timeElement, message, disposables);

		// 메시지 복사 버튼 (Event Delegation 패턴 사용 - 메모리 효율성 향상)
		const copyMessageButton = append(headerElement, $('button.claude-message-copy'));
		copyMessageButton.title = localize('copyMessage', "Copy message");
		append(copyMessageButton, $('.codicon.codicon-copy'));

		// Event Delegation을 위한 data 속성 설정 (개별 리스너 대신)
		copyMessageButton.setAttribute('data-action', 'copy-message');
		copyMessageButton.setAttribute('data-message-content', message.content);

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

		// 현재 도구 액션 표시 (스트리밍 중) - 컨텐츠 하단에 표시
		if (message.currentToolAction || (message.isStreaming && message.toolActions && message.toolActions.length > 0)) {
			this.renderCurrentToolAction(message, messageElement);
		}

		// 완료된 도구 액션 목록 표시
		if (message.toolActions && message.toolActions.length > 0 && !message.isStreaming) {
			this.renderToolActionsSummary(message.toolActions, messageElement, disposables);
		}

		// AskUser 질문 표시
		if (message.isWaitingForUser && message.askUserRequest) {
			this.renderAskUserRequest(message.askUserRequest, messageElement, disposables);
		}

		// 컨텍스트 및 첨부파일 표시 (사용자 메시지)
		if (message.role === 'user' && (message.context || (message.attachments && message.attachments.length > 0))) {
			this.renderContext(message, messageElement);
		}

		// 토큰 사용량 및 작업 시간 표시 (assistant 메시지, 스트리밍 완료 후)
		if (message.role === 'assistant' && !message.isStreaming && (message.usage || message.workStartTime)) {
			this.renderUsageInfo(message.usage, messageElement, message);
		}

		// 파일 변경사항 표시 (assistant 메시지, 스트리밍 완료 후)
		if (message.role === 'assistant' && !message.isStreaming && message.fileChanges && message.fileChanges.changes.length > 0) {
			this.renderFileChanges(message.fileChanges, messageElement, disposables, readOnly);
		}

		return disposables;
	}

	private renderMarkdownContent(content: string, container: HTMLElement, disposables: DisposableStore): void {
		const markdown: IMarkdownString = new MarkdownString(content, {
			isTrusted: false,
			supportThemeIcons: true
		});

		const renderOptions: MarkdownRenderOptions = {
			codeBlockRendererSync: (languageId: string, value: string) => {
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
		const attachments = message.attachments;

		// context도 attachments도 없으면 리턴
		if (!context && (!attachments || attachments.length === 0)) {
			return;
		}

		const contextElement = append(container, $('.claude-message-context'));

		// 기존 context 표시
		if (context) {
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

		// 첨부파일 표시
		if (attachments && attachments.length > 0) {
			for (const attachment of attachments) {
				const tag = append(contextElement, $('.claude-context-tag'));

				// 타입별 아이콘
				let iconClass = 'codicon-file';
				switch (attachment.type) {
					case 'file':
						iconClass = 'codicon-file';
						break;
					case 'folder':
						iconClass = 'codicon-folder';
						break;
					case 'selection':
						iconClass = 'codicon-selection';
						break;
					case 'diagnostics':
						iconClass = 'codicon-warning';
						break;
					case 'workspace':
						iconClass = 'codicon-folder-library';
						break;
					case 'image':
						iconClass = 'codicon-file-media';
						break;
					case 'code-reference':
						iconClass = 'codicon-code';
						tag.classList.add('code-reference');
						break;
				}

				append(tag, $(`.codicon.${iconClass}`));
				const nameSpan = append(tag, $('span'));
				nameSpan.textContent = attachment.name;

				// 툴팁에 전체 경로 표시
				if (attachment.uri) {
					tag.title = attachment.uri.fsPath;
				}
			}
		}
	}

	private formatTime(timestamp: number): string {
		const date = new Date(timestamp);
		return date.toLocaleTimeString(undefined, {
			hour: '2-digit',
			minute: '2-digit'
		});
	}

	private updateTimeDisplay(timeElement: HTMLElement, message: IClaudeMessage, disposables: DisposableStore): void {
		const baseTime = this.formatTime(message.timestamp);

		// 사용자 메시지는 기본 시간만 표시
		if (message.role === 'user') {
			timeElement.textContent = baseTime;
			return;
		}

		// Assistant 메시지의 경우 작업 시간도 표시
		if (message.workStartTime) {
			const workTimeText = this.formatWorkTime(message);
			timeElement.innerHTML = `${baseTime}<span class="claude-work-time">${workTimeText}</span>`;

			// 스트리밍 중이면 실시간 업데이트 설정
			if (message.isStreaming) {
				this.setupLiveTimeUpdate(timeElement, message, disposables);
			}
		} else {
			timeElement.textContent = baseTime;
		}
	}

	private formatWorkTime(message: IClaudeMessage): string {
		if (!message.workStartTime) {
			return '';
		}

		const endTime = message.workEndTime || Date.now();
		const durationMs = endTime - message.workStartTime;

		if (durationMs < 1000) {
			return ` • <1s`;
		}

		const seconds = Math.floor(durationMs / 1000);
		const minutes = Math.floor(seconds / 60);

		if (minutes > 0) {
			const remainingSeconds = seconds % 60;
			return ` • ${minutes}m ${remainingSeconds}s`;
		} else {
			return ` • ${seconds}s`;
		}
	}

	private setupLiveTimeUpdate(timeElement: HTMLElement, message: IClaudeMessage, disposables: DisposableStore): void {
		if (!message.workStartTime || !message.isStreaming) {
			return;
		}

		let lastNotificationTime = 0;
		const NOTIFICATION_INTERVALS = [30, 60, 120, 300]; // 30초, 1분, 2분, 5분

		let updateInterval: number | undefined;
		let timeoutId: number | undefined;

		// cleanup 함수 정의
		const cleanup = () => {
			if (updateInterval) {
				clearInterval(updateInterval);
				updateInterval = undefined;
			}
			if (timeoutId) {
				clearTimeout(timeoutId);
				timeoutId = undefined;
			}
		};

		// DisposableStore에 cleanup 등록 (Critical 메모리 누수 방지)
		disposables.add({ dispose: cleanup });

		updateInterval = window.setInterval(() => {
			// 스트리밍이 완료되었으면 중지
			if (!message.isStreaming) {
				cleanup();
				return;
			}

			const baseTime = this.formatTime(message.timestamp);
			const workTimeText = this.formatWorkTime(message);
			timeElement.innerHTML = `${baseTime}<span class="claude-work-time">${workTimeText}</span>`;

			// 장시간 작업 알림 체크
			const elapsedSeconds = (Date.now() - message.workStartTime!) / 1000;
			const shouldNotify = NOTIFICATION_INTERVALS.find(interval =>
				elapsedSeconds >= interval && lastNotificationTime < interval
			);

			if (shouldNotify) {
				lastNotificationTime = shouldNotify;
				this.showLongRunningTaskNotification(elapsedSeconds);
			}
		}, 1000);

		// 메모리 누수 방지를 위해 5분 후 자동 중지
		timeoutId = window.setTimeout(() => {
			cleanup();
		}, 5 * 60 * 1000);
	}

	private showLongRunningTaskNotification(elapsedSeconds: number): void {
		const container = document.querySelector('.claude-message:last-child .claude-message-content');
		if (!container) return;

		// 기존 알림이 있으면 제거
		const existingNotification = container.querySelector('.claude-long-task-notification');
		if (existingNotification) {
			existingNotification.remove();
		}

		const notification = document.createElement('div');
		notification.className = 'claude-long-task-notification';

		let message = '';
		if (elapsedSeconds >= 300) { // 5분 이상
			message = localize('longTaskNotification5min', "Claude is working on a complex task (5+ minutes). This may involve multiple steps or require significant processing time.");
		} else if (elapsedSeconds >= 120) { // 2분 이상
			message = localize('longTaskNotification2min', "Claude is working on a complex task (2+ minutes). Please be patient as this may take some time to complete.");
		} else if (elapsedSeconds >= 60) { // 1분 이상
			message = localize('longTaskNotification1min', "Claude is working on your request (1+ minute). For complex tasks, this is normal.");
		} else if (elapsedSeconds >= 30) { // 30초 이상
			message = localize('longTaskNotification30s', "Claude is thinking deeply about your request...");
		}

		notification.innerHTML = `
			<div class="claude-notification-icon">
				<span class="codicon codicon-info"></span>
			</div>
			<div class="claude-notification-text">${message}</div>
		`;

		container.appendChild(notification);

		// 3초 후 자동 제거
		setTimeout(() => {
			if (notification.parentNode) {
				notification.remove();
			}
		}, 3000);
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

	private renderToolActionsSummary(toolActions: IClaudeToolAction[], container: HTMLElement, disposables: DisposableStore): void {
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

		// 토글 기능 (Critical 메모리 누수 방지)
		const toggleHandler = () => {
			const isHidden = list.style.display === 'none';
			list.style.display = isHidden ? 'block' : 'none';
			toggleIcon.classList.toggle('codicon-chevron-right', !isHidden);
			toggleIcon.classList.toggle('codicon-chevron-down', isHidden);
		};
		header.addEventListener('click', toggleHandler);
		disposables.add({ dispose: () => header.removeEventListener('click', toggleHandler) });
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

	private renderUsageInfo(usage: IClaudeUsageInfo | undefined, container: HTMLElement, message?: IClaudeMessage): void {
		const usageElement = append(container, $('.claude-message-usage'));

		// 작업 시간 (맨 앞에 표시)
		if (message?.workStartTime) {
			const workTimeElement = append(usageElement, $('.claude-usage-worktime'));
			const endTime = message.workEndTime || Date.now();
			const durationMs = endTime - message.workStartTime;

			let timeText: string;
			if (durationMs < 1000) {
				timeText = '<1s';
			} else {
				const seconds = Math.floor(durationMs / 1000);
				const minutes = Math.floor(seconds / 60);
				if (minutes > 0) {
					const remainingSeconds = seconds % 60;
					timeText = `${minutes}m ${remainingSeconds}s`;
				} else {
					timeText = `${seconds}s`;
				}
			}

			append(workTimeElement, $('.codicon.codicon-clock'));
			const timeValue = append(workTimeElement, $('span'));
			timeValue.textContent = timeText;
			workTimeElement.title = localize('workDuration', "Work duration");
		}

		// 토큰 정보 (usage가 있을 때만)
		if (usage) {
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

			// 서브에이전트 정보 (있으면)
			if (usage.subagents && usage.subagents.length > 0) {
				const subagentItem = append(tokensElement, $('.claude-usage-item.subagent'));
				// 각 에이전트 타입과 설명을 줄바꿈으로 구분하여 툴팁에 표시
				const tooltipLines = usage.subagents.map((s, i) => {
					const desc = s.description ? `: ${s.description}` : '';
					return `${i + 1}. ${s.type}${desc}`;
				});
				subagentItem.title = `Subagents used:\n${tooltipLines.join('\n')}`;
				append(subagentItem, $('.codicon.codicon-server-process'));
				const subagentValue = append(subagentItem, $('span'));
				subagentValue.textContent = `${usage.subagents.length}`;
			}

			// 비용 (있으면)
			if (usage.totalCostUsd !== undefined && usage.totalCostUsd > 0) {
				const costElement = append(usageElement, $('.claude-usage-cost'));
				costElement.title = localize('totalCost', "Estimated cost");
				costElement.textContent = `$${usage.totalCostUsd.toFixed(4)}`;
			}
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

	private renderFileChanges(fileChanges: IClaudeFileChangesSummary, container: HTMLElement, disposables: DisposableStore, readOnly: boolean = false): void {
		const changesContainer = append(container, $('.claude-file-changes'));

		// 읽기 전용 상태일 경우 클래스 추가
		if (readOnly) {
			changesContainer.classList.add('read-only');
		}

		// 선택된 파일 추적
		const selectedFiles = new Set<IClaudeFileChange>();

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

		// 읽기 전용 배너 (이전 세션 변경사항)
		if (readOnly) {
			const readOnlyBanner = append(changesContainer, $('.claude-file-changes-readonly-banner'));
			readOnlyBanner.textContent = localize('previousSessionChanges', "Changes from a previous session (read-only)");
		}

		// 배치 액션 바 (Accept All / Reject All) - 읽기 전용일 때는 생성하지 않음
		const batchActionsBar = readOnly ? null : append(changesContainer, $('.claude-file-changes-batch-actions'));

		// Accept All 버튼 - 읽기 전용이 아닐 때만
		if (!readOnly && batchActionsBar && this.options.onAcceptAllFiles) {
			const acceptAllButton = append(batchActionsBar, $('button.claude-batch-btn.accept'));
			append(acceptAllButton, $('.codicon.codicon-check-all'));
			const acceptAllText = append(acceptAllButton, $('span'));
			acceptAllText.textContent = localize('acceptAll', "Accept All");
			acceptAllButton.title = localize('acceptAllTitle', "Accept all changes and clear snapshots");

			const acceptAllHandler = (e: MouseEvent) => {
				e.stopPropagation();
				this.options.onAcceptAllFiles?.();
				changesContainer.remove();
				this.notificationService.info(localize('allChangesAccepted', "All changes accepted"));
			};
			acceptAllButton.addEventListener('click', acceptAllHandler);
			disposables.add({ dispose: () => acceptAllButton.removeEventListener('click', acceptAllHandler) });
		}

		// Reject All 버튼 - 읽기 전용이 아닐 때만
		if (!readOnly && batchActionsBar && this.options.onRevertAllFiles && fileChanges.changes.length > 0) {
			const rejectAllButton = append(batchActionsBar, $('button.claude-batch-btn.reject'));
			append(rejectAllButton, $('.codicon.codicon-discard'));
			const rejectAllText = append(rejectAllButton, $('span'));
			rejectAllText.textContent = localize('rejectAll', "Reject All");
			rejectAllButton.title = localize('rejectAllTitle', "Revert all changes");

			const rejectAllHandler = async (e: MouseEvent) => {
				e.stopPropagation();
				if (this.options.onRevertAllFiles) {
					const count = await this.options.onRevertAllFiles();
					if (count > 0) {
						this.notificationService.info(localize('revertedFiles', "Reverted {0} file(s)", count));
						changesContainer.remove();
					}
				}
			};
			rejectAllButton.addEventListener('click', rejectAllHandler);
			disposables.add({ dispose: () => rejectAllButton.removeEventListener('click', rejectAllHandler) });
		}

		// 선택 액션 바 (처음에는 숨김) - 읽기 전용이 아닐 때만
		let selectionActionsBar: HTMLElement | null = null;
		let selectionCount: HTMLElement | null = null;

		if (!readOnly) {
			selectionActionsBar = append(changesContainer, $('.claude-file-changes-selection-actions'));
			selectionActionsBar.style.display = 'none';

			selectionCount = append(selectionActionsBar, $('.selection-count'));
		}

		// 파일 목록 (먼저 생성 - 클로저에서 참조해야 함)
		const fileList = append(changesContainer, $('.claude-file-changes-list'));

		// 선택 UI 업데이트 함수 - 읽기 전용이 아닐 때만 사용
		const updateSelectionUI = !readOnly ? () => {
			const count = selectedFiles.size;
			if (count > 0) {
				selectionActionsBar!.style.display = 'flex';
				batchActionsBar!.style.display = 'none';
				selectionCount!.textContent = localize('selectedCount', "{0} selected", count);
			} else {
				selectionActionsBar!.style.display = 'none';
				batchActionsBar!.style.display = 'flex';
			}
		} : () => {};

		// Accept Selected 버튼 - 읽기 전용이 아닐 때만
		if (!readOnly && selectionActionsBar) {
			const acceptSelectedButton = append(selectionActionsBar, $('button.claude-selection-btn.accept')) as HTMLButtonElement;
			append(acceptSelectedButton, $('.codicon.codicon-check'));
			const acceptSelectedText = append(acceptSelectedButton, $('span'));
			acceptSelectedText.textContent = localize('acceptSelected', "Accept");

			const acceptSelectedHandler = (e: MouseEvent) => {
				e.stopPropagation();
				if (selectedFiles.size > 0) {
					this.options.onAcceptSelectedFiles?.(Array.from(selectedFiles));
					// 선택된 항목 UI에서 제거
					for (const change of selectedFiles) {
						const item = fileList.querySelector(`[data-file-path="${CSS.escape(change.filePath)}"]`);
						item?.classList.add('accepted');
					}
					this.notificationService.info(localize('selectedAccepted', "{0} file(s) accepted", selectedFiles.size));
					selectedFiles.clear();
					updateSelectionUI();
				}
			};
			acceptSelectedButton.addEventListener('click', acceptSelectedHandler);
			disposables.add({ dispose: () => acceptSelectedButton.removeEventListener('click', acceptSelectedHandler) });

			// Reject Selected 버튼
			const rejectSelectedButton = append(selectionActionsBar, $('button.claude-selection-btn.reject')) as HTMLButtonElement;
			append(rejectSelectedButton, $('.codicon.codicon-discard'));
			const rejectSelectedText = append(rejectSelectedButton, $('span'));
			rejectSelectedText.textContent = localize('rejectSelected', "Reject");

			const rejectSelectedHandler = async (e: MouseEvent) => {
				e.stopPropagation();
				if (selectedFiles.size > 0 && this.options.onRevertSelectedFiles) {
					const count = await this.options.onRevertSelectedFiles(Array.from(selectedFiles));
					if (count > 0) {
						// 선택된 항목 UI에서 reverted 표시
						for (const change of selectedFiles) {
							const item = fileList.querySelector(`[data-file-path="${CSS.escape(change.filePath)}"]`);
							item?.classList.add('reverted');
						}
						this.notificationService.info(localize('selectedReverted', "{0} file(s) reverted", count));
						selectedFiles.clear();
						updateSelectionUI();
					}
				}
			};
			rejectSelectedButton.addEventListener('click', rejectSelectedHandler);
			disposables.add({ dispose: () => rejectSelectedButton.removeEventListener('click', rejectSelectedHandler) });

			// 선택 해제 버튼
			const clearSelectionButton = append(selectionActionsBar, $('button.claude-selection-btn.clear'));
			append(clearSelectionButton, $('.codicon.codicon-close'));

			const clearSelectionHandler = (e: MouseEvent) => {
				e.stopPropagation();
				selectedFiles.clear();
				fileList.querySelectorAll('.claude-file-checkbox input').forEach((cb: Element) => {
					(cb as HTMLInputElement).checked = false;
				});
				updateSelectionUI();
			};
			clearSelectionButton.addEventListener('click', clearSelectionHandler);
			disposables.add({ dispose: () => clearSelectionButton.removeEventListener('click', clearSelectionHandler) });
		}

		for (const change of fileChanges.changes) {
			const fileItem = append(fileList, $('.claude-file-changes-item'));
			fileItem.dataset.filePath = change.filePath;

			// 체크박스 - 읽기 전용이 아닐 때만 표시
			if (!readOnly) {
				const checkboxContainer = append(fileItem, $('.claude-file-checkbox'));
				const checkbox = append(checkboxContainer, $('input')) as HTMLInputElement;
				checkbox.type = 'checkbox';
				checkbox.title = localize('selectFile', "Select file");

				const checkboxHandler = (e: Event) => {
					e.stopPropagation();
					if (checkbox.checked) {
						selectedFiles.add(change);
					} else {
						selectedFiles.delete(change);
					}
					updateSelectionUI();
				};
				checkbox.addEventListener('change', checkboxHandler);
				disposables.add({ dispose: () => checkbox.removeEventListener('change', checkboxHandler) });
			}

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

			// Accept 버튼 - 읽기 전용이 아닐 때만
			if (!readOnly && this.options.onAcceptFile) {
				const acceptButton = append(buttons, $('button.claude-file-button.accept')) as HTMLButtonElement;
				acceptButton.title = localize('acceptFile', "Accept changes");
				append(acceptButton, $('.codicon.codicon-check'));

				const acceptHandler = (e: MouseEvent) => {
					e.stopPropagation();
					this.options.onAcceptFile?.(change);
					fileItem.classList.add('accepted');
					acceptButton.disabled = true;
				};
				acceptButton.addEventListener('click', acceptHandler);
				disposables.add({ dispose: () => acceptButton.removeEventListener('click', acceptHandler) });
			}

			// Revert 버튼 - 읽기 전용이 아닐 때만
			if (!readOnly && this.options.onRevertFile && !change.reverted) {
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
				const itemClickHandler = (e: MouseEvent) => {
					// 체크박스나 버튼 클릭이 아닐 때만
					if (!(e.target as HTMLElement).closest('.claude-file-checkbox, .claude-file-buttons')) {
						this.options.onShowFileDiff?.(change);
					}
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
