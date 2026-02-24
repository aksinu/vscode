/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
import { IClaudeRateLimitInfo } from '../common/claudeCLI.js';

// 디버그용 파일 로그
const logFile = path.join(process.env.TEMP || '/tmp', 'claude-cli-debug.log');
export function debugLog(...args: unknown[]): void {
	const timestamp = new Date().toISOString();
	const msg = args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ');
	fs.appendFileSync(logFile, `[${timestamp}] ${msg}\n`);
}

/**
 * Rate limit 에러 메시지 파싱
 * Claude CLI/API는 다양한 형태로 rate limit을 알려줄 수 있음
 */
export function parseRateLimitError(errorText: string): IClaudeRateLimitInfo | null {
	const isRateLimited = /rate[_\s]?limit/i.test(errorText) ||
		/too many requests/i.test(errorText) ||
		/429/i.test(errorText) ||
		/quota exceeded/i.test(errorText) ||
		/token.*exhaust/i.test(errorText);

	if (!isRateLimited) {
		return null;
	}

	let retryAfterSeconds = 60;

	const retryMatch = errorText.match(/(?:retry|try again|wait).*?(\d+)\s*(second|minute|hour|sec|min|hr)/i);
	if (retryMatch) {
		const value = parseInt(retryMatch[1], 10);
		const unit = retryMatch[2].toLowerCase();
		if (unit.startsWith('min')) {
			retryAfterSeconds = value * 60;
		} else if (unit.startsWith('hour') || unit.startsWith('hr')) {
			retryAfterSeconds = value * 3600;
		} else {
			retryAfterSeconds = value;
		}
	}

	const resetMatch = errorText.match(/reset.*?(\d{1,2}:\d{2}(?::\d{2})?)/i);
	let resetTime: Date | undefined;
	if (resetMatch) {
		const now = new Date();
		const [hours, minutes] = resetMatch[1].split(':').map(Number);
		resetTime = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hours, minutes);
		if (resetTime < now) {
			resetTime.setDate(resetTime.getDate() + 1);
		}
		retryAfterSeconds = Math.ceil((resetTime.getTime() - now.getTime()) / 1000);
	}

	return {
		isRateLimited: true,
		retryAfterSeconds,
		resetTime,
		message: errorText.substring(0, 200)
	};
}

/**
 * CLI stderr에서 치명적 에러 감지
 * exit code 0이어도 실질적 실패인 경우 (prompt too long 등)
 */
export function isFatalCLIError(stderrText: string): boolean {
	const lower = stderrText.toLowerCase();
	return lower.includes('prompt is too long') ||
		lower.includes('too many tokens') ||
		lower.includes('context length exceeded') ||
		lower.includes('content_too_large') ||
		lower.includes('maximum context length');
}

/**
 * 디버거가 자식 프로세스에 붙지 않도록 정리된 환경 변수 생성
 */
export function createCleanEnv(): NodeJS.ProcessEnv {
	const cleanEnv = { ...process.env };
	delete cleanEnv.NODE_OPTIONS;
	delete cleanEnv.ELECTRON_RUN_AS_NODE;
	delete cleanEnv.VSCODE_INSPECTOR_OPTIONS;
	return cleanEnv;
}

/**
 * Claude CLI 연결 테스트 (공유 유틸리티)
 */
export function checkClaudeConnection(label: string): Promise<{ success: boolean; version?: string; error?: string }> {
	debugLog(`[${label}] checkConnection`);

	return new Promise((resolve) => {
		try {
			const proc = spawn('claude', ['--version'], {
				shell: true,
				env: createCleanEnv(),
				timeout: 10000
			});

			let stdout = '';
			let stderr = '';

			proc.stdout?.on('data', (data: Buffer) => {
				stdout += data.toString();
			});

			proc.stderr?.on('data', (data: Buffer) => {
				stderr += data.toString();
			});

			proc.on('close', (code) => {
				debugLog(`[${label}] checkConnection closed, code:`, code);

				if (code === 0) {
					const versionMatch = stdout.match(/(\d+\.\d+\.\d+)/);
					resolve({
						success: true,
						version: versionMatch ? versionMatch[1] : stdout.trim()
					});
				} else {
					resolve({
						success: false,
						error: stderr || `Exit code: ${code}`
					});
				}
			});

			proc.on('error', (error) => {
				debugLog(`[${label}] checkConnection error:`, error.message);
				resolve({
					success: false,
					error: error.message
				});
			});

		} catch (error) {
			debugLog(`[${label}] checkConnection exception:`, error);
			resolve({
				success: false,
				error: String(error)
			});
		}
	});
}
