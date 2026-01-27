/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, append } from '../../../../../base/browser/dom.js';
import { Disposable } from '../../../../../base/common/lifecycle.js';
import { localize } from '../../../../../nls.js';
import { Button } from '../../../../../base/browser/ui/button/button.js';
import { defaultButtonStyles } from '../../../../../platform/theme/browser/defaultStyles.js';

/**
 * 연결 상태
 */
export type ConnectionOverlayState = 'connecting' | 'retrying' | 'failed' | 'connected';

/**
 * 연결 오버레이 콜백
 */
export interface IConnectionOverlayCallbacks {
	onRetry(): void;
}

/**
 * 연결 오버레이
 * 채팅창 초기화 중 연결 상태를 표시하고 UI를 비활성화
 */
export class ConnectionOverlay extends Disposable {

	private readonly overlay: HTMLElement;
	private readonly statusIcon: HTMLElement;
	private readonly statusText: HTMLElement;
	private readonly detailText: HTMLElement;
	private readonly retryButton: Button;

	private _state: ConnectionOverlayState = 'connecting';
	private _retryCount = 0;
	private _maxRetries = 3;

	constructor(
		container: HTMLElement,
		private readonly callbacks: IConnectionOverlayCallbacks
	) {
		super();

		// 오버레이 컨테이너
		this.overlay = append(container, $('.claude-connection-overlay'));

		// 내용 영역
		const content = append(this.overlay, $('.claude-connection-overlay-content'));

		// 상태 아이콘
		this.statusIcon = append(content, $('.claude-connection-icon'));
		this.statusIcon.classList.add('codicon', 'codicon-loading', 'codicon-modifier-spin');

		// 상태 텍스트
		this.statusText = append(content, $('.claude-connection-status'));
		this.statusText.textContent = localize('connecting', "Connecting to Claude...");

		// 상세 텍스트
		this.detailText = append(content, $('.claude-connection-detail'));
		this.detailText.textContent = '';

		// 재시도 버튼
		const buttonContainer = append(content, $('.claude-connection-button'));
		this.retryButton = this._register(new Button(buttonContainer, defaultButtonStyles));
		this.retryButton.label = localize('retry', "Retry Connection");
		this.retryButton.element.style.display = 'none';

		this._register(this.retryButton.onDidClick(() => {
			this.callbacks.onRetry();
		}));
	}

	/**
	 * 현재 상태
	 */
	get state(): ConnectionOverlayState {
		return this._state;
	}

	/**
	 * 재시도 횟수
	 */
	get retryCount(): number {
		return this._retryCount;
	}

	/**
	 * 최대 재시도 횟수
	 */
	get maxRetries(): number {
		return this._maxRetries;
	}

	/**
	 * 연결 시도 중 상태로 변경
	 */
	setConnecting(): void {
		this._state = 'connecting';
		this.updateUI();
	}

	/**
	 * 재시도 중 상태로 변경
	 */
	setRetrying(attempt: number): void {
		this._state = 'retrying';
		this._retryCount = attempt;
		this.updateUI();
	}

	/**
	 * 연결 실패 상태로 변경
	 */
	setFailed(error?: string): void {
		this._state = 'failed';
		this.updateUI(error);
	}

	/**
	 * 연결 성공 - 오버레이 숨김
	 */
	setConnected(): void {
		this._state = 'connected';
		this._retryCount = 0;
		this.hide();
	}

	/**
	 * 오버레이 표시
	 */
	show(): void {
		this.overlay.style.display = 'flex';
	}

	/**
	 * 오버레이 숨김
	 */
	hide(): void {
		this.overlay.style.display = 'none';
	}

	/**
	 * 재시도 횟수 초기화
	 */
	resetRetryCount(): void {
		this._retryCount = 0;
	}

	/**
	 * UI 업데이트
	 */
	private updateUI(error?: string): void {
		// 아이콘 클래스 초기화
		this.statusIcon.classList.remove(
			'codicon-loading', 'codicon-modifier-spin',
			'codicon-error', 'codicon-check'
		);

		switch (this._state) {
			case 'connecting':
				this.statusIcon.classList.add('codicon-loading', 'codicon-modifier-spin');
				this.statusText.textContent = localize('connecting', "Connecting to Claude...");
				this.detailText.textContent = localize('checkingCLI', "Checking Claude CLI installation...");
				this.retryButton.element.style.display = 'none';
				this.show();
				break;

			case 'retrying':
				this.statusIcon.classList.add('codicon-loading', 'codicon-modifier-spin');
				this.statusText.textContent = localize('retrying', "Retrying connection...");
				this.detailText.textContent = localize('retryAttempt', "Attempt {0} of {1}", this._retryCount, this._maxRetries);
				this.retryButton.element.style.display = 'none';
				this.show();
				break;

			case 'failed':
				this.statusIcon.classList.add('codicon-error');
				this.statusText.textContent = localize('connectionFailed', "Connection Failed");
				this.detailText.textContent = error || localize('checkCLI', "Make sure Claude CLI is installed and you are logged in.\nRun 'claude login' in terminal.");
				this.retryButton.element.style.display = 'block';
				this.show();
				break;

			case 'connected':
				this.hide();
				break;
		}
	}
}
