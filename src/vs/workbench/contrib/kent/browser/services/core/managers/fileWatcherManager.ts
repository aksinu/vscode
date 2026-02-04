/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, IDisposable } from '../../../../../../../base/common/lifecycle.js';
import { URI } from '../../../../../../../base/common/uri.js';
import { IFileService, FileChangesEvent } from '../../../../../../../platform/files/common/files.js';
import { IClaudeFileService } from '../../../../common/types/claudeFileService.js';
import { IClaudeLogService } from '../../../../common/claudeLogService.js';

/**
 * FileWatcherManager - 파일 시스템 감시 관리
 * 책임: setupFileSystemWatcher, _processFileChangesSync, _batchProcessFileChanges
 */
export class FileWatcherManager extends Disposable {

	private static readonly LOG_CATEGORY = 'FileWatcherManager';

	constructor(
		private readonly _platformFileService: IFileService,
		private readonly _fileService: IClaudeFileService,
		private readonly _logService: IClaudeLogService
	) {
		super();
	}

	/**
	 * 파일 시스템 이벤트 구독 설정
	 * @returns 등록된 disposable
	 */
	setupFileSystemWatcher(): IDisposable {
		const disposable = this._platformFileService.onDidFilesChange((event: FileChangesEvent) => {
			// 변경된 파일들 수집
			const changedFiles = [
				...event.rawAdded,
				...event.rawUpdated,
				...event.rawDeleted
			];

			if (changedFiles.length === 0) {
				return;
			}

			this._logService.debug(FileWatcherManager.LOG_CATEGORY, 'File change detected:', {
				count: changedFiles.length,
				first3: changedFiles.slice(0, 3).map(f => f.toString())
			});

			// 대량 변경 시 배칭 처리로 UI 블로킹 방지
			if (changedFiles.length > 10) {
				this.batchProcessFileChanges(changedFiles);
			} else {
				this.processFileChangesSync(changedFiles);
			}
		});

		this._logService.info(FileWatcherManager.LOG_CATEGORY, 'File system watcher setup completed');

		return disposable;
	}

	/**
	 * 소량 파일 변경 시 동기 처리
	 */
	private processFileChangesSync(changedFiles: URI[]): void {
		this._logService.info(FileWatcherManager.LOG_CATEGORY, `Sync processing ${changedFiles.length} file changes`);

		for (const fileUri of changedFiles) {
			this._fileService.removeSnapshot(fileUri.toString());
			this._logService.debug(FileWatcherManager.LOG_CATEGORY, `Removed snapshot for: ${fileUri.toString()}`);
		}
	}

	/**
	 * 대량 파일 변경 시 배칭 비동기 처리 (UI 블로킹 방지)
	 */
	private async batchProcessFileChanges(changedFiles: URI[]): Promise<void> {
		this._logService.info(FileWatcherManager.LOG_CATEGORY, `Batch processing ${changedFiles.length} file changes`);

		const BATCH_SIZE = 20; // 20개씩 배칭 처리
		const BATCH_DELAY = 10; // 10ms 딜레이 (UI 응답성 유지)

		for (let i = 0; i < changedFiles.length; i += BATCH_SIZE) {
			const batch = changedFiles.slice(i, i + BATCH_SIZE);

			// 배칭 처리
			for (const fileUri of batch) {
				this._fileService.removeSnapshot(fileUri.toString());
			}

			this._logService.debug(FileWatcherManager.LOG_CATEGORY,
				`Processed batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(changedFiles.length / BATCH_SIZE)}`);

			// 다음 배치 전 짧은 대기 (UI 응답성 보장)
			if (i + BATCH_SIZE < changedFiles.length) {
				await new Promise(resolve => setTimeout(resolve, BATCH_DELAY));
			}
		}

		this._logService.info(FileWatcherManager.LOG_CATEGORY, `Batch processing completed for ${changedFiles.length} files`);
	}
}
