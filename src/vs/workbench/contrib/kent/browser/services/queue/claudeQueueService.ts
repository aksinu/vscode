/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../../../../base/common/event.js';
import { Disposable } from '../../../../../base/common/lifecycle.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../../platform/storage/common/storage.js';
import { IClaudeQueueService } from '../../../common/types/claudeQueueService.js';
import { IClaudeQueuedMessage, IClaudeSendRequestOptions } from '../../../common/types/claudeTypes.js';
import { IClaudeLogService } from '../../../common/claudeLogService.js';

/**
 * Claude 메시지 큐 관리 서비스
 *
 * 메시지 큐잉, 재시도, 우선순위 처리 등을 담당합니다.
 */
export class ClaudeQueueService extends Disposable implements IClaudeQueueService {
	declare readonly _serviceBrand: undefined;

	private static readonly QUEUE_STORAGE_KEY = 'claude.messageQueue';
	private static readonly MAX_QUEUE_SIZE = 10;

	// ========== Events ==========

	private readonly _onDidChangeQueue = this._register(new Emitter<IClaudeQueuedMessage[]>());
	readonly onDidChangeQueue: Event<IClaudeQueuedMessage[]> = this._onDidChangeQueue.event;

	// ========== State ==========

	private _queue: IClaudeQueuedMessage[] = [];

	constructor(
		@IClaudeLogService private readonly logService: IClaudeLogService,
		@IStorageService private readonly storageService: IStorageService
	) {
		super();
		this.logService.info('ClaudeQueueService', 'Service initialized');
		this._loadQueue();
	}

	// ========== Queue Management ==========

	getQueue(sessionId?: string): IClaudeQueuedMessage[] {
		if (sessionId) {
			return this._queue.filter(msg => msg.sessionId === sessionId);
		}
		return [...this._queue];
	}

	addToQueue(message: IClaudeQueuedMessage): void {
		// Remove oldest message if queue is full
		if (this._queue.length >= ClaudeQueueService.MAX_QUEUE_SIZE) {
			this._queue.shift();
			this.logService.warn('ClaudeQueueService', 'Queue full, removing oldest message');
		}

		this._queue.push(message);
		this._saveQueue();
		this._onDidChangeQueue.fire([...this._queue]);
		this.logService.info('ClaudeQueueService', `Message added to queue. Queue size: ${this._queue.length}`);
	}

	removeFromQueue(messageId: string): boolean {
		const index = this._queue.findIndex(msg => msg.id === messageId);
		if (index !== -1) {
			this._queue.splice(index, 1);
			this._saveQueue();
			this._onDidChangeQueue.fire([...this._queue]);
			this.logService.info('ClaudeQueueService', `Message removed from queue. Queue size: ${this._queue.length}`);
			return true;
		}
		return false;
	}

	clearQueue(sessionId?: string): void {
		if (sessionId) {
			const beforeSize = this._queue.length;
			this._queue = this._queue.filter(msg => msg.sessionId !== sessionId);
			const afterSize = this._queue.length;
			this.logService.info('ClaudeQueueService', `Cleared ${beforeSize - afterSize} messages for session ${sessionId}`);
		} else {
			const queueSize = this._queue.length;
			this._queue = [];
			this.logService.info('ClaudeQueueService', `Cleared entire queue (${queueSize} messages)`);
		}

		this._saveQueue();
		this._onDidChangeQueue.fire([...this._queue]);
	}

	getQueueSize(sessionId?: string): number {
		if (sessionId) {
			return this._queue.filter(msg => msg.sessionId === sessionId).length;
		}
		return this._queue.length;
	}

	// ========== Private Methods ==========

	private _loadQueue(): void {
		try {
			const stored = this.storageService.get(ClaudeQueueService.QUEUE_STORAGE_KEY, StorageScope.WORKSPACE, '[]');
			this._queue = JSON.parse(stored);
			this.logService.info('ClaudeQueueService', `Loaded ${this._queue.length} messages from storage`);
		} catch (error) {
			this.logService.error('ClaudeQueueService', 'Failed to load queue from storage', error);
			this._queue = [];
		}
	}

	private _saveQueue(): void {
		try {
			this.storageService.store(
				ClaudeQueueService.QUEUE_STORAGE_KEY,
				JSON.stringify(this._queue),
				StorageScope.WORKSPACE,
				StorageTarget.MACHINE
			);
		} catch (error) {
			this.logService.error('ClaudeQueueService', 'Failed to save queue to storage', error);
		}
	}
}