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
import { IClaudeExecutableConfig, getScriptInterpreter, detectScriptType, ClaudeScriptType } from '../common/claudeLocalConfig.js';

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
			'--verbose',
			'--dangerously-skip-permissions'
		];

		if (options?.resumeSessionId) {
			claudeArgs.push('--resume', options.resumeSessionId);
			debugLog(`[Instance:${this.chatId}] Resuming session:`, options.resumeSessionId);
		} else if (options?.continueLastSession) {
			claudeArgs.push('--continue');
			debugLog(`[Instance:${this.chatId}] Continuing last session`);
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
		if (options?.maxTurns !== undefined && options.maxTurns > 0) {
			claudeArgs.push('--max-turns', String(options.maxTurns));
		}
		if (options?.maxBudgetUsd !== undefined && options.maxBudgetUsd > 0) {
			claudeArgs.push('--max-budget-usd', String(options.maxBudgetUsd));
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
		if (options?.permissionMode) {
			claudeArgs.push('--permission-mode', options.permissionMode);
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

		const { spawnCommand, spawnArgs } = this.resolveExecutable(options?.executable, claudeArgs, options?.workingDir);
		debugLog(`[Instance:${this.chatId}] Spawning:`, spawnCommand, spawnArgs.join(' '));

		return new Promise((resolve, reject) => {
			try {
				const cleanEnv = { ...process.env };
				delete cleanEnv.NODE_OPTIONS;
				delete cleanEnv.ELECTRON_RUN_AS_NODE;
				delete cleanEnv.VSCODE_INSPECTOR_OPTIONS;

				this._process = spawn(spawnCommand, spawnArgs, {
					cwd: options?.workingDir || process.cwd(),
					shell: true,
					env: cleanEnv,
					stdio: ['pipe', 'pipe', 'pipe'],
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
			});

			this._process.on('close', (code, signal) => {
				debugLog(`[Instance:${this.chatId}] Process closed, code:`, code, 'signal:', signal);
				this._isRunning = false;
				this._stdinOpen = false;
				this._process = undefined;
				this.cleanupPromptFile();

				const isSuccess = code === 0 || (code === null && this._receivedResult);

				if (isSuccess) {
					debugLog(`[Instance:${this.chatId}] Process completed successfully`);
					this._onDidComplete.fire();
					resolve();
				} else {
					const errorMsg = signal
						? `Claude CLI terminated by signal ${signal}`
						: `Claude CLI exited with code ${code}`;
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

			if (this._process.stdin) {
				debugLog(`[Instance:${this.chatId}] Writing prompt to stdin...`);
				this._stdinOpen = true;
				this._process.stdin.write(prompt + '\n', 'utf8', (err) => {
					if (err) {
						debugLog(`[Instance:${this.chatId}] ERROR: stdin write failed:`, err.message);
						this._stdinOpen = false;
					} else {
						debugLog(`[Instance:${this.chatId}] Prompt written, ending stdin`);
						this._process?.stdin?.end();
						this._stdinOpen = false;
					}
				});
			}
		});
	}

	private resolveExecutable(
		executable: IClaudeExecutableConfig | undefined,
		claudeArgs: string[],
		workingDir?: string
	): { spawnCommand: string; spawnArgs: string[] } {
		const isWindows = process.platform === 'win32';

		if (!executable || executable.type === 'command') {
			const command = executable?.command || 'claude';
			return { spawnCommand: command, spawnArgs: claudeArgs };
		}

		if (executable.type === 'script' && executable.script) {
			let scriptPath = executable.script;

			if (!path.isAbsolute(scriptPath) && workingDir) {
				scriptPath = path.join(workingDir, scriptPath);
			}

			const scriptType: ClaudeScriptType = executable.scriptType || detectScriptType(scriptPath) || 'sh';
			const interpreter = getScriptInterpreter(scriptType, isWindows);

			if (interpreter.command) {
				return {
					spawnCommand: interpreter.command,
					spawnArgs: [...interpreter.args, scriptPath, ...claudeArgs]
				};
			} else {
				return {
					spawnCommand: scriptPath,
					spawnArgs: claudeArgs
				};
			}
		}

		return { spawnCommand: 'claude', spawnArgs: claudeArgs };
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
