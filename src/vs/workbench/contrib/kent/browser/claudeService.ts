/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { IChannel } from '../../../../base/parts/ipc/common/ipc.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IClaudeService } from '../common/claude.js';
import { IClaudeMessage, IClaudeSendRequestOptions, ClaudeServiceState, IClaudeSession } from '../common/claudeTypes.js';
import { IMainProcessService } from '../../../../platform/ipc/common/mainProcessService.js';
import { IClaudeCLIStreamEvent, IClaudeCLIRequestOptions } from '../common/claudeCLI.js';
import { CLAUDE_CLI_CHANNEL_NAME } from '../common/claudeCLIChannel.js';

export class ClaudeService extends Disposable implements IClaudeService {
	declare readonly _serviceBrand: undefined;

	private _state: ClaudeServiceState = 'idle';
	private _currentSession: IClaudeSession | undefined;
	private _sessions: IClaudeSession[] = [];
	private _currentMessageId: string | undefined;
	private _accumulatedContent: string = '';

	private readonly channel: IChannel;

	private readonly _onDidReceiveMessage = this._register(new Emitter<IClaudeMessage>());
	readonly onDidReceiveMessage: Event<IClaudeMessage> = this._onDidReceiveMessage.event;

	private readonly _onDidUpdateMessage = this._register(new Emitter<IClaudeMessage>());
	readonly onDidUpdateMessage: Event<IClaudeMessage> = this._onDidUpdateMessage.event;

	private readonly _onDidChangeState = this._register(new Emitter<ClaudeServiceState>());
	readonly onDidChangeState: Event<ClaudeServiceState> = this._onDidChangeState.event;

	private readonly _onDidChangeSession = this._register(new Emitter<IClaudeSession | undefined>());
	readonly onDidChangeSession: Event<IClaudeSession | undefined> = this._onDidChangeSession.event;

	constructor(
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IMainProcessService mainProcessService: IMainProcessService
	) {
		super();

		// Main Process의 Claude CLI 채널에 연결
		this.channel = mainProcessService.getChannel(CLAUDE_CLI_CHANNEL_NAME);
		console.log('[ClaudeService] Channel obtained:', CLAUDE_CLI_CHANNEL_NAME);

		// CLI 이벤트 구독
		this._register(this.channel.listen<IClaudeCLIStreamEvent>('onDidReceiveData')(event => {
			console.log('[ClaudeService] Received CLI data:', event.type, event);
			this.handleCLIData(event);
		}));
		this._register(this.channel.listen<void>('onDidComplete')(() => {
			console.log('[ClaudeService] CLI complete');
			this.handleCLIComplete();
		}));
		this._register(this.channel.listen<string>('onDidError')(error => {
			console.log('[ClaudeService] CLI error:', error);
			this.handleCLIError(error);
		}));

		// 초기 세션 생성
		this.startNewSession();
	}

	// ========== CLI Event Handlers ==========

	private handleCLIData(event: IClaudeCLIStreamEvent): void {
		if (!this._currentMessageId || !this._currentSession) {
			return;
		}

		// 텍스트 컨텐츠 추출
		let text = '';

		if (event.type === 'assistant' && event.message) {
			// CLI의 assistant 타입: message.content 배열에서 텍스트 추출
			if (typeof event.message === 'object' && event.message.content) {
				for (const block of event.message.content) {
					if (block.type === 'text' && block.text) {
						text += block.text;
					}
				}
			} else if (typeof event.message === 'string') {
				text = event.message;
			}
		} else if (event.type === 'result' && event.result) {
			// result 타입: 최종 결과
			text = event.result;
		} else if (event.type === 'content_block_delta' && event.delta?.text) {
			text = event.delta.text;
		} else if (event.type === 'text' && event.content) {
			text = event.content;
		}

		if (text) {
			// 텍스트 누적 (CLI는 여러 text 이벤트로 응답을 스트리밍)
			if (this._accumulatedContent) {
				this._accumulatedContent += '\n' + text;
			} else {
				this._accumulatedContent = text;
			}

			// 메시지 업데이트
			const updatedMessage: IClaudeMessage = {
				id: this._currentMessageId,
				role: 'assistant',
				content: this._accumulatedContent,
				timestamp: Date.now(),
				isStreaming: true
			};

			// 세션의 메시지 업데이트
			const msgIndex = this._currentSession.messages.findIndex(m => m.id === this._currentMessageId);
			if (msgIndex !== -1) {
				(this._currentSession.messages as IClaudeMessage[])[msgIndex] = updatedMessage;
			}

			this._onDidUpdateMessage.fire(updatedMessage);
		}
	}

	private handleCLIComplete(): void {
		if (!this._currentMessageId || !this._currentSession) {
			return;
		}

		// 최종 메시지
		const finalMessage: IClaudeMessage = {
			id: this._currentMessageId,
			role: 'assistant',
			content: this._accumulatedContent,
			timestamp: Date.now(),
			isStreaming: false
		};

		// 세션의 메시지 업데이트
		const msgIndex = this._currentSession.messages.findIndex(m => m.id === this._currentMessageId);
		if (msgIndex !== -1) {
			(this._currentSession.messages as IClaudeMessage[])[msgIndex] = finalMessage;
		}

		this._onDidUpdateMessage.fire(finalMessage);
		this.setState('idle');

		this._currentMessageId = undefined;
		this._accumulatedContent = '';
	}

	private handleCLIError(error: string): void {
		if (!this._currentSession) {
			return;
		}

		const errorMessage: IClaudeMessage = {
			id: this._currentMessageId || generateUuid(),
			role: 'assistant',
			content: `Error: ${error}`,
			timestamp: Date.now(),
			isError: true
		};

		// 기존 스트리밍 메시지가 있으면 업데이트, 없으면 추가
		if (this._currentMessageId) {
			const msgIndex = this._currentSession.messages.findIndex(m => m.id === this._currentMessageId);
			if (msgIndex !== -1) {
				(this._currentSession.messages as IClaudeMessage[])[msgIndex] = errorMessage;
				this._onDidUpdateMessage.fire(errorMessage);
			}
		} else {
			this._currentSession.messages.push(errorMessage);
			this._onDidReceiveMessage.fire(errorMessage);
		}

		this.setState('error');
		this._currentMessageId = undefined;
		this._accumulatedContent = '';
	}

	// ========== State ==========

	getState(): ClaudeServiceState {
		return this._state;
	}

	private setState(state: ClaudeServiceState): void {
		if (this._state !== state) {
			this._state = state;
			this._onDidChangeState.fire(state);
		}
	}

	getCurrentSession(): IClaudeSession | undefined {
		return this._currentSession;
	}

	// ========== Chat ==========

	async sendMessage(content: string, options?: IClaudeSendRequestOptions): Promise<IClaudeMessage> {
		if (!this._currentSession) {
			this.startNewSession();
		}

		// 사용자 메시지 추가
		const userMessage: IClaudeMessage = {
			id: generateUuid(),
			role: 'user',
			content,
			timestamp: Date.now(),
			context: options?.context
		};

		this._currentSession!.messages.push(userMessage);
		this._onDidReceiveMessage.fire(userMessage);

		// 프롬프트 구성
		let prompt = content;

		// 컨텍스트 추가
		if (options?.context) {
			const contextParts: string[] = [];
			if (options.context.selection) {
				contextParts.push(`Selected code:\n\`\`\`${options.context.language || ''}\n${options.context.selection}\n\`\`\``);
			}
			if (options.context.filePath) {
				contextParts.push(`Current file: ${options.context.filePath.fsPath}`);
			}
			if (options.context.attachments && options.context.attachments.length > 0) {
				for (const attachment of options.context.attachments) {
					if (attachment.content) {
						contextParts.push(`File: ${attachment.name}\n\`\`\`\n${attachment.content}\n\`\`\``);
					} else {
						contextParts.push(`Attached: ${attachment.name} (${attachment.type})`);
					}
				}
			}
			if (contextParts.length > 0) {
				prompt = contextParts.join('\n\n') + '\n\n' + content;
			}
		}

		// 스트리밍 메시지 생성
		this._currentMessageId = generateUuid();
		this._accumulatedContent = '';

		const assistantMessage: IClaudeMessage = {
			id: this._currentMessageId,
			role: 'assistant',
			content: '',
			timestamp: Date.now(),
			isStreaming: true
		};

		this._currentSession!.messages.push(assistantMessage);
		this._onDidReceiveMessage.fire(assistantMessage);

		// CLI 호출
		this.setState('streaming');
		console.log('[ClaudeService] Sending prompt to CLI:', prompt.substring(0, 100));

		try {
			// 먼저 채널이 작동하는지 테스트
			console.log('[ClaudeService] Testing channel with isRunning...');
			const isRunning = await Promise.race([
				this.channel.call<boolean>('isRunning'),
				new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Channel timeout')), 5000))
			]);
			console.log('[ClaudeService] Channel test passed, isRunning:', isRunning);

			console.log('[ClaudeService] Calling channel.call sendPrompt...');

			const cliOptions: IClaudeCLIRequestOptions = {
				model: options?.model || this.configurationService.getValue<string>('claude.model'),
				systemPrompt: options?.systemPrompt || this.configurationService.getValue<string>('claude.systemPrompt')
			};

			// 30초 타임아웃 추가
			await Promise.race([
				this.channel.call('sendPrompt', [prompt, cliOptions]),
				new Promise<never>((_, reject) => setTimeout(() => reject(new Error('sendPrompt timeout after 30s - CLI may not be responding')), 30000))
			]);
			console.log('[ClaudeService] sendPrompt completed, accumulated content:', this._accumulatedContent.substring(0, 100));

			// 완료 후 최종 메시지 반환
			const finalMessage: IClaudeMessage = {
				id: this._currentMessageId,
				role: 'assistant',
				content: this._accumulatedContent,
				timestamp: Date.now(),
				isStreaming: false
			};

			return finalMessage;
		} catch (error) {
			console.error('[ClaudeService] sendPrompt error:', error);
			// 에러는 handleCLIError에서 처리됨
			throw error;
		}
	}

	cancelRequest(): void {
		this.channel.call('cancelRequest');
		this.setState('idle');
		this._currentMessageId = undefined;
		this._accumulatedContent = '';
	}

	// ========== History ==========

	getMessages(): IClaudeMessage[] {
		return this._currentSession?.messages ?? [];
	}

	clearHistory(): void {
		if (this._currentSession) {
			this._currentSession.messages.length = 0;
			this._onDidChangeSession.fire(this._currentSession);
		}
	}

	// ========== Session ==========

	startNewSession(): IClaudeSession {
		const session: IClaudeSession = {
			id: generateUuid(),
			createdAt: Date.now(),
			messages: []
		};

		this._sessions.push(session);
		this._currentSession = session;
		this._onDidChangeSession.fire(session);

		return session;
	}

	getSessions(): IClaudeSession[] {
		return [...this._sessions];
	}
}
