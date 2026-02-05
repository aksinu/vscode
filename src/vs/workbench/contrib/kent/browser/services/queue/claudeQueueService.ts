/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../../../../../base/common/event.js';
import { IDisposable } from '../../../../../../base/common/lifecycle.js';
import { Disposable, DisposableStore } from '../../../../../../base/common/lifecycle.js';
import { IStorageService, StorageScope } from '../../../../../../platform/storage/common/storage.js';
import { generateUuid } from '../../../../../../base/common/uuid.js';
import { IClaudeQueueService, IQueueStateManager } from '../../../common/types/claudeQueueService.js';
import { IClaudeQueuedMessage, IClaudeSendRequestOptions } from '../../../common/types/claudeTypes.js';
import { IClaudeLogService } from '../../../common/claudeLogService.js';

/**
 * Claude 메시지 큐 관리 서비스
 *
 * 메시지 큐잉, 재시도, 우선순위 처리 등을 담당합니다.
 */
export class ClaudeQueueService extends Disposable implements IClaudeQueueService {
	declare readonly _serviceBrand: undefined;

	private static readonly LOG_CATEGORY = 'ClaudeQueueService';
	private static readonly QUEUE_STORAGE_KEY = 'claude.messageQueue';
	private static readonly MAX_QUEUE_SIZE = 10;

	// ========== Events ==========

	private readonly _onDidChangeQueue = this._register(new Emitter<IClaudeQueuedMessage[]>());
	readonly onDidChangeQueue: Event<IClaudeQueuedMessage[]> = this._onDidChangeQueue.event;

	// ========== State ==========

	private _globalQueue: IClaudeQueuedMessage[] = [];
	private readonly _sessionQueues = new Map<string, IClaudeQueuedMessage[]>();
	private readonly _processingQueues = new Set<string>();

	// ========== Delegates ==========

	private _saveSessionQueue: ((sessionId: string, queue: IClaudeQueuedMessage[]) => void) | undefined;
	private _saveGlobalQueue: ((queue: IClaudeQueuedMessage[]) => void) | undefined;
	private _processMessage: ((content: string, options?: IClaudeSendRequestOptions, sessionId?: string) => Promise<void>) | undefined;

	constructor(
		@IClaudeLogService private readonly logService: IClaudeLogService,
		@IStorageService private readonly storageService: IStorageService
	) {
		super();
		this.logService.info(ClaudeQueueService.LOG_CATEGORY, 'Service initialized');
		this._loadQueue();
	}

	// ========== State Manager ==========

	private _stateManager: IQueueStateManager | undefined;
	private _stateManagerSubscription: DisposableStore | undefined;

	// ========== Delegate Setup ==========

	setQueueDelegates(
		saveSessionQueue: (sessionId: string, queue: IClaudeQueuedMessage[]) => void,
		saveGlobalQueue: (queue: IClaudeQueuedMessage[]) => void,
		processMessage: (content: string, options?: IClaudeSendRequestOptions, sessionId?: string) => Promise<void>
	): void {
		this._saveSessionQueue = saveSessionQueue;
		this._saveGlobalQueue = saveGlobalQueue;
		this._processMessage = processMessage;
		this.logService.debug(ClaudeQueueService.LOG_CATEGORY, 'Delegates set');
	}

	/**
	 * 상태 관리자 구독 설정
	 * ChatStateManager의 idle 이벤트를 구독하여 자동으로 큐 처리
	 */
	subscribeToStateManager(stateManager: IQueueStateManager): IDisposable {
		// 기존 구독 정리
		this._stateManagerSubscription?.dispose();
		this._stateManagerSubscription = new DisposableStore();

		this._stateManager = stateManager;

		// idle 상태가 되면 자동으로 큐 처리 시작
		this._stateManagerSubscription.add(
			stateManager.onDidBecomeIdle(sessionId => {
				this.logService.debug(ClaudeQueueService.LOG_CATEGORY,
					`Session became idle, checking queue: ${sessionId}`);

				// WaitingForUser 상태면 큐 처리하지 않음
				if (stateManager.isWaitingForUser(sessionId)) {
					this.logService.debug(ClaudeQueueService.LOG_CATEGORY,
						`Skipping queue processing - waiting for user: ${sessionId}`);
					return;
				}

				// 비동기로 큐 처리 시작
				this.processQueue(sessionId).catch(error => {
					this.logService.error(ClaudeQueueService.LOG_CATEGORY,
						`Error processing queue for session ${sessionId}:`, error);
				});
			})
		);

		this.logService.info(ClaudeQueueService.LOG_CATEGORY, 'Subscribed to state manager');

		return {
			dispose: () => {
				this._stateManagerSubscription?.dispose();
				this._stateManagerSubscription = undefined;
				this._stateManager = undefined;
			}
		};
	}

	// ========== Queue Operations ==========

	addToQueue(content: string, options?: IClaudeSendRequestOptions, sessionId?: string): { message: IClaudeQueuedMessage; added: boolean } {
		const message: IClaudeQueuedMessage = {
			id: generateUuid(),
			content,
			context: options?.context,
			timestamp: Date.now()
		};

		let added = false;

		if (sessionId) {
			const queue = this._getOrCreateSessionQueue(sessionId);
			if (queue.length >= ClaudeQueueService.MAX_QUEUE_SIZE) {
				this.logService.warn(ClaudeQueueService.LOG_CATEGORY, `Session queue full for ${sessionId}`);
			} else {
				queue.push(message);
				this._saveSessionQueue?.(sessionId, queue);
				this._onDidChangeQueue.fire([...queue]);
				added = true;
			}
		} else {
			if (this._globalQueue.length >= ClaudeQueueService.MAX_QUEUE_SIZE) {
				this.logService.warn(ClaudeQueueService.LOG_CATEGORY, 'Global queue full');
			} else {
				this._globalQueue.push(message);
				this._saveGlobalQueue?.(this._globalQueue);
				this._onDidChangeQueue.fire([...this._globalQueue]);
				added = true;
			}
		}

		this.logService.debug(ClaudeQueueService.LOG_CATEGORY, `Message ${added ? 'added to' : 'rejected from'} queue: ${content.substring(0, 50)}`);
		return { message, added };
	}

	addToGlobalQueue(message: IClaudeQueuedMessage): void {
		if (this._globalQueue.length >= ClaudeQueueService.MAX_QUEUE_SIZE) {
			this._globalQueue.shift();
			this.logService.warn(ClaudeQueueService.LOG_CATEGORY, 'Queue full, removing oldest message');
		}

		this._globalQueue.push(message);
		this._saveGlobalQueue?.(this._globalQueue);
		this._onDidChangeQueue.fire([...this._globalQueue]);
		this.logService.debug(ClaudeQueueService.LOG_CATEGORY, `Message added to global queue. Size: ${this._globalQueue.length}`);
	}

	removeFromQueue(id: string, sessionId?: string): boolean {
		if (sessionId) {
			const queue = this._sessionQueues.get(sessionId);
			if (queue) {
				const index = queue.findIndex(m => m.id === id);
				if (index !== -1) {
					queue.splice(index, 1);
					this._saveSessionQueue?.(sessionId, queue);
					this._onDidChangeQueue.fire([...queue]);
					return true;
				}
			}
		} else {
			const index = this._globalQueue.findIndex(m => m.id === id);
			if (index !== -1) {
				this._globalQueue.splice(index, 1);
				this._saveGlobalQueue?.(this._globalQueue);
				this._onDidChangeQueue.fire([...this._globalQueue]);
				return true;
			}
		}
		return false;
	}

	clearQueue(sessionId?: string): void {
		if (sessionId) {
			this._sessionQueues.set(sessionId, []);
			this._saveSessionQueue?.(sessionId, []);
		} else {
			this._globalQueue = [];
			this._saveGlobalQueue?.([]);
		}
		this._onDidChangeQueue.fire([]);
		this.logService.debug(ClaudeQueueService.LOG_CATEGORY, `Queue cleared${sessionId ? ` for session ${sessionId}` : ''}`);
	}

	getQueuedMessages(sessionId?: string): IClaudeQueuedMessage[] {
		if (sessionId) {
			return [...(this._sessionQueues.get(sessionId) || [])];
		}
		return [...this._globalQueue];
	}

	getGlobalQueue(): IClaudeQueuedMessage[] {
		return [...this._globalQueue];
	}

	updateQueuedMessage(id: string, newContent: string, sessionId?: string): boolean {
		const queue = sessionId ? this._sessionQueues.get(sessionId) : this._globalQueue;
		if (!queue) return false;

		const index = queue.findIndex(m => m.id === id);
		if (index !== -1) {
			// Replace with new object since content is readonly
			queue[index] = { ...queue[index], content: newContent };
			if (sessionId) {
				this._saveSessionQueue?.(sessionId, queue);
			} else {
				this._saveGlobalQueue?.(queue);
			}
			this._onDidChangeQueue.fire([...queue]);
			return true;
		}
		return false;
	}

	reorderQueue(fromIndex: number, toIndex: number, sessionId?: string): boolean {
		const queue = sessionId ? this._sessionQueues.get(sessionId) : this._globalQueue;
		if (!queue) return false;

		if (fromIndex < 0 || fromIndex >= queue.length || toIndex < 0 || toIndex >= queue.length) {
			return false;
		}

		const [item] = queue.splice(fromIndex, 1);
		queue.splice(toIndex, 0, item);

		if (sessionId) {
			this._saveSessionQueue?.(sessionId, queue);
		} else {
			this._saveGlobalQueue?.(queue);
		}
		this._onDidChangeQueue.fire([...queue]);
		return true;
	}

	// ========== Queue State ==========

	isProcessingQueue(sessionId?: string): boolean {
		const key = sessionId || '__global__';
		return this._processingQueues.has(key);
	}

	getMaxQueueSize(): number {
		return ClaudeQueueService.MAX_QUEUE_SIZE;
	}

	// ========== Queue Processing ==========

	async processQueue(sessionId?: string): Promise<void> {
		const key = sessionId || '__global__';
		this.logService.info(ClaudeQueueService.LOG_CATEGORY,
			`🚀 PROCESS QUEUE - Starting queue processing for: ${key}`);

		if (this._processingQueues.has(key)) {
			this.logService.info(ClaudeQueueService.LOG_CATEGORY, `⏳ ALREADY PROCESSING - Queue already being processed: ${key}`);
			return;
		}

		// 상태 관리자가 있으면 입력 가능 상태인지 확인
		if (sessionId && this._stateManager) {
			if (!this._stateManager.isInputEnabled(sessionId)) {
				this.logService.info(ClaudeQueueService.LOG_CATEGORY,
					`🚫 NOT READY - Session not ready for input, skipping queue: ${sessionId}`);
				return;
			}
			if (this._stateManager.isWaitingForUser(sessionId)) {
				this.logService.info(ClaudeQueueService.LOG_CATEGORY,
					`⏸️ WAITING - Waiting for user response, skipping queue: ${sessionId}`);
				return;
			}
		}

		const queue = sessionId ? this._sessionQueues.get(sessionId) : this._globalQueue;
		if (!queue || queue.length === 0) {
			this.logService.info(ClaudeQueueService.LOG_CATEGORY,
				`📭 EMPTY QUEUE - No messages to process for: ${key}`);
			return;
		}

		this._processingQueues.add(key);
		this.logService.info(ClaudeQueueService.LOG_CATEGORY,
			`🔥 PROCESSING START - Processing queue: ${key}, messages: ${queue.length}`);

		try {
			const message = queue.shift();
			if (message && this._processMessage) {
				this.logService.info(ClaudeQueueService.LOG_CATEGORY,
					`📤 PROCESSING MESSAGE - ID: ${message.id}, content: "${message.content.substring(0, 50)}..."`);

				if (sessionId) {
					this._saveSessionQueue?.(sessionId, queue);
				} else {
					this._saveGlobalQueue?.(queue);
				}
				this._onDidChangeQueue.fire([...queue]);

				await this._processMessage(message.content, { context: message.context }, sessionId);
				this.logService.info(ClaudeQueueService.LOG_CATEGORY,
					`✅ PROCESSING COMPLETE - Message processed successfully: ${message.id}`);
			} else {
				this.logService.error(ClaudeQueueService.LOG_CATEGORY,
					`❌ PROCESSING ERROR - No message or processMessage handler not set`);
			}
		} catch (error) {
			this.logService.error(ClaudeQueueService.LOG_CATEGORY, '💥 PROCESSING ERROR - Error processing queue:', error);
		} finally {
			this._processingQueues.delete(key);
			this.logService.info(ClaudeQueueService.LOG_CATEGORY,
				`🏁 PROCESSING END - Finished processing queue: ${key}`);
		}
	}

	// ========== Session Queue Helpers ==========

	loadSessionQueue(sessionId: string, queue: IClaudeQueuedMessage[]): void {
		this._sessionQueues.set(sessionId, queue);
	}

	loadGlobalQueue(queue: IClaudeQueuedMessage[]): void {
		this._globalQueue = queue;
	}

	getSessionQueue(sessionId: string): IClaudeQueuedMessage[] {
		return [...(this._sessionQueues.get(sessionId) || [])];
	}

	// ========== Private Methods ==========

	private _getOrCreateSessionQueue(sessionId: string): IClaudeQueuedMessage[] {
		if (!this._sessionQueues.has(sessionId)) {
			this._sessionQueues.set(sessionId, []);
		}
		return this._sessionQueues.get(sessionId)!;
	}

	private _loadQueue(): void {
		try {
			const stored = this.storageService.get(ClaudeQueueService.QUEUE_STORAGE_KEY, StorageScope.WORKSPACE, '[]');
			this._globalQueue = JSON.parse(stored);
			this.logService.info(ClaudeQueueService.LOG_CATEGORY, `Loaded ${this._globalQueue.length} messages from storage`);
		} catch (error) {
			this.logService.error(ClaudeQueueService.LOG_CATEGORY, 'Failed to load queue from storage', error);
			this._globalQueue = [];
		}
	}
}
