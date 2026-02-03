/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../../base/common/event.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { IClaudeMessage, IClaudeSendRequestOptions, IClaudeSession } from './claudeTypes.js';

export interface IClaudeAPIService {
	// Connection Status Events
	readonly onDidChangeConnectionStatus: Event<void>;
	readonly onDidReceiveData: Event<any>;
	readonly onDidCompleteAny: Event<any>;
	readonly onDidErrorAny: Event<any>;

	// Connection Management
	isConnected(): boolean;
	confirmConnected(): void;
	setError(error: any): void;

	// Message Sending
	sendMessage(content: string, options?: IClaudeSendRequestOptions, sessionId?: string): Promise<IClaudeMessage>;
	sendPrompt(sessionId: string, prompt: string, options?: any): Promise<void>;

	// Connection Delegates
	setConnectionDelegates(
		getCurrentSession: () => IClaudeSession | undefined,
		confirmConnected: () => void
	): void;
}

export const IClaudeAPIService = createDecorator<IClaudeAPIService>('claudeAPIService');