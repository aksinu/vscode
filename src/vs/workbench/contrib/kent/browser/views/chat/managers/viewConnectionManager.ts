/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../../../../nls.js';
import { IClaudeService } from '../../../../common/services/core/claude.js';
import { INotificationService, Severity } from '../../../../../../../platform/notification/common/notification.js';
import { ConnectionOverlay } from '../../ui/claudeConnectionOverlay.js';

export interface IViewConnectionManagerCallbacks {
	setInputEnabled: (enabled: boolean) => void;
}

/**
 * 연결 상태 UI 관리 매니저
 * 책임: 연결 초기화, 재시도, 에러 처리, 오버레이 표시
 */
export class ViewConnectionManager {

	constructor(
		private readonly connectionOverlay: ConnectionOverlay,
		private readonly claudeService: IClaudeService,
		private readonly notificationService: INotificationService,
		private readonly callbacks: IViewConnectionManagerCallbacks
	) {}

	/**
	 * Claude CLI 연결 초기화
	 * 최대 3회 자동 재시도, 실패 시 수동 재시도 버튼 표시
	 */
	async initializeConnection(): Promise<void> {
		const maxRetries = this.connectionOverlay.maxRetries;

		// 연결 시도
		this.connectionOverlay.setConnecting();

		for (let attempt = 1; attempt <= maxRetries; attempt++) {
			// 재시도 상태 표시 (첫 시도 제외)
			if (attempt > 1) {
				this.connectionOverlay.setRetrying(attempt);
				// 재시도 전 잠시 대기
				await new Promise(resolve => setTimeout(resolve, 1000));
			}

			try {
				const connected = await this.claudeService.checkConnection?.() ?? false;

				if (connected) {
					// 연결 성공
					this.connectionOverlay.setConnected();
					this.callbacks.setInputEnabled(true);
					return;
				}
			} catch (error) {
				// 에러 발생 - 계속 재시도
			}

			// 마지막 시도가 아니면 계속
			if (attempt < maxRetries) {
				continue;
			}
		}

		// 모든 재시도 실패 - 수동 재시도 버튼 표시
		this.connectionOverlay.setFailed(
			localize('connectionFailedDetail', "Could not connect to Claude CLI.\nMake sure Claude CLI is installed and you are logged in.\nRun 'claude login' in terminal.")
		);
	}

	/**
	 * 연결 끊김 처리
	 * CLI 세션이 비정상 종료되었을 때 호출
	 */
	handleConnectionLost(): void {
		// 입력 비활성화
		this.callbacks.setInputEnabled(false);

		// 연결 상태 정보 가져오기
		const errorMessage = (this.claudeService as any).connection?.error
			|| (this.claudeService as any)._multiConnection?.error
			|| '';

		// 에러 유형에 따른 메시지 결정
		let notificationMessage: string;
		let detailMessage: string;

		if (errorMessage.includes('rate') || errorMessage.includes('429') || errorMessage.includes('quota')) {
			// Rate limit 에러 (이 경우는 rate limit 매니저가 처리하지만 fallback)
			notificationMessage = localize('rateLimitError', "API rate limit exceeded.");
			detailMessage = localize('rateLimitDetail', "Please wait a moment before retrying.");
		} else if (errorMessage.includes('auth') || errorMessage.includes('login') || errorMessage.includes('401')) {
			// 인증 에러
			notificationMessage = localize('authError', "Authentication failed.");
			detailMessage = localize('authDetail', "Please run 'claude login' in terminal.");
		} else if (errorMessage.includes('exit') && errorMessage.includes('1')) {
			// CLI exit code 1
			notificationMessage = localize('cliExitError', "Claude CLI session terminated unexpectedly.");
			detailMessage = localize('cliExitDetail', "The CLI process exited with an error.");
		} else {
			// 일반 에러
			notificationMessage = localize('connectionLost', "Claude CLI session terminated unexpectedly.");
			detailMessage = errorMessage || localize('unknownError', "Unknown error occurred.");
		}

		// 연결 오버레이 표시
		this.connectionOverlay.setFailed(detailMessage);

		// 알림 표시 (액션 버튼 포함)
		this.notificationService.prompt(
			Severity.Warning,
			notificationMessage,
			[
				{
					label: localize('reconnect', "Reconnect"),
					run: () => this.initializeConnection()
				}
			]
		);
	}
}
