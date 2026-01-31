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
 * Claude CLI 권한 모드
 * - 'default': 기본 권한 모드
 * - 'plan': 계획 모드 (실행 전 확인)
 * - 'accept-edits': 편집 자동 수락
 */
export type ClaudePermissionMode = 'default' | 'plan' | 'accept-edits';

/**
 * Claude CLI 요청 옵션
 */
export interface IClaudeCLIRequestOptions {
	/** 작업 디렉토리 경로 */
	readonly workingDir?: string;

	/** 사용할 모델 이름 */
	readonly model?: string;

	/** 시스템 프롬프트 (기존 프롬프트 교체) */
	readonly systemPrompt?: string;

	/** 최대 출력 토큰 수 */
	readonly maxTokens?: number;

	/** 허용할 도구 목록 */
	readonly allowedTools?: string[];

	/** 세션 재개용 ID (--resume) */
	readonly resumeSessionId?: string;

	/** 마지막 세션 계속 여부 (--continue) */
	readonly continueLastSession?: boolean;

	/** 실행 설정 (로컬 설정에서 로드) */
	readonly executable?: IClaudeExecutableConfig;

	// ========== 추가된 옵션들 ==========

	/**
	 * 에이전트 최대 턴 수
	 * @description 에이전트가 실행할 수 있는 최대 턴(대화 라운드) 수를 제한합니다.
	 */
	readonly maxTurns?: number;

	/**
	 * 비용 상한선 (USD)
	 * @description API 호출 비용의 상한선을 USD 단위로 설정합니다.
	 */
	readonly maxBudgetUsd?: number;

	/**
	 * 대체 모델
	 * @description 주 모델이 사용 불가능할 때 사용할 대체 모델을 지정합니다.
	 */
	readonly fallbackModel?: string;

	/**
	 * 시스템 프롬프트 추가 (append)
	 * @description 기존 시스템 프롬프트를 유지하면서 추가할 프롬프트입니다.
	 *              systemPrompt는 기존을 교체하고, 이 옵션은 기존에 추가합니다.
	 */
	readonly appendSystemPrompt?: string;

	/**
	 * 금지할 도구 목록
	 * @description 에이전트가 사용할 수 없는 도구들의 목록입니다.
	 *              allowedTools와 반대로 특정 도구를 제외합니다.
	 */
	readonly disallowedTools?: string[];

	/**
	 * 권한 모드
	 * @description 에이전트의 권한 동작 모드를 설정합니다.
	 *              - 'default': 기본 권한 모드
	 *              - 'plan': 계획 모드 (실행 전 확인 필요)
	 *              - 'accept-edits': 파일 편집 자동 수락
	 */
	readonly permissionMode?: ClaudePermissionMode;

	/**
	 * 베타 기능 목록
	 * @description 활성화할 베타 기능들의 목록입니다.
	 */
	readonly betas?: string[];

	/**
	 * 추가 작업 디렉토리
	 * @description workingDir 외에 추가로 접근할 디렉토리 목록입니다.
	 */
	readonly addDirs?: string[];

	/**
	 * MCP 설정 파일 경로
	 * @description Model Context Protocol 설정 파일의 경로입니다.
	 */
	readonly mcpConfig?: string;

	/**
	 * 에이전트 설정 파일 경로
	 * @description 에이전트 정의 파일의 경로입니다.
	 */
	readonly agents?: string;
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

// ========== Multi-Instance Support ==========

/**
 * chatId와 함께 전달되는 이벤트
 */
export interface IClaudeCLIMultiEvent<T> {
	readonly chatId: string;
	readonly data: T;
}

/**
 * 다중 인스턴스 CLI 서비스 인터페이스
 * 각 chatId에 대해 독립적인 CLI 프로세스를 관리
 */
export interface IClaudeCLIMultiService {
	readonly _serviceBrand: undefined;

	/**
	 * chatId별 스트리밍 데이터 수신 이벤트
	 */
	readonly onDidReceiveData: Event<IClaudeCLIMultiEvent<IClaudeCLIStreamEvent>>;

	/**
	 * chatId별 요청 완료 이벤트
	 */
	readonly onDidComplete: Event<{ chatId: string }>;

	/**
	 * chatId별 에러 발생 이벤트
	 */
	readonly onDidError: Event<{ chatId: string; error: string }>;

	/**
	 * 특정 chatId로 프롬프트 전송
	 */
	sendPrompt(chatId: string, prompt: string, options?: IClaudeCLIRequestOptions): Promise<void>;

	/**
	 * 특정 chatId의 요청 취소
	 */
	cancelRequest(chatId: string): void;

	/**
	 * 특정 chatId가 요청 진행 중인지 확인
	 */
	isRunning(chatId: string): boolean;

	/**
	 * 특정 chatId로 사용자 입력 전송
	 */
	sendUserInput(chatId: string, input: string): void;

	/**
	 * Claude CLI 연결 테스트 (전역)
	 */
	checkConnection(): Promise<{ success: boolean; version?: string; error?: string }>;

	/**
	 * 특정 chatId의 인스턴스 제거
	 */
	destroyInstance(chatId: string): void;

	/**
	 * 모든 인스턴스 제거
	 */
	destroyAllInstances(): void;
}
