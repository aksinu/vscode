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
 * Claude 도구 액션 (파일 읽기, 검색 등)
 */
export interface IClaudeToolAction {
	readonly id: string;
	readonly tool: string;
	readonly status: 'running' | 'completed' | 'error';
	readonly input?: Record<string, unknown>;
	readonly output?: string;
	readonly error?: string;
}

/**
 * AskUser 질문 옵션
 */
export interface IClaudeAskUserOption {
	readonly label: string;
	readonly description?: string;
}

/**
 * AskUser 질문
 */
export interface IClaudeAskUserQuestion {
	readonly question: string;
	readonly header?: string;
	readonly options: IClaudeAskUserOption[];
	readonly multiSelect?: boolean;
}

/**
 * AskUser 요청
 */
export interface IClaudeAskUserRequest {
	readonly id: string;
	readonly questions: IClaudeAskUserQuestion[];
	/** 자동 승인되었는지 여부 */
	readonly autoAccepted?: boolean;
	/** 자동 선택된 옵션 */
	readonly autoAcceptedOption?: string;
}

/**
 * Claude 토큰 사용량 정보
 */
export interface IClaudeUsageInfo {
	readonly inputTokens: number;
	readonly outputTokens: number;
	readonly cacheReadTokens?: number;
	readonly cacheCreationTokens?: number;
	readonly totalCostUsd?: number;
}

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
	readonly toolActions?: IClaudeToolAction[];
	readonly currentToolAction?: IClaudeToolAction;
	readonly askUserRequest?: IClaudeAskUserRequest;
	readonly isWaitingForUser?: boolean;
	/** 토큰 사용량 (assistant 메시지에만 해당) */
	readonly usage?: IClaudeUsageInfo;
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
	readonly type: 'file' | 'folder' | 'selection' | 'diagnostics' | 'workspace' | 'image';
	readonly uri?: URI;
	readonly name: string;
	readonly content?: string;
	/** 이미지 base64 데이터 (type === 'image'일 때) */
	readonly imageData?: string;
	/** 이미지 MIME 타입 (type === 'image'일 때) */
	readonly mimeType?: string;
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
	/** 이전 세션에서 로드된 메시지 개수 (구분선 표시용) */
	readonly previousMessageCount?: number;
}

/**
 * Claude 채팅 모드
 */
export const enum ClaudeChatMode {
	Ask = 'ask',
	Edit = 'edit',
	Agent = 'agent'
}

/**
 * 큐에 대기 중인 메시지
 */
export interface IClaudeQueuedMessage {
	readonly id: string;
	readonly content: string;
	readonly context?: IClaudeContext;
	readonly timestamp: number;
}

/**
 * Claude 연결 상태
 */
export type ClaudeConnectionStatus = 'connected' | 'disconnected' | 'connecting' | 'error';

/**
 * Claude 실행 방식
 */
export type ClaudeExecutionMethod = 'cli' | 'script';

/**
 * Claude 상태 정보
 */
export interface IClaudeStatusInfo {
	readonly connectionStatus: ClaudeConnectionStatus;
	readonly model: string;
	readonly extendedThinking: boolean;
	readonly executionMethod: ClaudeExecutionMethod;
	readonly scriptPath?: string;
	readonly lastConnected?: number;
	readonly error?: string;
	readonly version?: string;
}

/**
 * Claude 계정 정보
 */
export interface IClaudeAccountInfo {
	readonly email?: string;
	readonly organization?: string;
	readonly apiKeyConfigured: boolean;
	readonly plan?: string;
}
