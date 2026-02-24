/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, append } from '../../../../../../../base/browser/dom.js';
import { DisposableStore } from '../../../../../../../base/common/lifecycle.js';
import { localize } from '../../../../../../../nls.js';
import { IAssistantMessage, IClaudeToolAction, ChatSessionState } from '../../../../common/types/claudeTypes.js';

/**
 * 도구 정보 렌더러
 * 현재 실행 중인 도구 + 완료된 도구 요약을 표시
 */
export class ToolInfoRenderer {

	/**
	 * 사용 툴 정보 렌더링 (현재 실행 중 + 완료된 툴들)
	 */
	renderToolInfo(
		message: IAssistantMessage,
		container: HTMLElement,
		_currentState: ChatSessionState,
		disposables: DisposableStore
	): void {
		// 현재 실행 중인 툴 (status가 'running'이고 이 메시지가 스트리밍 중일 때만 스피너 표시)
		if (message.currentToolAction && message.currentToolAction.status === 'running' && message.isStreaming) {
			this.renderCurrentTool(message.currentToolAction, container);
		}

		// 완료된 툴들의 요약
		if (message.toolActions && message.toolActions.length > 0 && (!message.isStreaming || (message.currentToolAction && message.currentToolAction.status !== 'running'))) {
			const sanitizedActions = message.isStreaming ? message.toolActions : message.toolActions.map(action => {
				if (action.status === 'running') {
					return { ...action, status: 'completed' as const };
				}
				return action;
			});
			this.renderToolSummary(sanitizedActions, container, disposables);
		}
	}

	private renderCurrentTool(toolAction: IClaudeToolAction, container: HTMLElement): void {
		const toolContainer = append(container, $('.claude-current-tool'));

		const spinner = append(toolContainer, $('.claude-tool-spinner'));
		spinner.classList.add('codicon', 'codicon-loading', 'codicon-modifier-spin');

		const toolName = append(toolContainer, $('.claude-tool-name'));
		toolName.textContent = getToolDisplayName(toolAction.tool);

		if (toolAction.input) {
			const toolInput = append(toolContainer, $('.claude-tool-input'));
			toolInput.textContent = formatToolInput(toolAction.tool, toolAction.input);
		}
	}

	private renderToolSummary(toolActions: IClaudeToolAction[], container: HTMLElement, disposables: DisposableStore): void {
		const summaryContainer = append(container, $('.claude-tool-summary'));

		const header = append(summaryContainer, $('.claude-tool-summary-header'));
		const toggleIcon = append(header, $('.codicon.codicon-chevron-right'));
		const headerText = append(header, $('span'));
		headerText.textContent = localize('toolsUsed', "{0} tool(s) used", toolActions.length);

		const list = append(summaryContainer, $('.claude-tool-summary-list'));
		list.style.display = 'none';

		for (const action of toolActions) {
			const item = append(list, $('.claude-tool-summary-item'));

			const statusIcon = append(item, $('.claude-tool-status-icon'));
			statusIcon.classList.add('codicon');
			if (action.status === 'completed') {
				statusIcon.classList.add('codicon-check');
			} else if (action.status === 'error') {
				statusIcon.classList.add('codicon-error');
			} else {
				statusIcon.classList.add('codicon-circle-outline');
			}

			const name = append(item, $('.claude-tool-name'));
			name.textContent = getToolDisplayName(action.tool);

			if (action.input) {
				const desc = append(item, $('.claude-tool-desc'));
				desc.textContent = formatToolInput(action.tool, action.input);
			}
		}

		const toggleHandler = () => {
			const isHidden = list.style.display === 'none';
			list.style.display = isHidden ? 'block' : 'none';
			toggleIcon.classList.toggle('codicon-chevron-right', !isHidden);
			toggleIcon.classList.toggle('codicon-chevron-down', isHidden);
		};
		header.addEventListener('click', toggleHandler);
		disposables.add({ dispose: () => header.removeEventListener('click', toggleHandler) });
	}
}

/**
 * 도구 표시 이름 반환 (export for reuse)
 */
export function getToolDisplayName(tool: string): string {
	const toolNames: Record<string, string> = {
		'Read': 'Reading file',
		'Write': 'Writing file',
		'Edit': 'Editing file',
		'Bash': 'Running command',
		'Grep': 'Searching code',
		'Glob': 'Finding files',
		'WebFetch': 'Fetching URL',
		'WebSearch': 'Searching web',
		'Task': 'Running agent',
		'AskUser': 'Asking question'
	};
	return toolNames[tool] || tool;
}

/**
 * 도구 입력을 간략하게 포맷 (export for reuse)
 */
export function formatToolInput(tool: string, input: Record<string, unknown>): string {
	switch (tool) {
		case 'Read':
		case 'Write':
		case 'Edit':
			return String(input['file_path'] || input['path'] || '').split(/[/\\]/).pop() || '';
		case 'Bash': {
			const cmd = String(input['command'] || '');
			return cmd.length > 50 ? cmd.substring(0, 50) + '...' : cmd;
		}
		case 'Grep':
			return `"${input['pattern'] || ''}"`;
		case 'Glob':
			return String(input['pattern'] || '');
		case 'WebFetch':
		case 'WebSearch':
			return String(input['url'] || input['query'] || '');
		case 'Task': {
			const agentType = String(input['subagent_type'] || input['subagentType'] || '');
			const desc = String(input['description'] || '');
			if (agentType && desc) {
				return `${agentType}: ${desc.length > 40 ? desc.substring(0, 40) + '...' : desc}`;
			}
			return agentType || desc || '';
		}
		default:
			return '';
	}
}
