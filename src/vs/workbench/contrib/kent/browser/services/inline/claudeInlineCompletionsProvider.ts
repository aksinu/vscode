/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../../../base/common/cancellation.js';
import { Disposable } from '../../../../../../base/common/lifecycle.js';
import { Position } from '../../../../../../editor/common/core/position.js';
import { ITextModel } from '../../../../../../editor/common/model.js';
import {
	InlineCompletions,
	InlineCompletionsProvider,
	InlineCompletionContext,
	InlineCompletionTriggerKind,
	InlineCompletionsDisposeReason
} from '../../../../../../editor/common/languages.js';
import type { ILanguageFeaturesService } from '../../../../../../editor/common/services/languageFeatures.js';
import type { IConfigurationService } from '../../../../../../platform/configuration/common/configuration.js';
import type { IClaudeLogService } from '../../../common/claudeLogService.js';
import type { IClaudeService } from '../../../common/services/core/claude.js';

interface ClaudeInlineCompletionList extends InlineCompletions {
	readonly items: readonly {
		readonly insertText: string;
	}[];
}

/**
 * Claude 인라인 코드 제안 프로바이더
 *
 * 에디터에서 타이핑 시 Claude CLI를 통해 코드 완성을 제안합니다.
 * Ghost text (회색 텍스트)로 표시되며, Tab으로 수락합니다.
 */
export class ClaudeInlineCompletionsProvider extends Disposable implements InlineCompletionsProvider<ClaudeInlineCompletionList> {

	private static readonly LOG_CATEGORY = 'InlineCompletions';

	// 프로바이더 메타데이터
	readonly displayName = 'Claude';
	readonly groupId = 'claude-inline';
	readonly debounceDelayMs = 500;

	// 중복 요청 방지
	private _lastRequestKey: string = '';
	private _lastResult: ClaudeInlineCompletionList | null = null;
	private _pendingRequest: Promise<ClaudeInlineCompletionList | null> | null = null;

	constructor(
		private readonly _claudeService: IClaudeService,
		private readonly _configurationService: IConfigurationService,
		private readonly _logService: IClaudeLogService,
		private readonly _languageFeaturesService: ILanguageFeaturesService
	) {
		super();

		// 프로바이더 등록
		this._register(
			this._languageFeaturesService.inlineCompletionsProvider.register(
				{ pattern: '**' },  // 모든 파일
				this
			)
		);

		this._logService.info(ClaudeInlineCompletionsProvider.LOG_CATEGORY, 'Claude inline completions provider registered');
	}

	async provideInlineCompletions(
		model: ITextModel,
		position: Position,
		context: InlineCompletionContext,
		token: CancellationToken
	): Promise<ClaudeInlineCompletionList | null> {

		// 비활성화 체크
		const enabled = this._configurationService.getValue<boolean>('claude.inlineCompletions.enabled');
		if (!enabled) {
			return null;
		}

		// completeCode 미지원 시 무시
		if (!this._claudeService.completeCode) {
			return null;
		}

		// 자동 트리거 시 필터링
		if (context.triggerKind === InlineCompletionTriggerKind.Automatic) {
			const lineContent = model.getLineContent(position.lineNumber).trim();
			if (lineContent === '' || lineContent.startsWith('//') || lineContent.startsWith('/*') || lineContent.startsWith('*')) {
				return null;
			}
		}

		// 커서 전후 코드 추출
		const prefix = this._getPrefix(model, position);
		const suffix = this._getSuffix(model, position);

		if (prefix.trim().length < 3) {
			return null;
		}

		// 캐시 키
		const requestKey = `${model.uri.toString()}:${position.lineNumber}:${position.column}:${prefix.slice(-50)}`;
		if (requestKey === this._lastRequestKey && this._lastResult) {
			return this._lastResult;
		}

		if (this._pendingRequest) {
			return this._pendingRequest;
		}

		this._lastRequestKey = requestKey;

		const fileName = model.uri.path.split('/').pop() || 'file';
		const languageId = model.getLanguageId();
		const prompt = this._buildPrompt(prefix, suffix, fileName, languageId);
		const inlineModel = this._configurationService.getValue<string>('claude.inlineCompletions.model') || undefined;

		this._logService.debug(ClaudeInlineCompletionsProvider.LOG_CATEGORY, `Requesting completion for ${fileName}:${position.lineNumber}`);

		this._pendingRequest = this._requestCompletion(prompt, inlineModel, token);

		try {
			const result = await this._pendingRequest;
			this._lastResult = result;
			return result;
		} finally {
			this._pendingRequest = null;
		}
	}

	private async _requestCompletion(
		prompt: string,
		model: string | undefined,
		token: CancellationToken
	): Promise<ClaudeInlineCompletionList | null> {

		if (token.isCancellationRequested) {
			return null;
		}

		try {
			const response = await this._claudeService.completeCode!(prompt, model);

			if (token.isCancellationRequested || !response) {
				return null;
			}

			const code = this._extractCode(response);
			if (!code) {
				return null;
			}

			return {
				items: [{ insertText: code }]
			};

		} catch (error) {
			this._logService.warn(ClaudeInlineCompletionsProvider.LOG_CATEGORY, 'Completion request failed:', String(error));
			return null;
		}
	}

	disposeInlineCompletions(_completions: ClaudeInlineCompletionList, _reason: InlineCompletionsDisposeReason): void {
		// no-op
	}

	private _getPrefix(model: ITextModel, position: Position): string {
		const startLine = Math.max(1, position.lineNumber - 50);
		const lines: string[] = [];

		for (let i = startLine; i < position.lineNumber; i++) {
			lines.push(model.getLineContent(i));
		}
		lines.push(model.getLineContent(position.lineNumber).substring(0, position.column - 1));

		return lines.join('\n');
	}

	private _getSuffix(model: ITextModel, position: Position): string {
		const endLine = Math.min(model.getLineCount(), position.lineNumber + 20);
		const lines: string[] = [];

		const currentLine = model.getLineContent(position.lineNumber);
		lines.push(currentLine.substring(position.column - 1));

		for (let i = position.lineNumber + 1; i <= endLine; i++) {
			lines.push(model.getLineContent(i));
		}

		return lines.join('\n');
	}

	private _buildPrompt(prefix: string, suffix: string, fileName: string, languageId: string): string {
		return `You are an inline code completion engine. Complete the code at the cursor position marked with <CURSOR>.

File: ${fileName} (${languageId})

Rules:
- Output ONLY the code that should be inserted at the cursor position
- Do NOT include any explanation, markdown formatting, or code fences
- Do NOT repeat code that already exists before or after the cursor
- Keep completions concise (1-3 lines preferred)
- Match the existing code style and indentation

Code before cursor:
${prefix}<CURSOR>${suffix ? `

Code after cursor:
${suffix}` : ''}

Complete the code at <CURSOR>:`;
	}

	private _extractCode(response: string): string | null {
		let code = response.trim();

		// 코드 펜스 제거
		const fenceMatch = code.match(/^```(?:\w+)?\n([\s\S]*?)\n```$/);
		if (fenceMatch) {
			code = fenceMatch[1];
		}

		if (!code || code.length === 0) {
			return null;
		}

		// 최대 10줄
		const lines = code.split('\n');
		if (lines.length > 10) {
			code = lines.slice(0, 10).join('\n');
		}

		return code;
	}
}
