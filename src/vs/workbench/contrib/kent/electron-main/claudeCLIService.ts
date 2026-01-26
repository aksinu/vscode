/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { spawn, ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { IClaudeCLIService, IClaudeCLIStreamEvent, IClaudeCLIRequestOptions } from '../common/claudeCLI.js';
import { IClaudeExecutableConfig, getScriptInterpreter, detectScriptType, ClaudeScriptType } from '../common/claudeLocalConfig.js';

// 디버그용 파일 로그
const logFile = path.join(process.env.TEMP || '/tmp', 'claude-cli-debug.log');
function debugLog(...args: unknown[]) {
	const timestamp = new Date().toISOString();
	const msg = args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ');
	fs.appendFileSync(logFile, `[${timestamp}] ${msg}\n`);
}


export class ClaudeCLIService extends Disposable implements IClaudeCLIService {
	declare readonly _serviceBrand: undefined;

	private _process: ChildProcess | undefined;
	private _isRunning = false;
	private _stdinOpen = false;

	private readonly _onDidReceiveData = this._register(new Emitter<IClaudeCLIStreamEvent>());
	readonly onDidReceiveData: Event<IClaudeCLIStreamEvent> = this._onDidReceiveData.event;

	private readonly _onDidComplete = this._register(new Emitter<void>());
	readonly onDidComplete: Event<void> = this._onDidComplete.event;

	private readonly _onDidError = this._register(new Emitter<string>());
	readonly onDidError: Event<string> = this._onDidError.event;

	constructor() {
		super();
		debugLog('ClaudeCLIService initialized');
	}

	private _promptFile: string | undefined;

	async sendPrompt(prompt: string, options?: IClaudeCLIRequestOptions): Promise<void> {
		if (this._isRunning) {
			throw new Error('A request is already in progress');
		}

		this._isRunning = true;

		debugLog(`Starting with prompt length: ${prompt.length}, first 100 chars: ${prompt.substring(0, 100)}`);

		// Claude CLI 인자 구성
		const claudeArgs: string[] = [
			'--output-format', 'stream-json',
			'--verbose'
		];

		// 세션 재개 옵션
		if (options?.resumeSessionId) {
			claudeArgs.push('--resume', options.resumeSessionId);
			debugLog(' Resuming session:', options.resumeSessionId);
		}

		// 옵션 추가
		if (options?.model) {
			claudeArgs.push('--model', options.model);
		}
		if (options?.systemPrompt && !options?.resumeSessionId) {
			// 세션 재개 시에는 시스템 프롬프트 무시
			claudeArgs.push('--system-prompt', options.systemPrompt);
		}
		if (options?.allowedTools && options.allowedTools.length > 0) {
			claudeArgs.push('--allowedTools', ...options.allowedTools);
		}

		// 실행 명령어 및 인자 결정
		const { spawnCommand, spawnArgs } = this.resolveExecutable(options?.executable, claudeArgs, options?.workingDir);
		debugLog(' Spawning:', spawnCommand, spawnArgs.join(' '));

		return new Promise((resolve, reject) => {
			debugLog(' Platform:', process.platform);

			try {
				// 디버거가 자식 프로세스에 붙지 않도록 환경 변수 정리
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

				debugLog(' Spawned with shell: true');
			} catch (spawnError) {
				debugLog('ERROR: Spawn failed:', spawnError);
				this._isRunning = false;
				this.cleanupPromptFile();
				this._onDidError.fire(`Spawn failed: ${spawnError}`);
				reject(spawnError);
				return;
			}

			if (!this._process || !this._process.pid) {
				const error = 'Failed to spawn claude process - no PID';
				debugLog('ERROR:', error);
				this._isRunning = false;
				this.cleanupPromptFile();
				this._onDidError.fire(error);
				reject(new Error(error));
				return;
			}

			debugLog(' Process spawned successfully, pid:', this._process.pid);
			debugLog(' stdout exists:', !!this._process.stdout);
			debugLog(' stderr exists:', !!this._process.stderr);

			let buffer = '';

			debugLog(' Registering stdout handler...');
			this._process.stdout?.on('data', (data: Buffer) => {
				const chunk = data.toString();
				debugLog(' stdout chunk:', chunk.substring(0, 200));
				buffer += chunk;

				// 줄 단위로 JSON 파싱
				const lines = buffer.split('\n');
				buffer = lines.pop() || '';

				for (const line of lines) {
					if (!line.trim()) continue;

					try {
						const parsed = JSON.parse(line) as IClaudeCLIStreamEvent;
						debugLog(' Parsed event type:', parsed.type);
						this._onDidReceiveData.fire(parsed);
					} catch {
						debugLog(' JSON parse failed, treating as text');
						// JSON 파싱 실패 시 텍스트로 처리
						this._onDidReceiveData.fire({
							type: 'text',
							content: line
						});
					}
				}
			});

			debugLog(' Registering stderr handler...');
			this._process.stderr?.on('data', (data: Buffer) => {
				const errorText = data.toString();
				debugLog('stderr:', errorText);
			});

			debugLog(' Registering close handler...');
			this._process.on('close', (code) => {
				debugLog(' Process closed with code:', code);
				this._isRunning = false;
				this._stdinOpen = false;
				this._process = undefined;
				this.cleanupPromptFile();

				if (code === 0) {
					this._onDidComplete.fire();
					resolve();
				} else {
					const errorMsg = `Claude CLI exited with code ${code}`;
					this._onDidError.fire(errorMsg);
					reject(new Error(errorMsg));
				}
			});

			debugLog(' Registering error handler...');
			this._process.on('error', (error) => {
				debugLog('ERROR: Process error:', error.message);
				this._isRunning = false;
				this._stdinOpen = false;
				this._process = undefined;
				this.cleanupPromptFile();
				this._onDidError.fire(error.message);
				reject(error);
			});

			debugLog(' All handlers registered, waiting for process events...');

			// stdin으로 프롬프트 전송 후 end() 호출
			// AskUser가 필요하면 --resume 옵션으로 새 세션 시작
			if (this._process.stdin) {
				debugLog(' Writing prompt to stdin...');
				this._stdinOpen = true;
				this._process.stdin.write(prompt + '\n', 'utf8', (err) => {
					if (err) {
						debugLog('ERROR: stdin write failed:', err.message);
						this._stdinOpen = false;
					} else {
						debugLog(' Prompt written to stdin, ending...');
						this._process?.stdin?.end();
						this._stdinOpen = false;
					}
				});
			}
		});
	}

	/**
	 * 실행 설정에 따라 spawn 명령어와 인자를 결정
	 */
	private resolveExecutable(
		executable: IClaudeExecutableConfig | undefined,
		claudeArgs: string[],
		workingDir?: string
	): { spawnCommand: string; spawnArgs: string[] } {
		const isWindows = process.platform === 'win32';

		// 기본값: 'claude' 명령어 직접 실행
		if (!executable || executable.type === 'command') {
			const command = executable?.command || 'claude';
			return { spawnCommand: command, spawnArgs: claudeArgs };
		}

		// 스크립트 실행
		if (executable.type === 'script' && executable.script) {
			let scriptPath = executable.script;

			// 상대 경로면 워크스페이스 기준으로 변환
			if (!path.isAbsolute(scriptPath) && workingDir) {
				scriptPath = path.join(workingDir, scriptPath);
			}

			// 스크립트 타입 결정 (명시 또는 자동 감지)
			const scriptType: ClaudeScriptType = executable.scriptType || detectScriptType(scriptPath) || 'sh';

			debugLog(' Script path:', scriptPath);
			debugLog(' Script type:', scriptType);

			// 인터프리터 정보
			const interpreter = getScriptInterpreter(scriptType, isWindows);

			if (interpreter.command) {
				// 인터프리터로 스크립트 실행: interpreter script claudeArgs
				return {
					spawnCommand: interpreter.command,
					spawnArgs: [...interpreter.args, scriptPath, ...claudeArgs]
				};
			} else {
				// 직접 실행 (bat/sh with shell:true)
				return {
					spawnCommand: scriptPath,
					spawnArgs: claudeArgs
				};
			}
		}

		// 폴백: 기본 'claude' 명령어
		return { spawnCommand: 'claude', spawnArgs: claudeArgs };
	}

	private cleanupPromptFile(): void {
		if (this._promptFile) {
			try {
				if (fs.existsSync(this._promptFile)) {
					fs.unlinkSync(this._promptFile);
					debugLog(` Cleaned up prompt file: ${this._promptFile}`);
				}
			} catch (e) {
				debugLog('ERROR: Failed to cleanup prompt file:', e);
			}
			this._promptFile = undefined;
		}
	}

	sendUserInput(input: string): void {
		if (!this._process || !this._process.stdin || !this._stdinOpen) {
			debugLog('ERROR: Cannot send user input - no active process or stdin closed');
			return;
		}

		debugLog(' Sending user input:', input.substring(0, 100));

		this._process.stdin.write(input + '\n', 'utf8', (err) => {
			if (err) {
				debugLog('ERROR: Failed to send user input:', err.message);
			} else {
				debugLog(' User input sent successfully');
			}
		});
	}

	cancelRequest(): void {
		if (this._process) {
			this._process.kill('SIGTERM');
			this._process = undefined;
			this._isRunning = false;
			this._stdinOpen = false;
			this.cleanupPromptFile();
		}
	}

	isRunning(): boolean {
		return this._isRunning;
	}

	override dispose(): void {
		this.cancelRequest();
		this.cleanupPromptFile();
		super.dispose();
	}
}
