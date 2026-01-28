/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Claude 실행 방식
 */
export type ClaudeExecutableType = 'command' | 'script';

/**
 * 스크립트 타입
 */
export type ClaudeScriptType = 'bat' | 'sh' | 'ps1' | 'node' | 'python';

/**
 * Claude 실행 설정
 */
export interface IClaudeExecutableConfig {
	/** 실행 방식: 'command' (터미널 명령어) 또는 'script' (스크립트 파일) */
	readonly type: ClaudeExecutableType;
	/** type: 'command'일 때 사용할 명령어 (기본: 'claude') */
	readonly command?: string;
	/** type: 'script'일 때 스크립트 경로 (워크스페이스 상대 경로) */
	readonly script?: string;
	/** 스크립트 타입 (자동 감지 또는 명시) */
	readonly scriptType?: ClaudeScriptType;
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
	/** 확장 사고 모드 활성화 */
	readonly extendedThinking?: boolean;
}

/**
 * 기본 로컬 설정
 */
export const DEFAULT_LOCAL_CONFIG: IClaudeLocalConfig = {
	executable: {
		type: 'command',
		command: 'claude'
	},
	autoAccept: false
};

/**
 * 스크립트 타입별 인터프리터
 */
export function getScriptInterpreter(scriptType: ClaudeScriptType, isWindows: boolean): { command: string; args: string[] } {
	switch (scriptType) {
		case 'bat':
			return { command: 'cmd.exe', args: ['/c'] };
		case 'ps1':
			return { command: 'powershell.exe', args: ['-ExecutionPolicy', 'Bypass', '-File'] };
		case 'sh':
			return isWindows
				? { command: 'bash.exe', args: [] }  // Git Bash or WSL
				: { command: '/bin/bash', args: [] };
		case 'node':
			return { command: 'node', args: [] };
		case 'python':
			return isWindows
				? { command: 'python', args: [] }
				: { command: 'python3', args: [] };
		default:
			return { command: '', args: [] };
	}
}

/**
 * 파일 확장자로 스크립트 타입 감지
 */
export function detectScriptType(scriptPath: string): ClaudeScriptType | undefined {
	const ext = scriptPath.toLowerCase().split('.').pop();
	switch (ext) {
		case 'bat':
		case 'cmd':
			return 'bat';
		case 'ps1':
			return 'ps1';
		case 'sh':
		case 'bash':
			return 'sh';
		case 'js':
		case 'mjs':
			return 'node';
		case 'py':
			return 'python';
		default:
			return undefined;
	}
}
