/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../../../base/common/event.js';
import { createDecorator } from '../../../../../platform/instantiation/common/instantiation.js';
import { IClaudeMessage, IClaudeSendRequestOptions, IClaudeSession, IClaudeQueuedMessage } from './claudeTypes.js';

export const IClaudeMessageService = createDecorator<IClaudeMessageService>('claudeMessageService');

/**
 * Claude 메시지 관리 서비스 인터페이스
 *
 * 메시지의 생성, 저장, 업데이트, 조회 등의 CRUD 작업을 담당
 */
export interface IClaudeMessageService {
	readonly _serviceBrand: undefined;

	// ========== Events ==========

	/**
	 * 메시지 수신 이벤트
	 */
	readonly onDidReceiveMessage: Event<IClaudeMessage>;

	/**
	 * 스트리밍 메시지 업데이트 이벤트
	 */
	readonly onDidUpdateMessage: Event<IClaudeMessage>;

	/**
	 * 메시지 큐 변경 이벤트
	 */
	readonly onDidChangeQueue: Event<IClaudeQueuedMessage[]>;

	// ========== Message CRUD ==========

	/**
	 * 현재 세션의 모든 메시지 가져오기
	 */
	getMessages(sessionId?: string): IClaudeMessage[];

	/**
	 * 메시지 추가
	 */
	addMessage(message: IClaudeMessage, session?: IClaudeSession): void;

	/**
	 * 메시지 업데이트
	 */
	updateMessage(message: IClaudeMessage, session?: IClaudeSession): boolean;

	/**
	 * 특정 메시지 찾기
	 */
	findMessage(messageId: string, sessionId?: string): IClaudeMessage | undefined;

	/**
	 * 메시지 삭제
	 */
	removeMessage(messageId: string, sessionId?: string): boolean;

	/**
	 * 모든 메시지 삭제
	 */
	clearMessages(sessionId?: string): void;

	// ========== Queue Management ==========

	/**
	 * 큐에 메시지 추가
	 */
	addToQueue(content: string, options?: IClaudeSendRequestOptions, sessionId?: string): IClaudeMessage;

	/**
	 * 대기 중인 메시지 가져오기
	 */
	getQueuedMessages(sessionId?: string): IClaudeQueuedMessage[];

	/**
	 * 큐에서 메시지 제거
	 */
	removeFromQueue(messageId: string, sessionId?: string): boolean;

	/**
	 * 큐 비우기
	 */
	clearQueue(sessionId?: string): void;

	/**
	 * 큐 메시지 내용 업데이트
	 */
	updateQueuedMessage(id: string, newContent: string, sessionId?: string): boolean;

	/**
	 * 큐 메시지 순서 변경
	 */
	reorderQueuedMessage(fromIndex: number, toIndex: number, sessionId?: string): boolean;

	/**
	 * 다음 메시지를 큐에서 가져오기
	 */
	getNextQueuedMessage(sessionId?: string): IClaudeQueuedMessage | undefined;

	// ========== Utility ==========

	/**
	 * 마지막 사용자 메시지 찾기
	 */
	findLastUserMessage(sessionId?: string): IClaudeMessage | undefined;

	/**
	 * 메시지 생성 헬퍼
	 */
	createMessage(content: string, role: 'user' | 'assistant', options?: Partial<IClaudeMessage>): IClaudeMessage;

	/**
	 * 큐 메시지 생성 헬퍼
	 */
	createQueuedMessage(content: string, options?: IClaudeSendRequestOptions): IClaudeQueuedMessage;

	// ========== Message Processing ==========

	/**
	 * 메시지 전송 처리
	 */
	sendMessage(content: string, options?: IClaudeSendRequestOptions, sessionId?: string): Promise<IClaudeMessage>;

	/**
	 * 특정 세션에 메시지 전송
	 */
	sendMessageToSession(sessionId: string, content: string, options?: IClaudeSendRequestOptions): Promise<IClaudeMessage>;

	/**
	 * Assistant 메시지 생성
	 */
	createAssistantMessage(id: string, sessionId?: string): IClaudeMessage;

	/**
	 * User 메시지 생성
	 */
	createUserMessage(content: string, options?: IClaudeSendRequestOptions): IClaudeMessage;

	/**
	 * 스트리밍 메시지 업데이트 처리
	 */
	handleStreamingUpdate(messageId: string, content: string, isStreaming: boolean, sessionId?: string): void;

	/**
	 * 메시지 이벤트 발송
	 */
	fireMessageReceive(message: IClaudeMessage): void;
	fireMessageUpdate(message: IClaudeMessage): void;
	fireQueueChange(queuedMessages: IClaudeQueuedMessage[]): void;

	/**
	 * 세션 델리게이트 설정 (ClaudeService에서 사용)
	 */
	setSessionDelegates(
		getMessages: (sessionId?: string) => IClaudeMessage[],
		updateMessage: (message: IClaudeMessage, session?: IClaudeSession) => void,
		getQueue: (sessionId?: string) => IClaudeQueuedMessage[]
	): void;

	/**
	 * 핵심 서비스 델리게이트 설정 (ClaudeService 연동용)
	 */
	setCoreServiceDelegates(
		sendMessageDelegate: (content: string, options?: IClaudeSendRequestOptions, sessionId?: string) => Promise<IClaudeMessage>,
		createAssistantMessageDelegate: (id: string) => IClaudeMessage,
		getCurrentSessionDelegate: () => IClaudeSession | undefined,
		hasCurrentSessionDelegate: () => boolean
	): void;
}