/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, append, clearNode } from '../../../../../../../base/browser/dom.js';
import { Codicon } from '../../../../../../../base/common/codicons.js';
import { DisposableStore } from '../../../../../../../base/common/lifecycle.js';
import { ThemeIcon } from '../../../../../../../base/common/themables.js';
import { localize } from '../../../../../../../nls.js';
import { IUserMessage, IClaudeAttachment } from '../../../../common/types/claudeTypes.js';

/**
 * 개발자 말풍선 렌더러
 * 구조: You | 전송시간 | 전송내용 | 첨부파일 리스트 | 시스템메시지
 */
export class UserMessageRenderer {

	/**
	 * 사용자 메시지 렌더링
	 */
	renderUserMessage(message: IUserMessage, container: HTMLElement): DisposableStore {
		const disposables = new DisposableStore();
		clearNode(container);

		const messageElement = append(container, $('.claude-user-message'));

		// 헤더: You | 전송시간
		this.renderHeader(message, messageElement);

		// 전송내용 (본문)
		this.renderContent(message, messageElement);

		// 첨부파일 리스트
		if (message.attachments && message.attachments.length > 0) {
			this.renderAttachments(message.attachments, messageElement);
		}

		// 시스템메시지 (취소, 오류 등)
		if (message.systemMessage) {
			this.renderSystemMessage(message.systemMessage, messageElement);
		}

		return disposables;
	}

	/**
	 * 헤더: You | 전송시간
	 */
	private renderHeader(message: IUserMessage, container: HTMLElement): void {
		const header = append(container, $('.claude-user-message-header'));

		// 사용자 아이콘
		const iconElement = append(header, $('.claude-user-icon'));
		iconElement.classList.add(...ThemeIcon.asClassNameArray(Codicon.account));

		// "You" 텍스트
		const roleElement = append(header, $('.claude-user-role'));
		roleElement.textContent = 'You';

		// 전송시간
		const timeElement = append(header, $('.claude-user-time'));
		timeElement.textContent = this.formatTime(message.timestamp);
	}

	/**
	 * 전송내용 (본문)
	 */
	private renderContent(message: IUserMessage, container: HTMLElement): void {
		const contentElement = append(container, $('.claude-user-content'));

		// 텍스트 내용 (간단한 처리, 개발자 입력이므로 Markdown 불필요)
		const textElement = append(contentElement, $('.claude-user-text'));
		textElement.textContent = message.content;
	}

	/**
	 * 첨부파일 리스트
	 */
	private renderAttachments(attachments: IClaudeAttachment[], container: HTMLElement): void {
		const attachmentsContainer = append(container, $('.claude-user-attachments'));

		// 헤더
		const attachmentsHeader = append(attachmentsContainer, $('.claude-user-attachments-header'));
		append(attachmentsHeader, $('.codicon.codicon-paperclip'));
		const attachmentsLabel = append(attachmentsHeader, $('span'));
		attachmentsLabel.textContent = localize('attachedFiles', "Attached files ({0})", attachments.length);

		// 첨부파일 목록
		const attachmentsList = append(attachmentsContainer, $('.claude-user-attachments-list'));

		for (const attachment of attachments) {
			const attachmentItem = append(attachmentsList, $('.claude-user-attachment-item'));

			// 타입별 아이콘
			const iconElement = append(attachmentItem, $('.claude-attachment-icon'));
			iconElement.classList.add('codicon', this.getAttachmentIcon(attachment.type));

			// 파일명
			const nameElement = append(attachmentItem, $('.claude-attachment-name'));
			nameElement.textContent = attachment.name;

			// 경로 툴팁
			if (attachment.uri) {
				attachmentItem.title = attachment.uri.fsPath;
			}
		}
	}

	/**
	 * 시스템메시지 (프로젝트 자체의 메시지)
	 */
	private renderSystemMessage(systemMessage: any, container: HTMLElement): void {
		const systemContainer = append(container, $('.claude-user-system-message'));

		// 시스템 메시지 아이콘
		const iconElement = append(systemContainer, $('.claude-system-icon'));
		iconElement.classList.add('codicon', this.getSystemMessageIcon(systemMessage.type));

		// 시스템 메시지 텍스트
		const messageElement = append(systemContainer, $('.claude-system-text'));
		messageElement.textContent = systemMessage.message;
	}

	/**
	 * 시간 포맷팅
	 */
	private formatTime(timestamp: number): string {
		const date = new Date(timestamp);
		return date.toLocaleTimeString(undefined, {
			hour: '2-digit',
			minute: '2-digit'
		});
	}

	/**
	 * 첨부파일 타입별 아이콘
	 */
	private getAttachmentIcon(type: IClaudeAttachment['type']): string {
		switch (type) {
			case 'file': return 'codicon-file';
			case 'folder': return 'codicon-folder';
			case 'selection': return 'codicon-selection';
			case 'diagnostics': return 'codicon-warning';
			case 'workspace': return 'codicon-folder-library';
			case 'image': return 'codicon-file-media';
			case 'code-reference': return 'codicon-code';
			default: return 'codicon-file';
		}
	}

	/**
	 * 시스템 메시지 타입별 아이콘
	 */
	private getSystemMessageIcon(type: string): string {
		switch (type) {
			case 'cancel': return 'codicon-close';
			case 'error': return 'codicon-error';
			case 'timeout': return 'codicon-clock';
			case 'queue-rejected': return 'codicon-circle-slash';
			case 'rate-limit': return 'codicon-watch';
			case 'connection-lost': return 'codicon-debug-disconnect';
			default: return 'codicon-info';
		}
	}
}