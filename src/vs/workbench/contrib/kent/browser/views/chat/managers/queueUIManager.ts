/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, append, addDisposableListener, EventType } from '../../../../../../../base/browser/dom.js';
import { DisposableStore, IDisposable } from '../../../../../../../base/common/lifecycle.js';
import { localize } from '../../../../../../../nls.js';
import { IClaudeService } from '../../../../common/services/core/claude.js';
import { IClaudeQueuedMessage } from '../../../../common/types/claudeTypes.js';
import { IQuickInputService } from '../../../../../../../platform/quickinput/common/quickInput.js';
import { INotificationService } from '../../../../../../../platform/notification/common/notification.js';

export interface IQueueUIManagerCallbacks {
	registerDisposable: (disposable: IDisposable) => void;
}

/**
 * 메시지 큐 UI 관리 매니저
 * 책임: 큐 UI 렌더링, 드래그앤드롭 재정렬, 큐 아이템 편집/삭제
 */
export class QueueUIManager {

	private readonly disposables = new DisposableStore();

	constructor(
		private readonly queueContainer: HTMLElement,
		private readonly claudeService: IClaudeService,
		private readonly quickInputService: IQuickInputService,
		private readonly notificationService: INotificationService,
		_callbacks: IQueueUIManagerCallbacks
	) {}

	/**
	 * 큐 UI 업데이트
	 */
	updateQueueUI(queue: IClaudeQueuedMessage[]): void {
		// 기존 내용 초기화
		while (this.queueContainer.firstChild) {
			this.queueContainer.removeChild(this.queueContainer.firstChild);
		}

		// 이전 disposables 정리
		this.disposables.clear();

		if (queue.length === 0) {
			this.queueContainer.style.display = 'none';
			return;
		}

		this.queueContainer.style.display = 'block';

		// 헤더
		const header = append(this.queueContainer, $('.claude-queue-header'));
		const headerIcon = append(header, $('.codicon.codicon-loading.claude-queue-spinner'));
		headerIcon.setAttribute('aria-hidden', 'true');
		const headerText = append(header, $('span.claude-queue-title'));
		headerText.textContent = localize('pendingMessages', "{0} message(s) pending", queue.length);

		// 전체 취소 버튼
		const clearButton = append(header, $('button.claude-queue-clear'));
		clearButton.title = localize('clearQueue', "Clear all pending");
		append(clearButton, $('.codicon.codicon-close-all'));

		this.disposables.add(addDisposableListener(clearButton, EventType.CLICK, () => {
			this.claudeService.clearQueue();
		}));

		// 상태 메시지
		const statusMessage = append(this.queueContainer, $('.claude-queue-status'));
		statusMessage.textContent = localize('waitingForPrevious', "Waiting for current request to complete...");

		// 큐 아이템들
		const list = append(this.queueContainer, $('.claude-queue-list'));

		// 드래그 앤 드롭 상태
		let draggedIndex: number | null = null;

		queue.forEach((item, index) => {
			const itemElement = append(list, $('.claude-queue-item'));
			itemElement.dataset.index = String(index);

			// 드래그 앤 드롭 활성화
			itemElement.draggable = true;

			// 드래그 핸들
			const dragHandle = append(itemElement, $('.claude-queue-item-drag'));
			dragHandle.title = localize('dragToReorder', "Drag to reorder");
			append(dragHandle, $('.codicon.codicon-gripper'));

			// 순서 번호
			const orderBadge = append(itemElement, $('.claude-queue-item-order'));
			orderBadge.textContent = `#${index + 1}`;

			// 대기 아이콘
			const waitIcon = append(itemElement, $('.codicon.codicon-clock.claude-queue-item-icon'));
			waitIcon.setAttribute('aria-hidden', 'true');

			// 메시지 내용 (요약) - 클릭하여 편집
			const content = append(itemElement, $('.claude-queue-item-content'));
			const preview = item.content.length > 60 ? item.content.substring(0, 60) + '...' : item.content;
			content.textContent = preview;
			content.title = localize('clickToEdit', "Click to edit: {0}", item.content);

			// 컨텍스트 미리보기 (첨부파일이 있으면 표시)
			if (item.context?.attachments && item.context.attachments.length > 0) {
				const contextBadge = append(itemElement, $('.claude-queue-item-context'));
				contextBadge.title = localize('attachments', "{0} attachment(s)", item.context.attachments.length);
				append(contextBadge, $('.codicon.codicon-attach'));
				const countSpan = append(contextBadge, $('span'));
				countSpan.textContent = String(item.context.attachments.length);
			}

			// 편집 버튼
			const editButton = append(itemElement, $('button.claude-queue-item-edit'));
			editButton.title = localize('editMessage', "Edit message");
			append(editButton, $('.codicon.codicon-edit'));

			// 개별 삭제 버튼
			const removeButton = append(itemElement, $('button.claude-queue-item-remove'));
			removeButton.title = localize('removeFromQueue', "Remove from queue");
			append(removeButton, $('.codicon.codicon-close'));

			// 편집 클릭 이벤트
			this.disposables.add(addDisposableListener(editButton, EventType.CLICK, (e) => {
				e.stopPropagation();
				this.showQueueItemEditDialog(item);
			}));

			// 내용 클릭 이벤트 (편집)
			this.disposables.add(addDisposableListener(content, EventType.CLICK, (e) => {
				e.stopPropagation();
				this.showQueueItemEditDialog(item);
			}));

			// 삭제 클릭 이벤트
			this.disposables.add(addDisposableListener(removeButton, EventType.CLICK, (e) => {
				e.stopPropagation();
				this.claudeService.removeFromQueue(item.id);
			}));

			// 드래그 시작
			this.disposables.add(addDisposableListener(itemElement, EventType.DRAG_START, (e: DragEvent) => {
				draggedIndex = index;
				itemElement.classList.add('dragging');
				if (e.dataTransfer) {
					e.dataTransfer.effectAllowed = 'move';
					e.dataTransfer.setData('text/plain', String(index));
				}
			}));

			// 드래그 종료
			this.disposables.add(addDisposableListener(itemElement, EventType.DRAG_END, () => {
				draggedIndex = null;
				itemElement.classList.remove('dragging');
				// 모든 드롭 인디케이터 제거
				list.querySelectorAll('.drop-target').forEach(el => el.classList.remove('drop-target'));
			}));

			// 드래그 오버
			this.disposables.add(addDisposableListener(itemElement, EventType.DRAG_OVER, (e: DragEvent) => {
				e.preventDefault();
				if (e.dataTransfer) {
					e.dataTransfer.dropEffect = 'move';
				}
				if (draggedIndex !== null && draggedIndex !== index) {
					itemElement.classList.add('drop-target');
				}
			}));

			// 드래그 리브
			this.disposables.add(addDisposableListener(itemElement, EventType.DRAG_LEAVE, () => {
				itemElement.classList.remove('drop-target');
			}));

			// 드롭
			this.disposables.add(addDisposableListener(itemElement, EventType.DROP, (e: DragEvent) => {
				e.preventDefault();
				itemElement.classList.remove('drop-target');

				const fromIndexStr = e.dataTransfer?.getData('text/plain');
				if (fromIndexStr !== undefined) {
					const fromIndex = parseInt(fromIndexStr, 10);
					if (!isNaN(fromIndex) && fromIndex !== index) {
						this.claudeService.reorderQueue?.(fromIndex, index);
					}
				}
			}));
		});
	}

	/**
	 * 큐 아이템 편집 다이얼로그 표시
	 */
	async showQueueItemEditDialog(item: IClaudeQueuedMessage): Promise<void> {
		const result = await this.quickInputService.input({
			title: localize('editQueuedMessage', "Edit Queued Message"),
			value: item.content,
			prompt: localize('editPrompt', "Modify the message content"),
			validateInput: async (value) => {
				if (!value.trim()) {
					return localize('emptyMessage', "Message cannot be empty");
				}
				return null;
			}
		});

		if (result !== undefined && result.trim() !== item.content) {
			const success = this.claudeService.updateQueuedMessage?.(item.id, result.trim());
			if (success) {
				this.notificationService.info(localize('messageUpdated', "Message updated"));
			}
		}
	}

	dispose(): void {
		this.disposables.dispose();
	}
}
