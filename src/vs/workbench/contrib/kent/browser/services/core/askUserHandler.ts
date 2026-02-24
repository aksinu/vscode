/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { generateUuid } from '../../../../../../base/common/uuid.js';
import { IChannel } from '../../../../../../base/parts/ipc/common/ipc.js';
import { IClaudeAskUserRequest, IClaudeAskUserQuestion } from '../../../common/types/claudeTypes.js';
import { IClaudeCLIStreamEvent, IClaudeCLIRequestOptions } from '../../../common/claudeCLI.js';
import { IClaudeLogService } from '../../../common/claudeLogService.js';
import { ICLIEventHandlerUnifiedContext } from './cliEventHandlerContext.js';

/**
 * AskUserHandler가 호스트(CLIEventHandler)에 위임하는 콜백
 */
export interface IAskUserHandlerHost {
	handleComplete(): Promise<boolean>;
	handleError(error: string): void;
	updateCurrentMessage(): void;
}

/**
 * AskUser / InputRequest 처리 전담 핸들러
 * CLIEventHandler에서 분리된 AskUser 관련 로직을 담당
 */
export class AskUserHandler {

	private static readonly LOG_CATEGORY = 'AskUserHandler';

	// AskUser 응답으로 새 프로세스가 시작됨 → stale handleComplete 무시용
	private _askUserResumeInProgress = false;
	// respondToAskUser 진행 중 여부 (중복 호출 방어 — 즉시 설정)
	private _respondToAskUserInProgress = false;

	constructor(
		private readonly context: ICLIEventHandlerUnifiedContext,
		private readonly logService: IClaudeLogService,
		private readonly host: IAskUserHandlerHost
	) { }

	/**
	 * AskUser resume이 진행 중인지 확인
	 * (handleComplete에서 stale completion을 스킵하기 위해 사용)
	 */
	isResumeInProgress(): boolean {
		return this._askUserResumeInProgress;
	}

	/**
	 * AskUserQuestion 도구 이벤트 처리
	 */
	handleAskUserQuestion(event: IClaudeCLIStreamEvent): void {
		this.logService.debug(AskUserHandler.LOG_CATEGORY, 'AskUserQuestion received:', event.tool_input);

		const input = event.tool_input as {
			questions?: Array<{
				question: string;
				header?: string;
				options: Array<{ label: string; description?: string }>;
				multiSelect?: boolean
			}>
		} | undefined;

		if (!input?.questions) {
			this.logService.error(AskUserHandler.LOG_CATEGORY, 'AskUserQuestion missing questions');
			return;
		}

		this._processUserQuestion(input.questions, false, event.tool_use_id);
	}

	/**
	 * input_request 이벤트 처리
	 */
	handleInputRequest(event: IClaudeCLIStreamEvent): void {
		this.logService.debug(AskUserHandler.LOG_CATEGORY, 'InputRequest received:', event.questions);

		if (!event.questions || event.questions.length === 0) {
			this.logService.error(AskUserHandler.LOG_CATEGORY, 'InputRequest missing questions');
			return;
		}

		// input_request: 현재 메시지가 없으면 생성
		const message = this.context.message;
		if (!message.getCurrentMessageId()) {
			const newId = generateUuid();
			message.setCurrentMessageId(newId);
			message.setAccumulatedContent('');
			message.createAssistantMessage(newId);
		}

		this._processUserQuestion(event.questions, true);
	}

	/**
	 * AskUser 질문에 응답
	 */
	async respondToAskUser(responses: string[], askRequestFromUI?: IClaudeAskUserRequest): Promise<void> {
		console.log('[AskUser] respondToAskUser called', { responses, askRequestId: askRequestFromUI?.id, resumeInProgress: this._askUserResumeInProgress, respondInProgress: this._respondToAskUserInProgress });

		// 이미 응답 처리 중이면 중복 호출 무시 (즉시 체크 — UI 더블 클릭 및 재렌더 방어)
		if (this._respondToAskUserInProgress || this._askUserResumeInProgress) {
			this.logService.info(AskUserHandler.LOG_CATEGORY,
				`[AskUser] respondToAskUser ignored - already in progress (respond=${this._respondToAskUserInProgress}, resume=${this._askUserResumeInProgress})`);
			console.log('[AskUser] respondToAskUser BLOCKED - duplicate call');
			return;
		}
		this._respondToAskUserInProgress = true;

		const sessionInteraction = this.context.sessionInteraction;
		let askRequest = sessionInteraction.getCurrentAskUserRequest();

		// 세션 복원 후에는 런타임 상태가 초기화되어 있을 수 있음
		// UI에서 전달받은 askRequest로 복구 시도
		if (!askRequest && askRequestFromUI) {
			this.logService.info(AskUserHandler.LOG_CATEGORY, 'Restoring askRequest from UI (session was restored)');
			askRequest = askRequestFromUI;
			sessionInteraction.setCurrentAskUserRequest(askRequest);
		}

		if (!askRequest) {
			this.logService.error(AskUserHandler.LOG_CATEGORY, 'No askRequest available - cannot respond');
			this._respondToAskUserInProgress = false;
			return;
		}

		// isWaitingForUser가 false인 경우 (세션 복원 등) 자동 복구
		if (!sessionInteraction.isWaitingForUser()) {
			this.logService.info(AskUserHandler.LOG_CATEGORY, 'Auto-restoring waitingForUser state (was false, askRequest exists)');
			sessionInteraction.setWaitingForUser(true);
		}

		this.logService.info(AskUserHandler.LOG_CATEGORY, '[AskUser] respondToAskUser called with responses:', responses);

		const isInputRequest = askRequest.isInputRequest === true;
		const cliSessionId = sessionInteraction.getCliSessionId();
		const currentMessageId = this.context.message.getCurrentMessageId();
		this.logService.info(AskUserHandler.LOG_CATEGORY,
			`[AskUser] isInputRequest: ${isInputRequest}, cliSessionId: ${cliSessionId}, currentMessageId: ${currentMessageId}`);

		// 응답 텍스트
		const responseText = responses.join(', ');

		if (isInputRequest) {
			await this._handleInputResponse(responseText, sessionInteraction);
		} else if (cliSessionId) {
			await this._handleResumeResponse(responseText, cliSessionId, sessionInteraction);
		} else {
			// cliSessionId 없음 — resume 불가
			this.logService.error(AskUserHandler.LOG_CATEGORY,
				'[AskUser] No cliSessionId available - cannot resume CLI session. User must start a new conversation.');

			sessionInteraction.setWaitingForUser(false);
			sessionInteraction.setCurrentAskUserRequest(undefined);
			this.host.updateCurrentMessage();
			this.context.state.setState('idle');

			this.host.handleError('AskUser 응답을 전송할 수 없습니다. CLI 세션이 만료되었습니다. 새 대화를 시작해 주세요.');
			this._respondToAskUserInProgress = false;
		}
	}

	// ========== Private Methods ==========

	/**
	 * input_request 응답: 기존 CLI 프로세스의 stdin으로 전송
	 */
	private async _handleInputResponse(
		responseText: string,
		sessionInteraction: ICLIEventHandlerUnifiedContext['sessionInteraction']
	): Promise<void> {
		this.logService.debug(AskUserHandler.LOG_CATEGORY, 'Sending user input via stdin:', responseText);

		sessionInteraction.setWaitingForUser(false);
		sessionInteraction.setCurrentAskUserRequest(undefined);
		this.host.updateCurrentMessage();
		this.context.state.setState('streaming');

		try {
			await this.context.connection.getChannel().call('sendUserInput', [responseText]);
		} catch (error) {
			this.logService.error(AskUserHandler.LOG_CATEGORY, 'sendUserInput failed:', error);
			this.context.state.setState('idle');
			this.host.handleError(`User input failed: ${error}`);
		} finally {
			this._respondToAskUserInProgress = false;
		}
	}

	/**
	 * AskUserQuestion 응답: --resume 옵션으로 세션 재개
	 */
	private async _handleResumeResponse(
		responseText: string,
		cliSessionId: string,
		sessionInteraction: ICLIEventHandlerUnifiedContext['sessionInteraction']
	): Promise<void> {
		this.logService.info(AskUserHandler.LOG_CATEGORY, `[AskUser] Resuming session with cliSessionId: ${cliSessionId}, response: ${responseText}`);

		sessionInteraction.setWaitingForUser(false);
		sessionInteraction.setCurrentAskUserRequest(undefined);
		this.host.updateCurrentMessage();
		this.context.state.setState('streaming');

		try {
			// 이전 프로세스의 stale handleComplete가 도착해도 무시하도록 플래그 설정
			this._askUserResumeInProgress = true;

			// CLI 프로세스가 아직 실행 중일 수 있음 — 완료될 때까지 대기
			const channel = this.context.connection.getChannel();
			const isStillRunning = await channel.call<boolean>('isRunning', []);
			if (isStillRunning) {
				this.logService.info(AskUserHandler.LOG_CATEGORY,
					'[AskUser] CLI process still running, waiting for completion before resume...');
				await this._waitForProcessCompletion(channel, 30000);
				this.logService.info(AskUserHandler.LOG_CATEGORY,
					'[AskUser] CLI process completed, proceeding with resume');
			}

			const stateCtx = this.context.state;
			const effectivePermMode = stateCtx.getEffectivePermissionMode?.();
			const localConfig = stateCtx.getLocalConfig();
			const cliOptions: IClaudeCLIRequestOptions = {
				resumeSessionId: cliSessionId,
				permissionMode: effectivePermMode as IClaudeCLIRequestOptions['permissionMode'],
				workingDir: stateCtx.getWorkingDirectory?.(),
				executable: localConfig.executable
			};

			await channel.call('sendPrompt', [responseText, cliOptions]);

			// sendPrompt가 resolve된 후 — resume 프로세스가 완료됨
			this._askUserResumeInProgress = false;
			this._respondToAskUserInProgress = false;
			this.logService.info(AskUserHandler.LOG_CATEGORY, '[AskUser] Resume sendPrompt completed, calling handleComplete');
			await this.host.handleComplete();
		} catch (error) {
			this.logService.error(AskUserHandler.LOG_CATEGORY, '[AskUser] Resume failed:', error);
			this._askUserResumeInProgress = false;
			this._respondToAskUserInProgress = false;
			this.context.state.setState('idle');
			this.host.handleError(`AskUser resume failed: ${error}`);
		}
	}

	/**
	 * AskUserQuestion / InputRequest 공통 처리
	 */
	private _processUserQuestion(
		rawQuestions: Array<{ question: string; header?: string; options: Array<{ label: string; description?: string }>; multiSelect?: boolean }>,
		isInputRequest: boolean,
		toolUseId?: string
	): void {
		const questions: IClaudeAskUserQuestion[] = rawQuestions.map(q => ({
			question: q.question,
			header: q.header,
			options: q.options.map(o => ({ label: o.label, description: o.description })),
			multiSelect: q.multiSelect
		}));

		const sessionInteraction = this.context.sessionInteraction;
		const requestId = toolUseId || generateUuid();

		// Auto Accept 모드: 첫 번째 옵션 자동 선택
		if (this.context.state.isAutoAcceptEnabled() && questions.length > 0 && questions[0].options.length > 0) {
			const firstOption = questions[0].options[0].label;
			this.logService.debug(AskUserHandler.LOG_CATEGORY, `Auto-accept enabled${isInputRequest ? ' (input_request)' : ''}, selecting:`, firstOption);

			sessionInteraction.setCurrentAskUserRequest({
				id: requestId,
				questions,
				autoAccepted: true,
				autoAcceptedOption: firstOption,
				...(isInputRequest ? { isInputRequest: true } : {})
			} as IClaudeAskUserRequest & { autoAccepted?: boolean; autoAcceptedOption?: string });

			if (!isInputRequest) {
				sessionInteraction.setWaitingForUser(true);
			}
			this.host.updateCurrentMessage();

			setTimeout(() => {
				this.respondToAskUser([firstOption]).catch(error => {
					this.logService.error(AskUserHandler.LOG_CATEGORY, 'Failed to auto-respond to AskUser:', error);
					sessionInteraction.setWaitingForUser(false);
					this.host.updateCurrentMessage();
				});
			}, 500);
			return;
		}

		sessionInteraction.setCurrentAskUserRequest({
			id: requestId,
			questions,
			...(isInputRequest ? { isInputRequest: true } : {})
		});
		sessionInteraction.setWaitingForUser(true);

		this.logService.debug(AskUserHandler.LOG_CATEGORY, `Waiting for user response${isInputRequest ? ' (input_request)' : ''}...`);
		this.host.updateCurrentMessage();
	}

	/**
	 * CLI 프로세스 완료 대기
	 */
	private async _waitForProcessCompletion(channel: IChannel, timeoutMs: number): Promise<void> {
		const pollInterval = 100;
		const maxAttempts = Math.ceil(timeoutMs / pollInterval);

		for (let i = 0; i < maxAttempts; i++) {
			const running = await channel.call<boolean>('isRunning', []);
			if (!running) {
				return;
			}
			await new Promise(resolve => setTimeout(resolve, pollInterval));
		}

		this.logService.warn(AskUserHandler.LOG_CATEGORY,
			`[AskUser] Timed out waiting for process completion (${timeoutMs}ms), proceeding anyway`);
	}
}
