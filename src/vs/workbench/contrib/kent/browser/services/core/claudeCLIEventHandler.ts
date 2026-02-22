/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../../../base/common/lifecycle.js';
import { generateUuid } from '../../../../../../base/common/uuid.js';
import { IChannel } from '../../../../../../base/parts/ipc/common/ipc.js';
import { IClaudeMessage, IClaudeToolAction, IClaudeAskUserRequest, IClaudeAskUserQuestion, IClaudeUsageInfo, IClaudeSubagentUsage } from '../../../common/types/claudeTypes.js';
import { IClaudeCLIStreamEvent, IClaudeCLIRequestOptions } from '../../../common/claudeCLI.js';
import { IClaudeLocalConfig } from '../../../common/config/claudeLocalConfig.js';
import { IClaudeLogService } from '../../../common/claudeLogService.js';
import { ICLIEventHandlerUnifiedContext, ICLIEventHandlerContext } from './cliEventHandlerContext.js';

/**
 * CLI 이벤트 핸들러 콜백 인터페이스
 */
export interface ICLIEventHandlerCallbacks {
	// 연결
	confirmConnected(): void;

	// 상태
	setState(state: 'idle' | 'sending' | 'streaming' | 'error'): void;
	getLocalConfig(): IClaudeLocalConfig;
	isAutoAcceptEnabled(): boolean;

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

	// Usage
	getUsage(): IClaudeUsageInfo | undefined;
	setUsage(usage: IClaudeUsageInfo | undefined): void;

	// File Snapshot (Diff 용)
	captureFileBeforeEdit(filePath: string): Promise<void>;
	captureFileAfterEdit(filePath: string): Promise<void>;
	onCommandComplete(): Promise<void>;
}

/**
 * CLI 이벤트 핸들러
 * Claude CLI에서 오는 이벤트를 처리
 */
export class CLIEventHandler extends Disposable {

	private static readonly LOG_CATEGORY = 'CLIEventHandler';

	// 현재 진행 중인 데이터 처리 작업 (race condition 방지용)
	private _dataOperationQueue: (() => Promise<void>)[] = [];
	private _isProcessingDataQueue = false;

	// handleData 호출 추적 (handleComplete가 모든 handleData 완료를 기다리기 위함)
	private _pendingHandleDataPromises: Set<Promise<void>> = new Set();

	// AskUser 응답으로 새 프로세스가 시작됨 → stale handleComplete 무시용
	private _askUserResumeInProgress = false;
	// respondToAskUser 진행 중 여부 (중복 호출 방어 — 즉시 설정)
	private _respondToAskUserInProgress = false;

	private readonly callbacks?: ICLIEventHandlerCallbacks;
	private readonly unifiedContext?: ICLIEventHandlerUnifiedContext;
	private readonly _context?: ICLIEventHandlerContext;

	/**
	 * Legacy 생성자 (47개 개별 콜백)
	 */
	constructor(callbacks: ICLIEventHandlerCallbacks, logService: IClaudeLogService);
	/**
	 * 새로운 생성자 (6개 그룹화된 컨텍스트)
	 */
	constructor(unifiedContext: ICLIEventHandlerUnifiedContext, logService: IClaudeLogService);
	/**
	 * 최신 생성자 (통합 컨텍스트 패턴)
	 */
	constructor(context: ICLIEventHandlerContext, logService: IClaudeLogService);
	constructor(
		callbacksOrContext: ICLIEventHandlerCallbacks | ICLIEventHandlerUnifiedContext | ICLIEventHandlerContext,
		private readonly logService: IClaudeLogService
	) {
		super();

		// 타입 구분
		if ('getConnection' in callbacksOrContext) {
			// 최신 통합 컨텍스트 (메모리 최적화)
			this._context = callbacksOrContext;
			void this._context; // Reserved for future use
			this.logService.info(CLIEventHandler.LOG_CATEGORY, 'Using optimized context pattern (memory efficient)');
		} else if ('connection' in callbacksOrContext) {
			// 6개 그룹 컨텍스트
			this.unifiedContext = callbacksOrContext;
			this.logService.info(CLIEventHandler.LOG_CATEGORY, 'Using unified context pattern (6 groups)');
		} else {
			// Legacy 개별 콜백
			this.callbacks = callbacksOrContext;
			this.logService.info(CLIEventHandler.LOG_CATEGORY, 'Using legacy callback pattern (47 individual callbacks)');
		}
	}

	// ========== 통합 접근 헬퍼 메서드들 ==========

	private getState() {
		return this.unifiedContext?.state || this.callbacks!;
	}

	private getMessage() {
		return this.unifiedContext?.message || this.callbacks!;
	}

	private getToolAction() {
		return this.unifiedContext?.toolAction || this.callbacks!;
	}

	private getSessionInteraction() {
		return this.unifiedContext?.sessionInteraction || this.callbacks!;
	}

	private getFileOperation() {
		return this.unifiedContext?.fileOperation || this.callbacks!;
	}

	private getConnection() {
		return this.unifiedContext?.connection || this.callbacks!;
	}

	/**
	 * CLI 데이터 이벤트 처리
	 */
	async handleData(event: IClaudeCLIStreamEvent): Promise<void> {
		this.logService.debug(CLIEventHandler.LOG_CATEGORY, 'handleData:', event.type, event.subtype || '');

		// handleComplete가 이 호출의 완료를 기다릴 수 있도록 Promise 추적
		const dataPromise = this._handleDataInternal(event);
		this._pendingHandleDataPromises.add(dataPromise);
		dataPromise.finally(() => {
			this._pendingHandleDataPromises.delete(dataPromise);
		});
		return dataPromise;
	}

	private async _handleDataInternal(event: IClaudeCLIStreamEvent): Promise<void> {

		// 데이터를 받으면 연결된 것으로 판단
		this.getConnection().confirmConnected();

		// Rate limit 에러 처리
		if (event.type === 'error' && event.error_type === 'rate_limit') {
			this.logService.debug(CLIEventHandler.LOG_CATEGORY, 'Rate limit detected! Retry after:', event.retry_after, 'seconds');
			this.getFileOperation().startRateLimitHandling(event.retry_after || 60, event.content);
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

		if (!this.getMessage().getCurrentMessageId() || !this.getSessionInteraction().hasCurrentSession()) {
			return;
		}

		// 도구 사용 이벤트 처리 (파일 캡처를 위해 await 필수, 순서 보장을 위해 큐 사용)
		if (event.type === 'tool_use') {
			await this.enqueueDataOperation(() => this.handleToolUse(event));
			return;
		}

		// 도구 결과 이벤트 처리 (파일 캡처를 위해 await 필수, 순서 보장을 위해 큐 사용)
		if (event.type === 'tool_result') {
			await this.enqueueDataOperation(() => this.handleToolResult(event));
			return;
		}

		// result 이벤트에서 usage 정보 추출
		if (event.type === 'result' && event.usage) {
			// 서브에이전트 정보 추출 (Task 도구 사용 내역)
			const subagents = this.extractSubagentUsage();

			this.getSessionInteraction().setUsage({
				inputTokens: event.usage.input_tokens || 0,
				outputTokens: event.usage.output_tokens || 0,
				cacheReadTokens: event.usage.cache_read_input_tokens,
				cacheCreationTokens: event.usage.cache_creation_input_tokens,
				totalCostUsd: event.total_cost_usd,
				subagents: subagents.length > 0 ? subagents : undefined
			});
			this.logService.debug(CLIEventHandler.LOG_CATEGORY, 'Usage extracted:', event.usage, 'subagents:', subagents);
		}

		// assistant 이벤트의 tool_use 블록을 큐를 통해 처리 (race condition 방지)
		const toolUseBlocks = this.extractToolUseBlocks(event);
		for (const block of toolUseBlocks) {
			await this.enqueueDataOperation(() => this.handleToolUse({
				type: 'tool_use',
				tool_use_id: block.tool_use_id,
				tool_name: block.tool_name,
				tool_input: block.tool_input
			}));
		}

		// 텍스트 컨텐츠 추출
		const text = this.extractText(event);

		if (text) {
			this.getMessage().appendContent(text);
			this.updateCurrentMessage();
		}
	}

	/**
	 * CLI 완료 이벤트 처리
	 * @returns true면 정상 처리, false면 스킵됨 (stale completion)
	 */
	async handleComplete(): Promise<boolean> {
		this.logService.info(CLIEventHandler.LOG_CATEGORY, '[FileChanges] handleComplete started, waiting for pending operations...');

		// AskUser 응답으로 새 프로세스가 이미 시작된 경우, 이전 프로세스의 handleComplete는 무시
		// (respondToAskUser가 상태를 이미 리셋하고 새 스트리밍을 시작했으므로 stale 이벤트)
		// flag은 respondToAskUser에서 sendPrompt가 resolve된 후에만 리셋됨
		// → 이렇게 해야 resume 중 발생하는 모든 stale handleComplete를 확실히 무시
		if (this._askUserResumeInProgress) {
			this.logService.info(CLIEventHandler.LOG_CATEGORY,
				'[AskUser] handleComplete skipped - AskUser resume already in progress (stale completion from previous process)');
			return false;
		}

		// 진행 중인 handleData 호출이 완료될 때까지 대기 (race condition 방지)
		// handleData가 아직 enqueueDataOperation을 호출하기 전일 수 있으므로,
		// handleData Promise 자체를 먼저 기다려야 함
		if (this._pendingHandleDataPromises.size > 0) {
			this.logService.info(CLIEventHandler.LOG_CATEGORY,
				`[FileChanges] Waiting for ${this._pendingHandleDataPromises.size} pending handleData calls...`);
			await Promise.all([...this._pendingHandleDataPromises]);
		}

		// 진행 중인 데이터 처리 작업이 완료될 때까지 대기 (race condition 방지)
		while (this._isProcessingDataQueue || this._dataOperationQueue.length > 0) {
			await new Promise(resolve => setTimeout(resolve, 10));
		}
		this.logService.info(CLIEventHandler.LOG_CATEGORY, '[FileChanges] handleComplete: pending operations done');

		const message = this.getMessage();
		const sessionInteraction = this.getSessionInteraction();
		const toolAction = this.getToolAction();

		if (!message.getCurrentMessageId() || !sessionInteraction.hasCurrentSession()) {
			this.logService.info(CLIEventHandler.LOG_CATEGORY, '[FileChanges] handleComplete: no message or session, returning');
			return true;
		}

		// AskUser 대기 중이면 상태 유지
		const isWaiting = sessionInteraction.isWaitingForUser();
		const askRequest = sessionInteraction.getCurrentAskUserRequest();
		this.logService.info(CLIEventHandler.LOG_CATEGORY,
			`[AskUser] handleComplete check: isWaitingForUser=${isWaiting}, hasAskRequest=${!!askRequest}, askRequestId=${askRequest?.id}`);
		if (isWaiting && askRequest) {
			this.logService.info(CLIEventHandler.LOG_CATEGORY, '[AskUser] CLI completed but waiting for user response - preserving asking state');
			const waitingMessage: IClaudeMessage = {
				id: message.getCurrentMessageId()!,
				role: 'assistant',
				content: message.getAccumulatedContent(),
				timestamp: Date.now(),
				isStreaming: false,
				toolActions: [...toolAction.getToolActions()],
				currentToolAction: undefined,  // 명시적으로 제거
				askUserRequest: sessionInteraction.getCurrentAskUserRequest(),
				isWaitingForUser: true,
				cliSessionId: sessionInteraction.getCliSessionId()
			};

			message.updateSessionMessage(waitingMessage);
			message.fireMessageUpdate(waitingMessage);
			// AskUser 대기 중이므로 setState('idle') 호출하지 않음 — 'asking' 상태 유지
			// (setState('idle')을 호출하면 chatStateManager.isWaitingForUser()가 false를 반환하여
			//  메시지 재렌더링 시 AskUser UI가 사라지는 문제 발생)
			sessionInteraction.saveSessions();
			return true;
		}

		// 최종 메시지
		// toolActions에서 아직 running 상태인 도구를 completed로 강제 변경
		// (tool_result 없이 result가 먼저 온 경우 대비)
		const finalToolActions = toolAction.getToolActions().map(action => {
			if (action.status === 'running') {
				return { ...action, status: 'completed' as const };
			}
			return action;
		});

		const finalMessage: IClaudeMessage = {
			id: message.getCurrentMessageId()!,
			role: 'assistant',
			content: message.getAccumulatedContent(),
			timestamp: Date.now(),
			isStreaming: false,
			toolActions: finalToolActions,
			currentToolAction: undefined,  // 명시적으로 undefined 설정하여 merge 시 이전 running 상태 제거
			askUserRequest: undefined,  // 명시적으로 undefined 설정하여 merge 시 이전 AskUser 상태 제거
			isWaitingForUser: false,
			usage: sessionInteraction.getUsage(),
			cliSessionId: sessionInteraction.getCliSessionId()  // 세션 복원 시 --resume에 필요
		};

		message.updateSessionMessage(finalMessage);
		message.fireMessageUpdate(finalMessage);

		// 상태 리셋 (큐 처리 전에 먼저 완료해야 함!)
		this.getState().setState('idle');
		sessionInteraction.setWaitingForUser(false);
		sessionInteraction.setCurrentAskUserRequest(undefined);

		// 응답 성공 시 연결 확인
		this.getConnection().confirmConnected();

		// 파일 변경사항 처리 (상태 리셋 전에 호출해야 함! await 필수!)
		this.logService.info(CLIEventHandler.LOG_CATEGORY, '[FileChanges] Calling onCommandComplete...');
		await this.getFileOperation().onCommandComplete();
		this.logService.info(CLIEventHandler.LOG_CATEGORY, '[FileChanges] onCommandComplete done');

		// 세션 저장
		this.getSessionInteraction().saveSessions();

		// 상태 리셋
		this.getMessage().setCurrentMessageId(undefined);
		this.getMessage().setAccumulatedContent('');
		this.getToolAction().setCurrentToolAction(undefined);
		// cliSessionId는 보존! 후속 턴에서 --resume으로 세션 연속성 유지를 위해 필요
		// (이전: setCliSessionId(undefined) → 매 턴마다 새 세션 시작 → 토큰 낭비)
		this.getSessionInteraction().setUsage(undefined);
		// 큐 리셋 (새로운 큐 시스템)
		this._dataOperationQueue = [];
		this._isProcessingDataQueue = false;

		// 큐에 대기 중인 메시지 처리
		this.getFileOperation().processQueue();

		return true;
	}

	/**
	 * CLI 에러 이벤트 처리
	 */
	handleError(error: string): void {
		this.logService.debug(CLIEventHandler.LOG_CATEGORY, 'handleError:', error);

		const fileOperation = this.getFileOperation();
		const sessionInteraction = this.getSessionInteraction();
		const message = this.getMessage();

		// Rate limit 에러인지 확인
		if (fileOperation.isRateLimitError(error)) {
			this.logService.debug(CLIEventHandler.LOG_CATEGORY, 'Rate limit detected in error message');
			const retrySeconds = fileOperation.parseRetrySeconds(error) || 60;
			fileOperation.startRateLimitHandling(retrySeconds, error);
			return;
		}

		if (!sessionInteraction.hasCurrentSession()) {
			return;
		}

		// 사용자 친화적 에러 메시지 변환
		const displayError = this.formatUserFriendlyError(error);

		const errorMessage: IClaudeMessage = {
			id: message.getCurrentMessageId() || generateUuid(),
			role: 'assistant',
			content: displayError,
			timestamp: Date.now(),
			isError: true,
			isStreaming: false,
			currentToolAction: undefined  // 명시적으로 제거하여 merge 시 이전 running 상태 정리
		};

		// 기존 스트리밍 메시지가 있으면 업데이트, 없으면 추가
		if (message.getCurrentMessageId()) {
			message.updateSessionMessage(errorMessage);
			message.fireMessageUpdate(errorMessage);
		} else {
			message.fireMessageReceive(errorMessage);
		}

		this.getState().setState('error');

		// 도구 상태 정리 (에러 발생 시에도 currentToolAction이 running으로 남으면
		// 다음 메시지 응답 시 이전 메시지에 스피너가 다시 뜨는 버그 방지)
		this.getToolAction().setCurrentToolAction(undefined);

		message.setCurrentMessageId(undefined);
		message.setAccumulatedContent('');
	}

	/**
	 * CLI 에러를 사용자 친화적 메시지로 변환
	 */
	private formatUserFriendlyError(error: string): string {
		const lowerError = error.toLowerCase();

		// Prompt too long / context window 초과
		if (lowerError.includes('prompt is too long') ||
			lowerError.includes('too many tokens') ||
			lowerError.includes('context length exceeded') ||
			lowerError.includes('content_too_large') ||
			lowerError.includes('maximum context length')) {
			return '대화가 너무 길어져서 처리할 수 없습니다.\n새 세션을 시작해 주세요. (세션 관리 버튼 → 새 세션)';
		}

		// 기본: 원본 에러
		return `Error: ${error}`;
	}

	/**
	 * AskUser 질문에 응답
	 */
	async respondToAskUser(responses: string[], askRequestFromUI?: IClaudeAskUserRequest): Promise<void> {
		console.log('[AskUser] respondToAskUser called', { responses, askRequestId: askRequestFromUI?.id, resumeInProgress: this._askUserResumeInProgress, respondInProgress: this._respondToAskUserInProgress });

		// 이미 응답 처리 중이면 중복 호출 무시 (즉시 체크 — UI 더블 클릭 및 재렌더 방어)
		if (this._respondToAskUserInProgress || this._askUserResumeInProgress) {
			this.logService.info(CLIEventHandler.LOG_CATEGORY,
				`[AskUser] respondToAskUser ignored - already in progress (respond=${this._respondToAskUserInProgress}, resume=${this._askUserResumeInProgress})`);
			console.log('[AskUser] respondToAskUser BLOCKED - duplicate call');
			return;
		}
		this._respondToAskUserInProgress = true;

		const sessionInteraction = this.getSessionInteraction();
		let askRequest = sessionInteraction.getCurrentAskUserRequest();

		// 세션 복원 후에는 런타임 상태가 초기화되어 있을 수 있음
		// UI에서 전달받은 askRequest로 복구 시도
		if (!askRequest && askRequestFromUI) {
			this.logService.info(CLIEventHandler.LOG_CATEGORY, 'Restoring askRequest from UI (session was restored)');
			askRequest = askRequestFromUI;
			sessionInteraction.setCurrentAskUserRequest(askRequest);
		}

		if (!askRequest) {
			this.logService.error(CLIEventHandler.LOG_CATEGORY, 'No askRequest available - cannot respond');
			this._respondToAskUserInProgress = false;
			return;
		}

		// isWaitingForUser가 false인 경우 (세션 복원 등) 자동 복구
		if (!sessionInteraction.isWaitingForUser()) {
			this.logService.info(CLIEventHandler.LOG_CATEGORY, 'Auto-restoring waitingForUser state (was false, askRequest exists)');
			sessionInteraction.setWaitingForUser(true);
		}

		this.logService.info(CLIEventHandler.LOG_CATEGORY, '[AskUser] respondToAskUser called with responses:', responses);

		const isInputRequest = askRequest.isInputRequest === true;
		const cliSessionId = sessionInteraction.getCliSessionId();
		const currentMessageId = this.getMessage().getCurrentMessageId();
		this.logService.info(CLIEventHandler.LOG_CATEGORY,
			`[AskUser] isInputRequest: ${isInputRequest}, cliSessionId: ${cliSessionId}, currentMessageId: ${currentMessageId}`);

		// 응답 텍스트
		const responseText = responses.join(', ');

		if (isInputRequest) {
			// input_request: 기존 CLI 프로세스의 stdin으로 응답 전송
			this.logService.debug(CLIEventHandler.LOG_CATEGORY, 'Sending user input via stdin:', responseText);

			// 상태 리셋
			sessionInteraction.setWaitingForUser(false);
			sessionInteraction.setCurrentAskUserRequest(undefined);
			this.updateCurrentMessage();
			this.getState().setState('streaming');

			try {
				await this.getConnection().getChannel().call('sendUserInput', [responseText]);
			} catch (error) {
				this.logService.error(CLIEventHandler.LOG_CATEGORY, 'sendUserInput failed:', error);
				// 에러 시 상태 복구
				this.getState().setState('idle');
				this.handleError(`User input failed: ${error}`);
			} finally {
				this._respondToAskUserInProgress = false;
			}
		} else if (cliSessionId) {
			// AskUserQuestion (tool_use): --resume 옵션으로 세션 재개
			this.logService.info(CLIEventHandler.LOG_CATEGORY, `[AskUser] Resuming session with cliSessionId: ${cliSessionId}, response: ${responseText}`);

			// 상태 리셋
			sessionInteraction.setWaitingForUser(false);
			sessionInteraction.setCurrentAskUserRequest(undefined);
			this.updateCurrentMessage();
			this.getState().setState('streaming');

			try {
				// 이전 프로세스의 stale handleComplete가 도착해도 무시하도록 플래그 설정
				// ★ waitForProcessCompletion 전에 설정해야 함!
				// 대기 중에 CLI 프로세스가 종료되면 handleComplete가 호출되는데,
				// 이 플래그가 없으면 handleComplete가 상태를 idle로 전환하고
				// currentMessageId를 정리해버려서 이후 resume이 실패함
				this._askUserResumeInProgress = true;

				// CLI 프로세스가 아직 실행 중일 수 있음 (AskUserQuestion tool_use 이벤트는
				// CLI 프로세스가 종료되기 전에 도착할 수 있음)
				// 현재 프로세스가 완료될 때까지 대기한 후 --resume으로 재개
				const channel = this.getConnection().getChannel();
				const isStillRunning = await channel.call<boolean>('isRunning', []);
				if (isStillRunning) {
					this.logService.info(CLIEventHandler.LOG_CATEGORY,
						'[AskUser] CLI process still running, waiting for completion before resume...');
					await this.waitForProcessCompletion(channel, 30000);
					this.logService.info(CLIEventHandler.LOG_CATEGORY,
						'[AskUser] CLI process completed, proceeding with resume');
				}

				const cliOptions: IClaudeCLIRequestOptions = {
					resumeSessionId: cliSessionId
				};

				await channel.call('sendPrompt', [responseText, cliOptions]);

				// sendPrompt가 resolve된 후 — resume 프로세스가 완료됨
				// onDidComplete 이벤트는 이미 도착했지만 flag으로 스킵되었으므로,
				// flag을 리셋하고 직접 handleComplete를 호출하여 최종 상태 정리
				this._askUserResumeInProgress = false;
				this._respondToAskUserInProgress = false;
				this.logService.info(CLIEventHandler.LOG_CATEGORY, '[AskUser] Resume sendPrompt completed, calling handleComplete');
				await this.handleComplete();
			} catch (error) {
				this.logService.error(CLIEventHandler.LOG_CATEGORY, '[AskUser] Resume failed:', error);
				this._askUserResumeInProgress = false;
				this._respondToAskUserInProgress = false;
				// 에러 시 상태 복구 — idle로 전환하여 사용자가 다시 시도할 수 있도록
				this.getState().setState('idle');
				this.handleError(`AskUser resume failed: ${error}`);
			}
		} else {
			// cliSessionId 없음 — resume 불가
			// 빈 옵션으로 sendPrompt를 호출하면 CLI가 즉시 거부하므로, 에러로 처리
			this.logService.error(CLIEventHandler.LOG_CATEGORY,
				'[AskUser] No cliSessionId available - cannot resume CLI session. User must start a new conversation.');

			sessionInteraction.setWaitingForUser(false);
			sessionInteraction.setCurrentAskUserRequest(undefined);
			this.updateCurrentMessage();
			this.getState().setState('idle');

			// 사용자에게 에러 알림
			this.handleError('AskUser 응답을 전송할 수 없습니다. CLI 세션이 만료되었습니다. 새 대화를 시작해 주세요.');
			this._respondToAskUserInProgress = false;
		}
	}

	// ========== Private Methods ==========

	private handleSystemEvent(event: IClaudeCLIStreamEvent): void {
		this.logService.debug(CLIEventHandler.LOG_CATEGORY, 'System event - Claude initializing...');
		const systemEvent = event as { session_id?: string };
		if (systemEvent.session_id) {
			this.getSessionInteraction().setCliSessionId(systemEvent.session_id);
			this.logService.debug(CLIEventHandler.LOG_CATEGORY, 'CLI session ID:', systemEvent.session_id);
		}

		if (this.getMessage().getCurrentMessageId() && this.getSessionInteraction().hasCurrentSession()) {
			// AskUser resume 시 기존 content를 보존 (빈 문자열로 리셋하지 않음)
			const existingContent = this.getMessage().getAccumulatedContent();
			if (!existingContent) {
				this.getMessage().setAccumulatedContent('');
			}
			this.updateCurrentMessage();
		}
	}

	private async handleToolUse(event: IClaudeCLIStreamEvent): Promise<void> {
		const toolName = event.tool_name || 'unknown';
		this.logService.info(CLIEventHandler.LOG_CATEGORY, `[FileChanges] handleToolUse: ${toolName}`);

		// AskUserQuestion 도구 처리
		if (toolName === 'AskUserQuestion') {
			this.handleAskUserQuestion(event);
			return;
		}

		const toolActionObj: IClaudeToolAction = {
			id: event.tool_use_id || generateUuid(),
			tool: toolName,
			status: 'running',
			input: event.tool_input
		};

		const toolActionCtx = this.getToolAction();
		toolActionCtx.setCurrentToolAction(toolActionObj);
		toolActionCtx.addToolAction(toolActionObj);

		// 파일 수정 도구인 경우 스냅샷 캡처 (await 필수!)
		const isFileTool = this.isFileModifyTool(toolName);
		this.logService.info(CLIEventHandler.LOG_CATEGORY, `[FileChanges] isFileModifyTool(${toolName}): ${isFileTool}`);

		if (isFileTool) {
			const filePath = this.extractFilePath(toolName, event.tool_input);
			this.logService.info(CLIEventHandler.LOG_CATEGORY, `[FileChanges] extractFilePath: ${filePath || 'null'}`);
			if (filePath) {
				this.logService.info(CLIEventHandler.LOG_CATEGORY, `[FileChanges] Capturing BEFORE edit: ${filePath}`);
				await this.getFileOperation().captureFileBeforeEdit(filePath);
				this.logService.info(CLIEventHandler.LOG_CATEGORY, `[FileChanges] BEFORE capture done: ${filePath}`);
			}
		}

		this.logService.debug(CLIEventHandler.LOG_CATEGORY, 'Tool use started:', toolActionObj.tool, toolActionObj.input);
		this.updateCurrentMessage();
	}

	/**
	 * 파일 수정 도구인지 확인
	 */
	private isFileModifyTool(toolName: string): boolean {
		return ['Edit', 'Write', 'NotebookEdit'].includes(toolName);
	}

	/**
	 * 도구 입력에서 파일 경로 추출
	 */
	private extractFilePath(toolName: string, input: unknown): string | undefined {
		if (!input || typeof input !== 'object') {
			return undefined;
		}

		const inputObj = input as Record<string, unknown>;

		// Edit, Write: file_path
		if (inputObj.file_path && typeof inputObj.file_path === 'string') {
			return inputObj.file_path;
		}

		// NotebookEdit: notebook_path
		if (inputObj.notebook_path && typeof inputObj.notebook_path === 'string') {
			return inputObj.notebook_path;
		}

		return undefined;
	}

	private handleAskUserQuestion(event: IClaudeCLIStreamEvent): void {
		this.logService.debug(CLIEventHandler.LOG_CATEGORY, 'AskUserQuestion received:', event.tool_input);

		const input = event.tool_input as {
			questions?: Array<{
				question: string;
				header?: string;
				options: Array<{ label: string; description?: string }>;
				multiSelect?: boolean
			}>
		} | undefined;

		if (!input?.questions) {
			this.logService.error(CLIEventHandler.LOG_CATEGORY, 'AskUserQuestion missing questions');
			return;
		}

		const questions: IClaudeAskUserQuestion[] = input.questions.map(q => ({
			question: q.question,
			header: q.header,
			options: q.options.map((o: { label: string; description?: string }) => ({ label: o.label, description: o.description })),
			multiSelect: q.multiSelect
		}));

		const sessionInteraction = this.getSessionInteraction();

		// Auto Accept 모드: 첫 번째 옵션 자동 선택 (세션 설정 > 로컬 설정)
		if (this.getState().isAutoAcceptEnabled() && questions.length > 0 && questions[0].options.length > 0) {
			const firstOption = questions[0].options[0].label;
			this.logService.debug(CLIEventHandler.LOG_CATEGORY, 'Auto-accept enabled, selecting:', firstOption);

			sessionInteraction.setCurrentAskUserRequest({
				id: event.tool_use_id || generateUuid(),
				questions,
				autoAccepted: true,
				autoAcceptedOption: firstOption
			} as IClaudeAskUserRequest & { autoAccepted?: boolean; autoAcceptedOption?: string });

			// AutoAccept 모드에서도 사용자에게 질문과 자동 선택된 답변을 표시하기 위해 필요
			sessionInteraction.setWaitingForUser(true);
			this.updateCurrentMessage();

			setTimeout(() => {
				this.respondToAskUser([firstOption]).catch(error => {
					this.logService.error(CLIEventHandler.LOG_CATEGORY, 'Failed to auto-respond to AskUser:', error);
					// 에러 시 대기 상태 해제
					sessionInteraction.setWaitingForUser(false);
					this.updateCurrentMessage();
				});
			}, 500);
			return;
		}

		sessionInteraction.setCurrentAskUserRequest({
			id: event.tool_use_id || generateUuid(),
			questions
		});
		sessionInteraction.setWaitingForUser(true);

		this.logService.debug(CLIEventHandler.LOG_CATEGORY, 'Waiting for user response...');
		this.updateCurrentMessage();
	}

	private handleInputRequest(event: IClaudeCLIStreamEvent): void {
		this.logService.debug(CLIEventHandler.LOG_CATEGORY, 'InputRequest received:', event.questions);

		if (!event.questions || event.questions.length === 0) {
			this.logService.error(CLIEventHandler.LOG_CATEGORY, 'InputRequest missing questions');
			return;
		}

		const message = this.getMessage();
		const sessionInteraction = this.getSessionInteraction();

		// 현재 메시지가 없으면 생성
		if (!message.getCurrentMessageId()) {
			const newId = generateUuid();
			message.setCurrentMessageId(newId);
			message.setAccumulatedContent('');
			message.createAssistantMessage(newId);
		}

		const questions: IClaudeAskUserQuestion[] = event.questions.map((q: { question: string; header?: string; options: Array<{ label: string; description?: string }>; multiSelect?: boolean }) => ({
			question: q.question,
			header: q.header,
			options: q.options.map((o: { label: string; description?: string }) => ({ label: o.label, description: o.description })),
			multiSelect: q.multiSelect
		}));

		// Auto Accept 모드 (세션 설정 > 로컬 설정)
		if (this.getState().isAutoAcceptEnabled() && questions.length > 0 && questions[0].options.length > 0) {
			const firstOption = questions[0].options[0].label;
			this.logService.debug(CLIEventHandler.LOG_CATEGORY, 'Auto-accept enabled (input_request), selecting:', firstOption);

			sessionInteraction.setCurrentAskUserRequest({
				id: generateUuid(),
				questions,
				autoAccepted: true,
				autoAcceptedOption: firstOption,
				isInputRequest: true
			} as IClaudeAskUserRequest & { autoAccepted?: boolean; autoAcceptedOption?: string });
			this.updateCurrentMessage();

			setTimeout(() => {
				this.respondToAskUser([firstOption]).catch(error => {
					this.logService.error(CLIEventHandler.LOG_CATEGORY, 'Failed to auto-respond to AskUser:', error);
					// 에러 시 대기 상태 해제
					sessionInteraction.setWaitingForUser(false);
					this.updateCurrentMessage();
				});
			}, 500);
			return;
		}

		sessionInteraction.setCurrentAskUserRequest({
			id: generateUuid(),
			questions,
			isInputRequest: true
		});
		sessionInteraction.setWaitingForUser(true);

		this.logService.debug(CLIEventHandler.LOG_CATEGORY, 'Waiting for user response (input_request)...');
		this.updateCurrentMessage();
	}

	private async handleToolResult(event: IClaudeCLIStreamEvent): Promise<void> {
		const toolAction = this.getToolAction();
		const currentToolAction = toolAction.getCurrentToolAction();
		this.logService.info(CLIEventHandler.LOG_CATEGORY, `[FileChanges] handleToolResult: currentTool=${currentToolAction?.tool || 'null'}, is_error=${event.is_error}, tool_result_length=${String(event.tool_result || '').length}`);

		if (currentToolAction) {
			toolAction.updateToolAction(currentToolAction.id, {
				status: event.is_error ? 'error' : 'completed',
				output: event.tool_result,
				error: event.is_error ? event.tool_result : undefined
			});

			// 파일 수정 도구의 결과인 경우 수정 후 내용 캡처 (await 필수!)
			const isFileTool = this.isFileModifyTool(currentToolAction.tool);
			this.logService.info(CLIEventHandler.LOG_CATEGORY, `[FileChanges] handleToolResult: isFileModifyTool(${currentToolAction.tool})=${isFileTool}, is_error=${event.is_error}`);

			if (isFileTool && !event.is_error) {
				const filePath = this.extractFilePath(currentToolAction.tool, currentToolAction.input);
				this.logService.info(CLIEventHandler.LOG_CATEGORY, `[FileChanges] handleToolResult: extractFilePath=${filePath || 'null'}, input=${JSON.stringify(currentToolAction.input)}`);
				if (filePath) {
					this.logService.info(CLIEventHandler.LOG_CATEGORY, `[FileChanges] handleToolResult: Calling captureFileAfterEdit for ${filePath}`);
					await this.getFileOperation().captureFileAfterEdit(filePath);
					this.logService.info(CLIEventHandler.LOG_CATEGORY, `[FileChanges] handleToolResult: captureFileAfterEdit DONE for ${filePath}`);
				}
			} else {
				this.logService.info(CLIEventHandler.LOG_CATEGORY, `[FileChanges] handleToolResult: SKIPPED capture (isFileTool=${isFileTool}, is_error=${event.is_error})`);
			}

			toolAction.setCurrentToolAction(undefined);
			this.logService.debug(CLIEventHandler.LOG_CATEGORY, 'Tool use completed:', currentToolAction.tool);
			this.updateCurrentMessage();
		} else {
			this.logService.info(CLIEventHandler.LOG_CATEGORY, `[FileChanges] handleToolResult: NO currentToolAction, skipping`);
		}
	}

	/**
	 * assistant 이벤트의 content 블록에서 tool_use 블록 추출
	 * (extractText와 분리하여 큐를 통해 순서 보장)
	 */
	private extractToolUseBlocks(event: IClaudeCLIStreamEvent): Array<{ tool_use_id: string; tool_name: string; tool_input: Record<string, unknown> | undefined }> {
		const blocks: Array<{ tool_use_id: string; tool_name: string; tool_input: Record<string, unknown> | undefined }> = [];

		if (event.type === 'assistant' && event.message) {
			if (typeof event.message === 'object' && event.message.content) {
				for (const block of event.message.content) {
					if (block.type === 'tool_use' && block.name) {
						blocks.push({
							tool_use_id: generateUuid(),
							tool_name: block.name,
							tool_input: block.input
						});
					}
				}
			}
		}

		return blocks;
	}

	private extractText(event: IClaudeCLIStreamEvent): string {
		let text = '';

		if (event.type === 'assistant' && event.message) {
			if (typeof event.message === 'object' && event.message.content) {
				for (const block of event.message.content) {
					if (block.type === 'text' && block.text) {
						text += block.text;
					}
					// tool_use 블록은 extractToolUseBlocks()에서 별도 처리
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

	/**
	 * 서브에이전트 사용 정보 추출 (Task 도구 사용 내역)
	 */
	private extractSubagentUsage(): IClaudeSubagentUsage[] {
		const toolActions = this.getToolAction().getToolActions();
		const subagents: IClaudeSubagentUsage[] = [];

		for (const action of toolActions) {
			if (action.tool === 'Task' && action.input) {
				const input = action.input as Record<string, unknown>;
				const subagentType = (input.subagent_type || input.subagentType || 'unknown') as string;
				const description = (input.description || input.prompt || '') as string;

				subagents.push({
					type: subagentType,
					description: description.length > 50 ? description.substring(0, 50) + '...' : description,
					status: action.status === 'error' ? 'error' : 'completed'
				});
			}
		}

		return subagents;
	}

	private updateCurrentMessage(): void {
		const message = this.getMessage();
		const toolAction = this.getToolAction();
		const sessionInteraction = this.getSessionInteraction();

		const currentMessageId = message.getCurrentMessageId();
		if (!currentMessageId || !sessionInteraction.hasCurrentSession()) {
			return;
		}

		const updatedMessage: IClaudeMessage = {
			id: currentMessageId,
			role: 'assistant',
			content: message.getAccumulatedContent(),
			timestamp: Date.now(),
			isStreaming: !sessionInteraction.isWaitingForUser(),
			toolActions: [...toolAction.getToolActions()],
			currentToolAction: toolAction.getCurrentToolAction(),
			askUserRequest: sessionInteraction.getCurrentAskUserRequest(),
			isWaitingForUser: sessionInteraction.isWaitingForUser()
		};

		message.updateSessionMessage(updatedMessage);
		message.fireMessageUpdate(updatedMessage);
	}

	/**
	 * 효율적인 큐 기반 데이터 작업 처리 (Promise 체인 대신 사용)
	 */
	private async enqueueDataOperation(operation: () => Promise<void>): Promise<void> {
		return new Promise<void>((resolve, reject) => {
			this._dataOperationQueue.push(async () => {
				try {
					await operation();
					resolve();
				} catch (error) {
					reject(error);
				}
			});

			// 큐 처리 시작
			this.processDataQueue();
		});
	}

	private async processDataQueue(): Promise<void> {
		if (this._isProcessingDataQueue || this._dataOperationQueue.length === 0) {
			return;
		}

		this._isProcessingDataQueue = true;

		try {
			while (this._dataOperationQueue.length > 0) {
				const operation = this._dataOperationQueue.shift();
				if (operation) {
					await operation();
				}
			}
		} catch (error) {
			this.logService.error(CLIEventHandler.LOG_CATEGORY, 'Error processing data queue:', error);
		} finally {
			this._isProcessingDataQueue = false;
		}
	}

	/**
	 * CLI 프로세스 완료 대기
	 * AskUserQuestion 응답 시 현재 프로세스가 아직 실행 중일 수 있음
	 * (tool_use 이벤트는 프로세스 종료 전에 도착)
	 */
	private async waitForProcessCompletion(channel: IChannel, timeoutMs: number): Promise<void> {
		const pollInterval = 100;
		const maxAttempts = Math.ceil(timeoutMs / pollInterval);

		for (let i = 0; i < maxAttempts; i++) {
			const running = await channel.call<boolean>('isRunning', []);
			if (!running) {
				return;
			}
			await new Promise(resolve => setTimeout(resolve, pollInterval));
		}

		this.logService.warn(CLIEventHandler.LOG_CATEGORY,
			`[AskUser] Timed out waiting for process completion (${timeoutMs}ms), proceeding anyway`);
	}
}
