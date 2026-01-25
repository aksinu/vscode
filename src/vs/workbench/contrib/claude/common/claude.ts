/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../../base/common/event.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { IClaudeMessage, IClaudeSendRequestOptions, ClaudeServiceState, IClaudeSession } from './claudeTypes.js';

export const IClaudeService = createDecorator<IClaudeService>('claudeService');

/**
 * Claude 서비스 인터페이스
 */
export interface IClaudeService {
	readonly _serviceBrand: undefined;

	// ========== Events ==========

	/**
	 * 메시지 수신 이벤트
	 */
	readonly onDidReceiveMessage: Event<IClaudeMessage>;

	/**
	 * 상태 변경 이벤트
	 */
	readonly onDidChangeState: Event<ClaudeServiceState>;

	/**
	 * 세션 변경 이벤트
	 */
	readonly onDidChangeSession: Event<IClaudeSession | undefined>;

	// ========== State ==========

	/**
	 * 현재 서비스 상태
	 */
	getState(): ClaudeServiceState;

	/**
	 * 현재 세션
	 */
	getCurrentSession(): IClaudeSession | undefined;

	// ========== Chat ==========

	/**
	 * 메시지 전송
	 */
	sendMessage(content: string, options?: IClaudeSendRequestOptions): Promise<IClaudeMessage>;

	/**
	 * 현재 요청 취소
	 */
	cancelRequest(): void;

	// ========== History ==========

	/**
	 * 현재 세션의 모든 메시지 가져오기
	 */
	getMessages(): IClaudeMessage[];

	/**
	 * 대화 기록 초기화
	 */
	clearHistory(): void;

	// ========== Session ==========

	/**
	 * 새 세션 시작
	 */
	startNewSession(): IClaudeSession;

	/**
	 * 세션 목록 가져오기
	 */
	getSessions(): IClaudeSession[];
}
