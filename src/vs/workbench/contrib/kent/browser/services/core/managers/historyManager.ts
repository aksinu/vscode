/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../../../../base/common/lifecycle.js';
import { IClaudeSessionChangesHistory, IClaudeChangesHistoryEntry, IClaudeFileChangeSummaryItem } from '../../../../common/services/core/claude.js';
import { IClaudeSessionService } from '../../../../common/types/claudeSessionService.js';
import { IClaudeFileChange } from '../../../../common/types/claudeTypes.js';

/**
 * HistoryManager - 변경 히스토리 관리
 * 책임: getSessionChangesHistory
 */
export class HistoryManager extends Disposable {

	constructor(
		private readonly _sessionService: IClaudeSessionService
	) {
		super();
	}

	/**
	 * 세션 전체 변경사항 히스토리 가져오기
	 */
	getSessionChangesHistory(): IClaudeSessionChangesHistory {
		const session = this._sessionService.getCurrentSession();
		if (!session) {
			return {
				sessionId: '',
				totalFilesChanged: 0,
				totalLinesAdded: 0,
				totalLinesRemoved: 0,
				entries: [],
				filesSummary: []
			};
		}

		const entries: IClaudeChangesHistoryEntry[] = [];
		const filesMap = new Map<string, IClaudeFileChangeSummaryItem>();
		let totalLinesAdded = 0;
		let totalLinesRemoved = 0;

		// 메시지를 시간순으로 순회
		const messages = session.messages;
		for (let i = 0; i < messages.length; i++) {
			const msg = messages[i];

			// assistant 메시지에서 fileChanges 추출
			if (msg.role === 'assistant' && msg.fileChanges && msg.fileChanges.changes.length > 0) {
				// 이전 user 메시지에서 프롬프트 가져오기
				let prompt = '';
				for (let j = i - 1; j >= 0; j--) {
					if (messages[j].role === 'user') {
						prompt = messages[j].content;
						// 프롬프트 요약 (100자)
						if (prompt.length > 100) {
							prompt = prompt.substring(0, 100) + '...';
						}
						break;
					}
				}

				entries.push({
					messageId: msg.id,
					timestamp: msg.timestamp,
					prompt,
					changes: msg.fileChanges.changes
				});

				// 파일별 통계 업데이트
				for (const change of msg.fileChanges.changes) {
					this.updateFileSummary(filesMap, change, msg.timestamp);
					totalLinesAdded += change.linesAdded;
					totalLinesRemoved += change.linesRemoved;
				}
			}
		}

		// 파일 요약을 배열로 변환 (수정 횟수 내림차순)
		const filesSummary = Array.from(filesMap.values())
			.sort((a, b) => b.changeCount - a.changeCount);

		return {
			sessionId: session.id,
			totalFilesChanged: filesMap.size,
			totalLinesAdded,
			totalLinesRemoved,
			entries,
			filesSummary
		};
	}

	/**
	 * 파일 요약 맵 업데이트
	 */
	private updateFileSummary(
		filesMap: Map<string, IClaudeFileChangeSummaryItem>,
		change: IClaudeFileChange,
		timestamp: number
	): void {
		const existing = filesMap.get(change.filePath);
		if (existing) {
			filesMap.set(change.filePath, {
				filePath: change.filePath,
				fileName: change.fileName,
				changeCount: existing.changeCount + 1,
				finalState: change.changeType,
				totalLinesAdded: existing.totalLinesAdded + change.linesAdded,
				totalLinesRemoved: existing.totalLinesRemoved + change.linesRemoved,
				lastModified: timestamp
			});
		} else {
			filesMap.set(change.filePath, {
				filePath: change.filePath,
				fileName: change.fileName,
				changeCount: 1,
				finalState: change.changeType,
				totalLinesAdded: change.linesAdded,
				totalLinesRemoved: change.linesRemoved,
				lastModified: timestamp
			});
		}
	}
}
