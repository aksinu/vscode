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

	async sendPrompt(prompt: string, options?: IClaudeCLIRequestOptions): Promise<void> {
		if (this._isRunning) {
			throw new Error('A request is already in progress');
		}

		this._isRunning = true;

		debugLog(`Starting with prompt length: ${prompt.length}, first 100 chars: ${prompt.substring(0, 100)}`);

		// stdin을 통해 프롬프트를 전달 (명령줄 길이 제한 회피)
		const args: string[] = [
			'--output-format', 'stream-json',
			'--verbose'
		];

		// 옵션 추가
		if (options?.model) {
			args.push('--model', options.model);
		}
		if (options?.systemPrompt) {
			args.push('--system-prompt', options.systemPrompt);
		}
		if (options?.allowedTools && options.allowedTools.length > 0) {
			args.push('--allowedTools', ...options.allowedTools);
		}

		debugLog(' Spawning process with args:', args.join(' '));

		return new Promise((resolve, reject) => {
			debugLog(' Platform:', process.platform);
			debugLog(' Args:', JSON.stringify(args.slice(0, 3)));

			try {
				// 디버거가 자식 프로세스에 붙지 않도록 환경 변수 정리
				const cleanEnv = { ...process.env };
				delete cleanEnv.NODE_OPTIONS;
				delete cleanEnv.ELECTRON_RUN_AS_NODE;
				delete cleanEnv.VSCODE_INSPECTOR_OPTIONS;

				// shell: true로 실행하면 인자가 올바르게 처리됨
				this._process = spawn('claude', args, {
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
				this._onDidError.fire(`Spawn failed: ${spawnError}`);
				reject(spawnError);
				return;
			}

			if (!this._process || !this._process.pid) {
				const error = 'Failed to spawn claude process - no PID';
				debugLog('ERROR:', error);
				this._isRunning = false;
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
				this._process = undefined;

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
				this._process = undefined;
				this._onDidError.fire(error.message);
				reject(error);
			});

			debugLog(' All handlers registered, waiting for process events...');

			// stdin을 통해 프롬프트 전송 후 닫기
			if (this._process.stdin) {
				debugLog(' Writing prompt to stdin...');
				this._process.stdin.write(prompt, 'utf8', (err) => {
					if (err) {
						debugLog('ERROR: stdin write failed:', err.message);
					} else {
						debugLog(' Prompt written to stdin, closing...');
					}
					this._process?.stdin?.end();
				});
			}
		});
	}

	cancelRequest(): void {
		if (this._process) {
			this._process.kill('SIGTERM');
			this._process = undefined;
			this._isRunning = false;
		}
	}

	isRunning(): boolean {
		return this._isRunning;
	}

	override dispose(): void {
		this.cancelRequest();
		super.dispose();
	}
}
