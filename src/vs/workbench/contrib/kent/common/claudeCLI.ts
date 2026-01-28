/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../../base/common/event.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { IClaudeExecutableConfig } from './claudeLocalConfig.js';

export const IClaudeCLIService = createDecorator<IClaudeCLIService>('claudeCLIService');

//claude cli reference
//https://code.claude.com/docs/ko/cli-reference

/**
 * CLI 스트림 이벤트의 usage 정보
 */
export interface IClaudeCLIUsage {
	readonly input_tokens?: number;
	readonly output_tokens?: number;
	readonly cache_read_input_tokens?: number;
	readonly cache_creation_input_tokens?: number;
}

/**
 * Claude CLI 스트리밍 응답 타입
 */
export interface IClaudeCLIStreamEvent {
	readonly type: 'system' | 'assistant' | 'text' | 'result' | 'error' | 'tool_use' | 'tool_result' | 'content_block_start' | 'content_block_delta' | 'content_block_stop' | 'message_start' | 'message_delta' | 'message_stop' | 'input_request';
	readonly subtype?: string;
	readonly content?: string;
	readonly message?: {
		readonly content?: Array<{ type: string; text?: string; name?: string; input?: Record<string, unknown> }>;
		readonly usage?: IClaudeCLIUsage;
	} | string;
	readonly result?: string;
	readonly delta?: { text?: string };
	readonly index?: number;
	readonly is_error?: boolean;
	// Tool use fields
	readonly tool_use_id?: string;
	readonly tool_name?: string;
	readonly tool_input?: Record<string, unknown>;
	readonly tool_result?: string;
	// Input request fields (AskUser)
	readonly questions?: Array<{
		readonly question: string;
		readonly header?: string;
		readonly options: Array<{ label: string; description?: string }>;
		readonly multiSelect?: boolean;
	}>;
	// Error fields (rate limit, etc.)
	readonly error_type?: 'rate_limit' | 'api_error' | 'network_error' | 'unknown';
	readonly retry_after?: number; // 초 단위 대기 시간
	// Usage fields (result event)
	readonly usage?: IClaudeCLIUsage;
	readonly total_cost_usd?: number;
}

/**
 * Rate limit 정보
 */
export interface IClaudeRateLimitInfo {
	readonly isRateLimited: boolean;
	readonly retryAfterSeconds: number;
	readonly resetTime?: Date;
	readonly message?: string;
}

/**
 * Claude CLI 요청 옵션
 */
export interface IClaudeCLIRequestOptions {
	readonly workingDir?: string;
	readonly model?: string;
	readonly systemPrompt?: string;
	readonly maxTokens?: number;
	readonly allowedTools?: string[];
	readonly resumeSessionId?: string; // 세션 재개용 (--resume)
	readonly continueLastSession?: boolean; // 마지막 세션 계속 (--continue)
	readonly extendedThinking?: boolean; // 확장 사고 모드
	/** 실행 설정 (로컬 설정에서 로드) */
	readonly executable?: IClaudeExecutableConfig;
}

/**
 * Claude CLI 서비스 - Main Process에서 실행
 */
export interface IClaudeCLIService {
	readonly _serviceBrand: undefined;

	/**
	 * 스트리밍 데이터 수신 이벤트
	 */
	readonly onDidReceiveData: Event<IClaudeCLIStreamEvent>;

	/**
	 * 요청 완료 이벤트
	 */
	readonly onDidComplete: Event<void>;

	/**
	 * 에러 발생 이벤트
	 */
	readonly onDidError: Event<string>;

	/**
	 * Claude CLI로 프롬프트 전송
	 */
	sendPrompt(prompt: string, options?: IClaudeCLIRequestOptions): Promise<void>;

	/**
	 * 현재 요청 취소
	 */
	cancelRequest(): void;

	/**
	 * 요청 진행 중 여부
	 */
	isRunning(): boolean;

	/**
	 * 사용자 입력 전송 (AskUser 응답용)
	 */
	sendUserInput(input: string): void;

	/**
	 * Claude CLI 연결 테스트
	 */
	checkConnection(): Promise<{ success: boolean; version?: string; error?: string }>;
}
