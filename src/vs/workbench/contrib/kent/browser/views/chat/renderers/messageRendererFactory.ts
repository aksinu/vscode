/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DisposableStore } from '../../../../../../../base/common/lifecycle.js';
import {
	IClaudeMessage,
	IUserMessage,
	IAssistantMessage,
	ChatSessionState
} from '../../../../common/types/claudeTypes.js';
import { UserMessageRenderer } from './userMessageRenderer.js';
import { AssistantMessageRenderer, IAssistantMessageRendererOptions } from './assistantMessageRenderer.js';
import { IClaudeFileChange } from '../../../../common/types/claudeTypes.js';

export interface IMessageRendererOptions {
	readonly onApplyCode?: (code: string, language: string) => void;
	readonly onRespondToAskUser?: (responses: string[]) => void;
	readonly onShowFileDiff?: (fileChange: IClaudeFileChange) => void;
	readonly onRevertFile?: (fileChange: IClaudeFileChange) => Promise<boolean>;
	readonly onRevertAllFiles?: () => Promise<number>;
	readonly onAcceptFile?: (fileChange: IClaudeFileChange) => void;
	readonly onAcceptAllFiles?: () => void;
	readonly onRevertSelectedFiles?: (fileChanges: IClaudeFileChange[]) => Promise<number>;
	readonly onAcceptSelectedFiles?: (fileChanges: IClaudeFileChange[]) => void;
}

/**
 * 메시지 렌더러 팩토리
 * 사용자/클로드 메시지를 타입에 따라 적절한 렌더러로 처리
 */
export class MessageRendererFactory {

	private readonly userRenderer: UserMessageRenderer;
	private readonly assistantRenderer: AssistantMessageRenderer;

	constructor(options: IMessageRendererOptions) {
		this.userRenderer = new UserMessageRenderer();

		// AssistantMessageRenderer에 파일 변경 관련 옵션 전달
		const assistantOptions: IAssistantMessageRendererOptions = {
			onShowFileDiff: options.onShowFileDiff,
			onRevertFile: options.onRevertFile,
			onAcceptFile: options.onAcceptFile,
			onRevertAllFiles: options.onRevertAllFiles,
			onAcceptAllFiles: options.onAcceptAllFiles,
			onRevertSelectedFiles: options.onRevertSelectedFiles,
			onAcceptSelectedFiles: options.onAcceptSelectedFiles,
		};
		this.assistantRenderer = new AssistantMessageRenderer(assistantOptions);
	}

	/**
	 * 메시지를 적절한 렌더러로 렌더링
	 */
	renderMessage(
		message: IClaudeMessage,
		container: HTMLElement,
		currentState: ChatSessionState,
		options?: { readOnly?: boolean }
	): DisposableStore {
		// 타입 가드로 메시지 타입 구분
		if (message.role === 'user') {
			return this.userRenderer.renderUserMessage(message as IUserMessage, container);
		} else {
			return this.assistantRenderer.renderAssistantMessage(
				message as IAssistantMessage,
				container,
				currentState,
				options
			);
		}
	}

	/**
	 * 기존 렌더러 호환성을 위한 래퍼 메서드
	 */
	renderLegacyMessage(
		message: IClaudeMessage,
		container: HTMLElement,
		options?: { readOnly?: boolean }
	): DisposableStore {
		// 기존 메시지 구조를 새로운 구조로 변환
		const convertedMessage = this.convertLegacyMessage(message);
		const currentState = this.inferStateFromMessage(message);

		return this.renderMessage(convertedMessage, container, currentState, options);
	}

	/**
	 * 기존 메시지를 새로운 타입 시스템으로 변환
	 */
	private convertLegacyMessage(message: IClaudeMessage): IClaudeMessage {
		// 이미 새로운 형식이면 그대로 반환
		if (this.isNewMessageFormat(message)) {
			return message;
		}

		// 레거시 메시지를 새로운 형식으로 변환
		const baseMessage = {
			id: message.id,
			role: message.role,
			content: message.content,
			timestamp: message.timestamp,
		};

		if (message.role === 'user') {
			return {
				...baseMessage,
				role: 'user',
				context: (message as any).context,
				attachments: (message as any).attachments,
			} as IUserMessage;
		} else {
			return {
				...baseMessage,
				role: 'assistant',
				isStreaming: (message as any).isStreaming,
				isError: (message as any).isError,
				currentToolAction: (message as any).currentToolAction,
				toolActions: (message as any).toolActions,
				askUserRequest: (message as any).askUserRequest,
				isWaitingForUser: (message as any).isWaitingForUser,
				usage: (message as any).usage,
				fileChanges: (message as any).fileChanges,
				queueRejected: (message as any).queueRejected,
				workStartTime: (message as any).workStartTime,
				workEndTime: (message as any).workEndTime,
				isCanceled: (message as any).isCanceled,
				cancelTime: (message as any).cancelTime,
			} as IAssistantMessage;
		}
	}

	/**
	 * 메시지가 새로운 형식인지 확인
	 */
	private isNewMessageFormat(message: IClaudeMessage): boolean {
		// systemMessage 필드가 있으면 새로운 형식
		return 'systemMessage' in message;
	}

	/**
	 * 메시지 상태에서 ChatSessionState 추론
	 */
	private inferStateFromMessage(message: IClaudeMessage): ChatSessionState {
		// user 메시지는 항상 idle 상태
		if (message.role === 'user') {
			return (message as IUserMessage).queueRejected ? 'rateLimit' : 'idle';
		}

		// assistant 메시지일 경우
		const assistantMsg = message as IAssistantMessage;

		if (assistantMsg.isCanceled) return 'cancelled';
		if (assistantMsg.isError) return 'error';
		if (assistantMsg.isWaitingForUser) return 'asking';
		if (assistantMsg.isStreaming) return 'responding';
		if (assistantMsg.queueRejected) return 'rateLimit';

		return 'idle';
	}
}