/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../../../../base/common/event.js';
import { Disposable } from '../../../../../base/common/lifecycle.js';
import { generateUuid } from '../../../../../base/common/uuid.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../../platform/storage/common/storage.js';
import { IClaudeMessage, IClaudeSession, IClaudeQueuedMessage } from '../../common/claudeTypes.js';

/**
 * 저장되는 세션 데이터 구조
 */
interface IStoredSession {
	id: string;
	cliSessionId?: string;  // Claude CLI의 --resume용 세션 ID
	createdAt: number;
	title?: string;
	messages: IClaudeMessage[];
	queuedMessages?: IClaudeQueuedMessage[];  // 세션별 대기 메시지 큐
}

/**
 * 세션 관리자
 * Claude 채팅 세션의 CRUD 및 저장/로드 담당
 */
export class ClaudeSessionManager extends Disposable {

	private _currentSession: IClaudeSession | undefined;
	private _sessions: IClaudeSession[] = [];

	private readonly _onDidChangeSession = this._register(new Emitter<IClaudeSession | undefined>());
	readonly onDidChangeSession: Event<IClaudeSession | undefined> = this._onDidChangeSession.event;

	private static readonly STORAGE_KEY = 'claude.sessions';

	constructor(
		private readonly storageService: IStorageService
	) {
		super();
	}

	/**
	 * 현재 세션
	 */
	get currentSession(): IClaudeSession | undefined {
		return this._currentSession;
	}

	/**
	 * 현재 세션 설정 (내부용)
	 */
	setCurrentSession(session: IClaudeSession | undefined): void {
		this._currentSession = session;
	}

	/**
	 * 모든 세션 목록
	 */
	get sessions(): IClaudeSession[] {
		return this._sessions;
	}

	/**
	 * 현재 세션이 있는지 확인
	 */
	hasCurrentSession(): boolean {
		return !!this._currentSession;
	}

	/**
	 * 초기화 - 저장된 세션 로드 및 현재 세션 설정
	 */
	initialize(): void {
		this.loadSessions();

		// 현재 세션이 없으면 새로 생성
		if (!this._currentSession) {
			this.startNewSession();
		}
	}

	/**
	 * 저장된 세션 로드
	 */
	private loadSessions(): void {
		try {
			const data = this.storageService.get(ClaudeSessionManager.STORAGE_KEY, StorageScope.WORKSPACE);
			if (data) {
				const parsed = JSON.parse(data) as { sessions: IClaudeSession[]; currentSessionId?: string };
				const rawSessions = parsed.sessions || [];

				// 중복 세션 제거 및 유효성 검증
				this._sessions = this.deduplicateAndValidateSessions(rawSessions);

				// 현재 세션 설정
				if (parsed.currentSessionId) {
					this._currentSession = this._sessions.find(s => s.id === parsed.currentSessionId);
				}
				if (!this._currentSession && this._sessions.length > 0) {
					this._currentSession = this._sessions[this._sessions.length - 1];
				}

				// 이전 메시지 개수 기록 (구분선 표시용)
				if (this._currentSession && this._currentSession.messages.length > 0) {
					(this._currentSession as { previousMessageCount?: number }).previousMessageCount = this._currentSession.messages.length;
					console.log('[SessionManager] Previous message count:', this._currentSession.previousMessageCount);
				}

				console.log('[SessionManager] Loaded sessions:', this._sessions.length);

				// 중복 제거로 인해 변경이 있었다면 저장
				if (this._sessions.length !== rawSessions.length) {
					console.log('[SessionManager] Removed duplicate sessions, saving cleaned data');
					this.saveSessions();
				}

				// 기존 전역 큐 마이그레이션 (한 번만 실행)
				this.migrateGlobalQueue();
			}
		} catch (e) {
			console.error('[SessionManager] Failed to load sessions:', e);
		}
	}

	/**
	 * 기존 전역 큐를 현재 세션으로 마이그레이션
	 */
	private migrateGlobalQueue(): void {
		const GLOBAL_QUEUE_KEY = 'claude.messageQueue';
		const MIGRATION_FLAG_KEY = 'claude.queueMigrated';

		// 이미 마이그레이션 완료했는지 확인
		const migrated = this.storageService.getBoolean(MIGRATION_FLAG_KEY, StorageScope.WORKSPACE, false);
		if (migrated) {
			return;
		}

		try {
			const globalQueueData = this.storageService.get(GLOBAL_QUEUE_KEY, StorageScope.WORKSPACE);
			if (globalQueueData && this._currentSession) {
				const globalQueue = JSON.parse(globalQueueData) as IClaudeQueuedMessage[];
				if (globalQueue.length > 0) {
					// 현재 세션에 큐 이전
					const currentSession = this._currentSession as IStoredSession;
					currentSession.queuedMessages = globalQueue;
					this.saveSessions();

					console.log('[SessionManager] Migrated global queue to current session:', globalQueue.length, 'messages');
				}
			}

			// 마이그레이션 플래그 설정
			this.storageService.store(MIGRATION_FLAG_KEY, true, StorageScope.WORKSPACE, StorageTarget.MACHINE);

			// 기존 전역 큐 삭제 (선택적)
			// this.storageService.remove(GLOBAL_QUEUE_KEY, StorageScope.WORKSPACE);

		} catch (e) {
			console.error('[SessionManager] Failed to migrate global queue:', e);
		}
	}

	/**
	 * 세션 저장
	 */
	saveSessions(): void {
		try {
			const data = JSON.stringify({
				sessions: this._sessions,
				currentSessionId: this._currentSession?.id
			});
			this.storageService.store(ClaudeSessionManager.STORAGE_KEY, data, StorageScope.WORKSPACE, StorageTarget.MACHINE);
		} catch (e) {
			console.error('[SessionManager] Failed to save sessions:', e);
		}
	}

	/**
	 * 새 세션 생성
	 */
	startNewSession(): IClaudeSession {
		// 고유한 ID 생성 (중복 방지)
		let sessionId = generateUuid();
		let attempts = 0;
		const maxAttempts = 10;

		// 중복 ID 체크 및 재시도
		while (this._sessions.some(s => s.id === sessionId) && attempts < maxAttempts) {
			console.warn('[SessionManager] Duplicate session ID detected, regenerating...', sessionId);
			sessionId = generateUuid();
			attempts++;
		}

		if (attempts >= maxAttempts) {
			console.error('[SessionManager] Failed to generate unique session ID after', maxAttempts, 'attempts');
			// 타임스탬프를 추가하여 강제로 고유성 확보
			sessionId = `${generateUuid()}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
		}

		const session: IClaudeSession = {
			id: sessionId,
			createdAt: Date.now(),
			messages: []
		};

		// 안전한 세션 추가
		if (!this.addSessionSafely(session)) {
			console.error('[SessionManager] Failed to add session safely');
			return session; // 실패해도 세션은 반환 (하위 호환성)
		}

		this._currentSession = session;
		this._onDidChangeSession.fire(session);

		// 세션 저장
		this.saveSessions();

		console.log('[SessionManager] New session created:', sessionId);
		return session;
	}

	/**
	 * 모든 세션 가져오기
	 */
	getSessions(): IClaudeSession[] {
		return [...this._sessions];
	}

	/**
	 * 특정 세션으로 전환
	 * @returns 전환된 세션 또는 undefined (찾지 못한 경우)
	 */
	switchSession(sessionId: string, onBeforeSwitch?: () => void): IClaudeSession | undefined {
		const session = this._sessions.find(s => s.id === sessionId);
		if (!session) {
			console.error('[SessionManager] Session not found:', sessionId);
			return undefined;
		}

		if (this._currentSession?.id === sessionId) {
			console.log('[SessionManager] Already on this session');
			return session;
		}

		console.log('[SessionManager] Switching to session:', sessionId);

		// 전환 전 콜백 (진행 중인 요청 취소 등)
		onBeforeSwitch?.();

		// 세션 전환
		this._currentSession = session;

		// 세션 저장 및 이벤트 발생
		this.saveSessions();
		this._onDidChangeSession.fire(session);

		return session;
	}

	/**
	 * 세션 삭제
	 */
	deleteSession(sessionId: string): boolean {
		const index = this._sessions.findIndex(s => s.id === sessionId);
		if (index === -1) {
			return false;
		}

		// 현재 세션이면 다른 세션으로 전환
		if (this._currentSession?.id === sessionId) {
			const otherSession = this._sessions.find(s => s.id !== sessionId);
			if (otherSession) {
				this.switchSession(otherSession.id);
			} else {
				// 마지막 세션이면 새 세션 생성
				this._sessions.splice(index, 1);
				this.startNewSession();
				this.saveSessions();
				return true;
			}
		}

		// 세션 삭제
		this._sessions.splice(index, 1);
		this.saveSessions();

		console.log('[SessionManager] Session deleted:', sessionId);
		return true;
	}

	/**
	 * 세션 제목 변경
	 */
	renameSession(sessionId: string, title: string): boolean {
		const session = this._sessions.find(s => s.id === sessionId);
		if (!session) {
			return false;
		}

		(session as { title?: string }).title = title;
		this.saveSessions();

		if (this._currentSession?.id === sessionId) {
			this._onDidChangeSession.fire(session);
		}

		return true;
	}

	/**
	 * 메시지 추가 (현재 세션 또는 지정된 세션)
	 */
	addMessage(message: IClaudeMessage, session?: IClaudeSession): void {
		const targetSession = session || this._currentSession;
		if (targetSession) {
			targetSession.messages.push(message);
		}
	}

	/**
	 * 메시지 업데이트 (현재 세션 또는 지정된 세션)
	 */
	updateMessage(message: IClaudeMessage, session?: IClaudeSession): boolean {
		const targetSession = session || this._currentSession;
		if (!targetSession) {
			return false;
		}

		const msgIndex = targetSession.messages.findIndex(m => m.id === message.id);
		if (msgIndex !== -1) {
			(targetSession.messages as IClaudeMessage[])[msgIndex] = message;
			return true;
		}
		return false;
	}

	/**
	 * ID로 세션 찾기
	 */
	getSessionById(sessionId: string): IClaudeSession | undefined {
		return this._sessions.find(s => s.id === sessionId);
	}

	/**
	 * 현재 세션 가져오기
	 */
	getCurrentSession(): IClaudeSession | undefined {
		return this._currentSession;
	}

	/**
	 * CLI 세션 ID 설정 (--resume 용)
	 */
	setCliSessionId(sessionId: string, cliSessionId: string): void {
		const session = this._sessions.find(s => s.id === sessionId) as IStoredSession | undefined;
		if (session) {
			session.cliSessionId = cliSessionId;
			this.saveSessions();
			console.log('[SessionManager] CLI session ID set for', sessionId, ':', cliSessionId);
		}
	}

	/**
	 * CLI 세션 ID 가져오기
	 */
	getCliSessionId(sessionId: string): string | undefined {
		const session = this._sessions.find(s => s.id === sessionId) as IStoredSession | undefined;
		return session?.cliSessionId;
	}

	/**
	 * 세션별 큐 저장
	 */
	saveSessionQueue(sessionId: string, queue: IClaudeQueuedMessage[]): void {
		const session = this._sessions.find(s => s.id === sessionId) as IStoredSession | undefined;
		if (session) {
			session.queuedMessages = queue;
			this.saveSessions();
		}
	}

	/**
	 * 세션별 큐 로드
	 */
	getSessionQueue(sessionId: string): IClaudeQueuedMessage[] {
		const session = this._sessions.find(s => s.id === sessionId) as IStoredSession | undefined;
		return session?.queuedMessages || [];
	}

	/**
	 * 현재 세션의 모든 메시지 가져오기
	 */
	getMessages(): IClaudeMessage[] {
		return this._currentSession?.messages ?? [];
	}

	/**
	 * 현재 세션의 히스토리 클리어
	 */
	clearHistory(): void {
		if (this._currentSession) {
			this._currentSession.messages.length = 0;
			this._onDidChangeSession.fire(this._currentSession);
			this.saveSessions();
		}
	}

	/**
	 * 중복 세션 제거 및 유효성 검증
	 */
	private deduplicateAndValidateSessions(sessions: IClaudeSession[]): IClaudeSession[] {
		const validSessions: IClaudeSession[] = [];
		const seenIds = new Set<string>();
		let removedCount = 0;

		for (const session of sessions) {
			// 유효성 검증
			if (!session || !session.id || !session.createdAt) {
				console.warn('[SessionManager] Invalid session detected, skipping:', session);
				removedCount++;
				continue;
			}

			// 중복 ID 체크
			if (seenIds.has(session.id)) {
				console.warn('[SessionManager] Duplicate session ID detected, skipping:', session.id);
				removedCount++;
				continue;
			}

			// messages 배열 유효성 체크
			if (!Array.isArray(session.messages)) {
				console.warn('[SessionManager] Invalid messages array, resetting for session:', session.id);
				// readonly 속성이므로 새 객체 생성
				const fixedSession: IClaudeSession = {
					...session,
					messages: []
				};
				seenIds.add(fixedSession.id);
				validSessions.push(fixedSession);
				continue;
			}

			seenIds.add(session.id);
			validSessions.push(session);
		}

		if (removedCount > 0) {
			console.log('[SessionManager] Removed', removedCount, 'invalid/duplicate sessions');
		}

		return validSessions;
	}

	/**
	 * 세션 ID 고유성 검증
	 */
	private validateSessionId(sessionId: string): boolean {
		if (!sessionId || typeof sessionId !== 'string') {
			return false;
		}
		return !this._sessions.some(s => s.id === sessionId);
	}

	/**
	 * 안전한 세션 추가 (중복 방지)
	 */
	private addSessionSafely(session: IClaudeSession): boolean {
		if (!this.validateSessionId(session.id)) {
			console.error('[SessionManager] Cannot add session with duplicate or invalid ID:', session.id);
			return false;
		}

		this._sessions.push(session);
		return true;
	}

	/**
	 * 세션 변경 이벤트 발생
	 */
	fireSessionChange(): void {
		this._onDidChangeSession.fire(this._currentSession);
	}
}
