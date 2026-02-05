/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, DisposableStore } from '../../../../../../base/common/lifecycle.js';
import { IClaudeMessage, IClaudeFileChange, ChatSessionState } from '../../../common/types/claudeTypes.js';
import { MessageRendererFactory, IMessageRendererOptions } from './renderers/messageRendererFactory.js';

export interface IClaudeMessageRendererOptions extends IMessageRendererOptions {
	/** 변경사항 수락 (스냅샷 정리) */
	readonly onAcceptFile?: (fileChange: IClaudeFileChange) => void;
	/** 모든 변경사항 수락 */
	readonly onAcceptAllFiles?: () => void;
	/** 선택된 파일들 Revert */
	readonly onRevertSelectedFiles?: (fileChanges: IClaudeFileChange[]) => Promise<number>;
	/** 선택된 파일들 Accept */
	readonly onAcceptSelectedFiles?: (fileChanges: IClaudeFileChange[]) => void;
}

/**
 * Claude 메시지 렌더러
 * 개발자/클로드 말풍선을 분리한 클린한 아키텍처
 */
export class ClaudeMessageRenderer extends Disposable {

	private readonly messageRendererFactory: MessageRendererFactory;
	private currentState: ChatSessionState = 'idle';

	constructor(
		private readonly options: IClaudeMessageRendererOptions
	) {
		super();
		this.messageRendererFactory = new MessageRendererFactory(this.options);
	}

	/**
	 * 현재 채팅 세션 상태 업데이트
	 */
	updateSessionState(state: ChatSessionState): void {
		this.currentState = state;
	}

	/**
	 * 메시지 렌더링 (새로운 구조 사용)
	 */
	renderMessage(message: IClaudeMessage, container: HTMLElement, options?: { readOnly?: boolean }): DisposableStore {
		return this.messageRendererFactory.renderMessage(message, container, this.currentState, options);
	}

	/**
	 * 기존 호환성을 위한 레거시 렌더링 메서드
	 */
	renderLegacyMessage(message: IClaudeMessage, container: HTMLElement, options?: { readOnly?: boolean }): DisposableStore {
		return this.messageRendererFactory.renderLegacyMessage(message, container, options);
	}
}