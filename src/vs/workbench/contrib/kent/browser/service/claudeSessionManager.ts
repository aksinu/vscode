/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../../../../base/common/event.js';
import { Disposable } from '../../../../../base/common/lifecycle.js';
import { generateUuid } from '../../../../../base/common/uuid.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../../platform/storage/common/storage.js';
import { IClaudeMessage, IClaudeSession } from '../../common/claudeTypes.js';

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
				this._sessions = parsed.sessions || [];
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
			}
		} catch (e) {
			console.error('[SessionManager] Failed to load sessions:', e);
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
		const session: IClaudeSession = {
			id: generateUuid(),
			createdAt: Date.now(),
			messages: []
		};

		this._sessions.push(session);
		this._currentSession = session;
		this._onDidChangeSession.fire(session);

		// 세션 저장
		this.saveSessions();

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
	 * 현재 세션에 메시지 추가
	 */
	addMessage(message: IClaudeMessage): void {
		if (this._currentSession) {
			this._currentSession.messages.push(message);
		}
	}

	/**
	 * 현재 세션의 메시지 업데이트
	 */
	updateMessage(message: IClaudeMessage): boolean {
		if (!this._currentSession) {
			return false;
		}

		const msgIndex = this._currentSession.messages.findIndex(m => m.id === message.id);
		if (msgIndex !== -1) {
			(this._currentSession.messages as IClaudeMessage[])[msgIndex] = message;
			return true;
		}
		return false;
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
	 * 세션 변경 이벤트 발생
	 */
	fireSessionChange(): void {
		this._onDidChangeSession.fire(this._currentSession);
	}
}
