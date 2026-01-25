/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../base/common/event.js';
import { createDecorator } from '../../instantiation/common/instantiation.js';

export const IClaudeCLIService = createDecorator<IClaudeCLIService>('claudeCLIService');

/**
 * Claude CLI 스트리밍 응답 타입
 */
export interface IClaudeCLIStreamEvent {
	readonly type: 'system' | 'assistant' | 'text' | 'result' | 'error' | 'tool_use' | 'content_block_start' | 'content_block_delta' | 'content_block_stop' | 'message_start' | 'message_delta' | 'message_stop';
	readonly subtype?: string;
	readonly content?: string;
	readonly message?: {
		readonly content?: Array<{ type: string; text?: string }>;
	} | string;
	readonly result?: string;
	readonly delta?: { text?: string };
	readonly index?: number;
	readonly is_error?: boolean;
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
}
