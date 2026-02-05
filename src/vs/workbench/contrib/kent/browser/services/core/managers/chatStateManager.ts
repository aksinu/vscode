/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../../../../../../base/common/event.js';
import { Disposable } from '../../../../../../../base/common/lifecycle.js';
import { IClaudeLogService } from '../../../../common/claudeLogService.js';

/**
 * 채팅 상태 타입
 * - idle: 입력 가능 상태
 * - streaming: Claude가 응답 생성 중
 * - waitingForUser: AskUser 대기 중 (사용자 응답 필요)
 * - rateLimit: Rate limit 대기 중
 * - error: 에러 상태
 */
export type ChatState = 'idle' | 'streaming' | 'waitingForUser' | 'rateLimit' | 'error';

/**
 * 상태 전이 정보
 */
export interface IChatStateTransition {
	readonly sessionId: string;
	readonly previousState: ChatState;
	readonly currentState: ChatState;
	readonly timestamp: number;
}

/**
 * 세션별 상태 정보
 */
export interface ISessionChatState {
	readonly sessionId: string;
	readonly state: ChatState;
	readonly currentMessageId?: string;
	readonly waitingReason?: string;
	readonly errorMessage?: string;
	readonly rateLimitCountdown?: number;
}

/**
 * ChatStateManager - 중앙 집중식 채팅 상태 관리
 *
 * 책임:
 * - 세션별 상태 관리 (idle, streaming, waitingForUser, rateLimit, error)
 * - 상태 전이 이벤트 발행
 * - 상태 조회 API 제공
 *
 * 다른 서비스들은 이 매니저를 구독하여 상태 변경에 반응
 */
export class ChatStateManager extends Disposable {

	private static readonly LOG_CATEGORY = 'ChatStateManager';

	// 세션별 상태 저장
	private readonly _sessionStates = new Map<string, ISessionChatState>();

	// 상태 전이 이벤트
	private readonly _onDidChangeState = this._register(new Emitter<IChatStateTransition>());
	readonly onDidChangeState: Event<IChatStateTransition> = this._onDidChangeState.event;

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
	getState(sessionId: string): ChatState {
		return this._sessionStates.get(sessionId)?.state ?? 'idle';
	}

	/**
	 * 세션 상태 정보 전체 조회
	 */
	getSessionState(sessionId: string): ISessionChatState | undefined {
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
	isWaitingForUser(sessionId: string): boolean {
		return this.getState(sessionId) === 'waitingForUser';
	}

	/**
	 * 스트리밍 중인지 확인
	 */
	isStreaming(sessionId: string): boolean {
		return this.getState(sessionId) === 'streaming';
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
	setState(sessionId: string, newState: ChatState, options?: {
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

		const newSessionState: ISessionChatState = {
			sessionId,
			state: newState,
			currentMessageId: options?.currentMessageId ?? currentSessionState?.currentMessageId,
			waitingReason: options?.waitingReason,
			errorMessage: options?.errorMessage,
			rateLimitCountdown: options?.rateLimitCountdown
		};

		this._sessionStates.set(sessionId, newSessionState);

		this._logService.debug(ChatStateManager.LOG_CATEGORY,
			`State transition: ${sessionId} [${previousState}] -> [${newState}]`);

		// 상태 전이 이벤트 발행
		const transition: IChatStateTransition = {
			sessionId,
			previousState,
			currentState: newState,
			timestamp: Date.now()
		};
		this._onDidChangeState.fire(transition);

		// idle 상태 진입 시 특별 이벤트 발행 (큐 처리 트리거)
		if (newState === 'idle' && previousState !== 'idle') {
			this._logService.debug(ChatStateManager.LOG_CATEGORY,
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
		this.setState(sessionId, 'streaming', { currentMessageId: messageId });
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
		this.setState(sessionId, 'waitingForUser', { waitingReason: reason });
	}

	/**
	 * 사용자 응답 완료 -> streaming 재개
	 */
	resumeFromUserResponse(sessionId: string): void {
		const currentState = this._sessionStates.get(sessionId);
		this.setState(sessionId, 'streaming', {
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
	 * Rate limit 완료 -> idle 또는 streaming
	 */
	completeRateLimitWait(sessionId: string, resumeStreaming: boolean = false): void {
		this.setState(sessionId, resumeStreaming ? 'streaming' : 'idle');
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
	 * 요청 취소 -> idle
	 */
	cancelRequest(sessionId: string): void {
		this.setState(sessionId, 'idle');
	}

	// ========== Session Management ==========

	/**
	 * 세션 삭제
	 */
	deleteSession(sessionId: string): void {
		this._sessionStates.delete(sessionId);
		this._logService.debug(ChatStateManager.LOG_CATEGORY, `Session deleted: ${sessionId}`);
	}

	/**
	 * 모든 세션 상태 초기화
	 */
	reset(): void {
		this._sessionStates.clear();
		this._logService.debug(ChatStateManager.LOG_CATEGORY, 'All session states reset');
	}
}
