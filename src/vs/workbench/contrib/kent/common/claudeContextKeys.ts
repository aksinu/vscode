/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';
import { RawContextKey } from '../../../../platform/contextkey/common/contextkey.js';

/**
 * Claude 패널이 포커스되었는지
 */
export const CONTEXT_CLAUDE_PANEL_FOCUSED = new RawContextKey<boolean>(
	'claudePanelFocused',
	false,
	localize('claudePanelFocused', "Whether the Claude panel is focused")
);

/**
 * Claude 입력창이 포커스되었는지
 */
export const CONTEXT_CLAUDE_INPUT_FOCUSED = new RawContextKey<boolean>(
	'claudeInputFocused',
	false,
	localize('claudeInputFocused', "Whether the Claude input is focused")
);

/**
 * Claude 요청이 진행 중인지
 */
export const CONTEXT_CLAUDE_REQUEST_IN_PROGRESS = new RawContextKey<boolean>(
	'claudeRequestInProgress',
	false,
	localize('claudeRequestInProgress', "Whether a Claude request is in progress")
);

/**
 * Claude 응답이 스트리밍 중인지
 */
export const CONTEXT_CLAUDE_RESPONSE_STREAMING = new RawContextKey<boolean>(
	'claudeResponseStreaming',
	false,
	localize('claudeResponseStreaming', "Whether Claude is streaming a response")
);

/**
 * Claude API 키가 설정되었는지
 */
export const CONTEXT_CLAUDE_API_KEY_SET = new RawContextKey<boolean>(
	'claudeApiKeySet',
	false,
	localize('claudeApiKeySet', "Whether the Claude API key is configured")
);
