/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, append, addDisposableListener, EventType } from '../../../../../base/browser/dom.js';
import { Disposable, IDisposable } from '../../../../../base/common/lifecycle.js';
import { localize } from '../../../../../nls.js';
import { IClaudeStatusInfo } from '../../common/claudeTypes.js';

/**
 * StatusBarManager 콜백 인터페이스
 */
export interface IStatusBarCallbacks {
	getStatusInfo(): IClaudeStatusInfo | undefined;
	checkConnection(): Promise<boolean>;
	toggleUltrathink(): Promise<void>;
	openLocalSettings(): Promise<void>;
	openSessionSettings(): void;
	registerDisposable<T extends IDisposable>(disposable: T): T;
}

/**
 * 상태 바 매니저
 * Claude 연결 상태, 모델, 설정 등을 표시하고 관리
 */
export class StatusBarManager extends Disposable {

	private container: HTMLElement;
	private ultrathinkButton: HTMLButtonElement | undefined;

	constructor(
		container: HTMLElement,
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
		// 모델 표시 제거 - CLI에서 현재 모델을 알 수 없어 불확실한 정보 표시 방지
		// this.updateModel(status);
		this.updateExecutionMethod(status);
		this.updateUltrathink(status);
	}

	// ========== Private Methods ==========

	private createStatusBar(): void {
		// Ultrathink 토글 버튼 (좌측)
		this.ultrathinkButton = append(this.container, $('button.claude-ultrathink-toggle')) as HTMLButtonElement;
		this.ultrathinkButton.title = localize('toggleUltrathink', "Toggle Ultrathink mode");
		const ultrathinkIcon = append(this.ultrathinkButton, $('span.codicon.codicon-lightbulb'));
		ultrathinkIcon.setAttribute('aria-hidden', 'true');
		const ultrathinkText = append(this.ultrathinkButton, $('span.claude-ultrathink-text'));
		ultrathinkText.textContent = 'Ultrathink';

		this.callbacks.registerDisposable(addDisposableListener(this.ultrathinkButton, EventType.CLICK, async () => {
			await this.callbacks.toggleUltrathink();
		}));

		// 구분자
		append(this.container, $('.claude-status-separator'));

		// 연결 상태
		const connectionStatus = append(this.container, $('.claude-status-item.connection'));
		const connectionIcon = append(connectionStatus, $('.claude-status-icon'));
		connectionIcon.classList.add('codicon', 'codicon-circle-filled');
		const connectionText = append(connectionStatus, $('.claude-status-text'));
		connectionText.textContent = 'Checking...';

		// 구분자
		append(this.container, $('.claude-status-separator'));

		// 실행 방식
		const execStatus = append(this.container, $('.claude-status-item.execution'));
		const execText = append(execStatus, $('.claude-status-text'));
		execText.textContent = 'CLI';

		// 설정 버튼 (오른쪽)
		const settingsButton = append(this.container, $('button.claude-status-settings'));
		settingsButton.title = localize('sessionSettings', "Session Settings");
		append(settingsButton, $('.codicon.codicon-settings-gear'));

		this.callbacks.registerDisposable(addDisposableListener(settingsButton, EventType.CLICK, () => {
			this.callbacks.openSessionSettings();
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

	private updateUltrathink(status: IClaudeStatusInfo): void {
		if (this.ultrathinkButton) {
			this.ultrathinkButton.classList.toggle('active', status.ultrathink);
			this.ultrathinkButton.title = status.ultrathink
				? localize('ultrathinkOn', "Ultrathink ON - Click to disable")
				: localize('ultrathinkOff', "Ultrathink OFF - Click to enable");
		}
	}

}
