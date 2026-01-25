/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { spawn, ChildProcess } from 'child_process';
import { Emitter, Event } from '../../../base/common/event.js';
import { Disposable } from '../../../base/common/lifecycle.js';
import { IClaudeCLIService, IClaudeCLIStreamEvent, IClaudeCLIRequestOptions } from '../common/claudeCLI.js';

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
	}

	async sendPrompt(prompt: string, options?: IClaudeCLIRequestOptions): Promise<void> {
		if (this._isRunning) {
			throw new Error('A request is already in progress');
		}

		this._isRunning = true;

		console.log('[Claude CLI] Starting with prompt:', prompt.substring(0, 100));

		const args: string[] = [
			'-p', prompt,
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

		console.log('[Claude CLI] Spawning process with args:', args.slice(0, 5).join(' '));

		return new Promise((resolve, reject) => {
			this._process = spawn('claude', args, {
				cwd: options?.workingDir,
				shell: true,
				env: { ...process.env }
			});

			console.log('[Claude CLI] Process spawned, pid:', this._process.pid);

			let buffer = '';

			this._process.stdout?.on('data', (data: Buffer) => {
				const chunk = data.toString();
				console.log('[Claude CLI] stdout chunk:', chunk.substring(0, 200));
				buffer += chunk;

				// 줄 단위로 JSON 파싱
				const lines = buffer.split('\n');
				buffer = lines.pop() || '';

				for (const line of lines) {
					if (!line.trim()) continue;

					try {
						const parsed = JSON.parse(line) as IClaudeCLIStreamEvent;
						console.log('[Claude CLI] Parsed event type:', parsed.type);
						this._onDidReceiveData.fire(parsed);
					} catch {
						console.log('[Claude CLI] JSON parse failed, treating as text');
						// JSON 파싱 실패 시 텍스트로 처리
						this._onDidReceiveData.fire({
							type: 'text',
							content: line
						});
					}
				}
			});

			this._process.stderr?.on('data', (data: Buffer) => {
				const errorText = data.toString();
				console.error('[Claude CLI stderr]', errorText);
				// stderr는 항상 에러는 아님 (진행 상황 등)
			});

			this._process.on('close', (code) => {
				console.log('[Claude CLI] Process closed with code:', code);
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

			this._process.on('error', (error) => {
				console.error('[Claude CLI] Process error:', error.message);
				this._isRunning = false;
				this._process = undefined;
				this._onDidError.fire(error.message);
				reject(error);
			});
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
