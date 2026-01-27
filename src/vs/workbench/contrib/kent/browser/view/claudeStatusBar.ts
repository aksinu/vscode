/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, append, addDisposableListener, EventType } from '../../../../../base/browser/dom.js';
import { Disposable, IDisposable } from '../../../../../base/common/lifecycle.js';
import { localize } from '../../../../../nls.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { IQuickInputService, IQuickPickItem } from '../../../../../platform/quickinput/common/quickInput.js';
import { INotificationService } from '../../../../../platform/notification/common/notification.js';
import { IClaudeStatusInfo } from '../../common/claudeTypes.js';

/**
 * StatusBarManager 콜백 인터페이스
 */
export interface IStatusBarCallbacks {
	getStatusInfo(): IClaudeStatusInfo | undefined;
	checkConnection(): Promise<boolean>;
	toggleExtendedThinking(): Promise<void>;
	openLocalSettings(): Promise<void>;
	registerDisposable<T extends IDisposable>(disposable: T): T;
}

/**
 * 상태 바 매니저
 * Claude 연결 상태, 모델, 설정 등을 표시하고 관리
 */
export class StatusBarManager extends Disposable {

	private container: HTMLElement;

	constructor(
		container: HTMLElement,
		private readonly configurationService: IConfigurationService,
		private readonly quickInputService: IQuickInputService,
		private readonly notificationService: INotificationService,
		private readonly callbacks: IStatusBarCallbacks
	) {
		super();
		this.container = container;
		this.createStatusBar();
	}

	/**
	 * 상태 바 업데이트
	 */
	update(status: IClaudeStatusInfo): void {
		this.updateConnectionStatus(status);
		this.updateModel(status);
		this.updateExecutionMethod(status);
	}

	// ========== Private Methods ==========

	private createStatusBar(): void {
		// 연결 상태
		const connectionStatus = append(this.container, $('.claude-status-item.connection'));
		const connectionIcon = append(connectionStatus, $('.claude-status-icon'));
		connectionIcon.classList.add('codicon', 'codicon-circle-filled');
		const connectionText = append(connectionStatus, $('.claude-status-text'));
		connectionText.textContent = 'Checking...';

		// 구분자
		append(this.container, $('.claude-status-separator'));

		// 모델
		const modelStatus = append(this.container, $('.claude-status-item.model'));
		const modelText = append(modelStatus, $('.claude-status-text'));
		modelText.textContent = 'Loading...';

		// 구분자
		append(this.container, $('.claude-status-separator'));

		// 실행 방식
		const execStatus = append(this.container, $('.claude-status-item.execution'));
		const execText = append(execStatus, $('.claude-status-text'));
		execText.textContent = 'CLI';

		// 설정 버튼 (오른쪽)
		const settingsButton = append(this.container, $('button.claude-status-settings'));
		settingsButton.title = localize('openSettings', "Open Settings");
		append(settingsButton, $('.codicon.codicon-settings-gear'));

		this.callbacks.registerDisposable(addDisposableListener(settingsButton, EventType.CLICK, () => {
			this.showSettingsQuickPick();
		}));

		// 초기 상태 업데이트
		const initialStatus = this.callbacks.getStatusInfo();
		if (initialStatus) {
			this.update(initialStatus);
		}
	}

	private updateConnectionStatus(status: IClaudeStatusInfo): void {
		const connectionItem = this.container.querySelector('.claude-status-item.connection');
		if (!connectionItem) return;

		const icon = connectionItem.querySelector('.claude-status-icon');
		const text = connectionItem.querySelector('.claude-status-text');

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

	private updateModel(status: IClaudeStatusInfo): void {
		const modelItem = this.container.querySelector('.claude-status-item.model .claude-status-text');
		if (modelItem) {
			// 모델명 축약 (claude-sonnet-4-xxx -> sonnet-4)
			const shortModel = status.model.replace(/^claude-/, '').replace(/-\d{8}$/, '');
			modelItem.textContent = shortModel;
		}
	}

	private updateExecutionMethod(status: IClaudeStatusInfo): void {
		const execItem = this.container.querySelector('.claude-status-item.execution .claude-status-text');
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
		const status = this.callbacks.getStatusInfo() || {
			connectionStatus: 'disconnected',
			model: 'unknown',
			extendedThinking: false,
			executionMethod: 'cli'
		} as IClaudeStatusInfo;

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

		if (!selected) return;

		const selectedItem = selected as ISettingsQuickPickItem;

		switch (selectedItem.id) {
			case 'changeModel':
				await this.showModelPicker();
				break;

			case 'testConnection':
				this.notificationService.info(localize('testingConnection', "Testing connection..."));
				const connected = await this.callbacks.checkConnection();
				if (connected) {
					this.notificationService.info(localize('connectionSuccess', "Connection successful!"));
				} else {
					this.notificationService.error(localize('connectionFailed', "Connection failed. Make sure Claude CLI is installed."));
				}
				break;

			case 'toggleThinking':
				await this.callbacks.toggleExtendedThinking();
				const newStatus = this.callbacks.getStatusInfo();
				this.notificationService.info(
					localize('thinkingToggled', "Extended Thinking: {0}", newStatus?.extendedThinking ? 'ON' : 'OFF')
				);
				break;

			case 'configureScript':
			case 'openJson':
				await this.callbacks.openLocalSettings();
				break;
		}
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
			const status = this.callbacks.getStatusInfo();
			if (status) {
				this.update({ ...status, model: newModel });
			}
		}
	}
}
