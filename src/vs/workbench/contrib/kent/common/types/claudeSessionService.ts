/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../../../base/common/event.js';
import { createDecorator } from '../../../../../platform/instantiation/common/instantiation.js';
import { IClaudeSession, ClaudeServiceState, IClaudeMessage, IClaudeToolAction, IClaudeQueuedMessage } from './claudeTypes.js';

export interface ISessionState {
	state: ClaudeServiceState;
	currentMessageId: string | undefined;
	accumulatedContent: string | undefined;
	isWaitingForUser: boolean;
	toolActions: IClaudeToolAction[];
	waitingMessageIds: Set<string>;
	pendingRequests: IClaudeQueuedMessage[];
	cliSessionId: string | undefined;
}

export const IClaudeSessionService = createDecorator<IClaudeSessionService>('claudeSessionService');

export interface IClaudeSessionService {
	readonly _serviceBrand: undefined;

	readonly onDidChangeSession: Event<IClaudeSession | undefined>;

	// Session Management
	getCurrentSession(): IClaudeSession | undefined;
	getSessionState(sessionId: string): ISessionState;
	getCurrentSessionState(): ISessionState | undefined;

	// Session State Management
	getState(): ClaudeServiceState;
	setState(state: ClaudeServiceState, sessionId?: string): void;

	// Session Content Management
	getCurrentMessageId(): string | undefined;
	setCurrentMessageId(id: string | undefined): void;

	getAccumulatedContent(): string | undefined;
	setAccumulatedContent(content: string | undefined): void;
	appendToAccumulatedContent(text: string): void;

	// Tool Actions
	getToolActions(): IClaudeToolAction[];
	addToolAction(action: IClaudeToolAction): void;
	clearToolActions(): void;

	// Waiting State
	getIsWaitingForUser(): boolean;
	setIsWaitingForUser(waiting: boolean): void;

	// Waiting Messages
	getWaitingMessageIds(): Set<string>;
	addWaitingMessageId(messageId: string): void;
	removeWaitingMessageId(messageId: string): void;
	clearWaitingMessageIds(): void;

	// Pending Requests
	getPendingRequests(): IClaudeQueuedMessage[];
	addPendingRequest(request: IClaudeQueuedMessage): void;
	removePendingRequest(request: IClaudeQueuedMessage): void;
	clearPendingRequests(): void;

	// CLI Session
	getCliSessionId(): string | undefined;
	setCliSessionId(sessionId: string | undefined): void;

	// Delegates for UI updates
	setOnDidChangeStateDelegate(delegate: (state: ClaudeServiceState) => void): void;

	// Session Management Methods (from SessionManager)
	initialize(): void;
	hasCurrentSession(): boolean;
	startNewSession(): IClaudeSession;
	switchSession(sessionId: string, onSwitch?: () => void): boolean;
	deleteSession(sessionId: string): boolean;
	renameSession(sessionId: string, title: string): boolean;
	getSessions(): IClaudeSession[];
	getSessionById(sessionId: string): IClaudeSession | undefined;
	clearHistory(): void;
	saveSessions(): void;

	// Message Management Methods
	addMessage(message: IClaudeMessage, session?: IClaudeSession): void;
	updateMessage(message: IClaudeMessage, session?: IClaudeSession): boolean;
	getMessages(sessionId?: string): IClaudeMessage[];
	getSessionQueue(sessionId: string): IClaudeQueuedMessage[];
}