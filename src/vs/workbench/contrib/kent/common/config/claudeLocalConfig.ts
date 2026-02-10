/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Claude 실행 설정
 */
export interface IClaudeExecutableConfig {
	/** 사용할 명령어 (기본: 'claude') */
	readonly command?: string;
}

/**
 * 권한 모드 타입 (사용자 설정용 - kebab-case 허용)
 */
export type ClaudePermissionMode = 'default' | 'plan' | 'accept-edits' | 'acceptEdits' | 'bypass-permissions' | 'bypassPermissions' | 'dont-ask' | 'dontAsk' | 'delegate';

/**
 * CLI 권한 모드 타입 (CLI가 실제로 허용하는 값)
 */
export type ClaudeCLIPermissionMode = 'default' | 'plan' | 'acceptEdits' | 'bypassPermissions' | 'dontAsk' | 'delegate';

/**
 * 권한 모드를 CLI가 허용하는 형식으로 변환
 * kebab-case → camelCase
 */
export function normalizePermissionMode(mode: string | undefined): ClaudeCLIPermissionMode | undefined {
	if (!mode) {
		return undefined;
	}

	const mapping: Record<string, ClaudeCLIPermissionMode> = {
		'default': 'default',
		'plan': 'plan',
		'delegate': 'delegate',
		// kebab-case → camelCase
		'accept-edits': 'acceptEdits',
		'acceptEdits': 'acceptEdits',
		'bypass-permissions': 'bypassPermissions',
		'bypassPermissions': 'bypassPermissions',
		'dont-ask': 'dontAsk',
		'dontAsk': 'dontAsk',
	};

	return mapping[mode] || (mode as ClaudeCLIPermissionMode);
}

/**
 * Claude 로컬 설정 (프로젝트별, .gitignore 대상)
 * 위치: {workspace}/.vscode/claude.local.json
 */
export interface IClaudeLocalConfig {
	/** Claude 실행 설정 */
	readonly executable?: IClaudeExecutableConfig;
	/** 모두 OK 모드 (AskUser 자동 승인) */
	readonly autoAccept?: boolean;
	/** 작업 디렉토리 (기본: 워크스페이스 루트) */
	readonly workingDirectory?: string;
	/** 사용할 모델명 (예: claude-sonnet-4-20250514) */
	readonly model?: string;

	// === 확장 옵션 (Step 2) ===

	/** 에이전트 최대 턴 수 */
	readonly maxTurns?: number;
	/** 비용 상한선 (USD) */
	readonly maxBudgetUsd?: number;
	/** 대체 모델 (기본 모델 실패 시 사용) */
	readonly fallbackModel?: string;
	/** 금지 도구 목록 */
	readonly disallowedTools?: string[];
	/** 권한 모드 */
	readonly permissionMode?: ClaudePermissionMode;
	/** 베타 기능 목록 */
	readonly betas?: string[];
	/** 추가 디렉토리 경로 목록 */
	readonly addDirs?: string[];
	/** MCP 설정 파일 경로 */
	readonly mcpConfig?: string;
	/** 에이전트 설정 경로 */
	readonly agents?: string;
	/** 최대 세션 수 (기본: 10, 최소: 1) */
	readonly maxSessions?: number;
}

/**
 * 기본 로컬 설정
 */
export const DEFAULT_LOCAL_CONFIG: IClaudeLocalConfig = {
	executable: {
		command: 'claude'
	},
	autoAccept: false
};

