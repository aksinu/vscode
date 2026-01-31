/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../../base/common/event.js';
import { IChannel, IServerChannel } from '../../../../base/parts/ipc/common/ipc.js';
import { IClaudeCLIService, IClaudeCLIStreamEvent, IClaudeCLIRequestOptions, IClaudeCLIMultiService, IClaudeCLIMultiEvent } from './claudeCLI.js';

/**
 * Claude CLI IPC 채널 이름
 */
export const CLAUDE_CLI_CHANNEL_NAME = 'claudeCLI';

/**
 * Claude CLI Multi-Instance IPC 채널 이름
 */
export const CLAUDE_CLI_MULTI_CHANNEL_NAME = 'claudeCLIMulti';

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
			case 'sendUserInput': {
				const [input] = args as [string];
				console.log('[ClaudeCLIChannel] Forwarding sendUserInput to service');
				this.service.sendUserInput(input);
				return Promise.resolve() as Promise<T>;
			}
			case 'cancelRequest':
				this.service.cancelRequest();
				return Promise.resolve() as Promise<T>;
			case 'isRunning':
				return Promise.resolve(this.service.isRunning()) as Promise<T>;
			case 'checkConnection':
				return this.service.checkConnection() as Promise<T>;
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

	sendUserInput(input: string): void {
		console.log('[ClaudeCLIChannelClient] Sending user input via channel');
		this.channel.call('sendUserInput', [input]);
	}

	checkConnection(): Promise<{ success: boolean; version?: string; error?: string }> {
		console.log('[ClaudeCLIChannelClient] Checking connection via channel');
		return this.channel.call('checkConnection');
	}
}

// ========== Multi-Instance Channel ==========

/**
 * Multi-Instance Main Process 측 채널 (서버)
 */
export class ClaudeCLIMultiChannel implements IServerChannel<string> {

	constructor(private readonly service: IClaudeCLIMultiService) {
		console.log('[ClaudeCLIMultiChannel] Server channel created');
	}

	listen<T>(_ctx: string, event: string, arg?: unknown): Event<T> {
		console.log('[ClaudeCLIMultiChannel] listen called for event:', event, 'arg:', arg);

		// arg가 chatId인 경우 필터링 적용
		const chatId = arg as string | undefined;

		switch (event) {
			case 'onDidReceiveData':
				if (chatId) {
					// chatId로 필터링
					return Event.filter(
						this.service.onDidReceiveData,
						e => e.chatId === chatId
					) as unknown as Event<T>;
				}
				return this.service.onDidReceiveData as Event<T>;

			case 'onDidComplete':
				if (chatId) {
					return Event.filter(
						this.service.onDidComplete,
						e => e.chatId === chatId
					) as unknown as Event<T>;
				}
				return this.service.onDidComplete as Event<T>;

			case 'onDidError':
				if (chatId) {
					return Event.filter(
						this.service.onDidError,
						e => e.chatId === chatId
					) as unknown as Event<T>;
				}
				return this.service.onDidError as Event<T>;
		}
		throw new Error(`Event not found: ${event}`);
	}

	call<T>(_ctx: string, command: string, args?: unknown[]): Promise<T> {
		console.log('[ClaudeCLIMultiChannel] call received:', command, 'args:', args?.[0]);

		switch (command) {
			case 'sendPrompt': {
				const [chatId, prompt, options] = args as [string, string, IClaudeCLIRequestOptions | undefined];
				console.log('[ClaudeCLIMultiChannel] Forwarding sendPrompt for chatId:', chatId);
				return this.service.sendPrompt(chatId, prompt, options) as Promise<T>;
			}
			case 'sendUserInput': {
				const [chatId, input] = args as [string, string];
				console.log('[ClaudeCLIMultiChannel] Forwarding sendUserInput for chatId:', chatId);
				this.service.sendUserInput(chatId, input);
				return Promise.resolve() as Promise<T>;
			}
			case 'cancelRequest': {
				const [chatId] = args as [string];
				this.service.cancelRequest(chatId);
				return Promise.resolve() as Promise<T>;
			}
			case 'isRunning': {
				const [chatId] = args as [string];
				return Promise.resolve(this.service.isRunning(chatId)) as Promise<T>;
			}
			case 'checkConnection':
				return this.service.checkConnection() as Promise<T>;
			case 'destroyInstance': {
				const [chatId] = args as [string];
				this.service.destroyInstance(chatId);
				return Promise.resolve() as Promise<T>;
			}
			case 'destroyAllInstances':
				this.service.destroyAllInstances();
				return Promise.resolve() as Promise<T>;
		}
		throw new Error(`Call not found: ${command}`);
	}
}

/**
 * Multi-Instance Renderer Process 측 클라이언트
 */
export class ClaudeCLIMultiChannelClient implements IClaudeCLIMultiService {
	declare readonly _serviceBrand: undefined;

	readonly onDidReceiveData: Event<IClaudeCLIMultiEvent<IClaudeCLIStreamEvent>>;
	readonly onDidComplete: Event<{ chatId: string }>;
	readonly onDidError: Event<{ chatId: string; error: string }>;

	constructor(private readonly channel: IChannel) {
		console.log('[ClaudeCLIMultiChannelClient] Initializing multi-channel client');
		// 전역 이벤트 (모든 chatId)
		this.onDidReceiveData = this.channel.listen<IClaudeCLIMultiEvent<IClaudeCLIStreamEvent>>('onDidReceiveData');
		this.onDidComplete = this.channel.listen<{ chatId: string }>('onDidComplete');
		this.onDidError = this.channel.listen<{ chatId: string; error: string }>('onDidError');
	}

	/**
	 * 특정 chatId의 데이터 이벤트만 수신
	 */
	onDidReceiveDataForChat(chatId: string): Event<IClaudeCLIMultiEvent<IClaudeCLIStreamEvent>> {
		return this.channel.listen<IClaudeCLIMultiEvent<IClaudeCLIStreamEvent>>('onDidReceiveData', chatId);
	}

	/**
	 * 특정 chatId의 완료 이벤트만 수신
	 */
	onDidCompleteForChat(chatId: string): Event<{ chatId: string }> {
		return this.channel.listen<{ chatId: string }>('onDidComplete', chatId);
	}

	/**
	 * 특정 chatId의 에러 이벤트만 수신
	 */
	onDidErrorForChat(chatId: string): Event<{ chatId: string; error: string }> {
		return this.channel.listen<{ chatId: string; error: string }>('onDidError', chatId);
	}

	sendPrompt(chatId: string, prompt: string, options?: IClaudeCLIRequestOptions): Promise<void> {
		console.log('[ClaudeCLIMultiChannelClient] Calling sendPrompt for chatId:', chatId);
		return this.channel.call('sendPrompt', [chatId, prompt, options]).then(
			() => console.log('[ClaudeCLIMultiChannelClient] sendPrompt resolved for:', chatId),
			(err) => {
				console.error('[ClaudeCLIMultiChannelClient] sendPrompt rejected for:', chatId, err);
				throw err;
			}
		);
	}

	cancelRequest(chatId: string): void {
		this.channel.call('cancelRequest', [chatId]);
	}

	isRunning(chatId: string): boolean {
		// 동기 호출이 필요하므로 캐시된 값 반환 또는 false
		return false;
	}

	/**
	 * 비동기로 실행 중인지 확인
	 */
	isRunningAsync(chatId: string): Promise<boolean> {
		return this.channel.call('isRunning', [chatId]);
	}

	sendUserInput(chatId: string, input: string): void {
		console.log('[ClaudeCLIMultiChannelClient] Sending user input for chatId:', chatId);
		this.channel.call('sendUserInput', [chatId, input]);
	}

	checkConnection(): Promise<{ success: boolean; version?: string; error?: string }> {
		console.log('[ClaudeCLIMultiChannelClient] Checking connection via channel');
		return this.channel.call('checkConnection');
	}

	destroyInstance(chatId: string): void {
		this.channel.call('destroyInstance', [chatId]);
	}

	destroyAllInstances(): void {
		this.channel.call('destroyAllInstances');
	}
}
