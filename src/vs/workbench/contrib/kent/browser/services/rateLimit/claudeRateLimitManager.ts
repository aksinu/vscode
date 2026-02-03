/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../../../../base/common/event.js';
import { Disposable } from '../../../../../base/common/lifecycle.js';
import { IClaudeRateLimitInfo, IClaudeCLIRequestOptions } from '../../common/claudeCLI.js';
import { IClaudeLogService } from '../../common/claudeLogService.js';

/**
 * Rate limit 상태 변경 이벤트
 */
export interface IRateLimitStatusEvent {
	waiting: boolean;
	countdown: number;
	message?: string;
	lastUpdateTime?: number; // UI에서 로컬 카운트다운을 위한 타임스탬프
}

/**
 * 재시도 요청 정보
 */
export interface IPendingRetryRequest {
	prompt: string;
	options?: IClaudeCLIRequestOptions;
}

/**
 * RateLimitManager 콜백 인터페이스
 */
export interface IRateLimitManagerCallbacks {
	onRetry(request: IPendingRetryRequest): Promise<void>;
	onUpdateMessage(content: string, isStreaming: boolean): void;
	onStateChange(state: 'idle' | 'retrying'): void;
}

/**
 * Rate Limit 관리자
 * API rate limit 감지, 카운트다운, 자동 재시도를 처리
 */
export class RateLimitManager extends Disposable {

	private static readonly LOG_CATEGORY = 'RateLimitManager';

	private _rateLimitInfo: IClaudeRateLimitInfo | undefined;
	private _retryTimer: ReturnType<typeof setTimeout> | undefined;
	private _retryCountdown = 0;
	private _pendingRetryRequest: IPendingRetryRequest | undefined;
	private _retryCountdownInterval: ReturnType<typeof setInterval> | undefined;

	private readonly _onDidChangeStatus = this._register(new Emitter<IRateLimitStatusEvent>());
	readonly onDidChangeStatus: Event<IRateLimitStatusEvent> = this._onDidChangeStatus.event;

	constructor(
		private readonly callbacks: IRateLimitManagerCallbacks,
		private readonly logService: IClaudeLogService
	) {
		super();
	}

	/**
	 * Rate limit 에러인지 확인
	 */
	isRateLimitError(error: string): boolean {
		return /rate[_\s]?limit/i.test(error) ||
			/too many requests/i.test(error) ||
			/429/i.test(error) ||
			/quota exceeded/i.test(error) ||
			/token.*exhaust/i.test(error);
	}

	/**
	 * 에러 메시지에서 재시도 시간 파싱
	 */
	parseRetrySeconds(error: string): number | null {
		const match = error.match(/(?:retry|try again|wait).*?(\d+)\s*(second|minute|hour|sec|min|hr)/i);
		if (match) {
			const value = parseInt(match[1], 10);
			const unit = match[2].toLowerCase();
			if (unit.startsWith('min')) {
				return value * 60;
			} else if (unit.startsWith('hour') || unit.startsWith('hr')) {
				return value * 3600;
			}
			return value;
		}
		return null;
	}

	/**
	 * Rate limit 처리 시작
	 */
	handleRateLimit(retryAfterSeconds: number, pendingRequest: IPendingRetryRequest, message?: string): void {
		this.logService.debug(RateLimitManager.LOG_CATEGORY, 'Starting retry timer:', retryAfterSeconds, 'seconds');
		this.logService.debug(RateLimitManager.LOG_CATEGORY, 'Message:', message);

		this._pendingRetryRequest = pendingRequest;

		// 초기 메시지 업데이트
		this.callbacks.onUpdateMessage(
			`⏳ Rate limit reached. Waiting ${this.formatWaitTime(retryAfterSeconds)} before retrying...\n\n${message || ''}`,
			true
		);

		// 카운트다운 시작
		this._retryCountdown = retryAfterSeconds;
		this._rateLimitInfo = {
			isRateLimited: true,
			retryAfterSeconds,
			message
		};

		this._onDidChangeStatus.fire({
			waiting: true,
			countdown: this._retryCountdown,
			message
		});

		// 기존 타이머 정리
		this.clearTimers();

		// 카운트다운 인터벌 최적화 (5초마다 이벤트 발생으로 성능 향상)
		// UI는 로컬에서 매초 업데이트를 처리하고, 서비스는 5초마다만 상태 동기화
		const COUNTDOWN_UPDATE_INTERVAL = 5000; // 5초
		let countdownTicks = 0;

		this._retryCountdownInterval = setInterval(() => {
			this._retryCountdown -= 5; // 5초씩 감소
			countdownTicks++;

			// 최소 0으로 제한
			if (this._retryCountdown < 0) {
				this._retryCountdown = 0;
			}

			this.logService.debug(RateLimitManager.LOG_CATEGORY, 'Countdown (5s interval):', this._retryCountdown);

			// 메시지 업데이트 (5초마다만)
			this.callbacks.onUpdateMessage(
				`⏳ Rate limit reached. Retrying in ${this.formatWaitTime(this._retryCountdown)}...\n\n${message || ''}`,
				true
			);

			// 상태 이벤트 발생 (5초마다만)
			this._onDidChangeStatus.fire({
				waiting: true,
				countdown: this._retryCountdown,
				message,
				// UI가 로컬 카운트다운을 처리할 수 있도록 시작 시간 추가
				lastUpdateTime: Date.now()
			});

			// 카운트다운 완료 체크
			if (this._retryCountdown <= 0) {
				if (this._retryCountdownInterval) {
					clearInterval(this._retryCountdownInterval);
					this._retryCountdownInterval = undefined;
				}
			}
		}, COUNTDOWN_UPDATE_INTERVAL);

		// 재시도 타이머
		this._retryTimer = setTimeout(() => {
			this.logService.debug(RateLimitManager.LOG_CATEGORY, 'Timer expired, attempting retry...');
			this.executeRetry();
		}, retryAfterSeconds * 1000);
	}

	/**
	 * Rate limit 대기 취소
	 */
	cancel(): void {
		this.logService.debug(RateLimitManager.LOG_CATEGORY, 'Cancelling wait');

		this.clearTimers();

		this._rateLimitInfo = undefined;
		this._pendingRetryRequest = undefined;
		this._retryCountdown = 0;

		this._onDidChangeStatus.fire({
			waiting: false,
			countdown: 0
		});

		this.callbacks.onStateChange('idle');
	}

	/**
	 * Rate limit 상태 정보
	 */
	get info(): IClaudeRateLimitInfo | undefined {
		return this._rateLimitInfo;
	}

	/**
	 * Rate limit 대기 중인지 여부
	 */
	get isWaiting(): boolean {
		return this._rateLimitInfo?.isRateLimited ?? false;
	}

	/**
	 * 현재 카운트다운 값
	 */
	get countdown(): number {
		return this._retryCountdown;
	}

	override dispose(): void {
		this.clearTimers();
		super.dispose();
	}

	// ========== Private Methods ==========

	private async executeRetry(): Promise<void> {
		this.logService.debug(RateLimitManager.LOG_CATEGORY, 'Retrying...');

		// 타이머 정리
		this._rateLimitInfo = undefined;
		this.clearTimers();

		this._onDidChangeStatus.fire({
			waiting: false,
			countdown: 0
		});

		if (!this._pendingRetryRequest) {
			this.logService.debug(RateLimitManager.LOG_CATEGORY, 'No pending request to retry');
			this.callbacks.onStateChange('idle');
			return;
		}

		const request = this._pendingRetryRequest;
		this._pendingRetryRequest = undefined;

		this.logService.debug(RateLimitManager.LOG_CATEGORY, 'Retrying prompt:', request.prompt.substring(0, 100));

		// 재시도 중 메시지
		this.callbacks.onUpdateMessage('🔄 Retrying request...', true);
		this.callbacks.onStateChange('retrying');

		try {
			await this.callbacks.onRetry(request);
			this.logService.debug(RateLimitManager.LOG_CATEGORY, 'Retry successful');
		} catch (error) {
			this.logService.error(RateLimitManager.LOG_CATEGORY, 'Retry failed:', error);
		}
	}

	private clearTimers(): void {
		if (this._retryTimer) {
			clearTimeout(this._retryTimer);
			this._retryTimer = undefined;
		}
		if (this._retryCountdownInterval) {
			clearInterval(this._retryCountdownInterval);
			this._retryCountdownInterval = undefined;
		}
	}

	private formatWaitTime(seconds: number): string {
		if (seconds < 60) {
			return `${seconds} seconds`;
		} else if (seconds < 3600) {
			const mins = Math.floor(seconds / 60);
			const secs = seconds % 60;
			return secs > 0 ? `${mins}m ${secs}s` : `${mins} minutes`;
		} else {
			const hours = Math.floor(seconds / 3600);
			const mins = Math.floor((seconds % 3600) / 60);
			return mins > 0 ? `${hours}h ${mins}m` : `${hours} hours`;
		}
	}
}
