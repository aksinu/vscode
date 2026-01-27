/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../../base/common/lifecycle.js';
import { generateUuid } from '../../../../../base/common/uuid.js';
import { IChannel } from '../../../../../base/parts/ipc/common/ipc.js';
import { IClaudeMessage, IClaudeToolAction, IClaudeAskUserRequest, IClaudeAskUserQuestion } from '../../common/claudeTypes.js';
import { IClaudeCLIStreamEvent, IClaudeCLIRequestOptions } from '../../common/claudeCLI.js';
import { IClaudeLocalConfig } from '../../common/claudeLocalConfig.js';
import { IClaudeLogService } from '../../common/claudeLogService.js';

/**
 * CLI 이벤트 핸들러 콜백 인터페이스
 */
export interface ICLIEventHandlerCallbacks {
	// 연결
	confirmConnected(): void;

	// 상태
	setState(state: 'idle' | 'sending' | 'streaming' | 'error'): void;
	getLocalConfig(): IClaudeLocalConfig;

	// 메시지
	getCurrentMessageId(): string | undefined;
	setCurrentMessageId(id: string | undefined): void;
	getAccumulatedContent(): string;
	setAccumulatedContent(content: string): void;
	appendContent(text: string): void;

	// 도구 액션
	getToolActions(): IClaudeToolAction[];
	addToolAction(action: IClaudeToolAction): void;
	updateToolAction(id: string, update: Partial<IClaudeToolAction>): void;
	getCurrentToolAction(): IClaudeToolAction | undefined;
	setCurrentToolAction(action: IClaudeToolAction | undefined): void;

	// AskUser
	getCurrentAskUserRequest(): IClaudeAskUserRequest | undefined;
	setCurrentAskUserRequest(request: IClaudeAskUserRequest | undefined): void;
	isWaitingForUser(): boolean;
	setWaitingForUser(waiting: boolean): void;

	// 세션
	getCliSessionId(): string | undefined;
	setCliSessionId(id: string | undefined): void;
	hasCurrentSession(): boolean;
	createAssistantMessage(id: string): void;
	updateSessionMessage(message: IClaudeMessage): void;
	fireMessageUpdate(message: IClaudeMessage): void;
	fireMessageReceive(message: IClaudeMessage): void;
	saveSessions(): void;

	// Rate limit
	startRateLimitHandling(retryAfterSeconds: number, message?: string): void;
	isRateLimitError(error: string): boolean;
	parseRetrySeconds(error: string): number | undefined;

	// 큐
	processQueue(): void;

	// 채널
	getChannel(): IChannel;
}

/**
 * CLI 이벤트 핸들러
 * Claude CLI에서 오는 이벤트를 처리
 */
export class CLIEventHandler extends Disposable {

	private static readonly LOG_CATEGORY = 'CLIEventHandler';

	constructor(
		private readonly callbacks: ICLIEventHandlerCallbacks,
		private readonly logService: IClaudeLogService
	) {
		super();
	}

	/**
	 * CLI 데이터 이벤트 처리
	 */
	handleData(event: IClaudeCLIStreamEvent): void {
		this.logService.debug(CLIEventHandler.LOG_CATEGORY, handleData:', event.type, event.subtype || '');

		// 데이터를 받으면 연결된 것으로 판단
		this.callbacks.confirmConnected();

		// Rate limit 에러 처리
		if (event.type === 'error' && event.error_type === 'rate_limit') {
			this.logService.debug(CLIEventHandler.LOG_CATEGORY, Rate limit detected! Retry after:', event.retry_after, 'seconds');
			this.callbacks.startRateLimitHandling(event.retry_after || 60, event.content);
			return;
		}

		// system 이벤트 처리 (초기화)
		if (event.type === 'system') {
			this.handleSystemEvent(event);
			return;
		}

		// input_request 이벤트 처리 (AskUser - CLI 직접 형식)
		if (event.type === 'input_request' && event.questions) {
			this.handleInputRequest(event);
			return;
		}

		if (!this.callbacks.getCurrentMessageId() || !this.callbacks.hasCurrentSession()) {
			return;
		}

		// 도구 사용 이벤트 처리
		if (event.type === 'tool_use') {
			this.handleToolUse(event);
			return;
		}

		// 도구 결과 이벤트 처리
		if (event.type === 'tool_result') {
			this.handleToolResult(event);
			return;
		}

		// 텍스트 컨텐츠 추출
		const text = this.extractText(event);

		if (text) {
			this.callbacks.appendContent(text);
			this.updateCurrentMessage();
		}
	}

	/**
	 * CLI 완료 이벤트 처리
	 */
	handleComplete(): void {
		if (!this.callbacks.getCurrentMessageId() || !this.callbacks.hasCurrentSession()) {
			return;
		}

		// AskUser 대기 중이면 상태 유지
		if (this.callbacks.isWaitingForUser() && this.callbacks.getCurrentAskUserRequest()) {
			this.logService.debug(CLIEventHandler.LOG_CATEGORY, CLI completed but waiting for user response');
			const waitingMessage: IClaudeMessage = {
				id: this.callbacks.getCurrentMessageId()!,
				role: 'assistant',
				content: this.callbacks.getAccumulatedContent(),
				timestamp: Date.now(),
				isStreaming: false,
				toolActions: [...this.callbacks.getToolActions()],
				askUserRequest: this.callbacks.getCurrentAskUserRequest(),
				isWaitingForUser: true
			};

			this.callbacks.updateSessionMessage(waitingMessage);
			this.callbacks.fireMessageUpdate(waitingMessage);
			this.callbacks.setState('idle');
			this.callbacks.saveSessions();
			return;
		}

		// 최종 메시지
		const finalMessage: IClaudeMessage = {
			id: this.callbacks.getCurrentMessageId()!,
			role: 'assistant',
			content: this.callbacks.getAccumulatedContent(),
			timestamp: Date.now(),
			isStreaming: false,
			toolActions: [...this.callbacks.getToolActions()]
		};

		this.callbacks.updateSessionMessage(finalMessage);
		this.callbacks.fireMessageUpdate(finalMessage);
		this.callbacks.setState('idle');

		// 응답 성공 시 연결 확인
		this.callbacks.confirmConnected();

		// 세션 저장
		this.callbacks.saveSessions();

		// 상태 리셋
		this.callbacks.setCurrentMessageId(undefined);
		this.callbacks.setAccumulatedContent('');
		this.callbacks.setCurrentToolAction(undefined);
		this.callbacks.setCliSessionId(undefined);

		// 큐에 대기 중인 메시지 처리
		this.callbacks.processQueue();
	}

	/**
	 * CLI 에러 이벤트 처리
	 */
	handleError(error: string): void {
		this.logService.debug(CLIEventHandler.LOG_CATEGORY, handleError:', error);

		// Rate limit 에러인지 확인
		if (this.callbacks.isRateLimitError(error)) {
			this.logService.debug(CLIEventHandler.LOG_CATEGORY, Rate limit detected in error message');
			const retrySeconds = this.callbacks.parseRetrySeconds(error) || 60;
			this.callbacks.startRateLimitHandling(retrySeconds, error);
			return;
		}

		if (!this.callbacks.hasCurrentSession()) {
			return;
		}

		const errorMessage: IClaudeMessage = {
			id: this.callbacks.getCurrentMessageId() || generateUuid(),
			role: 'assistant',
			content: `Error: ${error}`,
			timestamp: Date.now(),
			isError: true
		};

		// 기존 스트리밍 메시지가 있으면 업데이트, 없으면 추가
		if (this.callbacks.getCurrentMessageId()) {
			this.callbacks.updateSessionMessage(errorMessage);
			this.callbacks.fireMessageUpdate(errorMessage);
		} else {
			this.callbacks.fireMessageReceive(errorMessage);
		}

		this.callbacks.setState('error');
		this.callbacks.setCurrentMessageId(undefined);
		this.callbacks.setAccumulatedContent('');
	}

	/**
	 * AskUser 질문에 응답
	 */
	async respondToAskUser(responses: string[]): Promise<void> {
		if (!this.callbacks.isWaitingForUser() || !this.callbacks.getCurrentAskUserRequest()) {
			this.logService.error(CLIEventHandler.LOG_CATEGORY, Not waiting for user input');
			return;
		}

		this.logService.debug(CLIEventHandler.LOG_CATEGORY, User responded:', responses);
		const cliSessionId = this.callbacks.getCliSessionId();
		this.logService.debug(CLIEventHandler.LOG_CATEGORY, CLI session ID for resume:', cliSessionId);

		// 상태 리셋
		this.callbacks.setWaitingForUser(false);
		this.callbacks.setCurrentAskUserRequest(undefined);

		// 응답 텍스트
		const responseText = responses.join(', ');

		if (cliSessionId) {
			// --resume 옵션으로 세션 재개
			this.logService.debug(CLIEventHandler.LOG_CATEGORY, Resuming session with response:', responseText);

			this.updateCurrentMessage();
			this.callbacks.setState('streaming');

			try {
				const cliOptions: IClaudeCLIRequestOptions = {
					resumeSessionId: cliSessionId
				};

				await this.callbacks.getChannel().call('sendPrompt', [responseText, cliOptions]);
			} catch (error) {
				this.logService.error(CLIEventHandler.LOG_CATEGORY, Resume failed:', error);
			}
		} else {
			this.logService.debug(CLIEventHandler.LOG_CATEGORY, No session ID, sending as new message');
			this.updateCurrentMessage();
		}
	}

	// ========== Private Methods ==========

	private handleSystemEvent(event: IClaudeCLIStreamEvent): void {
		this.logService.debug(CLIEventHandler.LOG_CATEGORY, System event - Claude initializing...');
		const systemEvent = event as { session_id?: string };
		if (systemEvent.session_id) {
			this.callbacks.setCliSessionId(systemEvent.session_id);
			this.logService.debug(CLIEventHandler.LOG_CATEGORY, CLI session ID:', systemEvent.session_id);
		}

		if (this.callbacks.getCurrentMessageId() && this.callbacks.hasCurrentSession()) {
			this.callbacks.setAccumulatedContent('');
			this.updateCurrentMessage();
		}
	}

	private handleToolUse(event: IClaudeCLIStreamEvent): void {
		const toolName = event.tool_name || 'unknown';

		// AskUserQuestion 도구 처리
		if (toolName === 'AskUserQuestion') {
			this.handleAskUserQuestion(event);
			return;
		}

		const toolAction: IClaudeToolAction = {
			id: event.tool_use_id || generateUuid(),
			tool: toolName,
			status: 'running',
			input: event.tool_input
		};

		this.callbacks.setCurrentToolAction(toolAction);
		this.callbacks.addToolAction(toolAction);

		this.logService.debug(CLIEventHandler.LOG_CATEGORY, Tool use started:', toolAction.tool, toolAction.input);
		this.updateCurrentMessage();
	}

	private handleAskUserQuestion(event: IClaudeCLIStreamEvent): void {
		this.logService.debug(CLIEventHandler.LOG_CATEGORY, AskUserQuestion received:', event.tool_input);

		const input = event.tool_input as {
			questions?: Array<{
				question: string;
				header?: string;
				options: Array<{ label: string; description?: string }>;
				multiSelect?: boolean
			}>
		} | undefined;

		if (!input?.questions) {
			this.logService.error(CLIEventHandler.LOG_CATEGORY, AskUserQuestion missing questions');
			return;
		}

		const questions: IClaudeAskUserQuestion[] = input.questions.map(q => ({
			question: q.question,
			header: q.header,
			options: q.options.map(o => ({ label: o.label, description: o.description })),
			multiSelect: q.multiSelect
		}));

		const localConfig = this.callbacks.getLocalConfig();

		// Auto Accept 모드: 첫 번째 옵션 자동 선택
		if (localConfig.autoAccept && questions.length > 0 && questions[0].options.length > 0) {
			const firstOption = questions[0].options[0].label;
			this.logService.debug(CLIEventHandler.LOG_CATEGORY, Auto-accept enabled, selecting:', firstOption);

			this.callbacks.setCurrentAskUserRequest({
				id: event.tool_use_id || generateUuid(),
				questions,
				autoAccepted: true,
				autoAcceptedOption: firstOption
			} as IClaudeAskUserRequest & { autoAccepted?: boolean; autoAcceptedOption?: string });
			this.updateCurrentMessage();

			setTimeout(() => {
				this.respondToAskUser([firstOption]);
			}, 500);
			return;
		}

		this.callbacks.setCurrentAskUserRequest({
			id: event.tool_use_id || generateUuid(),
			questions
		});
		this.callbacks.setWaitingForUser(true);

		this.logService.debug(CLIEventHandler.LOG_CATEGORY, Waiting for user response...');
		this.updateCurrentMessage();
	}

	private handleInputRequest(event: IClaudeCLIStreamEvent): void {
		this.logService.debug(CLIEventHandler.LOG_CATEGORY, InputRequest received:', event.questions);

		if (!event.questions || event.questions.length === 0) {
			this.logService.error(CLIEventHandler.LOG_CATEGORY, InputRequest missing questions');
			return;
		}

		// 현재 메시지가 없으면 생성
		if (!this.callbacks.getCurrentMessageId()) {
			const newId = generateUuid();
			this.callbacks.setCurrentMessageId(newId);
			this.callbacks.setAccumulatedContent('');
			this.callbacks.createAssistantMessage(newId);
		}

		const questions: IClaudeAskUserQuestion[] = event.questions.map(q => ({
			question: q.question,
			header: q.header,
			options: q.options.map(o => ({ label: o.label, description: o.description })),
			multiSelect: q.multiSelect
		}));

		const localConfig = this.callbacks.getLocalConfig();

		// Auto Accept 모드
		if (localConfig.autoAccept && questions.length > 0 && questions[0].options.length > 0) {
			const firstOption = questions[0].options[0].label;
			this.logService.debug(CLIEventHandler.LOG_CATEGORY, Auto-accept enabled (input_request), selecting:', firstOption);

			this.callbacks.setCurrentAskUserRequest({
				id: generateUuid(),
				questions,
				autoAccepted: true,
				autoAcceptedOption: firstOption
			} as IClaudeAskUserRequest & { autoAccepted?: boolean; autoAcceptedOption?: string });
			this.updateCurrentMessage();

			setTimeout(() => {
				this.respondToAskUser([firstOption]);
			}, 500);
			return;
		}

		this.callbacks.setCurrentAskUserRequest({
			id: generateUuid(),
			questions
		});
		this.callbacks.setWaitingForUser(true);

		this.logService.debug(CLIEventHandler.LOG_CATEGORY, Waiting for user response (input_request)...');
		this.updateCurrentMessage();
	}

	private handleToolResult(event: IClaudeCLIStreamEvent): void {
		const currentToolAction = this.callbacks.getCurrentToolAction();
		if (currentToolAction) {
			this.callbacks.updateToolAction(currentToolAction.id, {
				status: event.is_error ? 'error' : 'completed',
				output: event.tool_result,
				error: event.is_error ? event.tool_result : undefined
			});

			this.callbacks.setCurrentToolAction(undefined);
			this.logService.debug(CLIEventHandler.LOG_CATEGORY, Tool use completed:', currentToolAction.tool);
			this.updateCurrentMessage();
		}
	}

	private extractText(event: IClaudeCLIStreamEvent): string {
		let text = '';

		if (event.type === 'assistant' && event.message) {
			if (typeof event.message === 'object' && event.message.content) {
				for (const block of event.message.content) {
					if (block.type === 'text' && block.text) {
						text += block.text;
					} else if (block.type === 'tool_use' && block.name) {
						this.handleToolUse({
							type: 'tool_use',
							tool_use_id: generateUuid(),
							tool_name: block.name,
							tool_input: block.input
						});
					}
				}
			} else if (typeof event.message === 'string') {
				text = event.message;
			}
		} else if (event.type === 'result' && event.result) {
			text = event.result;
		} else if (event.type === 'content_block_delta' && event.delta?.text) {
			text = event.delta.text;
		} else if (event.type === 'text' && event.content) {
			text = event.content;
		}

		return text;
	}

	private updateCurrentMessage(): void {
		const currentMessageId = this.callbacks.getCurrentMessageId();
		if (!currentMessageId || !this.callbacks.hasCurrentSession()) {
			return;
		}

		const updatedMessage: IClaudeMessage = {
			id: currentMessageId,
			role: 'assistant',
			content: this.callbacks.getAccumulatedContent(),
			timestamp: Date.now(),
			isStreaming: !this.callbacks.isWaitingForUser(),
			toolActions: [...this.callbacks.getToolActions()],
			currentToolAction: this.callbacks.getCurrentToolAction(),
			askUserRequest: this.callbacks.getCurrentAskUserRequest(),
			isWaitingForUser: this.callbacks.isWaitingForUser()
		};

		this.callbacks.updateSessionMessage(updatedMessage);
		this.callbacks.fireMessageUpdate(updatedMessage);
	}
}
