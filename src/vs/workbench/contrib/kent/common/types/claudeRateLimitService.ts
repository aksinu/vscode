/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../../base/common/event.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { IClaudeCLIRequestOptions } from '../claudeCLI.js';

export interface IRateLimitStatus {
	waiting: boolean;
	countdown: number;
	message?: string;
}

export interface IRateLimitPendingRequest {
	prompt: string;
	options?: IClaudeCLIRequestOptions;
}

export const IClaudeRateLimitService = createDecorator<IClaudeRateLimitService>('claudeRateLimitService');

export interface IRateLimitCallbacks {
	retryPendingRequest: (request: IRateLimitPendingRequest) => Promise<void>;
}

export interface IClaudeRateLimitService {
	readonly _serviceBrand: undefined;

	// Events
	readonly onDidChangeStatus: Event<IRateLimitStatus>;

	// Delegate Setup
	setCoreRateLimitDelegates(callbacks: IRateLimitCallbacks): void;

	// Rate Limit Detection
	isRateLimitError(error: any): boolean;

	// Rate Limit Handling
	handleRateLimit(retryAfterSeconds: number, pendingRequest: IRateLimitPendingRequest, message?: string): void;
	cancelRateLimitWait(): void;

	// Status Query
	getRateLimitStatus(): IRateLimitStatus;
}