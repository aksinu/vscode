/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IClaudeRateLimitService, IRateLimitStatus, IRateLimitPendingRequest, IRateLimitCallbacks } from '../../../common/types/claudeRateLimitService.js';
import { Emitter, Event } from '../../../../../../base/common/event.js';
import { Disposable } from '../../../../../../base/common/lifecycle.js';
import { ILogService } from '../../../../../../platform/log/common/log.js';

/**
 * Rate limit service implementation
 */
export class ClaudeRateLimitService extends Disposable implements IClaudeRateLimitService {
	declare readonly _serviceBrand: undefined;

	private readonly _onDidChangeStatus = this._register(new Emitter<IRateLimitStatus>());
	readonly onDidChangeStatus: Event<IRateLimitStatus> = this._onDidChangeStatus.event;

	private _waiting = false;
	private _countdown = 0;
	private _message?: string;
	private _countdownTimer?: ReturnType<typeof setInterval> | undefined;
	private _pendingRequest?: IRateLimitPendingRequest;
	private _callbacks?: IRateLimitCallbacks;

	constructor(
		@ILogService private readonly logService: ILogService
	) {
		super();
	}

	/**
	 * Set delegate callbacks from core service
	 */
	setCoreRateLimitDelegates(callbacks: IRateLimitCallbacks): void {
		this._callbacks = callbacks;
	}

	/**
	 * Handle rate limit error
	 */
	handleRateLimit(retryAfterSeconds: number, pendingRequest: IRateLimitPendingRequest, message?: string): void {
		this.logService.info('ClaudeRateLimitService', `Rate limit triggered: ${retryAfterSeconds}s`, message);

		this._waiting = true;
		this._countdown = retryAfterSeconds;
		this._message = message;
		this._pendingRequest = pendingRequest;

		this._fireStatusChange();
		this._startCountdown();
	}

	/**
	 * Cancel rate limit wait
	 */
	cancelRateLimitWait(): void {
		this.logService.info('ClaudeRateLimitService', 'Rate limit wait cancelled');

		this._clearCountdown();
		this._waiting = false;
		this._countdown = 0;
		this._message = undefined;
		this._pendingRequest = undefined;

		this._fireStatusChange();
	}

	/**
	 * Get current rate limit status
	 */
	getRateLimitStatus(): IRateLimitStatus {
		return {
			waiting: this._waiting,
			countdown: this._countdown,
			message: this._message
		};
	}

	/**
	 * Check if error is a rate limit error
	 */
	isRateLimitError(error: any): boolean {
		if (!error) {
			return false;
		}

		// Check for 429 status code
		if (error.status === 429 || error.statusCode === 429) {
			return true;
		}

		// Check for rate limit keywords in error message
		const errorMessage = (error.message || error.toString()).toLowerCase();
		return errorMessage.includes('rate limit') ||
			   errorMessage.includes('too many requests') ||
			   errorMessage.includes('quota exceeded');
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
	 * Start countdown timer
	 */
	private _startCountdown(): void {
		this._clearCountdown();

		this._countdownTimer = setInterval(() => {
			this._countdown--;
			this._fireStatusChange();

			if (this._countdown <= 0) {
				this._handleCountdownComplete();
			}
		}, 1000);
	}

	/**
	 * Clear countdown timer
	 */
	private _clearCountdown(): void {
		if (this._countdownTimer) {
			clearInterval(this._countdownTimer);
			this._countdownTimer = undefined;
		}
	}

	/**
	 * Handle countdown completion
	 */
	private _handleCountdownComplete(): void {
		this.logService.info('ClaudeRateLimitService', 'Rate limit countdown completed, retrying request');

		this._clearCountdown();
		this._waiting = false;
		this._countdown = 0;

		const pendingRequest = this._pendingRequest;

		this._pendingRequest = undefined;
		this._message = undefined;

		this._fireStatusChange();

		// Retry the pending request
		if (pendingRequest && this._callbacks?.retryPendingRequest) {
			this._callbacks.retryPendingRequest(pendingRequest);
		}
	}

	/**
	 * Fire status change event
	 */
	private _fireStatusChange(): void {
		this._onDidChangeStatus.fire({
			waiting: this._waiting,
			countdown: this._countdown,
			message: this._message
		});
	}

	override dispose(): void {
		this._clearCountdown();
		super.dispose();
	}
}