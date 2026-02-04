/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../../../../base/common/event.js';
import { Disposable } from '../../../../../../base/common/lifecycle.js';
import { IStorageService } from '../../../../../../platform/storage/common/storage.js';
import { IConfigurationService } from '../../../../../../platform/configuration/common/configuration.js';
import { IClaudeSessionService, ISessionState } from '../../../common/types/claudeSessionService.js';
import { IClaudeSession, ClaudeServiceState, IClaudeToolAction, IClaudeQueuedMessage, IClaudeMessage } from '../../../common/types/claudeTypes.js';
import { ClaudeSessionManager } from './claudeSessionManager.js';

/**
 * Claude 세션 관리 서비스
 *
 * ClaudeSessionManager의 기능을 서비스 패턴으로 래핑하여
 * 세션 상태 관리와 세션 라이프사이클을 담당합니다.
 */
export class ClaudeSessionService extends Disposable implements IClaudeSessionService {
	declare readonly _serviceBrand: undefined;

	private readonly _sessionManager: ClaudeSessionManager;
	private readonly _sessionStates = new Map<string, ISessionState>();

	// State change delegate
	private _onDidChangeStateDelegate: ((state: ClaudeServiceState) => void) | undefined;

	constructor(
		@IStorageService private readonly storageService: IStorageService,
		@IConfigurationService private readonly configurationService: IConfigurationService
	) {
		super();

		// SessionManager 초기화
		this._sessionManager = this._register(new ClaudeSessionManager(
			this.storageService,
			this.configurationService
		));
	}

	// ========== Event Forwarding ==========

	get onDidChangeSession(): Event<IClaudeSession | undefined> {
		return this._sessionManager.onDidChangeSession;
	}

	// ========== Session Management ==========

	initialize(): void {
		this._sessionManager.initialize();
	}

	getCurrentSession(): IClaudeSession | undefined {
		return this._sessionManager.getCurrentSession();
	}

	hasCurrentSession(): boolean {
		return this._sessionManager.hasCurrentSession();
	}

	startNewSession(): IClaudeSession {
		return this._sessionManager.startNewSession();
	}

	switchSession(sessionId: string, onSwitch?: () => void): boolean {
		const result = this._sessionManager.switchSession(sessionId, onSwitch);
		return !!result;
	}

	deleteSession(sessionId: string): boolean {
		return this._sessionManager.deleteSession(sessionId);
	}

	renameSession(sessionId: string, title: string): boolean {
		return this._sessionManager.renameSession(sessionId, title);
	}

	getSessions(): IClaudeSession[] {
		return this._sessionManager.getSessions();
	}

	getSessionById(sessionId: string): IClaudeSession | undefined {
		return this._sessionManager.getSessionById(sessionId);
	}

	clearHistory(): void {
		this._sessionManager.clearHistory();
	}

	saveSessions(): void {
		this._sessionManager.saveSessions();
	}

	// ========== Message Management ==========

	addMessage(message: any, session?: IClaudeSession): void {
		this._sessionManager.addMessage(message, session);
	}

	updateMessage(message: any, session?: IClaudeSession): boolean {
		return this._sessionManager.updateMessage(message, session);
	}

	getMessages(sessionId?: string): IClaudeMessage[] {
		if (sessionId) {
			const session = this._sessionManager.getSessionById(sessionId);
			return session?.messages || [];
		}
		return this._sessionManager.getMessages();
	}

	getSessionQueue(sessionId: string): IClaudeQueuedMessage[] {
		return this._sessionManager.getSessionQueue(sessionId);
	}

	// ========== Session State Management ==========

	getSessionState(sessionId: string): ISessionState {
		const existing = this._sessionStates.get(sessionId);
		if (existing) {
			return existing;
		}

		// 기본 세션 상태 생성
		const defaultState: ISessionState = {
			state: 'idle',
			currentMessageId: undefined,
			accumulatedContent: undefined,
			isWaitingForUser: false,
			toolActions: [],
			waitingMessageIds: new Set<string>(),
			pendingRequests: [],
			cliSessionId: undefined
		};

		this._sessionStates.set(sessionId, defaultState);
		return defaultState;
	}

	getCurrentSessionState(): ISessionState | undefined {
		const currentSession = this.getCurrentSession();
		return currentSession ? this.getSessionState(currentSession.id) : undefined;
	}

	getState(): ClaudeServiceState {
		const currentState = this.getCurrentSessionState();
		return currentState?.state || 'idle';
	}

	setState(state: ClaudeServiceState, sessionId?: string): void {
		const targetSessionId = sessionId || this.getCurrentSession()?.id;
		if (targetSessionId) {
			const sessionState = this.getSessionState(targetSessionId);
			sessionState.state = state;

			// UI 업데이트 델리게이트 호출
			if (this._onDidChangeStateDelegate) {
				this._onDidChangeStateDelegate(state);
			}
		}
	}

	// ========== Session Content Management ==========

	getCurrentMessageId(): string | undefined {
		const currentState = this.getCurrentSessionState();
		return currentState?.currentMessageId;
	}

	setCurrentMessageId(id: string | undefined): void {
		const currentState = this.getCurrentSessionState();
		if (currentState) {
			currentState.currentMessageId = id;
		}
	}

	getAccumulatedContent(): string | undefined {
		const currentState = this.getCurrentSessionState();
		return currentState?.accumulatedContent;
	}

	setAccumulatedContent(content: string | undefined): void {
		const currentState = this.getCurrentSessionState();
		if (currentState) {
			currentState.accumulatedContent = content;
		}
	}

	appendToAccumulatedContent(text: string): void {
		const currentState = this.getCurrentSessionState();
		if (currentState) {
			currentState.accumulatedContent = (currentState.accumulatedContent || '') + text;
		}
	}

	// ========== Tool Actions ==========

	getToolActions(): IClaudeToolAction[] {
		const currentState = this.getCurrentSessionState();
		return currentState?.toolActions || [];
	}

	addToolAction(action: any): void {
		const currentState = this.getCurrentSessionState();
		if (currentState) {
			currentState.toolActions.push(action);
		}
	}

	clearToolActions(): void {
		const currentState = this.getCurrentSessionState();
		if (currentState) {
			currentState.toolActions.length = 0;
		}
	}

	// ========== Waiting State ==========

	getIsWaitingForUser(): boolean {
		const currentState = this.getCurrentSessionState();
		return currentState?.isWaitingForUser || false;
	}

	setIsWaitingForUser(waiting: boolean): void {
		const currentState = this.getCurrentSessionState();
		if (currentState) {
			currentState.isWaitingForUser = waiting;
		}
	}

	// ========== Waiting Messages ==========

	getWaitingMessageIds(): Set<string> {
		const currentState = this.getCurrentSessionState();
		return currentState?.waitingMessageIds || new Set();
	}

	addWaitingMessageId(messageId: string): void {
		const currentState = this.getCurrentSessionState();
		if (currentState) {
			currentState.waitingMessageIds.add(messageId);
		}
	}

	removeWaitingMessageId(messageId: string): void {
		const currentState = this.getCurrentSessionState();
		if (currentState) {
			currentState.waitingMessageIds.delete(messageId);
		}
	}

	clearWaitingMessageIds(): void {
		const currentState = this.getCurrentSessionState();
		if (currentState) {
			currentState.waitingMessageIds.clear();
		}
	}

	// ========== Pending Requests ==========

	getPendingRequests(): IClaudeQueuedMessage[] {
		const currentState = this.getCurrentSessionState();
		return currentState?.pendingRequests || [];
	}

	addPendingRequest(request: any): void {
		const currentState = this.getCurrentSessionState();
		if (currentState) {
			currentState.pendingRequests.push(request);
		}
	}

	removePendingRequest(request: any): void {
		const currentState = this.getCurrentSessionState();
		if (currentState) {
			const index = currentState.pendingRequests.indexOf(request);
			if (index !== -1) {
				currentState.pendingRequests.splice(index, 1);
			}
		}
	}

	clearPendingRequests(): void {
		const currentState = this.getCurrentSessionState();
		if (currentState) {
			currentState.pendingRequests.length = 0;
		}
	}

	// ========== CLI Session ==========

	getCliSessionId(): string | undefined {
		const currentState = this.getCurrentSessionState();
		return currentState?.cliSessionId;
	}

	setCliSessionId(sessionId: string | undefined): void {
		const currentState = this.getCurrentSessionState();
		if (currentState) {
			currentState.cliSessionId = sessionId;
		}
	}

	// ========== Delegates ==========

	setOnDidChangeStateDelegate(delegate: (state: ClaudeServiceState) => void): void {
		this._onDidChangeStateDelegate = delegate;
	}
}