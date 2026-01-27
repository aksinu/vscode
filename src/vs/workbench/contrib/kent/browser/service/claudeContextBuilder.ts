/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IClaudeMessage, IClaudeSendRequestOptions } from '../../common/claudeTypes.js';

/**
 * 프롬프트 컨텍스트 빌더
 * 이전 대화 히스토리와 파일 컨텍스트를 포함한 프롬프트 구성
 */
export class ClaudeContextBuilder {

	private readonly maxHistoryMessages = 10; // 최대 10개의 이전 메시지

	/**
	 * 컨텍스트가 포함된 프롬프트 생성
	 * @param content 현재 메시지 내용
	 * @param messages 현재 세션의 메시지 목록
	 * @param context 추가 컨텍스트 (선택, 파일, 첨부파일)
	 */
	buildPromptWithContext(
		content: string,
		messages: IClaudeMessage[],
		context?: IClaudeSendRequestOptions['context']
	): string {
		const parts: string[] = [];

		// 이전 대화 내용 추가
		const historyPart = this.buildHistoryPart(messages);
		if (historyPart) {
			parts.push(historyPart);
		}

		// 파일 컨텍스트 추가
		const contextPart = this.buildContextPart(context);
		if (contextPart) {
			parts.push(contextPart);
		}

		// 현재 메시지
		parts.push(content);

		return parts.join('\n\n');
	}

	/**
	 * 대화 히스토리 부분 생성
	 */
	private buildHistoryPart(messages: IClaudeMessage[]): string | null {
		// 현재 보낸 메시지 제외한 이전 메시지들
		const previousMessages = messages.slice(0, -1); // 마지막은 방금 추가한 사용자 메시지

		if (previousMessages.length === 0) {
			return null;
		}

		const recentMessages = previousMessages.slice(-this.maxHistoryMessages);
		const historyParts: string[] = [];

		for (const msg of recentMessages) {
			// 스트리밍 중인 메시지나 에러 메시지 제외
			if (msg.isStreaming || msg.isError) {
				continue;
			}

			const role = msg.role === 'user' ? 'User' : 'Assistant';
			// 너무 긴 메시지는 요약
			let msgContent = msg.content;
			if (msgContent.length > 2000) {
				msgContent = msgContent.substring(0, 2000) + '\n... (truncated)';
			}
			historyParts.push(`${role}: ${msgContent}`);
		}

		if (historyParts.length === 0) {
			return null;
		}

		return [
			'=== Previous conversation ===',
			historyParts.join('\n\n'),
			'=== End of previous conversation ===\n'
		].join('\n');
	}

	/**
	 * 파일/선택 컨텍스트 부분 생성
	 */
	private buildContextPart(context?: IClaudeSendRequestOptions['context']): string | null {
		if (!context) {
			return null;
		}

		const parts: string[] = [];

		// 선택된 코드
		if (context.selection) {
			parts.push(`Selected code:\n\`\`\`${context.language || ''}\n${context.selection}\n\`\`\``);
		}

		// 현재 파일 경로
		if (context.filePath) {
			parts.push(`Current file: ${context.filePath.fsPath}`);
		}

		// 첨부파일
		if (context.attachments && context.attachments.length > 0) {
			for (const attachment of context.attachments) {
				if (attachment.type === 'image' && attachment.imageData) {
					// 이미지 첨부 - base64 데이터 포함
					parts.push(`[Image attached: ${attachment.name}]`);
					parts.push(`Image data (base64, ${attachment.mimeType || 'image/png'}):`);
					parts.push(`data:${attachment.mimeType || 'image/png'};base64,${attachment.imageData}`);
				} else if (attachment.content) {
					parts.push(`File: ${attachment.name}\n\`\`\`\n${attachment.content}\n\`\`\``);
				} else {
					parts.push(`Attached: ${attachment.name} (${attachment.type})`);
				}
			}
		}

		return parts.length > 0 ? parts.join('\n\n') : null;
	}
}
