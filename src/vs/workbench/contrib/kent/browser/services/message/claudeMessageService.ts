/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { IClaudeMessageService } from '../../../common/types/claudeMessageService.js';
import { IClaudeMessage, IClaudeSendRequestOptions, IClaudeSession, IClaudeQueuedMessage } from '../../../common/types/claudeTypes.js';
import { IClaudeLogService } from '../../../common/claudeLogService.js';

/**
 * Claude 메시지 관리 서비스
 *
 * 메시지의 생성, 저장, 업데이트, 조회 등의 CRUD 작업을 담당하고
 * 메시지 전송 로직도 처리합니다.
 */
export class ClaudeMessageService extends Disposable implements IClaudeMessageService {
	declare readonly _serviceBrand: undefined;

	// ========== Events ==========

	private readonly _onDidReceiveMessage = this._register(new Emitter<IClaudeMessage>());
	readonly onDidReceiveMessage: Event<IClaudeMessage> = this._onDidReceiveMessage.event;

	private readonly _onDidUpdateMessage = this._register(new Emitter<IClaudeMessage>());
	readonly onDidUpdateMessage: Event<IClaudeMessage> = this._onDidUpdateMessage.event;

	private readonly _onDidChangeQueue = this._register(new Emitter<IClaudeQueuedMessage[]>());
	readonly onDidChangeQueue: Event<IClaudeQueuedMessage[]> = this._onDidChangeQueue.event;

	// ========== Delegates ==========

	private getMessagesDelegate?: (sessionId?: string) => IClaudeMessage[];
	private updateMessageDelegate?: (message: IClaudeMessage, session?: IClaudeSession) => void;
	private getQueueDelegate?: (sessionId?: string) => IClaudeQueuedMessage[];

	// Core service delegates
	private sendMessageDelegate?: (content: string, options?: IClaudeSendRequestOptions, sessionId?: string) => Promise<IClaudeMessage>;
	private createAssistantMessageDelegate?: (id: string) => IClaudeMessage;
	private getCurrentSessionDelegate?: () => IClaudeSession | undefined;
	private hasCurrentSessionDelegate?: () => boolean;

	constructor(
		@IClaudeLogService private readonly logService: IClaudeLogService
	) {
		super();
		this.logService.info('ClaudeMessageService', 'Service initialized');
	}

	// ========== Message CRUD ==========

	getMessages(sessionId?: string): IClaudeMessage[] {
		if (this.getMessagesDelegate) {
			return this.getMessagesDelegate(sessionId);
		}
		return [];
	}

	addMessage(message: IClaudeMessage, session?: IClaudeSession): void {
		// This will be delegated to sessionManager through ClaudeService
		// For now, just fire the event
		this._onDidReceiveMessage.fire(message);
	}

	updateMessage(message: IClaudeMessage, session?: IClaudeSession): boolean {
		if (this.updateMessageDelegate) {
			this.updateMessageDelegate(message, session);
			this._onDidUpdateMessage.fire(message);
			return true;
		}
		return false;
	}

	findMessage(messageId: string, sessionId?: string): IClaudeMessage | undefined {
		const messages = this.getMessages(sessionId);
		return messages.find(msg => msg.id === messageId);
	}

	removeMessage(messageId: string, sessionId?: string): boolean {
		// TODO: Implement when needed
		return false;
	}

	clearMessages(sessionId?: string): void {
		// TODO: Implement when needed
	}

	// ========== Queue Management ==========

	addToQueue(content: string, options?: IClaudeSendRequestOptions, sessionId?: string): IClaudeMessage {
		const queuedMessage = this.createQueuedMessage(content, options);
		// TODO: Actually add to queue
		return queuedMessage as IClaudeMessage;
	}

	getQueuedMessages(sessionId?: string): IClaudeQueuedMessage[] {
		if (this.getQueueDelegate) {
			return this.getQueueDelegate(sessionId);
		}
		return [];
	}

	removeFromQueue(messageId: string, sessionId?: string): boolean {
		// TODO: Implement when needed
		return false;
	}

	clearQueue(sessionId?: string): void {
		// TODO: Implement when needed
	}

	updateQueuedMessage(id: string, newContent: string, sessionId?: string): boolean {
		// TODO: Implement when needed
		return false;
	}

	reorderQueuedMessage(fromIndex: number, toIndex: number, sessionId?: string): boolean {
		// TODO: Implement when needed
		return false;
	}

	getNextQueuedMessage(sessionId?: string): IClaudeQueuedMessage | undefined {
		const queuedMessages = this.getQueuedMessages(sessionId);
		return queuedMessages.length > 0 ? queuedMessages[0] : undefined;
	}

	// ========== Utility ==========

	findLastUserMessage(sessionId?: string): IClaudeMessage | undefined {
		const messages = this.getMessages(sessionId);
		for (let i = messages.length - 1; i >= 0; i--) {
			if (messages[i].role === 'user') {
				return messages[i];
			}
		}
		return undefined;
	}

	createMessage(content: string, role: 'user' | 'assistant', options?: Partial<IClaudeMessage>): IClaudeMessage {
		return {
			id: generateUuid(),
			content,
			role,
			timestamp: Date.now(),
			...options
		};
	}

	createQueuedMessage(content: string, options?: IClaudeSendRequestOptions): IClaudeQueuedMessage {
		return {
			id: generateUuid(),
			content,
			timestamp: Date.now(),
			options: options || {}
		};
	}

	// ========== Message Processing ==========

	async sendMessage(content: string, options?: IClaudeSendRequestOptions, sessionId?: string): Promise<IClaudeMessage> {
		if (this.sendMessageDelegate) {
			return await this.sendMessageDelegate(content, options, sessionId);
		}
		throw new Error('Send message delegate not set');
	}

	async sendMessageToSession(sessionId: string, content: string, options?: IClaudeSendRequestOptions): Promise<IClaudeMessage> {
		return await this.sendMessage(content, options, sessionId);
	}

	createAssistantMessage(id: string, sessionId?: string): IClaudeMessage {
		if (this.createAssistantMessageDelegate) {
			return this.createAssistantMessageDelegate(id);
		}

		const now = Date.now();
		return this.createMessage('', 'assistant', {
			id,
			isStreaming: true,
			workStartTime: now
		});
	}

	createUserMessage(content: string, options?: IClaudeSendRequestOptions): IClaudeMessage {
		return this.createMessage(content, 'user', {
			...options
		});
	}

	handleStreamingUpdate(messageId: string, content: string, isStreaming: boolean, sessionId?: string): void {
		const message: IClaudeMessage = {
			id: messageId,
			content,
			role: 'assistant',
			timestamp: Date.now(),
			isStreaming
		};

		this.updateMessage(message);
	}

	fireMessageReceive(message: IClaudeMessage): void {
		this._onDidReceiveMessage.fire(message);
	}

	fireMessageUpdate(message: IClaudeMessage): void {
		this._onDidUpdateMessage.fire(message);
	}

	fireQueueChange(queuedMessages: IClaudeQueuedMessage[]): void {
		this._onDidChangeQueue.fire(queuedMessages);
	}

	// ========== Delegates Setup ==========

	setSessionDelegates(
		getMessages: (sessionId?: string) => IClaudeMessage[],
		updateMessage: (message: IClaudeMessage, session?: IClaudeSession) => void,
		getQueue: (sessionId?: string) => IClaudeQueuedMessage[]
	): void {
		this.getMessagesDelegate = getMessages;
		this.updateMessageDelegate = updateMessage;
		this.getQueueDelegate = getQueue;
	}

	setCoreServiceDelegates(
		sendMessageDelegate: (content: string, options?: IClaudeSendRequestOptions, sessionId?: string) => Promise<IClaudeMessage>,
		createAssistantMessageDelegate: (id: string) => IClaudeMessage,
		getCurrentSessionDelegate: () => IClaudeSession | undefined,
		hasCurrentSessionDelegate: () => boolean
	): void {
		this.sendMessageDelegate = sendMessageDelegate;
		this.createAssistantMessageDelegate = createAssistantMessageDelegate;
		this.getCurrentSessionDelegate = getCurrentSessionDelegate;
		this.hasCurrentSessionDelegate = hasCurrentSessionDelegate;
	}
}