/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../../../../../../base/common/event.js';
import { Disposable } from '../../../../../../../base/common/lifecycle.js';
import { IClaudeLogService } from '../../../../common/claudeLogService.js';
import { ChatSessionState } from '../../../../common/types/claudeTypes.js';

/**
 * 채팅 상태 관리
 * 상태 정의는 claudeTypes.ts의 ChatSessionState를 사용
 */

/**
 * 상태 전이 정보
 */
export interface IChatSessionStateTransition {
	readonly sessionId: string;
	readonly previousState: ChatSessionState;
	readonly currentState: ChatSessionState;
	readonly timestamp: number;
}

/**
 * 세션별 상태 정보
 */
export interface ISessionChatSessionState {
	readonly sessionId: string;
	readonly state: ChatSessionState;
	readonly currentMessageId?: string;
	readonly waitingReason?: string;
	readonly errorMessage?: string;
	readonly rateLimitCountdown?: number;
}

/**
 * ChatSessionStateManager - 중앙 집중식 채팅 상태 관리
 *
 * 책임:
 * - 세션별 상태 관리 (idle, sending, responding, asking, rateLimit, error, cancelled)
 * - 상태 전이 이벤트 발행
 * - 상태 조회 API 제공
 *
 * 다른 서비스들은 이 매니저를 구독하여 상태 변경에 반응
 */
export class ChatSessionStateManager extends Disposable {

	private static readonly LOG_CATEGORY = 'ChatSessionStateManager';

	// 세션별 상태 저장
	private readonly _sessionStates = new Map<string, ISessionChatSessionState>();

	// 상태 전이 이벤트
	private readonly _onDidChangeState = this._register(new Emitter<IChatSessionStateTransition>());
	readonly onDidChangeState: Event<IChatSessionStateTransition> = this._onDidChangeState.event;

	// idle 상태 진입 이벤트 (큐 처리 트리거용)
	private readonly _onDidBecomeIdle = this._register(new Emitter<string>());
	readonly onDidBecomeIdle: Event<string> = this._onDidBecomeIdle.event;

	// 입력 가능 상태 변경 이벤트 (UI용)
	private readonly _onDidChangeInputEnabled = this._register(new Emitter<{ sessionId: string; enabled: boolean }>());
	readonly onDidChangeInputEnabled: Event<{ sessionId: string; enabled: boolean }> = this._onDidChangeInputEnabled.event;

	constructor(
		private readonly _logService: IClaudeLogService
	) {
		super();
	}

	// ========== State Queries ==========

	/**
	 * 세션 상태 조회
	 */
	getState(sessionId: string): ChatSessionState {
		return this._sessionStates.get(sessionId)?.state ?? 'idle';
	}

	/**
	 * 세션 상태 정보 전체 조회
	 */
	getSessionState(sessionId: string): ISessionChatSessionState | undefined {
		return this._sessionStates.get(sessionId);
	}

	/**
	 * 입력 가능한 상태인지 확인
	 * idle 상태에서만 새 메시지 입력 가능
	 */
	isInputEnabled(sessionId: string): boolean {
		const state = this.getState(sessionId);
		return state === 'idle';
	}

	/**
	 * 메시지 전송 가능한 상태인지 확인
	 * idle 상태에서만 메시지 전송 가능 (큐에 추가가 아닌 직접 전송)
	 */
	canSendMessage(sessionId: string): boolean {
		return this.getState(sessionId) === 'idle';
	}

	/**
	 * 사용자 응답 대기 중인지 확인 (AskUser)
	 */
	isAsking(sessionId: string): boolean {
		return this.getState(sessionId) === 'asking';
	}

	/**
	 * 사용자 응답 대기 중인지 확인 (isAsking의 별칭)
	 */
	isWaitingForUser(sessionId: string): boolean {
		return this.getState(sessionId) === 'asking';
	}

	/**
	 * 클로드 응답 중인지 확인
	 */
	isResponding(sessionId: string): boolean {
		return this.getState(sessionId) === 'responding';
	}

	/**
	 * Rate limit 대기 중인지 확인
	 */
	isRateLimited(sessionId: string): boolean {
		return this.getState(sessionId) === 'rateLimit';
	}

	// ========== State Transitions ==========

	/**
	 * 상태 설정 (범용)
	 */
	setState(sessionId: string, newState: ChatSessionState, options?: {
		currentMessageId?: string;
		waitingReason?: string;
		errorMessage?: string;
		rateLimitCountdown?: number;
	}): void {
		const currentSessionState = this._sessionStates.get(sessionId);
		const previousState = currentSessionState?.state ?? 'idle';

		// 상태가 변경되지 않으면 early return
		if (previousState === newState && !options) {
			return;
		}

		const newSessionState: ISessionChatSessionState = {
			sessionId,
			state: newState,
			currentMessageId: options?.currentMessageId ?? currentSessionState?.currentMessageId,
			waitingReason: options?.waitingReason,
			errorMessage: options?.errorMessage,
			rateLimitCountdown: options?.rateLimitCountdown
		};

		this._sessionStates.set(sessionId, newSessionState);

		this._logService.debug(ChatSessionStateManager.LOG_CATEGORY,
			`State transition: ${sessionId} [${previousState}] -> [${newState}]`);

		// 상태 전이 이벤트 발행
		const transition: IChatSessionStateTransition = {
			sessionId,
			previousState,
			currentState: newState,
			timestamp: Date.now()
		};
		this._onDidChangeState.fire(transition);

		// idle 상태 진입 시 특별 이벤트 발행 (큐 처리 트리거)
		if (newState === 'idle' && previousState !== 'idle') {
			this._logService.debug(ChatSessionStateManager.LOG_CATEGORY,
				`Session became idle, firing onDidBecomeIdle: ${sessionId}`);
			this._onDidBecomeIdle.fire(sessionId);
		}

		// 입력 가능 상태 변경 이벤트
		const wasInputEnabled = previousState === 'idle';
		const isInputEnabled = newState === 'idle';
		if (wasInputEnabled !== isInputEnabled) {
			this._onDidChangeInputEnabled.fire({ sessionId, enabled: isInputEnabled });
		}
	}

	/**
	 * 스트리밍 시작
	 */
	startStreaming(sessionId: string, messageId: string): void {
		this.setState(sessionId, 'responding', { currentMessageId: messageId });
	}

	/**
	 * 스트리밍 완료 -> idle
	 */
	completeStreaming(sessionId: string): void {
		this.setState(sessionId, 'idle');
	}

	/**
	 * AskUser 대기 상태로 전환
	 */
	waitForUser(sessionId: string, reason?: string): void {
		this.setState(sessionId, 'asking', { waitingReason: reason });
	}

	/**
	 * 사용자 응답 완료 -> responding 재개
	 */
	resumeFromUserResponse(sessionId: string): void {
		const currentState = this._sessionStates.get(sessionId);
		this.setState(sessionId, 'responding', {
			currentMessageId: currentState?.currentMessageId
		});
	}

	/**
	 * Rate limit 대기 상태로 전환
	 */
	startRateLimitWait(sessionId: string, countdown: number): void {
		this.setState(sessionId, 'rateLimit', { rateLimitCountdown: countdown });
	}

	/**
	 * Rate limit 카운트다운 업데이트
	 */
	updateRateLimitCountdown(sessionId: string, countdown: number): void {
		const currentState = this._sessionStates.get(sessionId);
		if (currentState?.state === 'rateLimit') {
			this._sessionStates.set(sessionId, {
				...currentState,
				rateLimitCountdown: countdown
			});
		}
	}

	/**
	 * Rate limit 완료 -> idle 또는 responding
	 */
	completeRateLimitWait(sessionId: string, resumeResponding: boolean = false): void {
		this.setState(sessionId, resumeResponding ? 'responding' : 'idle');
	}

	/**
	 * 에러 상태로 전환
	 */
	setError(sessionId: string, errorMessage: string): void {
		this.setState(sessionId, 'error', { errorMessage });
	}

	/**
	 * 에러에서 복구 -> idle
	 */
	clearError(sessionId: string): void {
		this.setState(sessionId, 'idle');
	}

	/**
	 * 요청 취소 -> cancelled
	 */
	cancelRequest(sessionId: string): void {
		this.setState(sessionId, 'cancelled');
	}

	/**
	 * 사용자가 입력 시작 -> composing
	 */
	startComposing(sessionId: string): void {
		this.setState(sessionId, 'composing');
	}

	/**
	 * 사용자가 입력 완료 (텍스트 비움) -> idle
	 */
	stopComposing(sessionId: string): void {
		this.setState(sessionId, 'idle');
	}

	/**
	 * 메시지 전송 시작 -> sending
	 */
	startSending(sessionId: string, messageId?: string): void {
		this.setState(sessionId, 'sending', { currentMessageId: messageId });
	}

	/**
	 * Claude 응답 시작 -> responding
	 */
	startResponding(sessionId: string, messageId?: string): void {
		this.setState(sessionId, 'responding', { currentMessageId: messageId });
	}

	/**
	 * Claude가 사용자 선택 대기 -> asking
	 */
	startAsking(sessionId: string, reason?: string): void {
		this.setState(sessionId, 'asking', { waitingReason: reason });
	}

	/**
	 * 취소 상태에서 복구 -> idle
	 */
	clearCancelled(sessionId: string): void {
		this.setState(sessionId, 'idle');
	}

	// ========== Session Management ==========

	/**
	 * 세션 삭제
	 */
	deleteSession(sessionId: string): void {
		this._sessionStates.delete(sessionId);
		this._logService.debug(ChatSessionStateManager.LOG_CATEGORY, `Session deleted: ${sessionId}`);
	}

	/**
	 * 모든 세션 상태 초기화
	 */
	reset(): void {
		this._sessionStates.clear();
		this._logService.debug(ChatSessionStateManager.LOG_CATEGORY, 'All session states reset');
	}
}
