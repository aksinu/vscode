/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { IClaudeCLIService, IClaudeCLIStreamEvent, IClaudeCLIRequestOptions } from '../common/claudeCLI.js';
import { ClaudeCLIInstance } from './claudeCLIInstance.js';
import { debugLog, checkClaudeConnection } from './claudeCLIUtils.js';

/**
 * Legacy single-instance CLI 서비스
 * 내부적으로 ClaudeCLIInstance에 위임하여 중복 코드 제거
 */
export class ClaudeCLIService extends Disposable implements IClaudeCLIService {
	declare readonly _serviceBrand: undefined;

	private readonly _instance: ClaudeCLIInstance;

	readonly onDidReceiveData: Event<IClaudeCLIStreamEvent>;
	readonly onDidComplete: Event<void>;
	readonly onDidError: Event<string>;

	constructor() {
		super();
		this._instance = this._register(new ClaudeCLIInstance('__legacy__'));

		this.onDidReceiveData = this._instance.onDidReceiveData;
		this.onDidComplete = this._instance.onDidComplete;
		this.onDidError = this._instance.onDidError;

		debugLog('ClaudeCLIService initialized (delegating to ClaudeCLIInstance)');
	}

	async sendPrompt(prompt: string, options?: IClaudeCLIRequestOptions): Promise<void> {
		return this._instance.sendPrompt(prompt, options);
	}

	sendUserInput(input: string): void {
		this._instance.sendUserInput(input);
	}

	cancelRequest(): void {
		this._instance.cancelRequest();
	}

	isRunning(): boolean {
		return this._instance.isRunning();
	}

	async checkConnection(): Promise<{ success: boolean; version?: string; error?: string }> {
		return checkClaudeConnection('ClaudeCLIService');
	}

	override dispose(): void {
		super.dispose();
	}
}
