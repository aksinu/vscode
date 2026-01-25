/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../base/common/event.js';
import { IChannel, IServerChannel } from '../../../base/parts/ipc/common/ipc.js';
import { IClaudeCLIService, IClaudeCLIStreamEvent, IClaudeCLIRequestOptions } from './claudeCLI.js';

/**
 * Claude CLI IPC 채널 이름
 */
export const CLAUDE_CLI_CHANNEL_NAME = 'claudeCLI';

/**
 * Main Process 측 채널 (서버)
 */
export class ClaudeCLIChannel implements IServerChannel<string> {

	constructor(private readonly service: IClaudeCLIService) {
		console.log('[ClaudeCLIChannel] Server channel created');
	}

	listen<T>(_ctx: string, event: string): Event<T> {
		console.log('[ClaudeCLIChannel] listen called for event:', event);
		switch (event) {
			case 'onDidReceiveData': return this.service.onDidReceiveData as Event<T>;
			case 'onDidComplete': return this.service.onDidComplete as Event<T>;
			case 'onDidError': return this.service.onDidError as Event<T>;
		}
		throw new Error(`Event not found: ${event}`);
	}

	call<T>(_ctx: string, command: string, args?: unknown[]): Promise<T> {
		console.log('[ClaudeCLIChannel] call received:', command);
		switch (command) {
			case 'sendPrompt': {
				const [prompt, options] = args as [string, IClaudeCLIRequestOptions | undefined];
				console.log('[ClaudeCLIChannel] Forwarding sendPrompt to service');
				return this.service.sendPrompt(prompt, options) as Promise<T>;
			}
			case 'cancelRequest':
				this.service.cancelRequest();
				return Promise.resolve() as Promise<T>;
			case 'isRunning':
				return Promise.resolve(this.service.isRunning()) as Promise<T>;
		}
		throw new Error(`Call not found: ${command}`);
	}
}

/**
 * Renderer Process 측 클라이언트
 */
export class ClaudeCLIChannelClient implements IClaudeCLIService {
	declare readonly _serviceBrand: undefined;

	readonly onDidReceiveData: Event<IClaudeCLIStreamEvent>;
	readonly onDidComplete: Event<void>;
	readonly onDidError: Event<string>;

	constructor(private readonly channel: IChannel) {
		console.log('[ClaudeCLIChannelClient] Initializing channel client');
		this.onDidReceiveData = this.channel.listen<IClaudeCLIStreamEvent>('onDidReceiveData');
		this.onDidComplete = this.channel.listen<void>('onDidComplete');
		this.onDidError = this.channel.listen<string>('onDidError');
	}

	sendPrompt(prompt: string, options?: IClaudeCLIRequestOptions): Promise<void> {
		console.log('[ClaudeCLIChannelClient] Calling sendPrompt via channel');
		return this.channel.call('sendPrompt', [prompt, options]).then(
			() => console.log('[ClaudeCLIChannelClient] sendPrompt resolved'),
			(err) => {
				console.error('[ClaudeCLIChannelClient] sendPrompt rejected:', err);
				throw err;
			}
		);
	}

	cancelRequest(): void {
		this.channel.call('cancelRequest');
	}

	isRunning(): boolean {
		// 동기 호출이 필요하므로 캐시된 값 반환 또는 false
		return false;
	}
}
