/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../../../../base/common/uri.js';
import { VSBuffer } from '../../../../../../../base/common/buffer.js';
import { localize } from '../../../../../../../nls.js';
import { IConfigurationService } from '../../../../../../../platform/configuration/common/configuration.js';
import { IFileService } from '../../../../../../../platform/files/common/files.js';
import { INotificationService } from '../../../../../../../platform/notification/common/notification.js';
import { IWorkspaceContextService } from '../../../../../../../platform/workspace/common/workspace.js';
import { IQuickInputService } from '../../../../../../../platform/quickinput/common/quickInput.js';
import { IClaudeService } from '../../../../common/services/core/claude.js';
import { IClaudeMessage, IAssistantMessage, getAvailableClaudeModels, getModelDisplayName } from '../../../../common/types/claudeTypes.js';
import { ClaudePermissionMode } from '../../../../common/config/claudeLocalConfig.js';

/**
 * SlashCommandHandler가 ChatView에 접근하기 위한 UI 콜백
 */
export interface ISlashCommandUI {
	appendInfoMessage(html: string): void;
	clearMessages(): void;
	appendMessage(message: IClaudeMessage): void;
	scrollToBottom(): void;
	updateWelcomeVisibility(): void;
	renderSessionTabs(): void;
	openSettingsPanel(): void;
}

/**
 * 슬래시 명령어 핸들러
 * ChatView의 /cost, /compact, /help 등 13개 명령어 + 설정 헬퍼를 담당
 */
export class SlashCommandHandler {

	constructor(
		private readonly claudeService: IClaudeService,
		private readonly configurationService: IConfigurationService,
		private readonly fileService: IFileService,
		private readonly workspaceContextService: IWorkspaceContextService,
		private readonly quickInputService: IQuickInputService,
		private readonly notificationService: INotificationService,
		private readonly ui: ISlashCommandUI
	) { }

	// ========== 명령어 디스패처 ==========

	handleBuiltinCommand(commandId: string): void {
		switch (commandId) {
			case 'cost': this.showCostSummary(); break;
			case 'compact': this.compactConversation(); break;
			case 'help': this.showHelp(); break;
			case 'clear': this.clearConversation(); break;
			case 'model': this.showModelPicker(); break;
			case 'config': this.ui.openSettingsPanel(); break;
			case 'context': this.showContext(); break;
			case 'export': this.exportConversation(); break;
			case 'resume': this.resumeSession(); break;
			case 'rename': this.renameSession(); break;
			case 'plan': this.switchToPlanMode(); break;
			case 'agent': this.toggleAgentMode(); break;
			case 'status': this.showStatus(); break;
		}
	}

	// ========== 설정 헬퍼 (StatusBar에서도 사용) ==========

	getPermissionMode(): ClaudePermissionMode {
		const localConfig = this.claudeService.getLocalConfig?.();
		return localConfig?.permissionMode
			?? this.configurationService.getValue<ClaudePermissionMode>('claude.permissionMode')
			?? 'default';
	}

	async cyclePermissionMode(): Promise<void> {
		const modes: ClaudePermissionMode[] = ['default', 'plan', 'accept-edits', 'bypass-permissions'];
		const current = this.getPermissionMode();
		const normalizedCurrent = current === 'bypassPermissions' ? 'bypass-permissions' : current;
		const nextIndex = (modes.indexOf(normalizedCurrent) + 1) % modes.length;
		await this.updateLocalConfigPermissionMode(modes[nextIndex]);
	}

	toggleThinking(): void {
		const current = this.claudeService.isThinkingEnabled?.() ?? false;
		this.claudeService.setSessionThinking?.(!current);
	}

	cycleEffort(): void {
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

	// ========== Private: 명령어 구현 ==========

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

		const statusInfo = this.claudeService.getStatusInfo?.();
		const modelName = statusInfo?.model ? getModelDisplayName(statusInfo.model) : 'Unknown';

		let html = `<strong>Session Cost Summary</strong><br>`;
		html += `Model: ${modelName}<br>`;
		html += `Turns: ${messageCount}<br>`;
		html += `───────────────<br>`;
		html += `Input tokens: ${formatTokens(totalInputTokens)}<br>`;
		html += `Output tokens: ${formatTokens(totalOutputTokens)}<br>`;
		if (totalCacheReadTokens > 0 || totalCacheCreationTokens > 0) {
			html += `<span style="opacity:0.7">  ↳ cache read: ${formatTokens(totalCacheReadTokens)}, create: ${formatTokens(totalCacheCreationTokens)} (included in input)</span><br>`;
		}
		html += `───────────────<br>`;
		if (totalCostUsd > 0) {
			html += `<strong>Total cost: $${totalCostUsd.toFixed(4)}</strong>`;
		} else {
			html += `<strong>Total tokens: ${formatTokens(totalInputTokens + totalOutputTokens)}</strong>`;
		}

		this.ui.appendInfoMessage(html);
	}

	private async compactConversation(): Promise<void> {
		const messages = this.claudeService.getMessages();

		if (messages.length < 4) {
			this.ui.appendInfoMessage(
				localize('compactTooFew', "Not enough messages to compact (minimum 4 messages needed).")
			);
			return;
		}

		const conversationText = messages
			.map(m => `[${m.role}]: ${m.content.substring(0, 500)}${m.content.length > 500 ? '...' : ''}`)
			.join('\n\n');

		const totalTokensBefore = messages
			.filter(m => m.role === 'assistant')
			.reduce((sum, m) => {
				const assistantMsg = m as IAssistantMessage;
				return sum + (assistantMsg.usage?.inputTokens || 0) + (assistantMsg.usage?.outputTokens || 0);
			}, 0);

		this.ui.appendInfoMessage(
			`⏳ ${localize('compacting', "Compacting conversation...")} (${messages.length} messages)`
		);

		try {
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

			this.ui.appendInfoMessage(
				`✅ ${localize('compactDone', "Conversation compacted")} — ${messages.length} messages summarized. Previous tokens: ${formatTokens(totalTokensBefore)}`
			);
		} catch (error) {
			this.ui.appendInfoMessage(
				`❌ ${localize('compactError', "Compact failed: {0}", String(error))}`
			);
		}
	}

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

		this.ui.appendInfoMessage(html);
	}

	private clearConversation(): void {
		const messages = this.claudeService.getMessages();
		if (messages.length === 0) {
			this.ui.appendInfoMessage(
				localize('clearEmpty', "Conversation is already empty.")
			);
			return;
		}

		this.ui.clearMessages();
		this.claudeService.clearMessages?.();

		this.ui.appendInfoMessage(
			`✅ ${localize('clearDone', "Conversation cleared")} — ${messages.length} messages removed.`
		);
	}

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
			this.ui.appendInfoMessage(
				`✅ ${localize('modelChanged', "Model changed to {0}", displayName)}`
			);
		}
	}

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
		const maxContext = 200000;
		const usagePercent = Math.min(100, (totalInputTokens / maxContext) * 100);

		const barLength = 20;
		const filledLength = Math.round((usagePercent / 100) * barLength);
		const bar = '█'.repeat(filledLength) + '░'.repeat(barLength - filledLength);

		let html = `<strong>Context Usage</strong><br>`;
		html += `Model: ${statusInfo?.model ? getModelDisplayName(statusInfo.model) : 'Unknown'}<br>`;
		html += `───────────────<br>`;
		html += `[${bar}] ${usagePercent.toFixed(1)}%<br>`;
		html += `Input: ${formatTokens(totalInputTokens)} / ${formatTokens(maxContext)}<br>`;
		html += `Output: ${formatTokens(totalOutputTokens)}<br>`;
		if (totalCacheReadTokens > 0 || totalCacheCreationTokens > 0) {
			html += `<span style="opacity:0.7">  ↳ cache read: ${formatTokens(totalCacheReadTokens)}, create: ${formatTokens(totalCacheCreationTokens)} (included in input)</span><br>`;
		}
		html += `Total: ${formatTokens(totalTokens)}<br>`;
		html += `Messages: ${messages.length}`;

		this.ui.appendInfoMessage(html);
	}

	private async exportConversation(): Promise<void> {
		const messages = this.claudeService.getMessages();

		if (messages.length === 0) {
			this.ui.appendInfoMessage(
				localize('exportEmpty', "No messages to export.")
			);
			return;
		}

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
			this.ui.appendInfoMessage(
				`✅ ${localize('exportDone', "Conversation exported to clipboard")} — ${messages.length} messages`
			);
		} catch {
			this.ui.appendInfoMessage(
				`❌ ${localize('exportFailed', "Failed to copy to clipboard")}`
			);
		}
	}

	private async resumeSession(): Promise<void> {
		const sessions = this.claudeService.getSessions();

		if (sessions.length <= 1) {
			this.ui.appendInfoMessage(
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
			this.ui.clearMessages();

			const messages = this.claudeService.getMessages();
			for (const msg of messages) {
				this.ui.appendMessage(msg);
			}

			this.ui.updateWelcomeVisibility();
			this.ui.appendInfoMessage(
				`✅ ${localize('resumeDone', "Resumed session: {0}", (picked as { label: string }).label)}`
			);
		}
	}

	private async renameSession(): Promise<void> {
		const currentSession = this.claudeService.getCurrentSession?.();

		if (!currentSession) {
			this.ui.appendInfoMessage(
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
				this.ui.appendInfoMessage(
					`✅ ${localize('renameDone', "Session renamed to \"{0}\"", newName.trim())}`
				);
			}
		}
	}

	private async switchToPlanMode(): Promise<void> {
		const currentMode = this.getPermissionMode();

		if (currentMode === 'plan') {
			this.ui.appendInfoMessage(
				localize('alreadyPlanMode', "Already in Plan mode.")
			);
			return;
		}

		await this.updateLocalConfigPermissionMode('plan');

		this.ui.appendInfoMessage(
			`✅ ${localize('planMode', "Switched to Plan mode")} — Claude will show plans before executing.`
		);
	}

	private async toggleAgentMode(): Promise<void> {
		const currentMode = this.getPermissionMode();
		const isAgent = currentMode === 'bypass-permissions' || currentMode === 'bypassPermissions';

		if (isAgent) {
			await this.updateLocalConfigPermissionMode('default');
			this.ui.appendInfoMessage(
				`✅ ${localize('agentModeOff', "Agent mode OFF")} — Switched to Default mode.`
			);
		} else {
			await this.updateLocalConfigPermissionMode('bypass-permissions');
			this.ui.appendInfoMessage(
				`⚡ ${localize('agentModeOn', "Agent mode ON")} — Claude will autonomously edit files and run commands.`
			);
		}
	}

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

		const permMode = this.getPermissionMode();
		const permModeDisplay = (permMode === 'bypass-permissions' || permMode === 'bypassPermissions') ? 'Agent' :
			permMode === 'accept-edits' ? 'Accept-Edits' :
				permMode === 'plan' ? 'Plan' : 'Default';
		html += `<strong>Mode:</strong> ${permModeDisplay}<br>`;

		const thinkingEnabled = this.claudeService.isThinkingEnabled?.() || false;
		html += `<strong>Thinking:</strong> ${thinkingEnabled ? 'ON' : 'OFF'}<br>`;

		const effort = this.claudeService.getSessionEffort?.();
		html += `<strong>Effort:</strong> ${effort || 'Auto'}<br>`;

		this.ui.appendInfoMessage(html);
	}

	// ========== Private: 설정 파일 업데이트 ==========

	private async updateLocalConfigPermissionMode(mode: ClaudePermissionMode): Promise<void> {
		const workspaceFolder = this.workspaceContextService.getWorkspace().folders[0];
		if (!workspaceFolder) {
			return;
		}

		const configPath = URI.joinPath(workspaceFolder.uri, '.vscode', 'claude.local.json');

		try {
			let config: Record<string, unknown> = {};
			try {
				const content = await this.fileService.readFile(configPath);
				config = JSON.parse(content.value.toString());
			} catch {
				// 파일이 없으면 빈 객체로 시작
			}

			config['permissionMode'] = mode;

			const newContent = JSON.stringify(config, null, '\t');
			await this.fileService.writeFile(configPath, VSBuffer.fromString(newContent));

			await this.claudeService.reloadLocalConfig?.();
		} catch (error) {
			this.notificationService.error(
				localize('failedToUpdatePermissionMode', "Failed to update permission mode: {0}", String(error))
			);
		}
	}
}

// ========== Shared Utility ==========

function formatTokens(n: number): string {
	if (n >= 1_000_000) { return `${(n / 1_000_000).toFixed(1)}M`; }
	if (n >= 1_000) { return `${(n / 1_000).toFixed(1)}K`; }
	return String(n);
}
