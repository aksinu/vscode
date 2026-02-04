/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, append } from '../../../../../../../base/browser/dom.js';
import { DisposableStore } from '../../../../../../../base/common/lifecycle.js';
import { localize } from '../../../../../../../nls.js';
import { IClaudeMessage } from '../../../../common/types/claudeTypes.js';
import { ClaudeMessageRenderer } from '../claudeMessageRenderer.js';

/**
 * 메시지 리스트 DOM 관리 매니저
 * 책임: 메시지 추가/업데이트/삭제, 스크롤, 세션 구분선
 */
export class MessageListManager {

	private readonly messageDisposables = new Map<string, DisposableStore>();

	constructor(
		private readonly messagesContainer: HTMLElement,
		private readonly loadingElement: HTMLElement,
		private readonly messageRenderer: ClaudeMessageRenderer,
		private readonly isMessageReadOnly?: (messageId: string) => boolean
	) {}

	/**
	 * 메시지 추가
	 */
	appendMessage(message: IClaudeMessage): void {
		// 이미 DOM에 있으면 중복 추가 방지
		const existing = this.messagesContainer.querySelector(`[data-message-id="${message.id}"]`);
		if (existing) {
			return;
		}

		const messageContainer = $('.claude-message-wrapper');
		messageContainer.dataset.messageId = message.id;
		messageContainer.dataset.timestamp = String(message.timestamp);

		// 스트리밍 상태에 따라 클래스 토글
		if (message.isStreaming) {
			messageContainer.classList.add('streaming');
		}

		// 읽기 전용 상태 확인
		const readOnly = this.isMessageReadOnly?.(message.id) ?? false;
		const disposables = this.messageRenderer.renderMessage(message, messageContainer, { readOnly });
		this.messageDisposables.set(message.id, disposables);

		// 타임스탬프 기준으로 올바른 위치에 삽입 (취소 후 순서 꼬임 방지)
		let insertBefore: Element | null = this.loadingElement;
		const existingMessages = this.messagesContainer.querySelectorAll('.claude-message-wrapper');

		for (const existingMsg of existingMessages) {
			const existingTimestamp = parseInt((existingMsg as HTMLElement).dataset.timestamp || '0', 10);
			if (message.timestamp < existingTimestamp) {
				insertBefore = existingMsg;
				break;
			}
		}

		this.messagesContainer.insertBefore(messageContainer, insertBefore);
		this.scrollToBottom();
	}

	/**
	 * 세션 구분선 추가
	 */
	appendSessionDivider(): void {
		const divider = $('.claude-session-divider');

		append(divider, $('.claude-session-divider-line'));
		const text = append(divider, $('.claude-session-divider-text'));
		text.textContent = localize('previousSession', "Previous Session");
		append(divider, $('.claude-session-divider-line'));

		// 로딩 인디케이터 앞에 삽입
		this.messagesContainer.insertBefore(divider, this.loadingElement);
	}

	/**
	 * 메시지 업데이트
	 */
	updateMessage(message: IClaudeMessage): void {
		// 기존 메시지 컨테이너 찾기
		const existingContainer = this.messagesContainer.querySelector(`[data-message-id="${message.id}"]`) as HTMLElement;
		if (!existingContainer) {
			// 기존 컨테이너가 없으면 새로 추가 (타이밍 이슈 대응)
			this.appendMessage(message);
			return;
		}

		// 스트리밍 상태에 따라 클래스 토글 (애니메이션 제어)
		existingContainer.classList.toggle('streaming', !!message.isStreaming);

		// 기존 disposables 정리
		const oldDisposables = this.messageDisposables.get(message.id);
		if (oldDisposables) {
			oldDisposables.dispose();
		}

		// 컨테이너 내용 초기화
		while (existingContainer.firstChild) {
			existingContainer.removeChild(existingContainer.firstChild);
		}

		// 읽기 전용 상태 확인
		const readOnly = this.isMessageReadOnly?.(message.id) ?? false;

		// 새로운 내용 렌더링
		const disposables = this.messageRenderer.renderMessage(message, existingContainer, { readOnly });
		this.messageDisposables.set(message.id, disposables);

		// 스트리밍 중이거나 파일 변경사항이 있으면 스크롤
		if (message.isStreaming || message.fileChanges) {
			this.scrollToBottom();
		}
	}

	/**
	 * 모든 메시지 삭제
	 */
	clearMessages(): void {
		// 기존 메시지 dispose
		for (const disposables of this.messageDisposables.values()) {
			disposables.dispose();
		}
		this.messageDisposables.clear();

		// DOM 초기화 (로딩 인디케이터 유지)
		const children = Array.from(this.messagesContainer.children);
		for (const child of children) {
			if (child !== this.loadingElement) {
				child.remove();
			}
		}
	}

	/**
	 * 맨 아래로 스크롤
	 */
	scrollToBottom(): void {
		requestAnimationFrame(() => {
			this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;
		});
	}

	/**
	 * 리소스 정리
	 */
	dispose(): void {
		this.clearMessages();
	}
}
