/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../../../../base/common/lifecycle.js';
import { generateUuid } from '../../../../../../../base/common/uuid.js';
import { IClaudeCLIStreamEvent } from '../../../../common/claudeCLI.js';
import { IClaudeSessionService } from '../../../../common/types/claudeSessionService.js';
import { IClaudeMessageService } from '../../../../common/types/claudeMessageService.js';
import { IClaudeMessage, ClaudeServiceState, IClaudeQueuedMessage, IClaudeSendRequestOptions } from '../../../../common/types/claudeTypes.js';
import { IClaudeLogService } from '../../../../common/claudeLogService.js';

/**
 * 세션별 상태 인터페이스 (내부용)
 */
export interface ISessionState {
	state: ClaudeServiceState;
	currentMessageId?: string;
	accumulatedContent: string;
	toolActions: unknown[];
	currentToolAction?: unknown;
	currentAskUserRequest?: unknown;
	isWaitingForUser: boolean;
	cliSessionId?: string;
	messageQueue: IClaudeQueuedMessage[];
	isProcessingQueue?: boolean;
}

/**
 * MultiSessionManager - 멀티 세션 상태 관리
 * 책임: accumulateSessionContent, _handleSessionData, _handleSessionComplete, _handleSessionError, updateSessionMessage, extractTextFromEvent
 */
export class MultiSessionManager extends Disposable {

	private static readonly LOG_CATEGORY = 'MultiSessionManager';

	// 세션 상태 관리 (멀티 세션)
	private readonly _sessionStates = new Map<string, ISessionState>();

	constructor(
		private readonly _sessionService: IClaudeSessionService,
		private readonly _messageService: IClaudeMessageService,
		private readonly _logService: IClaudeLogService
	) {
		super();
	}

	/**
	 * 세션 상태 가져오기 (없으면 생성)
	 */
	getOrCreateSessionState(sessionId: string): ISessionState {
		if (!this._sessionStates.has(sessionId)) {
			this._sessionStates.set(sessionId, {
				state: 'idle',
				accumulatedContent: '',
				toolActions: [],
				isWaitingForUser: false,
				messageQueue: []
			});
		}
		return this._sessionStates.get(sessionId)!;
	}

	/**
	 * 세션 상태 가져오기
	 */
	getSessionState(sessionId: string): ISessionState | undefined {
		return this._sessionStates.get(sessionId);
	}

	/**
	 * 세션 상태 삭제
	 */
	deleteSessionState(sessionId: string): boolean {
		return this._sessionStates.delete(sessionId);
	}

	/**
	 * 세션 상태 맵 가져오기 (내부 접근용)
	 */
	getSessionStatesMap(): Map<string, ISessionState> {
		return this._sessionStates;
	}

	/**
	 * 세션 메시지 업데이트
	 */
	updateSessionMessage(sessionId: string, isStreaming: boolean = true): void {
		const sessionState = this._sessionStates.get(sessionId);
		if (!sessionState || !sessionState.currentMessageId) return;

		const message: IClaudeMessage = {
			id: sessionState.currentMessageId,
			role: 'assistant',
			content: sessionState.accumulatedContent,
			timestamp: Date.now(),
			isStreaming,
			workEndTime: isStreaming ? undefined : Date.now()
		};

		const session = this._sessionService.getSessionById(sessionId);
		if (session) {
			this._sessionService.updateMessage(message, session);
		}
		this._messageService.fireMessageUpdate(message);
	}

	/**
	 * 이벤트에서 텍스트 추출
	 */
	extractTextFromEvent(event: IClaudeCLIStreamEvent): string {
		if (event.type === 'content_block_delta' && event.delta?.text) {
			return event.delta.text;
		}
		if (event.type === 'text' && event.content) {
			return event.content;
		}
		return '';
	}

	/**
	 * 세션 컨텐츠 축적 (백그라운드 세션 포함)
	 * 모든 세션의 CLI 응답을 세션 상태에 저장
	 */
	accumulateSessionContent(sessionId: string, event: IClaudeCLIStreamEvent): void {
		const sessionState = this._sessionStates.get(sessionId);
		if (!sessionState) {
			return;
		}

		// assistant 이벤트: 텍스트 컨텐츠 추출
		if (event.type === 'assistant') {
			// 텍스트 컨텐츠 추출 및 축적 (message가 객체인 경우만)
			if (event.message && typeof event.message !== 'string') {
				const messageContent = event.message.content;
				if (messageContent && Array.isArray(messageContent)) {
					for (const block of messageContent) {
						if (block.type === 'text' && block.text) {
							if (sessionState.accumulatedContent) {
								sessionState.accumulatedContent += '\n' + block.text;
							} else {
								sessionState.accumulatedContent = block.text;
							}
						}
					}
				}
			}
		}

		// 스트리밍 텍스트 이벤트
		const text = this.extractTextFromEvent(event);
		if (text) {
			if (sessionState.accumulatedContent) {
				sessionState.accumulatedContent += text;
			} else {
				sessionState.accumulatedContent = text;
			}
		}

		// result 이벤트: 최종 결과
		if (event.type === 'result' && event.result) {
			// result가 문자열이면 최종 컨텐츠로 사용
			if (typeof event.result === 'string' && event.result.trim()) {
				sessionState.accumulatedContent = event.result;
			}
		}
	}

	/**
	 * 백그라운드 세션 완료 처리
	 * 축적된 컨텐츠를 세션 메시지로 저장
	 */
	handleBackgroundSessionComplete(sessionId: string): void {
		const sessionState = this._sessionStates.get(sessionId);
		if (!sessionState) return;

		// 축적된 컨텐츠를 세션 메시지로 저장
		if (sessionState.currentMessageId && sessionState.accumulatedContent) {
			const session = this._sessionService.getSessionById(sessionId);
			if (session) {
				const assistantMessage: IClaudeMessage = {
					id: sessionState.currentMessageId,
					role: 'assistant',
					content: sessionState.accumulatedContent,
					timestamp: Date.now(),
					isStreaming: false,
					workEndTime: Date.now()
				};
				this._sessionService.updateMessage(assistantMessage, session);
				this._logService.debug(MultiSessionManager.LOG_CATEGORY,
					`Saved background session message: ${sessionId}, content length: ${sessionState.accumulatedContent.length}`);
			}
		}

		// 백그라운드 세션 상태를 idle로 변경
		sessionState.state = 'idle';
		sessionState.isWaitingForUser = false;
		sessionState.currentMessageId = undefined;
		this._logService.debug(MultiSessionManager.LOG_CATEGORY, `Background session state reset to idle: ${sessionId}`);
	}

	/**
	 * 세션 에러 처리
	 */
	handleSessionError(sessionId: string): void {
		const sessionState = this._sessionStates.get(sessionId);
		if (sessionState) {
			sessionState.state = 'idle';
			sessionState.isWaitingForUser = false;
			this._logService.debug(MultiSessionManager.LOG_CATEGORY, `Session state reset to idle after error: ${sessionId}`);
		}
	}

	/**
	 * 새 메시지를 위한 세션 상태 초기화
	 */
	initializeSessionForNewMessage(sessionId: string): string {
		const sessionState = this.getOrCreateSessionState(sessionId);
		const messageId = generateUuid();

		sessionState.currentMessageId = messageId;
		sessionState.accumulatedContent = '';
		sessionState.currentToolAction = undefined;
		sessionState.state = 'streaming';

		return messageId;
	}

	/**
	 * 세션 큐에 메시지 추가
	 */
	addToSessionQueue(sessionId: string, content: string, options?: IClaudeSendRequestOptions, maxQueueSize: number = 10): IClaudeQueuedMessage | null {
		const sessionState = this.getOrCreateSessionState(sessionId);

		if (sessionState.messageQueue.length >= maxQueueSize) {
			this._logService.warn(MultiSessionManager.LOG_CATEGORY, `Session queue is full for ${sessionId}`);
			return null;
		}

		const queuedMessage: IClaudeQueuedMessage = {
			id: generateUuid(),
			content,
			context: options?.context,
			timestamp: Date.now()
		};

		sessionState.messageQueue.push(queuedMessage);
		this._logService.debug(MultiSessionManager.LOG_CATEGORY,
			`Added message to session queue: ${sessionId}, queue size: ${sessionState.messageQueue.length}`);

		return queuedMessage;
	}

	/**
	 * 세션 큐에서 다음 메시지 가져오기
	 */
	getNextFromSessionQueue(sessionId: string): IClaudeQueuedMessage | undefined {
		const sessionState = this._sessionStates.get(sessionId);
		if (!sessionState || sessionState.messageQueue.length === 0) {
			return undefined;
		}

		return sessionState.messageQueue.shift();
	}

	/**
	 * 세션 큐 가져오기
	 */
	getSessionQueue(sessionId: string): IClaudeQueuedMessage[] {
		return this._sessionStates.get(sessionId)?.messageQueue || [];
	}

	/**
	 * 세션이 idle 상태인지 확인
	 */
	isSessionIdle(sessionId: string): boolean {
		const state = this._sessionStates.get(sessionId);
		return !state || state.state === 'idle';
	}

	/**
	 * 세션이 사용자 대기 중인지 확인
	 */
	isSessionWaitingForUser(sessionId: string): boolean {
		return this._sessionStates.get(sessionId)?.isWaitingForUser ?? false;
	}

	/**
	 * 세션 큐 처리 중인지 확인
	 */
	isSessionProcessingQueue(sessionId: string): boolean {
		return this._sessionStates.get(sessionId)?.isProcessingQueue ?? false;
	}

	/**
	 * 세션 큐 처리 상태 설정
	 */
	setSessionProcessingQueue(sessionId: string, processing: boolean): void {
		const state = this._sessionStates.get(sessionId);
		if (state) {
			state.isProcessingQueue = processing;
		}
	}
}
