/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable, DisposableStore } from '../../../../base/common/lifecycle.js';
import { IClaudeCLIStreamEvent, IClaudeCLIRequestOptions, IClaudeCLIMultiService, IClaudeCLIMultiEvent } from '../common/claudeCLI.js';
import { ClaudeCLIInstance } from './claudeCLIInstance.js';

// 디버그용 파일 로그
const logFile = path.join(process.env.TEMP || '/tmp', 'claude-cli-debug.log');
function debugLog(...args: unknown[]) {
	const timestamp = new Date().toISOString();
	const msg = args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ');
	fs.appendFileSync(logFile, `[${timestamp}] ${msg}\n`);
}

/**
 * 다중 CLI 프로세스 관리자
 * 각 chatId에 대해 독립적인 ClaudeCLIInstance를 생성하고 관리
 */
export class ClaudeCLIProcessManager extends Disposable implements IClaudeCLIMultiService {
	private readonly _instances = new Map<string, ClaudeCLIInstance>();
	private readonly _instanceDisposables = new Map<string, DisposableStore>();

	declare readonly _serviceBrand: undefined;

	// 설정값
	private readonly _maxInstances: number;
	private readonly _idleTimeoutMs: number;
	private _idleCheckInterval: ReturnType<typeof setInterval> | undefined;

	// chatId 포함 이벤트
	private readonly _onDidReceiveData = this._register(new Emitter<IClaudeCLIMultiEvent<IClaudeCLIStreamEvent>>());
	readonly onDidReceiveData: Event<IClaudeCLIMultiEvent<IClaudeCLIStreamEvent>> = this._onDidReceiveData.event;

	private readonly _onDidComplete = this._register(new Emitter<{ chatId: string }>());
	readonly onDidComplete: Event<{ chatId: string }> = this._onDidComplete.event;

	private readonly _onDidError = this._register(new Emitter<{ chatId: string; error: string }>());
	readonly onDidError: Event<{ chatId: string; error: string }> = this._onDidError.event;

	constructor(maxInstances: number = 5, idleTimeoutMs: number = 5 * 60 * 1000) {
		super();
		this._maxInstances = maxInstances;
		this._idleTimeoutMs = idleTimeoutMs;

		debugLog(`[ProcessManager] Created with maxInstances=${maxInstances}, idleTimeoutMs=${idleTimeoutMs}`);

		// 주기적으로 유휴 인스턴스 정리 (1분마다)
		this._idleCheckInterval = setInterval(() => this.cleanupIdleInstances(), 60 * 1000);
	}

	/**
	 * chatId에 해당하는 인스턴스를 가져오거나 새로 생성
	 */
	private getOrCreateInstance(chatId: string): ClaudeCLIInstance {
		let instance = this._instances.get(chatId);

		if (!instance) {
			// 최대 인스턴스 수 체크
			if (this._instances.size >= this._maxInstances) {
				// 가장 오래된 유휴 인스턴스 제거
				this.removeOldestIdleInstance();

				// 여전히 최대치면 에러
				if (this._instances.size >= this._maxInstances) {
					throw new Error(`Maximum CLI instances (${this._maxInstances}) reached. Please close some chat sessions.`);
				}
			}

			debugLog(`[ProcessManager] Creating new instance for chatId: ${chatId}`);
			instance = new ClaudeCLIInstance(chatId);

			const disposables = new DisposableStore();

			// 인스턴스 이벤트를 chatId와 함께 전파
			disposables.add(instance.onDidReceiveData(event => {
				this._onDidReceiveData.fire({ chatId, data: event });
			}));

			disposables.add(instance.onDidComplete(() => {
				this._onDidComplete.fire({ chatId });
			}));

			disposables.add(instance.onDidError(error => {
				this._onDidError.fire({ chatId, error });
			}));

			this._instances.set(chatId, instance);
			this._instanceDisposables.set(chatId, disposables);
		}

		return instance;
	}

	/**
	 * 가장 오래된 유휴 인스턴스 제거
	 */
	private removeOldestIdleInstance(): void {
		let oldestChatId: string | undefined;
		let oldestTime = Infinity;

		for (const [chatId, instance] of this._instances) {
			if (!instance.isRunning() && instance.lastActivityTime < oldestTime) {
				oldestTime = instance.lastActivityTime;
				oldestChatId = chatId;
			}
		}

		if (oldestChatId) {
			debugLog(`[ProcessManager] Removing oldest idle instance: ${oldestChatId}`);
			this.destroyInstance(oldestChatId);
		}
	}

	/**
	 * 유휴 인스턴스 정리
	 */
	private cleanupIdleInstances(): void {
		const now = Date.now();

		for (const [chatId, instance] of this._instances) {
			if (!instance.isRunning() && (now - instance.lastActivityTime) > this._idleTimeoutMs) {
				debugLog(`[ProcessManager] Cleaning up idle instance: ${chatId}`);
				this.destroyInstance(chatId);
			}
		}
	}

	/**
	 * 프롬프트 전송
	 */
	async sendPrompt(chatId: string, prompt: string, options?: IClaudeCLIRequestOptions): Promise<void> {
		debugLog(`[ProcessManager] sendPrompt for chatId: ${chatId}`);
		const instance = this.getOrCreateInstance(chatId);
		return instance.sendPrompt(prompt, options);
	}

	/**
	 * 사용자 입력 전송
	 */
	sendUserInput(chatId: string, input: string): void {
		const instance = this._instances.get(chatId);
		if (instance) {
			instance.sendUserInput(input);
		} else {
			debugLog(`[ProcessManager] sendUserInput: No instance for chatId ${chatId}`);
		}
	}

	/**
	 * 요청 취소
	 */
	cancelRequest(chatId: string): void {
		const instance = this._instances.get(chatId);
		if (instance) {
			instance.cancelRequest();
		} else {
			debugLog(`[ProcessManager] cancelRequest: No instance for chatId ${chatId}`);
		}
	}

	/**
	 * 실행 중인지 확인
	 */
	isRunning(chatId: string): boolean {
		const instance = this._instances.get(chatId);
		return instance?.isRunning() ?? false;
	}

	/**
	 * CLI 연결 체크 (전역)
	 */
	async checkConnection(): Promise<{ success: boolean; version?: string; error?: string }> {
		debugLog('[ProcessManager] checkConnection');

		return new Promise((resolve) => {
			try {
				const cleanEnv = { ...process.env };
				delete cleanEnv.NODE_OPTIONS;
				delete cleanEnv.ELECTRON_RUN_AS_NODE;
				delete cleanEnv.VSCODE_INSPECTOR_OPTIONS;

				const proc = spawn('claude', ['--version'], {
					shell: true,
					env: cleanEnv,
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
					debugLog('[ProcessManager] checkConnection closed, code:', code);

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
					debugLog('[ProcessManager] checkConnection error:', error.message);
					resolve({
						success: false,
						error: error.message
					});
				});

			} catch (error) {
				debugLog('[ProcessManager] checkConnection exception:', error);
				resolve({
					success: false,
					error: String(error)
				});
			}
		});
	}

	/**
	 * 특정 인스턴스 제거
	 */
	destroyInstance(chatId: string): void {
		debugLog(`[ProcessManager] destroyInstance: ${chatId}`);

		const instance = this._instances.get(chatId);
		if (instance) {
			instance.dispose();
			this._instances.delete(chatId);
		}

		const disposables = this._instanceDisposables.get(chatId);
		if (disposables) {
			disposables.dispose();
			this._instanceDisposables.delete(chatId);
		}
	}

	/**
	 * 모든 인스턴스 제거
	 */
	destroyAllInstances(): void {
		debugLog('[ProcessManager] destroyAllInstances');

		for (const chatId of this._instances.keys()) {
			this.destroyInstance(chatId);
		}
	}

	/**
	 * 현재 인스턴스 수
	 */
	get instanceCount(): number {
		return this._instances.size;
	}

	/**
	 * 활성 (실행 중) 인스턴스 수
	 */
	get activeInstanceCount(): number {
		let count = 0;
		for (const instance of this._instances.values()) {
			if (instance.isRunning()) {
				count++;
			}
		}
		return count;
	}

	override dispose(): void {
		debugLog('[ProcessManager] Disposing');

		if (this._idleCheckInterval) {
			clearInterval(this._idleCheckInterval);
			this._idleCheckInterval = undefined;
		}

		this.destroyAllInstances();
		super.dispose();
	}
}
