/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, append } from '../../../../../../../base/browser/dom.js';
import { DisposableStore } from '../../../../../../../base/common/lifecycle.js';
import { localize } from '../../../../../../../nls.js';
import { IClaudeFileChangesSummary, IClaudeFileChange } from '../../../../common/types/claudeTypes.js';

/**
 * 파일 변경사항 렌더링 콜백
 */
export interface IFileChangesRendererCallbacks {
	readonly onShowFileDiff?: (fileChange: IClaudeFileChange) => void;
	readonly onRevertFile?: (fileChange: IClaudeFileChange) => Promise<boolean>;
	readonly onAcceptFile?: (fileChange: IClaudeFileChange) => void;
	readonly onRevertAllFiles?: () => Promise<number>;
	readonly onAcceptAllFiles?: () => void;
}

/**
 * 파일 변경사항 렌더러
 * 변경된 파일 목록, Revert/Accept 버튼, Diff 열기를 담당
 */
export class FileChangesRenderer {

	constructor(private readonly callbacks: IFileChangesRendererCallbacks) { }

	/**
	 * 파일 변경사항 렌더링
	 */
	renderFileChanges(
		fileChanges: IClaudeFileChangesSummary,
		container: HTMLElement,
		disposables: DisposableStore,
		readOnly: boolean
	): void {
		const changesContainer = append(container, $('.claude-file-changes'));

		if (readOnly) {
			changesContainer.classList.add('read-only');
		}

		// 접이식 헤더
		const header = append(changesContainer, $('.claude-file-changes-header'));
		const toggleIcon = append(header, $('.codicon.codicon-chevron-right'));

		// 변경사항 요약
		const summary = append(header, $('.claude-file-changes-summary'));
		append(summary, $('.codicon.codicon-files'));
		const totalFiles = fileChanges.filesCreated + fileChanges.filesModified + fileChanges.filesDeleted;
		append(summary, $('span')).textContent = localize('filesChanged', "{0} file(s) changed", totalFiles);

		// 라인 변경 정보
		const linesInfo = append(summary, $('.claude-file-changes-lines'));
		const addedSpan = append(linesInfo, $('span.added'));
		addedSpan.textContent = `+${fileChanges.totalLinesAdded}`;
		const removedSpan = append(linesInfo, $('span.removed'));
		removedSpan.textContent = `-${fileChanges.totalLinesRemoved}`;

		// Revert All 버튼 (readOnly가 아닐 때만)
		if (!readOnly && this.callbacks.onRevertAllFiles) {
			const revertAllBtn = append(header, $('button.claude-file-changes-revert-all'));
			append(revertAllBtn, $('.codicon.codicon-discard'));
			revertAllBtn.appendChild(document.createTextNode(localize('revertAll', "Revert All")));

			const revertAllHandler = async (e: Event) => {
				e.stopPropagation();
				if (this.callbacks.onRevertAllFiles) {
					const revertedCount = await this.callbacks.onRevertAllFiles();
					if (revertedCount > 0) {
						const items = fileList.querySelectorAll('.claude-file-changes-item');
						items.forEach(item => item.classList.add('reverted'));
					}
				}
			};
			revertAllBtn.addEventListener('click', revertAllHandler);
			disposables.add({ dispose: () => revertAllBtn.removeEventListener('click', revertAllHandler) });
		}

		// 파일 목록 (기본 숨김)
		const fileList = append(changesContainer, $('.claude-file-changes-list'));
		fileList.style.display = 'none';

		for (const change of fileChanges.changes) {
			this.renderFileChangeItem(change, fileList, disposables, readOnly);
		}

		// 헤더 클릭으로 목록 펼치기/접기
		const toggleHandler = () => {
			const isHidden = fileList.style.display === 'none';
			fileList.style.display = isHidden ? 'flex' : 'none';
			toggleIcon.classList.toggle('codicon-chevron-right', !isHidden);
			toggleIcon.classList.toggle('codicon-chevron-down', isHidden);
		};
		header.addEventListener('click', toggleHandler);
		disposables.add({ dispose: () => header.removeEventListener('click', toggleHandler) });
	}

	private renderFileChangeItem(
		change: IClaudeFileChange,
		container: HTMLElement,
		disposables: DisposableStore,
		readOnly: boolean
	): void {
		const item = append(container, $('.claude-file-changes-item'));

		if (change.reverted) {
			item.classList.add('reverted');
		}

		// 상태 아이콘
		const statusIcon = append(item, $('.claude-file-status-icon'));
		statusIcon.classList.add('codicon');
		statusIcon.classList.add(change.changeType);
		switch (change.changeType) {
			case 'created':
				statusIcon.classList.add('codicon-new-file');
				statusIcon.title = localize('fileCreated', "Created");
				break;
			case 'modified':
				statusIcon.classList.add('codicon-edit');
				statusIcon.title = localize('fileModified', "Modified");
				break;
			case 'deleted':
				statusIcon.classList.add('codicon-trash');
				statusIcon.title = localize('fileDeleted', "Deleted");
				break;
		}

		// 파일 이름
		const fileName = append(item, $('.claude-file-name'));
		fileName.textContent = change.fileName;
		fileName.title = change.filePath;

		// 라인 변경
		const lineChanges = append(item, $('.claude-file-line-changes'));
		if (change.linesAdded > 0) {
			const added = append(lineChanges, $('span.added'));
			added.textContent = `+${change.linesAdded}`;
		}
		if (change.linesRemoved > 0) {
			const removed = append(lineChanges, $('span.removed'));
			removed.textContent = `-${change.linesRemoved}`;
		}

		// 액션 버튼들 (readOnly가 아닐 때만)
		if (!readOnly) {
			const buttons = append(item, $('.claude-file-buttons'));

			if (this.callbacks.onAcceptFile) {
				const acceptBtn = append(buttons, $('button.claude-file-button.accept'));
				acceptBtn.title = localize('acceptFile', "Accept this change");
				append(acceptBtn, $('.codicon.codicon-check'));

				const acceptHandler = (e: Event) => {
					e.stopPropagation();
					if (this.callbacks.onAcceptFile) {
						this.callbacks.onAcceptFile(change);
						item.classList.add('accepted');
					}
				};
				acceptBtn.addEventListener('click', acceptHandler);
				disposables.add({ dispose: () => acceptBtn.removeEventListener('click', acceptHandler) });
			}

			if (this.callbacks.onRevertFile) {
				const revertBtn = append(buttons, $('button.claude-file-button.revert'));
				revertBtn.title = localize('revertFile', "Revert this change");
				append(revertBtn, $('.codicon.codicon-discard'));

				const revertHandler = async (e: Event) => {
					e.stopPropagation();
					if (this.callbacks.onRevertFile) {
						const success = await this.callbacks.onRevertFile(change);
						if (success) {
							item.classList.add('reverted');
							change.reverted = true;
						}
					}
				};
				revertBtn.addEventListener('click', revertHandler);
				disposables.add({ dispose: () => revertBtn.removeEventListener('click', revertHandler) });
			}
		}

		// 항목 클릭 시 Diff 뷰어 열기
		if (this.callbacks.onShowFileDiff) {
			const itemClickHandler = () => {
				if (this.callbacks.onShowFileDiff) {
					this.callbacks.onShowFileDiff(change);
				}
			};
			item.addEventListener('click', itemClickHandler);
			disposables.add({ dispose: () => item.removeEventListener('click', itemClickHandler) });
		}
	}
}
