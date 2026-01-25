/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { spawn, ChildProcess } from 'child_process';
import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';

export const IClaudeCLIService = createDecorator<IClaudeCLIService>('claudeCLIService');

export interface IClaudeCLIResponse {
	type: 'text' | 'result' | 'error' | 'tool_use' | 'assistant';
	content?: string;
	message?: string;
}

export interface IClaudeCLIService {
	readonly _serviceBrand: undefined;

	readonly onDidReceiveData: Event<IClaudeCLIResponse>;
	readonly onDidComplete: Event<void>;
	readonly onDidError: Event<Error>;

	sendPrompt(prompt: string, workingDir?: string): Promise<void>;
	cancel(): void;
	isRunning(): boolean;
}

export class ClaudeCLIService extends Disposable implements IClaudeCLIService {
	declare readonly _serviceBrand: undefined;

	private _process: ChildProcess | undefined;
	private _isRunning = false;

	private readonly _onDidReceiveData = this._register(new Emitter<IClaudeCLIResponse>());
	readonly onDidReceiveData: Event<IClaudeCLIResponse> = this._onDidReceiveData.event;

	private readonly _onDidComplete = this._register(new Emitter<void>());
	readonly onDidComplete: Event<void> = this._onDidComplete.event;

	private readonly _onDidError = this._register(new Emitter<Error>());
	readonly onDidError: Event<Error> = this._onDidError.event;

	constructor() {
		super();
	}

	async sendPrompt(prompt: string, workingDir?: string): Promise<void> {
		if (this._isRunning) {
			throw new Error('A request is already in progress');
		}

		this._isRunning = true;

		return new Promise((resolve, reject) => {
			// Claude CLI 실행
			this._process = spawn('claude', [
				'-p',
				prompt,
				'--output-format', 'stream-json'
			], {
				cwd: workingDir,
				shell: true,
				env: { ...process.env }
			});

			let buffer = '';

			this._process.stdout?.on('data', (data: Buffer) => {
				buffer += data.toString();

				// 줄 단위로 JSON 파싱
				const lines = buffer.split('\n');
				buffer = lines.pop() || '';

				for (const line of lines) {
					if (!line.trim()) continue;

					try {
						const parsed = JSON.parse(line);
						this._onDidReceiveData.fire(parsed);
					} catch {
						// JSON 파싱 실패 - 일반 텍스트로 처리
						this._onDidReceiveData.fire({
							type: 'text',
							content: line
						});
					}
				}
			});

			this._process.stderr?.on('data', (data: Buffer) => {
				const error = data.toString();
				console.error('[Claude CLI Error]', error);
			});

			this._process.on('close', (code) => {
				this._isRunning = false;
				this._process = undefined;

				if (code === 0) {
					this._onDidComplete.fire();
					resolve();
				} else {
					const error = new Error(`Claude CLI exited with code ${code}`);
					this._onDidError.fire(error);
					reject(error);
				}
			});

			this._process.on('error', (error) => {
				this._isRunning = false;
				this._process = undefined;
				this._onDidError.fire(error);
				reject(error);
			});
		});
	}

	cancel(): void {
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
		this.cancel();
		super.dispose();
	}
}
