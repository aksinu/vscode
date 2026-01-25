/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../base/common/uri.js';

/**
 * Claude 메시지 역할
 */
export type ClaudeMessageRole = 'user' | 'assistant';

/**
 * Claude 메시지
 */
export interface IClaudeMessage {
	readonly id: string;
	readonly role: ClaudeMessageRole;
	readonly content: string;
	readonly timestamp: number;
	readonly context?: IClaudeContext;
	readonly isStreaming?: boolean;
	readonly isError?: boolean;
}

/**
 * Claude 요청 컨텍스트
 */
export interface IClaudeContext {
	/** 선택된 텍스트 */
	readonly selection?: string;
	/** 파일 경로 */
	readonly filePath?: URI;
	/** 프로그래밍 언어 */
	readonly language?: string;
	/** 워크스페이스 폴더 */
	readonly workspaceFolder?: URI;
	/** 첨부 파일들 */
	readonly attachments?: IClaudeAttachment[];
}

/**
 * Claude 첨부 파일
 */
export interface IClaudeAttachment {
	readonly id: string;
	readonly type: 'file' | 'folder' | 'selection' | 'diagnostics';
	readonly uri?: URI;
	readonly name: string;
	readonly content?: string;
}

/**
 * Claude 서비스 상태
 */
export type ClaudeServiceState = 'idle' | 'sending' | 'streaming' | 'error';

/**
 * Claude 설정
 */
export interface IClaudeConfiguration {
	readonly apiKey: string;
	readonly model: string;
	readonly maxTokens: number;
	readonly systemPrompt?: string;
}

/**
 * Claude API 요청 옵션
 */
export interface IClaudeSendRequestOptions {
	readonly context?: IClaudeContext;
	readonly model?: string;
	readonly maxTokens?: number;
	readonly systemPrompt?: string;
}

/**
 * Claude 세션
 */
export interface IClaudeSession {
	readonly id: string;
	readonly title?: string;
	readonly createdAt: number;
	readonly messages: IClaudeMessage[];
}

/**
 * Claude 채팅 모드
 */
export const enum ClaudeChatMode {
	Ask = 'ask',
	Edit = 'edit',
	Agent = 'agent'
}
