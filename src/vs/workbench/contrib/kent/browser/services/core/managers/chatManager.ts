/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../../../../base/common/lifecycle.js';
import { generateUuid } from '../../../../../../../base/common/uuid.js';
import { IConfigurationService } from '../../../../../../../platform/configuration/common/configuration.js';
import { IClaudeCLIRequestOptions } from '../../../../common/claudeCLI.js';
import { IClaudeSessionService } from '../../../../common/types/claudeSessionService.js';
import { IClaudeMessageService } from '../../../../common/types/claudeMessageService.js';
import { IClaudeFileService } from '../../../../common/types/claudeFileService.js';
import { IClaudeUIService } from '../../../../common/types/claudeUIService.js';
import { IClaudeMessage, IAssistantMessage, IClaudeSendRequestOptions, resolveModelName } from '../../../../common/types/claudeTypes.js';
import { IClaudeLogService } from '../../../../common/claudeLogService.js';
import { IClaudeQueueService } from '../../../../common/types/claudeQueueService.js';
import { ClaudeContextBuilder } from '../claudeContextBuilder.js';
import { ClaudeMultiConnection } from '../claudeConnection.js';
import { ConfigManager } from './configManager.js';
import { MultiSessionManager } from './multiSessionManager.js';
import { ChatSessionStateManager as ChatStateManager } from './chatStateManager.js';

/**
 * ChatManager - 메시지 전송 핵심 로직
 * 책임: sendMessageInternal, sendMessageToSessionInternal, initializeNewMessageState
 */
export class ChatManager extends Disposable {

	private static readonly LOG_CATEGORY = 'ChatManager';

	// 컨텍스트 빌더
	private readonly _contextBuilder: ClaudeContextBuilder;

	// Legacy 단일 상태 (하위 호환성)
	private _currentMessageId: string | undefined;
	private _accumulatedContent: string = '';
	// Session overrides
	private _sessionModelOverride: string | undefined;
	private _sessionThinkingEnabled: boolean = false;
	private _sessionEffort: 'low' | 'medium' | 'high' | undefined;

	constructor(
		private readonly _configurationService: IConfigurationService,
		private readonly _sessionService: IClaudeSessionService,
		private readonly _messageService: IClaudeMessageService,
		private readonly _fileService: IClaudeFileService,
		private readonly _uiService: IClaudeUIService,
		private readonly _logService: IClaudeLogService,
		private readonly _queueService: IClaudeQueueService,
		private readonly _configManager: ConfigManager,
		private readonly _multiSessionManager: MultiSessionManager,
		private readonly _multiConnection: ClaudeMultiConnection,
		private readonly _chatStateManager?: ChatStateManager
	) {
		super();
		this._contextBuilder = new ClaudeContextBuilder();
	}

	/**
	 * 메시지 전송 (내부 구현)
	 */
	async sendMessageInternal(content: string, options?: IClaudeSendRequestOptions): Promise<IClaudeMessage> {
		if (!this._sessionService.hasCurrentSession()) {
			this._sessionService.startNewSession();
		}

		// 상태 기반 전송/큐 처리
		const queueSessionId = this._sessionService.getCurrentSession()?.id;
		if (queueSessionId && this._chatStateManager) {
			const currentState = this._chatStateManager.getState(queueSessionId);

			// 현재 상태가 idle이 아니면 메시지를 큐에 추가
			if (!this._chatStateManager.canSendMessage(queueSessionId)) {
				this._logService.info(ChatManager.LOG_CATEGORY, `📬 MESSAGE QUEUED - Current state: ${currentState}, queuing message`);
				const { message: queuedMessage, added } = this._queueService.addToQueue(content, options, queueSessionId);

				if (added) {
					// 큐에 성공적으로 추가됨 - queueRejected: false
					return {
						id: queuedMessage.id,
						role: 'user' as const,
						content: content,
						attachments: options?.context?.attachments,
						timestamp: Date.now(),
						queueRejected: false  // 큐에 추가됨, 거부 아님
					};
				} else {
					// 큐가 가득 차서 거부됨
					return {
						id: queuedMessage.id,
						role: 'user' as const,
						content: content,
						attachments: options?.context?.attachments,
						timestamp: Date.now(),
						queueRejected: true  // 큐 거부됨
					};
				}
			}

			this._logService.info(ChatManager.LOG_CATEGORY, `📤 DIRECT SEND - Current state: ${currentState}, sending directly`);
		}

		// 파일 스냅샷 매니저 초기화 - 새 명령 시작
		const workingDir = this._configManager.getWorkingDirectory();
		this._fileService.startCommand(workingDir);

		// 사용자 메시지 추가 (원본 content 사용)
		const userMessage: IClaudeMessage = {
			id: generateUuid(),
			role: 'user',
			content,
			timestamp: Date.now(),
			context: options?.context,
			// 첨부파일을 별도 필드로도 저장 (UI 렌더링용)
			attachments: options?.context?.attachments
		};

		this._sessionService.addMessage(userMessage);
		this._messageService.fireMessageReceive(userMessage);

		// 사용자 메시지 저장
		this._sessionService.saveSessions();

		// 세션 내 CLI 세션 ID 확인 — 있으면 후속 턴 (--resume 사용)
		const existingCliSessionId = this._sessionService.getCliSessionId();
		const isResumeTurn = !!existingCliSessionId;

		// 프롬프트 구성
		// CLI가 대화 히스토리를 내부적으로 관리하므로 히스토리를 포함하지 않음
		// (첫 턴/후속 턴 모두 — 이전에 첫 턴에서 히스토리를 포함했으나
		//  CLI의 CLAUDE.md + 시스템 프롬프트와 중복되어 "prompt is too long" 에러 유발)
		const prompt = this._contextBuilder.buildPromptWithContext(content, [], options?.context);

		// 스트리밍 메시지 생성 (헬퍼 메서드로 중복 제거)
		const messageId = generateUuid();
		this.initializeNewMessageState(messageId);

		const now = Date.now();
		const assistantMessage: IClaudeMessage = {
			id: messageId,
			role: 'assistant',
			content: '',
			timestamp: now,
			isStreaming: true,
			workStartTime: now
		};

		this._sessionService.addMessage(assistantMessage);
		this._messageService.fireMessageReceive(assistantMessage);

		// 메시지 전송 시작 - sending 상태로 전이
		const sendingSessionId = this._sessionService.getCurrentSession()?.id;
		if (sendingSessionId && this._chatStateManager) {
			this._chatStateManager.startSending(sendingSessionId, messageId);
		}

		// CLI 호출 - responding 상태로 전이
		this._sessionService.setState('streaming');
		if (sendingSessionId && this._chatStateManager) {
			this._chatStateManager.startResponding(sendingSessionId, messageId);
		}
		this._logService.debug(ChatManager.LOG_CATEGORY, 'State set to responding, calling CLI...');
		this._logService.debug(ChatManager.LOG_CATEGORY, 'Sending prompt to CLI:', prompt.substring(0, 100));

		try {
			// 채널 테스트 (Multi-Session)
			const testSessionId = this._sessionService.getCurrentSession()?.id || 'test';
			this._logService.debug(ChatManager.LOG_CATEGORY, 'Testing channel with isRunning for session:', testSessionId);
			const isRunning = await Promise.race([
				this._multiConnection.isRunning(testSessionId),
				new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Channel timeout')), 5000))
			]);
			this._logService.debug(ChatManager.LOG_CATEGORY, 'Channel test passed, isRunning:', isRunning);

			this._logService.debug(ChatManager.LOG_CATEGORY, 'Calling sendPrompt...');

			// CLI 옵션 빌드
			let cliOptions: IClaudeCLIRequestOptions;

			// 후속 턴이면 --resume으로 CLI 세션 이어가기
			// (터미널 CLI와 동일한 방식 — 히스토리는 CLI가 관리)
			if (isResumeTurn && existingCliSessionId) {
				// --resume 시에는 최소 옵션만 전달 (세션 설정은 첫 턴에서 이미 적용됨)
				cliOptions = {
					resumeSessionId: existingCliSessionId,
					workingDir: this._configManager.getWorkingDirectory(),
					executable: this._configManager.getLocalConfig().executable
				};
				this._logService.info(ChatManager.LOG_CATEGORY,
					`🔄 RESUME TURN - Using --resume with cliSessionId: ${existingCliSessionId}`);
			} else {
				cliOptions = this.buildCLIOptions(options);
				this._logService.info(ChatManager.LOG_CATEGORY,
					'🆕 FIRST TURN - Starting new CLI session');
			}

			// 15분 타임아웃 (복잡한 작업은 시간이 오래 걸릴 수 있음)
			const currentSessionId = this._sessionService.getCurrentSession()?.id;
			if (!currentSessionId) {
				throw new Error('No active session');
			}

			this._logService.debug(ChatManager.LOG_CATEGORY, 'Using multi-session sendPrompt for sessionId:', currentSessionId);
			// 타임아웃 없이 CLI 프로세스 완료까지 대기
			// Claude CLI는 복잡한 작업에 수십 분 이상 걸릴 수 있으므로
			// 프로세스 자체 종료 또는 사용자 취소에 의존
			await this._multiConnection.sendPrompt(currentSessionId, prompt, cliOptions);
			this._logService.debug(ChatManager.LOG_CATEGORY, 'sendPrompt completed, accumulated content:', this._accumulatedContent.substring(0, 100));

			// 완료 후 최종 메시지 반환
			const finalMessage: IClaudeMessage = {
				id: messageId,
				role: 'assistant',
				content: this._accumulatedContent,
				timestamp: Date.now(),
				isStreaming: false,
				workEndTime: Date.now()
			};

			// 스트리밍 완료 후 큐에 대기중인 메시지 처리
			this._logService.info(ChatManager.LOG_CATEGORY, `🎯 STREAMING COMPLETED for session ${currentSessionId}, checking queue...`);

			// 큐에 대기중인 메시지가 있는지 확인
			const queuedMessages = this._queueService.getQueuedMessages(currentSessionId);
			this._logService.info(ChatManager.LOG_CATEGORY,
				`🔍 QUEUE CHECK - Session: ${currentSessionId}, Queue length: ${queuedMessages.length}`);
			if (queuedMessages.length > 0) {
				this._logService.info(ChatManager.LOG_CATEGORY,
					`⚡ PROCESSING QUEUE - Found ${queuedMessages.length} messages, starting queue processing...`);
				this._queueService.processQueue(currentSessionId);
			} else {
				this._logService.info(ChatManager.LOG_CATEGORY, `✅ NO QUEUE - No messages in queue for session ${currentSessionId}`);
			}

			return finalMessage;
		} catch (error) {
			this._logService.error(ChatManager.LOG_CATEGORY, 'sendPrompt error:', error);

			// 타임아웃 에러 시 세션 상태 복구
			const errorSessionId = this._sessionService.getCurrentSession()?.id;
			if (errorSessionId) {
				this._multiSessionManager.handleSessionError(errorSessionId);

				// ChatStateManager에도 에러 상태 반영
				if (this._chatStateManager) {
					this._chatStateManager.setError(errorSessionId, error instanceof Error ? error.message : String(error));
				}
			}
			this._sessionService.setState('idle');
			this._uiService.fireStateChange('idle');

			throw error;
		}
	}

	/**
	 * 특정 세션에 메시지 전송 (내부용)
	 */
	async sendMessageToSessionInternal(sessionId: string, content: string, options?: IClaudeSendRequestOptions): Promise<IClaudeMessage> {
		// 세션 상태 가져오기 (future use)
		this._multiSessionManager.getOrCreateSessionState(sessionId);

		// 기본적으로는 sendMessageInternal과 동일하지만 특정 세션 대상
		// 현재는 단순화하여 현재 세션으로 전환 후 전송
		const currentSessionId = this._sessionService.getCurrentSession()?.id;
		if (sessionId !== currentSessionId) {
			this._sessionService.switchSession(sessionId);
		}

		return this.sendMessageInternal(content, options);
	}

	/**
	 * 새 메시지 시작 시 상태를 초기화하는 헬퍼 메서드
	 * Legacy와 세션별 상태 모두 동기화
	 */
	initializeNewMessageState(messageId: string): void {
		// Legacy 상태 초기화
		this._currentMessageId = messageId;
		this._accumulatedContent = '';

		// 세션 상태 초기화 (세션 서비스 메서드 사용)
		this._sessionService.setCurrentMessageId(messageId);
		this._sessionService.setAccumulatedContent('');
		this._sessionService.clearToolActions();
	}

	/**
	 * CLI 옵션 빌드
	 */
	private buildCLIOptions(options?: IClaudeSendRequestOptions): IClaudeCLIRequestOptions {
		const localConfig = this._configManager.getLocalConfig();

		// 모델 우선순위: options > session override > local config > VS Code config
		const rawModel = options?.model
			|| this._sessionModelOverride
			|| localConfig.model
			|| this._configurationService.getValue<string>('claude.model');
		const effectiveModel = resolveModelName(rawModel);

		// 로컬 설정 > VS Code 설정 우선순위로 옵션 결정
		const fallbackModel = localConfig.fallbackModel
			?? this._configurationService.getValue<string>('claude.fallbackModel');
		const appendSystemPrompt = this._configurationService.getValue<string>('claude.appendSystemPrompt');
		const disallowedTools = localConfig.disallowedTools
			?? this._configurationService.getValue<string[]>('claude.disallowedTools');
		const permissionMode = localConfig.permissionMode
			?? this._configurationService.getValue<'default' | 'plan' | 'accept-edits'>('claude.permissionMode');
		let betas = localConfig.betas
			?? this._configurationService.getValue<string[]>('claude.betas')
			?? [];

		// Extended Thinking 토글 반영
		if (this._sessionThinkingEnabled && !betas.includes('interleaved-thinking')) {
			betas = [...betas, 'interleaved-thinking'];
		} else if (!this._sessionThinkingEnabled && betas.includes('interleaved-thinking')) {
			betas = betas.filter(b => b !== 'interleaved-thinking');
		}

		return {
			model: effectiveModel,
			systemPrompt: options?.systemPrompt || this._configurationService.getValue<string>('claude.systemPrompt'),
			workingDir: this._configManager.getWorkingDirectory(),
			executable: localConfig.executable,
			// 새 옵션들 (로컬 설정 > VS Code 설정 우선순위)
			fallbackModel,
			appendSystemPrompt,
			disallowedTools,
			permissionMode,
			betas,
			// 로컬 설정 전용 옵션
			addDirs: localConfig.addDirs,
			mcpConfig: localConfig.mcpConfig,
			agents: localConfig.agents,
			effort: this._sessionEffort
		};
	}

	// ========== Getters/Setters for external access ==========

	get currentMessageId(): string | undefined {
		return this._currentMessageId;
	}

	get accumulatedContent(): string {
		return this._accumulatedContent;
	}

	set accumulatedContent(value: string) {
		this._accumulatedContent = value;
	}

	appendContent(text: string): void {
		this._accumulatedContent += text;
	}

	setSessionModelOverride(model: string | undefined): void {
		this._sessionModelOverride = model;
	}

	getSessionModelOverride(): string | undefined {
		return this._sessionModelOverride;
	}

	setSessionThinkingEnabled(enabled: boolean): void {
		this._sessionThinkingEnabled = enabled;
	}

	isSessionThinkingEnabled(): boolean {
		return this._sessionThinkingEnabled;
	}

	setSessionEffort(effort: 'low' | 'medium' | 'high' | undefined): void {
		this._sessionEffort = effort;
	}

	getSessionEffort(): 'low' | 'medium' | 'high' | undefined {
		return this._sessionEffort;
	}

	/**
	 * 멀티세션 요청 취소
	 */
	cancelSessionRequest(sessionId: string): void {
		this._multiConnection.cancelRequest(sessionId);

		// 세션 상태 가져오기
		const sessionState = this._sessionService.getSessionState(sessionId);

		// 현재 스트리밍 중인 메시지 업데이트
		if (sessionState.currentMessageId) {
			const session = this._sessionService.getSessionById(sessionId);
			if (session) {
				const message = session.messages.find((m: IClaudeMessage) => m.id === sessionState.currentMessageId);
				if (message && message.role === 'assistant' && message.isStreaming) {
					// 취소된 메시지로 업데이트
					const updatedMessage: IAssistantMessage = {
						...message,
						isStreaming: false,
						currentToolAction: undefined,
						workEndTime: Date.now(),
						isCanceled: true,
						cancelTime: Date.now()
					};
					if (this._sessionService.updateMessage(updatedMessage)) {
						this._messageService.fireMessageUpdate(updatedMessage);
					}
				}
			}
		}

		// 세션 상태 정리
		sessionState.state = 'idle';
		sessionState.currentMessageId = undefined;
		sessionState.accumulatedContent = '';

		// ChatStateManager에도 상태 반영
		if (this._chatStateManager) {
			this._chatStateManager.cancelRequest(sessionId);
		}
	}

	/**
	 * 요청 취소
	 */
	cancelRequest(): void {
		const sessionId = this._sessionService.getCurrentSession()?.id;
		if (sessionId) {
			this._multiConnection.cancelRequest(sessionId);

			// 세션 상태 초기화
			const sessionState = this._sessionService.getSessionState(sessionId);

			// 현재 스트리밍 중인 메시지 업데이트
			if (sessionState.currentMessageId) {
				const currentSession = this._sessionService.getCurrentSession();
				if (currentSession) {
					const message = currentSession.messages.find(m => m.id === sessionState.currentMessageId);
					if (message && message.role === 'assistant' && message.isStreaming) {
						// 취소 시 도구 상태도 정리하여 "진행 중" 표시 제거
						const updatedMessage: IAssistantMessage = {
							...message,
							isStreaming: false,
							currentToolAction: undefined,
							workEndTime: Date.now(),
							isCanceled: true,
							cancelTime: Date.now()
						};
						if (this._sessionService.updateMessage(updatedMessage)) {
							this._messageService.fireMessageUpdate(updatedMessage);
						}
					}
				}
			}

			// 세션 상태 정리 (도구 액션 포함)
			sessionState.state = 'idle';
			sessionState.currentMessageId = undefined;
			sessionState.accumulatedContent = '';
			this._sessionService.clearToolActions();

			// ChatStateManager에도 상태 반영 (중앙 집중 상태 관리)
			if (this._chatStateManager) {
				this._chatStateManager.completeStreaming(sessionId);
			}

			// idle 상태 이벤트 발생 (MultiSessionManager 방식 - 레거시)
			this._multiSessionManager.notifySessionBecameIdle(sessionId);
		}

		// Legacy 상태 초기화
		this._sessionService.setState('idle');
		this._currentMessageId = undefined;
		this._accumulatedContent = '';
	}
}
