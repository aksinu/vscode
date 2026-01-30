/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, append, clearNode } from '../../../../../base/browser/dom.js';
import { Codicon } from '../../../../../base/common/codicons.js';
import { ThemeIcon } from '../../../../../base/common/themables.js';
import { Disposable } from '../../../../../base/common/lifecycle.js';
import { localize } from '../../../../../nls.js';
import { IClaudeSessionChangesHistory, IClaudeChangesHistoryEntry, IClaudeFileChangeSummaryItem } from '../../common/claude.js';
import { IClaudeFileChange } from '../../common/claudeTypes.js';

/**
 * Changes History 패널 콜백
 */
export interface IChangesHistoryPanelCallbacks {
	onShowDiff(change: IClaudeFileChange): void;
	onRevertFile(change: IClaudeFileChange): void;
	onClose(): void;
}

/**
 * 세션 변경사항 히스토리 패널
 */
export class ChangesHistoryPanel extends Disposable {

	private readonly container: HTMLElement;
	private readonly headerContainer: HTMLElement;
	private readonly contentContainer: HTMLElement;
	private readonly tabsContainer: HTMLElement;
	private activeTab: 'timeline' | 'files' = 'timeline';

	constructor(
		parent: HTMLElement,
		private readonly callbacks: IChangesHistoryPanelCallbacks
	) {
		super();

		this.container = append(parent, $('.claude-changes-history-panel'));
		this.container.style.display = 'none';

		// 헤더
		this.headerContainer = append(this.container, $('.changes-history-header'));
		this.renderHeader();

		// 탭
		this.tabsContainer = append(this.container, $('.changes-history-tabs'));
		this.renderTabs();

		// 콘텐츠
		this.contentContainer = append(this.container, $('.changes-history-content'));
	}

	private renderHeader(): void {
		clearNode(this.headerContainer);

		const title = append(this.headerContainer, $('.changes-history-title'));
		title.textContent = localize('changesHistory', "Session Changes");

		const closeBtn = append(this.headerContainer, $('button.changes-history-close'));
		closeBtn.appendChild($(ThemeIcon.asCSSSelector(Codicon.close)));
		closeBtn.title = localize('close', "Close");
		closeBtn.onclick = () => this.callbacks.onClose();
	}

	private renderTabs(): void {
		clearNode(this.tabsContainer);

		// Timeline 탭
		const timelineTab = append(this.tabsContainer, $('button.changes-history-tab'));
		timelineTab.textContent = localize('timeline', "Timeline");
		timelineTab.classList.toggle('active', this.activeTab === 'timeline');
		timelineTab.onclick = () => {
			this.activeTab = 'timeline';
			this.renderTabs();
			this.renderContent(this._lastHistory);
		};

		// Files 탭
		const filesTab = append(this.tabsContainer, $('button.changes-history-tab'));
		filesTab.textContent = localize('files', "Files");
		filesTab.classList.toggle('active', this.activeTab === 'files');
		filesTab.onclick = () => {
			this.activeTab = 'files';
			this.renderTabs();
			this.renderContent(this._lastHistory);
		};
	}

	private _lastHistory: IClaudeSessionChangesHistory | undefined;

	/**
	 * 패널 표시
	 */
	show(history: IClaudeSessionChangesHistory): void {
		this._lastHistory = history;
		this.container.style.display = 'flex';
		this.renderContent(history);
	}

	/**
	 * 패널 숨기기
	 */
	hide(): void {
		this.container.style.display = 'none';
	}

	/**
	 * 패널 토글
	 */
	toggle(history: IClaudeSessionChangesHistory): void {
		if (this.container.style.display === 'none') {
			this.show(history);
		} else {
			this.hide();
		}
	}

	/**
	 * 표시 여부
	 */
	get isVisible(): boolean {
		return this.container.style.display !== 'none';
	}

	private renderContent(history: IClaudeSessionChangesHistory | undefined): void {
		clearNode(this.contentContainer);

		if (!history || history.entries.length === 0) {
			const empty = append(this.contentContainer, $('.changes-history-empty'));
			empty.textContent = localize('noChanges', "No file changes in this session");
			return;
		}

		// 요약 통계
		this.renderSummary(history);

		// 탭별 콘텐츠
		if (this.activeTab === 'timeline') {
			this.renderTimeline(history.entries);
		} else {
			this.renderFilesList(history.filesSummary);
		}
	}

	private renderSummary(history: IClaudeSessionChangesHistory): void {
		const summary = append(this.contentContainer, $('.changes-history-summary'));

		const stats = append(summary, $('.changes-stats'));
		stats.innerHTML = `
			<span class="stat-item">
				<span class="codicon codicon-file"></span>
				${history.totalFilesChanged} ${localize('filesChanged', "files")}
			</span>
			<span class="stat-item additions">
				<span class="codicon codicon-diff-added"></span>
				+${history.totalLinesAdded}
			</span>
			<span class="stat-item deletions">
				<span class="codicon codicon-diff-removed"></span>
				-${history.totalLinesRemoved}
			</span>
		`;
	}

	private renderTimeline(entries: IClaudeChangesHistoryEntry[]): void {
		const timeline = append(this.contentContainer, $('.changes-timeline'));

		// 최신 순으로 정렬
		const sortedEntries = [...entries].reverse();

		for (const entry of sortedEntries) {
			const item = append(timeline, $('.timeline-item'));

			// 시간
			const time = append(item, $('.timeline-time'));
			time.textContent = this.formatTime(entry.timestamp);

			// 프롬프트
			const prompt = append(item, $('.timeline-prompt'));
			prompt.textContent = entry.prompt || localize('noPrompt', "(no prompt)");
			prompt.title = entry.prompt;

			// 변경된 파일 목록
			const filesList = append(item, $('.timeline-files'));
			for (const change of entry.changes) {
				const fileItem = append(filesList, $('.timeline-file'));

				// 아이콘
				const icon = this.getChangeTypeIcon(change.changeType);
				fileItem.appendChild($(ThemeIcon.asCSSSelector(icon)));

				// 파일 이름
				const fileName = append(fileItem, $('span.file-name'));
				fileName.textContent = change.fileName;
				fileName.title = change.filePath;

				// 라인 변경
				const lineChanges = append(fileItem, $('span.line-changes'));
				if (change.linesAdded > 0) {
					const added = append(lineChanges, $('span.additions'));
					added.textContent = `+${change.linesAdded}`;
				}
				if (change.linesRemoved > 0) {
					const removed = append(lineChanges, $('span.deletions'));
					removed.textContent = `-${change.linesRemoved}`;
				}

				// 액션 버튼
				const actions = append(fileItem, $('.file-actions'));

				const diffBtn = append(actions, $('button.action-btn'));
				diffBtn.appendChild($(ThemeIcon.asCSSSelector(Codicon.diff)));
				diffBtn.title = localize('showDiff', "Show Diff");
				diffBtn.onclick = (e) => {
					e.stopPropagation();
					this.callbacks.onShowDiff(change);
				};
			}
		}
	}

	private renderFilesList(filesSummary: IClaudeFileChangeSummaryItem[]): void {
		const list = append(this.contentContainer, $('.changes-files-list'));

		for (const file of filesSummary) {
			const item = append(list, $('.files-list-item'));

			// 아이콘
			const icon = this.getChangeTypeIcon(file.finalState);
			item.appendChild($(ThemeIcon.asCSSSelector(icon)));

			// 파일 정보
			const info = append(item, $('.file-info'));

			const fileName = append(info, $('span.file-name'));
			fileName.textContent = file.fileName;
			fileName.title = file.filePath;

			const meta = append(info, $('span.file-meta'));
			meta.textContent = `${file.changeCount}x changes`;

			// 라인 변경
			const lineChanges = append(item, $('span.line-changes'));
			if (file.totalLinesAdded > 0) {
				const added = append(lineChanges, $('span.additions'));
				added.textContent = `+${file.totalLinesAdded}`;
			}
			if (file.totalLinesRemoved > 0) {
				const removed = append(lineChanges, $('span.deletions'));
				removed.textContent = `-${file.totalLinesRemoved}`;
			}
		}
	}

	private getChangeTypeIcon(changeType: 'created' | 'modified' | 'deleted'): typeof Codicon.diffAdded {
		switch (changeType) {
			case 'created':
				return Codicon.diffAdded;
			case 'deleted':
				return Codicon.diffRemoved;
			default:
				return Codicon.diffModified;
		}
	}

	private formatTime(timestamp: number): string {
		const date = new Date(timestamp);
		return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
	}
}
