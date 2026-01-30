/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../base/common/uri.js';

// ========== Model Constants ==========

/**
 * 사용 가능한 Claude 모델 목록
 */
export const CLAUDE_AVAILABLE_MODELS = [
	'claude-sonnet-4-20250514',
	'claude-opus-4-20250514',
	'claude-3-5-sonnet-20241022',
	'claude-3-5-haiku-20241022'
] as const;

/**
 * 기본 모델
 */
export const CLAUDE_DEFAULT_MODEL = 'claude-sonnet-4-20250514';

/**
 * 모델 별칭 매핑 (짧은 이름 → 전체 모델명)
 */
export const CLAUDE_MODEL_ALIASES: Record<string, string> = {
	// Opus 4
	'opus': 'claude-opus-4-20250514',
	'opus-4': 'claude-opus-4-20250514',
	'opus4': 'claude-opus-4-20250514',
	'o4': 'claude-opus-4-20250514',
	// Sonnet 4
	'sonnet': 'claude-sonnet-4-20250514',
	'sonnet-4': 'claude-sonnet-4-20250514',
	'sonnet4': 'claude-sonnet-4-20250514',
	's4': 'claude-sonnet-4-20250514',
	// Sonnet 3.5
	'3.5-sonnet': 'claude-3-5-sonnet-20241022',
	'sonnet-3.5': 'claude-3-5-sonnet-20241022',
	'sonnet35': 'claude-3-5-sonnet-20241022',
	's35': 'claude-3-5-sonnet-20241022',
	// Haiku 3.5
	'haiku': 'claude-3-5-haiku-20241022',
	'haiku-3.5': 'claude-3-5-haiku-20241022',
	'haiku35': 'claude-3-5-haiku-20241022',
	'h35': 'claude-3-5-haiku-20241022'
};

/**
 * 모델 표시 이름 (UI용)
 */
export const CLAUDE_MODEL_DISPLAY_NAMES: Record<string, string> = {
	'claude-opus-4-20250514': 'Opus 4',
	'claude-sonnet-4-20250514': 'Sonnet 4',
	'claude-3-5-sonnet-20241022': 'Sonnet 3.5',
	'claude-3-5-haiku-20241022': 'Haiku 3.5'
};

/**
 * 모델명 해석 (별칭 → 전체 모델명)
 * @param input 사용자 입력 (별칭 또는 전체 모델명)
 * @returns 전체 모델명 (매칭 안되면 입력값 그대로 반환)
 */
export function resolveModelName(input: string | undefined): string {
	if (!input || input.trim() === '') {
		return '';
	}

	const trimmed = input.trim().toLowerCase();

	// 1. 별칭 매핑 확인
	if (CLAUDE_MODEL_ALIASES[trimmed]) {
		return CLAUDE_MODEL_ALIASES[trimmed];
	}

	// 2. 전체 모델명과 정확히 일치하는지 확인
	const exactMatch = CLAUDE_AVAILABLE_MODELS.find(m => m.toLowerCase() === trimmed);
	if (exactMatch) {
		return exactMatch;
	}

	// 3. 부분 매칭 (예: "opus" → claude-opus-4-...)
	const partialMatch = CLAUDE_AVAILABLE_MODELS.find(m => m.toLowerCase().includes(trimmed));
	if (partialMatch) {
		return partialMatch;
	}

	// 4. 매칭 안되면 입력값 그대로 반환 (validateClaudeModel에서 처리)
	return input.trim();
}

/**
 * 모델 표시 이름 가져오기 (UI용)
 */
export function getModelDisplayName(model: string): string {
	return CLAUDE_MODEL_DISPLAY_NAMES[model] || model;
}

/**
 * UI용 모델 목록 (QuickPick 등)
 */
export interface IClaudeModelPickItem {
	readonly model: string;
	readonly displayName: string;
	readonly aliases: string[];
}

/**
 * UI용 모델 목록 반환
 */
export function getAvailableModelsForUI(): IClaudeModelPickItem[] {
	return [
		{
			model: 'claude-opus-4-20250514',
			displayName: 'Opus 4',
			aliases: ['opus', 'opus-4', 'o4']
		},
		{
			model: 'claude-sonnet-4-20250514',
			displayName: 'Sonnet 4 (Default)',
			aliases: ['sonnet', 'sonnet-4', 's4']
		},
		{
			model: 'claude-3-5-sonnet-20241022',
			displayName: 'Sonnet 3.5',
			aliases: ['sonnet-3.5', 's35']
		},
		{
			model: 'claude-3-5-haiku-20241022',
			displayName: 'Haiku 3.5',
			aliases: ['haiku', 'h35']
		}
	];
}

/**
 * 모델 유효성 검증 결과
 */
export interface IClaudeModelValidationResult {
	readonly isValid: boolean;
	readonly model: string;
	readonly warning?: string;
}

/**
 * 모델 유효성 검증 (별칭 지원)
 * @param model 검증할 모델명 (별칭 또는 전체 모델명)
 * @returns 유효성 검증 결과 (유효하지 않으면 기본 모델로 대체)
 */
export function validateClaudeModel(model: string | undefined): IClaudeModelValidationResult {
	// 빈 값이면 유효 (기본 모델 사용)
	if (!model || model.trim() === '') {
		return { isValid: true, model: '' };
	}

	// 별칭 해석
	const resolvedModel = resolveModelName(model);

	// 유효한 모델인지 확인
	if (CLAUDE_AVAILABLE_MODELS.includes(resolvedModel as typeof CLAUDE_AVAILABLE_MODELS[number])) {
		return { isValid: true, model: resolvedModel };
	}

	// 유효하지 않은 모델 - 경고와 함께 기본 모델 반환
	return {
		isValid: false,
		model: CLAUDE_DEFAULT_MODEL,
		warning: `Unknown model "${model}". Using default model "${CLAUDE_DEFAULT_MODEL}" instead.`
	};
}

/**
 * 사용 가능한 모델 목록 반환 (UI용)
 */
export function getAvailableClaudeModels(): string[] {
	return [...CLAUDE_AVAILABLE_MODELS];
}

// ========== Message Types ==========

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
 * 서브에이전트 사용 정보
 */
export interface IClaudeSubagentUsage {
	readonly type: string;  // 'Explore', 'Plan', 'Bash', 'general-purpose' 등
	readonly description?: string;
	readonly status: 'completed' | 'error';
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
	/** 서브에이전트 사용 정보 */
	readonly subagents?: IClaudeSubagentUsage[];
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
	/** 파일 변경사항 (assistant 메시지, 완료 후) */
	readonly fileChanges?: IClaudeFileChangesSummary;
	/** 큐가 가득 차서 거부됨 */
	readonly queueRejected?: boolean;
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
	readonly type: 'file' | 'folder' | 'selection' | 'diagnostics' | 'workspace' | 'image' | 'code-reference';
	readonly uri?: URI;
	readonly name: string;
	readonly content?: string;
	/** 이미지 base64 데이터 (type === 'image'일 때) */
	readonly imageData?: string;
	/** 이미지 MIME 타입 (type === 'image'일 때) */
	readonly mimeType?: string;
	/** 코드 참조 정보 (type === 'code-reference'일 때) */
	readonly codeReference?: IClaudeCodeReference;
}

/**
 * 코드 참조 정보 (에디터에서 복사한 코드)
 */
export interface IClaudeCodeReference {
	/** 참조 유형 */
	readonly type: 'code-reference';
	/** 파일 경로 */
	readonly filePath: string;
	/** 파일 이름 */
	readonly fileName: string;
	/** 시작 줄 번호 */
	readonly startLine: number;
	/** 종료 줄 번호 */
	readonly endLine: number;
	/** 코드 내용 */
	readonly content: string;
	/** 언어 ID (syntax highlighting용) */
	readonly languageId?: string;
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
	readonly ultrathink: boolean;
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

/**
 * 파일 변경 정보 (Claude가 수정한 파일)
 */
export interface IClaudeFileChange {
	readonly filePath: string;
	readonly fileName: string;
	readonly changeType: 'created' | 'modified' | 'deleted';
	readonly linesAdded: number;
	readonly linesRemoved: number;
	/** 원본 내용 (revert 용) */
	readonly originalContent: string;
	/** 수정된 내용 */
	readonly modifiedContent: string;
	/** 이미 revert 되었는지 */
	reverted?: boolean;
}

/**
 * 파일 변경 요약
 */
export interface IClaudeFileChangesSummary {
	readonly filesCreated: number;
	readonly filesModified: number;
	readonly filesDeleted: number;
	readonly totalLinesAdded: number;
	readonly totalLinesRemoved: number;
	readonly changes: IClaudeFileChange[];
}
