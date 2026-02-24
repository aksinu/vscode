/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../../../base/common/lifecycle.js';
import { generateUuid } from '../../../../../../base/common/uuid.js';
import { IClaudeMessage, IClaudeToolAction, IClaudeAskUserRequest, IClaudeSubagentUsage } from '../../../common/types/claudeTypes.js';
import { IClaudeCLIStreamEvent } from '../../../common/claudeCLI.js';
import { IClaudeLogService } from '../../../common/claudeLogService.js';
import { ICLIEventHandlerUnifiedContext } from './cliEventHandlerContext.js';
import { AskUserHandler } from './askUserHandler.js';

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

	private readonly context: ICLIEventHandlerUnifiedContext;
	private readonly askUserHandler: AskUserHandler;

	constructor(
		context: ICLIEventHandlerUnifiedContext,
		private readonly logService: IClaudeLogService
	) {
		super();
		this.context = context;
		this.askUserHandler = new AskUserHandler(context, logService, {
			handleComplete: () => this.handleComplete(),
			handleError: (error: string) => this.handleError(error),
			updateCurrentMessage: () => this.updateCurrentMessage()
		});
	}

	// ========== 컨텍스트 접근 헬퍼 ==========

	private getState() { return this.context.state; }
	private getMessage() { return this.context.message; }
	private getToolAction() { return this.context.toolAction; }
	private getSessionInteraction() { return this.context.sessionInteraction; }
	private getFileOperation() { return this.context.fileOperation; }
	private getConnection() { return this.context.connection; }

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

		// 일반 에러 이벤트 처리 (rate_limit 외 — prompt too long 등)
		if (event.type === 'error') {
			const errorContent = event.content || 'Unknown error';
			this.logService.warn(CLIEventHandler.LOG_CATEGORY, 'CLI error event:', errorContent);
			this.handleError(errorContent);
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

		// result 이벤트에서 에러 감지 (error_during_execution 등)
		// CLI가 result 이벤트를 보내지만 is_error=true인 경우 (예: --resume 실패)
		if (event.type === 'result' && event.is_error) {
			const errorContent = event.result || event.subtype || 'CLI execution error';
			this.logService.warn(CLIEventHandler.LOG_CATEGORY, '[ResultError] CLI result with is_error=true:', event.subtype, errorContent);
			console.warn('[CLIEventHandler] Error result received:', { subtype: event.subtype, result: errorContent });
			// 에러 결과를 handleError로 전달하여 사용자에게 표시
			this.handleError(`CLI 오류: ${errorContent}`);
			return;
		}

		// result 이벤트에서 usage 정보 추출
		// ★ subagent 정보는 여기서 추출하지 않음!
		// tool_use/tool_result 이벤트가 아직 데이터 큐에서 처리 중일 수 있어
		// getToolActions()가 불완전한 결과를 반환함.
		// subagent 추출은 handleComplete()에서 큐 완료 후 수행.
		if (event.type === 'result' && event.usage) {
			// ★ input_tokens는 비캐시 input만 포함!
			// 총 input = input_tokens + cache_read + cache_creation
			// CLI 출력 예: input_tokens=2, cache_read=19265, cache_creation=15646 → 총 34913
			const rawInput = event.usage.input_tokens || 0;
			const cacheRead = event.usage.cache_read_input_tokens || 0;
			const cacheCreation = event.usage.cache_creation_input_tokens || 0;
			const totalInput = rawInput + cacheRead + cacheCreation;

			this.getSessionInteraction().setUsage({
				inputTokens: totalInput,
				outputTokens: event.usage.output_tokens || 0,
				cacheReadTokens: cacheRead || undefined,
				cacheCreationTokens: cacheCreation || undefined,
				totalCostUsd: event.total_cost_usd
			});
			this.logService.debug(CLIEventHandler.LOG_CATEGORY, 'Usage extracted:',
				`input=${rawInput}+cache_read=${cacheRead}+cache_create=${cacheCreation}=${totalInput}`,
				`output=${event.usage.output_tokens || 0}`);
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
		if (this.askUserHandler.isResumeInProgress()) {
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
			// ★ fireMessageUpdate를 호출하지 않음!
			// fireMessageUpdate는 UI 전체 re-render를 트리거하는데,
			// renderAskUser에서 selections Map이 로컬로 생성되므로
			// re-render 시 사용자가 선택 중인 옵션이 모두 초기화됨.
			// updateSessionMessage만으로 세션 데이터는 저장됨.
			// AskUser 대기 중이므로 setState('idle') 호출하지 않음 — 'asking' 상태 유지
			// (setState('idle')을 호출하면 chatStateManager.isWaitingForUser()가 false를 반환하여
			//  메시지 재렌더링 시 AskUser UI가 사라지는 문제 발생)
			sessionInteraction.saveSessions();
			return true;
		}

		// 데이터 없이 완료된 경우 (prompt too long 등 CLI가 아무 응답 없이 종료)
		const hasContent = message.getAccumulatedContent().trim().length > 0;
		const hasToolActions = toolAction.getToolActions().length > 0;
		if (!hasContent && !hasToolActions) {
			this.logService.warn(CLIEventHandler.LOG_CATEGORY,
				'[EmptyResponse] CLI completed with no content and no tool actions - likely prompt too long or context exceeded');
			this.handleError('대화가 너무 길어져서 처리할 수 없습니다.\n새 세션을 시작해 주세요. (세션 관리 버튼 → 새 세션)');
			return true;
		}

		// ★ 서브에이전트 정보 추출 (큐 완료 후 — toolActions가 완전한 상태)
		// handleData의 result 이벤트 시점에서는 tool_use/tool_result가 아직 큐에 있을 수 있어
		// 여기서 추출해야 모든 Task 도구 사용 내역이 포함됨
		const currentUsage = sessionInteraction.getUsage();
		if (currentUsage) {
			const subagents = this.extractSubagentUsage();
			if (subagents.length > 0) {
				sessionInteraction.setUsage({
					...currentUsage,
					subagents
				});
				this.logService.debug(CLIEventHandler.LOG_CATEGORY, 'Subagent usage extracted in handleComplete:', subagents);
			}
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
	 * AskUser 질문에 응답 (askUserHandler에 위임)
	 */
	async respondToAskUser(responses: string[], askRequestFromUI?: IClaudeAskUserRequest): Promise<void> {
		return this.askUserHandler.respondToAskUser(responses, askRequestFromUI);
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
		this.askUserHandler.handleAskUserQuestion(event);
	}

	private handleInputRequest(event: IClaudeCLIStreamEvent): void {
		this.askUserHandler.handleInputRequest(event);
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

}
