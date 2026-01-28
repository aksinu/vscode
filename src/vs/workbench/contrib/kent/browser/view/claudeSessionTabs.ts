/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, append, addDisposableListener, EventType, clearNode } from '../../../../../base/browser/dom.js';
import { Disposable, IDisposable } from '../../../../../base/common/lifecycle.js';
import { Emitter, Event } from '../../../../../base/common/event.js';
import { localize } from '../../../../../nls.js';
import { IClaudeSession } from '../../common/claudeTypes.js';

/**
 * 세션 탭 이벤트
 */
export interface ISessionTabEvent {
	sessionId: string;
}

/**
 * 세션 탭 콜백
 */
export interface ISessionTabsCallbacks {
	getSessions(): IClaudeSession[];
	getCurrentSession(): IClaudeSession | undefined;
	onNewSession(): void;
	onSwitchSession(sessionId: string): void;
	onDeleteSession(sessionId: string): void;
	onRenameSession(sessionId: string, newName: string): void;
}

/**
 * 세션 탭 UI 컴포넌트
 * 브라우저 탭처럼 세션들을 탭으로 표시
 */
export class SessionTabs extends Disposable {

	private container: HTMLElement;
	private tabsContainer: HTMLElement;
	private disposables: IDisposable[] = [];

	private readonly _onDidRequestRename = this._register(new Emitter<ISessionTabEvent>());
	readonly onDidRequestRename: Event<ISessionTabEvent> = this._onDidRequestRename.event;

	constructor(
		parentContainer: HTMLElement,
		private readonly callbacks: ISessionTabsCallbacks
	) {
		super();

		this.container = append(parentContainer, $('.claude-session-tabs'));
		this.tabsContainer = append(this.container, $('.claude-session-tabs-list'));

		// 새 세션 버튼
		const newTabButton = append(this.container, $('button.claude-session-tab-new'));
		newTabButton.title = localize('newSession', "New Session");
		append(newTabButton, $('span.codicon.codicon-add'));

		this._register(addDisposableListener(newTabButton, EventType.CLICK, () => {
			this.callbacks.onNewSession();
		}));

		// 초기 렌더링
		this.render();
	}

	/**
	 * 탭 목록 렌더링
	 */
	render(): void {
		// 기존 탭 정리
		this.clearTabs();

		const sessions = this.callbacks.getSessions();
		const currentSession = this.callbacks.getCurrentSession();

		// 세션이 없으면 숨김
		if (sessions.length === 0) {
			this.container.style.display = 'none';
			return;
		}

		this.container.style.display = 'flex';

		// 세션별 탭 생성
		for (const session of sessions) {
			this.createTab(session, session.id === currentSession?.id);
		}
	}

	/**
	 * 탭 생성
	 */
	private createTab(session: IClaudeSession, isActive: boolean): void {
		const tab = append(this.tabsContainer, $('.claude-session-tab'));
		if (isActive) {
			tab.classList.add('active');
		}
		tab.dataset.sessionId = session.id;

		// 탭 제목
		const title = this.getSessionTitle(session);
		const titleElement = append(tab, $('.claude-session-tab-title'));
		titleElement.textContent = title;
		titleElement.title = title;

		// 닫기 버튼 (세션이 2개 이상일 때만)
		const sessions = this.callbacks.getSessions();
		if (sessions.length > 1) {
			const closeButton = append(tab, $('button.claude-session-tab-close'));
			closeButton.title = localize('closeSession', "Close Session");
			append(closeButton, $('span.codicon.codicon-close'));

			this.disposables.push(addDisposableListener(closeButton, EventType.CLICK, (e) => {
				e.stopPropagation();
				this.callbacks.onDeleteSession(session.id);
			}));
		}

		// 탭 클릭 - 세션 전환
		this.disposables.push(addDisposableListener(tab, EventType.CLICK, () => {
			if (!isActive) {
				this.callbacks.onSwitchSession(session.id);
			}
		}));

		// 더블클릭 - 이름 변경
		this.disposables.push(addDisposableListener(tab, EventType.DBLCLICK, () => {
			this.startRename(tab, session);
		}));
	}

	/**
	 * 세션 제목 가져오기
	 */
	private getSessionTitle(session: IClaudeSession): string {
		if (session.title) {
			return session.title;
		}

		// 첫 번째 사용자 메시지에서 제목 추출
		const firstUserMsg = session.messages.find(m => m.role === 'user');
		if (firstUserMsg) {
			const content = firstUserMsg.content.trim();
			// 첫 줄만 사용, 최대 20자
			const firstLine = content.split('\n')[0];
			return firstLine.length > 20 ? firstLine.substring(0, 20) + '...' : firstLine;
		}

		// 기본값: 생성 시간
		return new Date(session.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
	}

	/**
	 * 이름 변경 시작
	 */
	private startRename(tab: HTMLElement, session: IClaudeSession): void {
		const titleElement = tab.querySelector('.claude-session-tab-title') as HTMLElement;
		if (!titleElement) return;

		const currentTitle = this.getSessionTitle(session);

		// 입력 필드로 교체
		const input = document.createElement('input');
		input.type = 'text';
		input.className = 'claude-session-tab-rename-input';
		input.value = session.title || '';
		input.placeholder = currentTitle;

		titleElement.style.display = 'none';
		tab.insertBefore(input, titleElement);
		input.focus();
		input.select();

		const finishRename = () => {
			const newName = input.value.trim();
			input.remove();
			titleElement.style.display = '';

			if (newName && newName !== session.title) {
				this.callbacks.onRenameSession(session.id, newName);
			}
		};

		this.disposables.push(addDisposableListener(input, EventType.BLUR, finishRename));
		this.disposables.push(addDisposableListener(input, EventType.KEY_DOWN, (e: KeyboardEvent) => {
			if (e.key === 'Enter') {
				finishRename();
			} else if (e.key === 'Escape') {
				input.value = session.title || '';
				finishRename();
			}
		}));
	}

	/**
	 * 탭 정리
	 */
	private clearTabs(): void {
		clearNode(this.tabsContainer);
		this.disposables.forEach(d => d.dispose());
		this.disposables = [];
	}

	override dispose(): void {
		this.clearTabs();
		super.dispose();
	}
}
