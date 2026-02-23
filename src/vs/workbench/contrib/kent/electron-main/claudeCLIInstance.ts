/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { spawn, ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { IClaudeCLIStreamEvent, IClaudeCLIRequestOptions, IClaudeRateLimitInfo } from '../common/claudeCLI.js';
import { IClaudeExecutableConfig, normalizePermissionMode } from '../common/config/claudeLocalConfig.js';

// 디버그용 파일 로그
const logFile = path.join(process.env.TEMP || '/tmp', 'claude-cli-debug.log');
function debugLog(...args: unknown[]) {
	const timestamp = new Date().toISOString();
	const msg = args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ');
	fs.appendFileSync(logFile, `[${timestamp}] ${msg}\n`);
}

/**
 * Rate limit 에러 메시지 파싱
 */
function parseRateLimitError(errorText: string): IClaudeRateLimitInfo | null {
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
function isFatalCLIError(stderrText: string): boolean {
	const lower = stderrText.toLowerCase();
	return lower.includes('prompt is too long') ||
		lower.includes('too many tokens') ||
		lower.includes('context length exceeded') ||
		lower.includes('content_too_large') ||
		lower.includes('maximum context length');
}

/**
 * 단일 Claude CLI 프로세스 인스턴스
 * 하나의 채팅창(chatId)에 대응하는 CLI 프로세스를 관리
 */
export class ClaudeCLIInstance extends Disposable {
	private _process: ChildProcess | undefined;
	private _isRunning = false;
	private _stdinOpen = false;
	private _receivedResult = false;
	private _promptFile: string | undefined;
	private _lastActivityTime: number = Date.now();

	readonly chatId: string;

	private readonly _onDidReceiveData = this._register(new Emitter<IClaudeCLIStreamEvent>());
	readonly onDidReceiveData: Event<IClaudeCLIStreamEvent> = this._onDidReceiveData.event;

	private readonly _onDidComplete = this._register(new Emitter<void>());
	readonly onDidComplete: Event<void> = this._onDidComplete.event;

	private readonly _onDidError = this._register(new Emitter<string>());
	readonly onDidError: Event<string> = this._onDidError.event;

	constructor(chatId: string) {
		super();
		this.chatId = chatId;
		debugLog(`[Instance:${chatId}] Created`);
	}

	get lastActivityTime(): number {
		return this._lastActivityTime;
	}

	private updateActivityTime(): void {
		this._lastActivityTime = Date.now();
	}

	async sendPrompt(prompt: string, options?: IClaudeCLIRequestOptions): Promise<void> {
		if (this._isRunning) {
			throw new Error(`[${this.chatId}] A request is already in progress`);
		}

		this._isRunning = true;
		this._receivedResult = false;
		this.updateActivityTime();

		debugLog(`[Instance:${this.chatId}] Starting with prompt length: ${prompt.length}`);

		const claudeArgs: string[] = [
			'--output-format', 'stream-json',
			'--verbose'
		];

		// Permission Mode 처리: 설정된 모드에 따라 CLI 인자 결정
		// stream-json 모드에서는 인터랙티브 권한 프롬프트(input_request)를 처리할 수 없으므로
		// 'default' 모드는 --dangerously-skip-permissions로 대체 (향후 자체 권한 UI 구현 예정)
		// 'acceptEdits', 'plan' 등 비-인터랙티브 모드만 --permission-mode로 전달
		const normalizedPermMode = normalizePermissionMode(options?.permissionMode);
		const nonInteractiveModes = ['acceptEdits', 'plan', 'dontAsk'];
		if (normalizedPermMode && nonInteractiveModes.includes(normalizedPermMode)) {
			claudeArgs.push('--permission-mode', normalizedPermMode);
		} else {
			// 모드 미지정, 'default', 'bypassPermissions' → 전체 권한 부여
			claudeArgs.push('--dangerously-skip-permissions');
		}

		if (options?.resumeSessionId) {
			claudeArgs.push('--resume', options.resumeSessionId);
			debugLog(`[Instance:${this.chatId}] Resuming session:`, options.resumeSessionId);
		}

		if (options?.model) {
			claudeArgs.push('--model', options.model);
		}
		if (options?.systemPrompt && options.systemPrompt.trim() !== '' && !options?.resumeSessionId) {
			claudeArgs.push('--system-prompt', options.systemPrompt);
		}
		if (options?.allowedTools && options.allowedTools.length > 0) {
			claudeArgs.push('--allowedTools', ...options.allowedTools);
		}
		if (options?.fallbackModel) {
			claudeArgs.push('--fallback-model', options.fallbackModel);
		}
		if (options?.appendSystemPrompt && options.appendSystemPrompt.trim() !== '') {
			claudeArgs.push('--append-system-prompt', options.appendSystemPrompt);
		}
		if (options?.disallowedTools && options.disallowedTools.length > 0) {
			for (const tool of options.disallowedTools) {
				claudeArgs.push('--disallowedTools', tool);
			}
		}
		if (options?.betas && options.betas.length > 0) {
			for (const beta of options.betas) {
				claudeArgs.push('--betas', beta);
			}
		}
		if (options?.addDirs && options.addDirs.length > 0) {
			for (const dir of options.addDirs) {
				claudeArgs.push('--add-dir', dir);
			}
		}
		if (options?.mcpConfig) {
			claudeArgs.push('--mcp-config', options.mcpConfig);
		}
		if (options?.agents) {
			claudeArgs.push('--agents', options.agents);
		}
		if (options?.effort) {
			claudeArgs.push('--effort', options.effort);
		}

		// 프롬프트 전달 방식:
		// - 프롬프트를 임시 파일에 저장
		// - Normal: 임시 파일 내용을 Node.js stdin으로 전달 (input_request 응답 가능)
		// - Resume: Windows 셸 파이프로 전달 (type tempfile | claude --resume ...)
		//   → Node.js stdin 파이프가 --resume 모드에서 신뢰성 없어 셸 파이프 사용
		// - Windows cmd.exe 명령줄 제한(~8000자)을 피하기 위해 임시 파일 사용
		const isResuming = !!options?.resumeSessionId;
		const promptTempFile = path.join(process.env.TEMP || '/tmp', `claude-prompt-${this.chatId}-${Date.now()}.txt`);
		fs.writeFileSync(promptTempFile, prompt, 'utf8');
		this._promptFile = promptTempFile;
		debugLog(`[Instance:${this.chatId}] Prompt written to temp file: ${promptTempFile} (${prompt.length} chars, resume=${isResuming})`);

		const { spawnCommand, spawnArgs } = this.resolveExecutable(options?.executable, claudeArgs, options?.workingDir);

		// Resume: 셸 파이프로 프롬프트 전달 (Node.js stdin 대신)
		// type "tempfile" | claude --resume <id> --output-format stream-json ...
		let finalCommand: string;
		let finalArgs: string[];
		let useStdin: boolean;

		if (isResuming) {
			// Windows: type, Unix: cat
			const catCmd = process.platform === 'win32' ? 'type' : 'cat';
			finalCommand = `${catCmd} "${promptTempFile}" | ${spawnCommand} ${spawnArgs.join(' ')}`;
			finalArgs = [];
			useStdin = false;
			debugLog(`[Instance:${this.chatId}] Resume: using shell pipe: ${finalCommand}`);
		} else {
			finalCommand = spawnCommand;
			finalArgs = spawnArgs;
			useStdin = true;
			debugLog(`[Instance:${this.chatId}] Normal: using stdin, spawning: ${spawnCommand} ${spawnArgs.join(' ')}`);
		}

		return new Promise((resolve, reject) => {
			try {
				const cleanEnv = { ...process.env };
				delete cleanEnv.NODE_OPTIONS;
				delete cleanEnv.ELECTRON_RUN_AS_NODE;
				delete cleanEnv.VSCODE_INSPECTOR_OPTIONS;

				this._process = spawn(finalCommand, finalArgs, {
					cwd: options?.workingDir || process.cwd(),
					shell: true,
					env: cleanEnv,
					stdio: [useStdin ? 'pipe' : 'ignore', 'pipe', 'pipe'],
					windowsHide: true
				});
			} catch (spawnError) {
				debugLog(`[Instance:${this.chatId}] ERROR: Spawn failed:`, spawnError);
				this._isRunning = false;
				this.cleanupPromptFile();
				this._onDidError.fire(`Spawn failed: ${spawnError}`);
				reject(spawnError);
				return;
			}

			if (!this._process || !this._process.pid) {
				const error = 'Failed to spawn claude process - no PID';
				debugLog(`[Instance:${this.chatId}] ERROR:`, error);
				this._isRunning = false;
				this.cleanupPromptFile();
				this._onDidError.fire(error);
				reject(new Error(error));
				return;
			}

			debugLog(`[Instance:${this.chatId}] Process spawned, pid:`, this._process.pid);

			let buffer = '';

			this._process.stdout?.on('data', (data: Buffer) => {
				this.updateActivityTime();
				const chunk = data.toString();
				debugLog(`[Instance:${this.chatId}] stdout chunk:`, chunk.substring(0, 200));
				buffer += chunk;

				const lines = buffer.split('\n');
				buffer = lines.pop() || '';

				for (const line of lines) {
					if (!line.trim()) continue;

					try {
						const parsed = JSON.parse(line) as IClaudeCLIStreamEvent;
						debugLog(`[Instance:${this.chatId}] Parsed event type:`, parsed.type);

						if (parsed.type === 'result') {
							this._receivedResult = true;
							debugLog(`[Instance:${this.chatId}] Result event received`);
						}

						this._onDidReceiveData.fire(parsed);
					} catch {
						debugLog(`[Instance:${this.chatId}] JSON parse failed, treating as text`);
						this._onDidReceiveData.fire({
							type: 'text',
							content: line
						});
					}
				}
			});

			let stderrBuffer = '';
			let hasFatalStderrError = false;
			this._process.stderr?.on('data', (data: Buffer) => {
				this.updateActivityTime();
				const errorText = data.toString();
				stderrBuffer += errorText;
				debugLog(`[Instance:${this.chatId}] stderr:`, errorText);

				const rateLimitInfo = parseRateLimitError(stderrBuffer);
				if (rateLimitInfo) {
					debugLog(`[Instance:${this.chatId}] Rate limit detected`);
					this._onDidReceiveData.fire({
						type: 'error',
						error_type: 'rate_limit',
						retry_after: rateLimitInfo.retryAfterSeconds,
						content: rateLimitInfo.message
					});
				}

				// 치명적 에러 감지 (exit code 0으로 종료되어도 에러로 처리해야 함)
				if (isFatalCLIError(stderrBuffer)) {
					hasFatalStderrError = true;
				}
			});

			this._process.on('close', (code, signal) => {
				debugLog(`[Instance:${this.chatId}] Process closed, code:`, code, 'signal:', signal);
				debugLog(`[Instance:${this.chatId}] stderr buffer:`, stderrBuffer);
				this._isRunning = false;
				this._stdinOpen = false;
				this._process = undefined;
				this.cleanupPromptFile();

				// stderr에 치명적 에러가 있고 result를 못 받았으면 에러 처리
				// (CLI가 exit code 0으로 종료해도 실질적 실패)
				if (hasFatalStderrError && !this._receivedResult) {
					const errorMsg = stderrBuffer.trim();
					debugLog(`[Instance:${this.chatId}] Fatal stderr error detected (code=${code}):`, errorMsg);
					this._onDidError.fire(errorMsg);
					reject(new Error(errorMsg));
					return;
				}

				// result 이벤트를 이미 받았으면 exit code와 무관하게 정상 종료로 처리
				// Claude CLI가 AskUser 등의 이유로 code 1로 종료되더라도
				// result를 받았으면 정상 완료임
				const isSuccess = code === 0 || this._receivedResult || (code === null && this._receivedResult);

				if (isSuccess) {
					debugLog(`[Instance:${this.chatId}] Process completed successfully (code: ${code}, receivedResult: ${this._receivedResult})`);
					this._onDidComplete.fire();
					resolve();
				} else {
					const baseMsg = signal
						? `Claude CLI terminated by signal ${signal}`
						: `Claude CLI exited with code ${code}`;
					const stderrInfo = stderrBuffer.trim();
					const errorMsg = stderrInfo
						? `${baseMsg}\n${stderrInfo}`
						: baseMsg;
					debugLog(`[Instance:${this.chatId}] Process failed:`, errorMsg);
					this._onDidError.fire(errorMsg);
					reject(new Error(errorMsg));
				}
			});

			this._process.on('error', (error) => {
				debugLog(`[Instance:${this.chatId}] Process error:`, error.message);
				this._isRunning = false;
				this._stdinOpen = false;
				this._process = undefined;
				this.cleanupPromptFile();
				this._onDidError.fire(error.message);
				reject(error);
			});

			// 프롬프트를 stdin으로 전송 (normal case만)
			// Resume는 셸 파이프로 전달하므로 stdin 불필요 (stdio: 'ignore')
			if (useStdin && this._process.stdin) {
				this._stdinOpen = true;
				try {
					const promptContent = fs.readFileSync(promptTempFile, 'utf8');
					debugLog(`[Instance:${this.chatId}] Writing prompt from temp file to stdin (${promptContent.length} chars)...`);
					this._process.stdin.write(promptContent + '\n', 'utf8', (err) => {
						if (err) {
							debugLog(`[Instance:${this.chatId}] ERROR: stdin write failed:`, err.message);
							this._stdinOpen = false;
						} else {
							debugLog(`[Instance:${this.chatId}] Prompt written to stdin, keeping open for input_request`);
						}
					});
				} catch (readErr) {
					debugLog(`[Instance:${this.chatId}] ERROR: Failed to read prompt file:`, readErr);
					this._stdinOpen = false;
				}

				// 안전 장치: CLI가 EOF를 기다리는 경우를 대비한 폴백 타이머
				{
					let hasReceivedAnyData = false;
					const stdinFallbackTimer = setTimeout(() => {
						dataListener.dispose();
						if (!hasReceivedAnyData && this._stdinOpen && this._process?.stdin) {
							debugLog(`[Instance:${this.chatId}] No data from CLI after 10s — closing stdin (EOF fallback)`);
							this._process.stdin.end();
							this._stdinOpen = false;
						}
					}, 10000);
					const dataListener = this._onDidReceiveData.event(() => {
						if (!hasReceivedAnyData) {
							hasReceivedAnyData = true;
							clearTimeout(stdinFallbackTimer);
							dataListener.dispose();
							debugLog(`[Instance:${this.chatId}] CLI responded — stdin stays open for input_request`);
						}
					});
				}
			}
		});
	}

	private resolveExecutable(
		executable: IClaudeExecutableConfig | undefined,
		claudeArgs: string[],
		workingDir?: string
	): { spawnCommand: string; spawnArgs: string[] } {
		const command = executable?.command || 'claude';
		return { spawnCommand: command, spawnArgs: claudeArgs };
	}

	private cleanupPromptFile(): void {
		if (this._promptFile) {
			try {
				if (fs.existsSync(this._promptFile)) {
					fs.unlinkSync(this._promptFile);
					debugLog(`[Instance:${this.chatId}] Cleaned up prompt file`);
				}
			} catch (e) {
				debugLog(`[Instance:${this.chatId}] ERROR: Failed to cleanup prompt file:`, e);
			}
			this._promptFile = undefined;
		}
	}

	sendUserInput(input: string): void {
		if (!this._process || !this._process.stdin || !this._stdinOpen) {
			debugLog(`[Instance:${this.chatId}] ERROR: Cannot send user input - no active process or stdin closed`);
			return;
		}

		this.updateActivityTime();
		debugLog(`[Instance:${this.chatId}] Sending user input:`, input.substring(0, 100));

		this._process.stdin.write(input + '\n', 'utf8', (err) => {
			if (err) {
				debugLog(`[Instance:${this.chatId}] ERROR: Failed to send user input:`, err.message);
			} else {
				debugLog(`[Instance:${this.chatId}] User input sent`);
			}
		});
	}

	cancelRequest(): void {
		if (this._process) {
			debugLog(`[Instance:${this.chatId}] Cancelling request`);
			this._process.kill('SIGTERM');
			this._process = undefined;
			this._isRunning = false;
			this._stdinOpen = false;
			this._receivedResult = false;
			this.cleanupPromptFile();
		}
	}

	isRunning(): boolean {
		return this._isRunning;
	}

	override dispose(): void {
		debugLog(`[Instance:${this.chatId}] Disposing`);
		this.cancelRequest();
		this.cleanupPromptFile();
		super.dispose();
	}
}
