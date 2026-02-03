/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../../base/common/event.js';
import { IClaudeQueuedMessage, IClaudeSendRequestOptions } from '../claudeTypes.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';

export const IClaudeQueueService = createDecorator<IClaudeQueueService>('claudeQueueService');

export interface IClaudeQueueService {
	readonly _serviceBrand: undefined;

	// Events
	readonly onDidChangeQueue: Event<IClaudeQueuedMessage[]>;

	// Queue operations
	addToQueue(content: string, options?: IClaudeSendRequestOptions, sessionId?: string): IClaudeQueuedMessage;
	addToGlobalQueue(message: IClaudeQueuedMessage): void;
	removeFromQueue(id: string, sessionId?: string): boolean;
	clearQueue(sessionId?: string): void;
	getQueuedMessages(sessionId?: string): IClaudeQueuedMessage[];
	getGlobalQueue(): IClaudeQueuedMessage[];
	updateQueuedMessage(id: string, newContent: string, sessionId?: string): boolean;
	reorderQueue(fromIndex: number, toIndex: number, sessionId?: string): boolean;

	// Queue state
	isProcessingQueue(sessionId?: string): boolean;
	getMaxQueueSize(): number;

	// Queue processing
	processQueue(sessionId?: string): Promise<void>;

	// Delegates for saving queue state
	setQueueDelegates(
		saveSessionQueue: (sessionId: string, queue: IClaudeQueuedMessage[]) => void,
		saveGlobalQueue: (queue: IClaudeQueuedMessage[]) => void,
		processMessage: (content: string, options?: IClaudeSendRequestOptions, sessionId?: string) => Promise<void>
	): void;
}