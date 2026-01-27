/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../../nls.js';
import { INotificationService } from '../../../../../platform/notification/common/notification.js';
import { IQuickInputService, IQuickPickItem } from '../../../../../platform/quickinput/common/quickInput.js';
import { IClaudeService } from '../../common/claude.js';
import { IClaudeMessage, IClaudeSession } from '../../common/claudeTypes.js';

/**
 * SessionPicker 콜백 인터페이스
 */
export interface ISessionPickerCallbacks {
	clearMessages(): void;
	appendMessage(message: IClaudeMessage): void;
	updateWelcomeVisibility(): void;
}

/**
 * 세션 선택 UI 매니저
 * 세션 목록 표시, 새 세션 생성, 세션 전환 담당
 */
export class SessionPickerUI {

	constructor(
		private readonly claudeService: IClaudeService,
		private readonly quickInputService: IQuickInputService,
		private readonly notificationService: INotificationService,
		private readonly callbacks: ISessionPickerCallbacks
	) { }

	/**
	 * 세션 관리 QuickPick 표시
	 */
	async show(): Promise<void> {
		const sessions = this.claudeService.getSessions();
		const currentSession = this.claudeService.getCurrentSession();

		interface ISessionQuickPickItem extends IQuickPickItem {
			id: string;
			action?: 'switch' | 'new' | 'delete' | 'rename';
		}

		const items: ISessionQuickPickItem[] = [];

		// 새 세션 옵션
		items.push({
			id: 'new',
			label: '$(add) ' + localize('newSession', "New Session"),
			description: localize('newSessionDesc', "Start a fresh conversation"),
			action: 'new'
		});

		// 구분선
		items.push({
			id: 'separator-1',
			label: '',
			kind: 1 // separator
		} as ISessionQuickPickItem);

		// 세션 목록
		for (const session of sessions) {
			const isCurrent = currentSession?.id === session.id;
			const messageCount = session.messages.length;
			const lastMessage = session.messages[session.messages.length - 1];
			const preview = lastMessage?.content.substring(0, 50) || localize('emptySession', "Empty session");

			// 세션 제목 (없으면 첫 메시지 또는 생성 시간)
			let title = session.title;
			if (!title) {
				const firstUserMsg = session.messages.find(m => m.role === 'user');
				title = firstUserMsg?.content.substring(0, 30) || new Date(session.createdAt).toLocaleString();
			}

			items.push({
				id: session.id,
				label: (isCurrent ? '$(check) ' : '$(comment-discussion) ') + title,
				description: isCurrent ? localize('currentSession', "(current)") : `${messageCount} messages`,
				detail: preview + (preview.length >= 50 ? '...' : ''),
				action: 'switch'
			});
		}

		const selected = await this.quickInputService.pick(items, {
			placeHolder: localize('selectSession', "Select a session or create new"),
			canPickMany: false
		});

		if (!selected) {
			return;
		}

		const selectedItem = selected as ISessionQuickPickItem;

		if (selectedItem.action === 'new') {
			this.createNewSession();
		} else if (selectedItem.action === 'switch') {
			await this.switchToSession(selectedItem.id);
		}
	}

	/**
	 * 새 세션 생성
	 */
	createNewSession(): void {
		this.claudeService.startNewSession();
		this.callbacks.clearMessages();
		this.callbacks.updateWelcomeVisibility();
		this.notificationService.info(localize('newSessionCreated', "New session created"));
	}

	/**
	 * 세션 전환
	 */
	async switchToSession(sessionId: string): Promise<void> {
		const currentSession = this.claudeService.getCurrentSession();
		if (currentSession?.id === sessionId) {
			return;
		}

		// 세션 전환
		const session = this.claudeService.switchSession?.(sessionId);
		if (!session) {
			this.notificationService.error(localize('sessionNotFound', "Session not found"));
			return;
		}

		// UI 갱신
		this.renderSession(session);
	}

	/**
	 * 세션 렌더링
	 */
	renderSession(session: IClaudeSession): void {
		this.callbacks.clearMessages();

		// 세션의 메시지들 다시 렌더링
		for (const message of session.messages) {
			this.callbacks.appendMessage(message);
		}

		this.callbacks.updateWelcomeVisibility();

		const title = session.title || localize('session', "Session");
		this.notificationService.info(localize('switchedToSession', "Switched to: {0}", title));
	}
}
