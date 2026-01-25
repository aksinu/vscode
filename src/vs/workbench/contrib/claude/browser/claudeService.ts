/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IClaudeService } from '../common/claude.js';
import { IClaudeMessage, IClaudeSendRequestOptions, ClaudeServiceState, IClaudeSession } from '../common/claudeTypes.js';

export class ClaudeService extends Disposable implements IClaudeService {
	declare readonly _serviceBrand: undefined;

	private _state: ClaudeServiceState = 'idle';
	private _currentSession: IClaudeSession | undefined;
	private _sessions: IClaudeSession[] = [];
	private _abortController: AbortController | undefined;

	private readonly _onDidReceiveMessage = this._register(new Emitter<IClaudeMessage>());
	readonly onDidReceiveMessage: Event<IClaudeMessage> = this._onDidReceiveMessage.event;

	private readonly _onDidChangeState = this._register(new Emitter<ClaudeServiceState>());
	readonly onDidChangeState: Event<ClaudeServiceState> = this._onDidChangeState.event;

	private readonly _onDidChangeSession = this._register(new Emitter<IClaudeSession | undefined>());
	readonly onDidChangeSession: Event<IClaudeSession | undefined> = this._onDidChangeSession.event;

	constructor(
		@IConfigurationService private readonly configurationService: IConfigurationService
	) {
		super();

		// 초기 세션 생성
		this.startNewSession();
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

		// API 호출
		this.setState('sending');
		this._abortController = new AbortController();

		try {
			const assistantMessage = await this.callClaudeAPI(content, options);

			this._currentSession!.messages.push(assistantMessage);
			this._onDidReceiveMessage.fire(assistantMessage);

			this.setState('idle');
			return assistantMessage;
		} catch (error) {
			this.setState('error');

			const errorMessage: IClaudeMessage = {
				id: generateUuid(),
				role: 'assistant',
				content: error instanceof Error ? error.message : 'An error occurred',
				timestamp: Date.now(),
				isError: true
			};

			this._currentSession!.messages.push(errorMessage);
			this._onDidReceiveMessage.fire(errorMessage);

			throw error;
		}
	}

	private async callClaudeAPI(content: string, options?: IClaudeSendRequestOptions): Promise<IClaudeMessage> {
		const apiKey = this.configurationService.getValue<string>('claude.apiKey');
		const model = options?.model || this.configurationService.getValue<string>('claude.model') || 'claude-sonnet-4-20250514';
		const maxTokens = options?.maxTokens || this.configurationService.getValue<number>('claude.maxTokens') || 4096;

		if (!apiKey) {
			throw new Error('Claude API key is not configured. Please set "claude.apiKey" in settings.');
		}

		// 메시지 히스토리 구성
		const messages = this._currentSession!.messages
			.filter(m => !m.isError)
			.map(m => ({
				role: m.role,
				content: m.content
			}));

		// 컨텍스트가 있으면 시스템 프롬프트에 추가
		let systemPrompt = options?.systemPrompt || this.configurationService.getValue<string>('claude.systemPrompt');
		if (options?.context) {
			const contextParts: string[] = [];
			if (options.context.selection) {
				contextParts.push(`Selected code:\n\`\`\`${options.context.language || ''}\n${options.context.selection}\n\`\`\``);
			}
			if (options.context.filePath) {
				contextParts.push(`Current file: ${options.context.filePath.fsPath}`);
			}
			if (contextParts.length > 0) {
				systemPrompt = (systemPrompt || '') + '\n\nContext:\n' + contextParts.join('\n');
			}
		}

		const response = await fetch('https://api.anthropic.com/v1/messages', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'x-api-key': apiKey,
				'anthropic-version': '2023-06-01'
			},
			body: JSON.stringify({
				model,
				max_tokens: maxTokens,
				system: systemPrompt,
				messages
			}),
			signal: this._abortController?.signal
		});

		if (!response.ok) {
			const errorData = await response.json().catch(() => ({}));
			throw new Error(errorData.error?.message || `API request failed: ${response.status}`);
		}

		const data = await response.json();

		return {
			id: generateUuid(),
			role: 'assistant',
			content: data.content[0]?.text || '',
			timestamp: Date.now()
		};
	}

	cancelRequest(): void {
		if (this._abortController) {
			this._abortController.abort();
			this._abortController = undefined;
			this.setState('idle');
		}
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
