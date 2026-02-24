/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IClaudeToolAction, ClaudeServiceState } from '../../../common/types/claudeTypes.js';
import {
	ICLIEventHandlerUnifiedContext,
	IConnectionContext,
	IStateContext,
	IMessageContext,
	IToolActionContext,
	ISessionInteractionContext,
	IFileOperationContext
} from './cliEventHandlerContext.js';

/**
 * ClaudeService의 CLI 이벤트 핸들러를 위한 컨텍스트 제공자
 * 47개 개별 콜백을 6개 그룹으로 정리
 */
export class ClaudeServiceContextProvider implements ICLIEventHandlerUnifiedContext {

	constructor(
		private readonly claudeService: any // ClaudeService 타입 (순환 참조 방지)
	) {}

	// ========== 연결 관련 ==========
	readonly connection: IConnectionContext = {
		confirmConnected: () => this.claudeService._multiConnection.confirmConnected(),
		getChannel: () => this.claudeService._createMultiSessionChannelWrapper()
	};

	// ========== 상태 관리 ==========
	readonly state: IStateContext = {
		getEffectivePermissionMode: () => {
			const localConfig = this.claudeService._configManager.getLocalConfig();
			return localConfig.permissionMode
				?? this.claudeService.configurationService?.getValue('claude.permissionMode')
				?? 'default';
		},
		setState: (state: ClaudeServiceState) => {
			// ChatStateManager에도 상태 반영 (중앙 집중 상태 관리)
			const sessionId = this.claudeService._sessionService.getCurrentSession()?.id;
			if (sessionId && this.claudeService._chatStateManager) {
				switch (state) {
					case 'idle':
						// AskUser 대기 중이면 idle로 전환하지 않음 (asking 상태 보존)
						if (!this.claudeService._chatStateManager.isWaitingForUser(sessionId)) {
							this.claudeService._chatStateManager.completeStreaming(sessionId);
						}
						break;
					case 'streaming':
						// startStreaming은 messageId가 필요해서 여기서는 호출하지 않음
						break;
					case 'error':
						this.claudeService._chatStateManager.setError(sessionId, 'Unknown error');
						break;
				}
			}
			this.claudeService.setState(state);
		},
		getLocalConfig: () => this.claudeService._localConfig,
		isAutoAcceptEnabled: () => this.claudeService.isAutoAcceptEnabled(),
		getWorkingDirectory: () => this.claudeService._configManager.getWorkingDirectory()
	};

	// ========== 메시지 관리 ==========
	readonly message: IMessageContext = {
		getCurrentMessageId: () => this.claudeService._sessionService.getCurrentMessageId() ?? this.claudeService._currentMessageId,
		setCurrentMessageId: (id: string | undefined) => {
			this.claudeService._sessionService.setCurrentMessageId(id);
			this.claudeService._currentMessageId = id;
		},
		getAccumulatedContent: () => this.claudeService._sessionService.getAccumulatedContent() ?? this.claudeService._accumulatedContent,
		setAccumulatedContent: (content: string) => {
			this.claudeService._sessionService.setAccumulatedContent(content);
			this.claudeService._accumulatedContent = content;
		},
		appendContent: (text: string) => {
			this.claudeService._sessionService.appendToAccumulatedContent(text);
			if (this.claudeService._accumulatedContent) {
				this.claudeService._accumulatedContent += '\n' + text;
			} else {
				this.claudeService._accumulatedContent = text;
			}
		},
		createAssistantMessage: (id) => {
			const assistantMessage = this.claudeService._messageService.createAssistantMessage(id);
			this.claudeService._sessionService.addMessage(assistantMessage);
			this.claudeService._messageService.fireMessageReceive(assistantMessage);
		},
		updateSessionMessage: (message) => this.claudeService._sessionService.updateMessage(message),
		fireMessageUpdate: (message) => this.claudeService._messageService.fireMessageUpdate(message),
		fireMessageReceive: (message) => {
			this.claudeService._sessionService.addMessage(message);
			this.claudeService._messageService.fireMessageReceive(message);
		}
	};

	// ========== 도구 액션 관리 ==========
	readonly toolAction: IToolActionContext = {
		getToolActions: () => {
			const sessionState = this.claudeService._sessionService.getCurrentSessionState();
			return sessionState?.toolActions ?? this.claudeService._toolActions;
		},
		addToolAction: (action) => {
			const sessionState = this.claudeService._sessionService.getCurrentSessionState();
			if (sessionState) {
				sessionState.toolActions.push(action);
			}
			this.claudeService._toolActions.push(action);
		},
		updateToolAction: (id, update) => {
			const sessionState = this.claudeService._sessionService.getCurrentSessionState();
			if (sessionState) {
				const idx = sessionState.toolActions.findIndex((a: IClaudeToolAction) => a.id === id);
				if (idx !== -1) {
					sessionState.toolActions[idx] = { ...sessionState.toolActions[idx], ...update };
				}
			}
			const idx = this.claudeService._toolActions.findIndex((a: IClaudeToolAction) => a.id === id);
			if (idx !== -1) {
				this.claudeService._toolActions[idx] = { ...this.claudeService._toolActions[idx], ...update };
			}
		},
		getCurrentToolAction: () => {
			const sessionState = this.claudeService._sessionService.getCurrentSessionState();
			return sessionState?.currentToolAction ?? this.claudeService._currentToolAction;
		},
		setCurrentToolAction: (action) => {
			const sessionState = this.claudeService._sessionService.getCurrentSessionState();
			if (sessionState) {
				sessionState.currentToolAction = action;
			}
			this.claudeService._currentToolAction = action;
			this.claudeService._uiService.fireToolActionChange(action);
		}
	};

	// ========== 세션 및 사용자 상호작용 ==========
	readonly sessionInteraction: ISessionInteractionContext = {
		// AskUser 관련
		getCurrentAskUserRequest: () => {
			const sessionState = this.claudeService._sessionService.getCurrentSessionState();
			return sessionState?.currentAskUserRequest ?? this.claudeService._currentAskUserRequest;
		},
		setCurrentAskUserRequest: (request) => {
			const sessionState = this.claudeService._sessionService.getCurrentSessionState();
			if (sessionState) {
				sessionState.currentAskUserRequest = request;
			}
			this.claudeService._currentAskUserRequest = request;
		},
		isWaitingForUser: () => {
			// ChatStateManager 우선 사용 (중앙 집중 상태 관리)
			const sessionId = this.claudeService._sessionService.getCurrentSession()?.id;
			if (sessionId && this.claudeService._chatStateManager) {
				return this.claudeService._chatStateManager.isWaitingForUser(sessionId);
			}
			// Legacy fallback
			const sessionState = this.claudeService._sessionService.getCurrentSessionState();
			return sessionState?.isWaitingForUser ?? this.claudeService._isWaitingForUser;
		},
		setWaitingForUser: (waiting) => {
			// ChatStateManager에 상태 반영 (중앙 집중 상태 관리)
			const sessionId = this.claudeService._sessionService.getCurrentSession()?.id;
			if (sessionId && this.claudeService._chatStateManager) {
				if (waiting) {
					this.claudeService._chatStateManager.waitForUser(sessionId);
				} else {
					// 'asking' 상태에서만 resumeFromUserResponse 호출
					// (handleComplete 정리 시 이미 idle인 상태에서 호출하면
					//  idle → responding 바운스가 발생하여 UI가 깜빡임)
					const currentChatState = this.claudeService._chatStateManager.getSessionState(sessionId);
					if (currentChatState?.state === 'asking') {
						this.claudeService._chatStateManager.resumeFromUserResponse(sessionId);
					}
				}
			}
			// Legacy 상태도 동기화
			const sessionState = this.claudeService._sessionService.getCurrentSessionState();
			if (sessionState) {
				sessionState.isWaitingForUser = waiting;
			}
			this.claudeService._isWaitingForUser = waiting;
		},

		// 세션 관리
		getCliSessionId: () => {
			const sessionState = this.claudeService._sessionService.getCurrentSessionState();
			return sessionState?.cliSessionId ?? this.claudeService._cliSessionId;
		},
		setCliSessionId: (id) => {
			const sessionState = this.claudeService._sessionService.getCurrentSessionState();
			if (sessionState) {
				sessionState.cliSessionId = id;
			}
			this.claudeService._cliSessionId = id;
		},
		hasCurrentSession: () => this.claudeService._sessionService.hasCurrentSession(),
		saveSessions: () => this.claudeService._sessionService.saveSessions(),

		// Usage 정보
		getUsage: () => {
			const sessionState = this.claudeService._sessionService.getCurrentSessionState();
			return sessionState?.usage ?? this.claudeService._usage;
		},
		setUsage: (usage) => {
			const sessionState = this.claudeService._sessionService.getCurrentSessionState();
			if (sessionState) {
				sessionState.usage = usage;
			}
			this.claudeService._usage = usage;
		}
	};

	// ========== 파일 및 작업 처리 ==========
	readonly fileOperation: IFileOperationContext = {
		// Rate limit
		startRateLimitHandling: (retryAfterSeconds, message) => this.claudeService.startRateLimitHandling(retryAfterSeconds, message),
		isRateLimitError: (error) => this.claudeService._rateLimitService.isRateLimitError(error),
		parseRetrySeconds: (error) => this.claudeService._rateLimitService.parseRetrySeconds(error) ?? undefined,

		// 큐 처리
		processQueue: () => this.claudeService.processQueue(),

		// 파일 스냅샷
		captureFileBeforeEdit: (filePath) => this.claudeService.fileService.captureBeforeEdit(filePath),
		captureFileAfterEdit: (filePath) => this.claudeService.fileService.captureAfterEdit(filePath),
		onCommandComplete: () => this.claudeService.handleCommandComplete()
	};
}