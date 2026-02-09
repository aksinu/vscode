/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, IDisposable } from '../../../../../../../base/common/lifecycle.js';
import { URI } from '../../../../../../../base/common/uri.js';
import { IFileService } from '../../../../../../../platform/files/common/files.js';
import { IClaudeFileService } from '../../../../common/types/claudeFileService.js';
import { IClaudeLogService } from '../../../../common/claudeLogService.js';

/**
 * FileWatcherManager - 파일 시스템 감시 관리
 * 책임: setupFileSystemWatcher, _processFileChangesSync, _batchProcessFileChanges
 */
export class FileWatcherManager extends Disposable {

	private static readonly LOG_CATEGORY = 'FileWatcherManager';
	private readonly _debounceTimeouts = new Map<string, ReturnType<typeof setTimeout>>();

	constructor(
		_platformFileService: IFileService, // Reserved for future use when FileWatcher is re-enabled
		private readonly _fileService: IClaudeFileService,
		private readonly _logService: IClaudeLogService
	) {
		void _platformFileService; // Suppress unused warning
		super();

		// Suppress unused warnings for temporarily disabled methods
		void this._filterRelevantFiles;
		void this._processFileChangesSync;
		void this._batchProcessFileChanges;
	}

	/**
	 * 파일 시스템 이벤트 구독 설정
	 * @returns 등록된 disposable
	 */
	setupFileSystemWatcher(): IDisposable {
		this._logService.info(FileWatcherManager.LOG_CATEGORY, '🚨 TEMPORARILY DISABLED: FileWatcher to fix infinite loop');

		// 🚨 임시 비활성화: 무한 루프 문제 해결을 위해 FileWatcher 비활성화
		// TODO: 무한 루프 완전 해결 후 다시 활성화

		// 빈 disposable 반환 (실제로 감시하지 않음)
		return {
			dispose: () => {
				this._logService.info(FileWatcherManager.LOG_CATEGORY, 'FileWatcher disposed (was disabled)');
			}
		};

		/* 원본 코드 (무한 루프 문제로 임시 비활성화)
		const disposable = this._platformFileService.onDidFilesChange((event: FileChangesEvent) => {
			// 변경된 파일들 수집
			const allChangedFiles = [
				...event.rawAdded,
				...event.rawUpdated,
				...event.rawDeleted
			];

			if (allChangedFiles.length === 0) {
				return;
			}

			// 🚨 무한 루프 방지: 특정 파일 패턴 필터링
			const changedFiles = this.filterRelevantFiles(allChangedFiles);

			if (changedFiles.length === 0) {
				return;
			}

			this._logService.debug(FileWatcherManager.LOG_CATEGORY, 'File change detected:', {
				count: changedFiles.length,
				first3: changedFiles.slice(0, 3).map(f => f.toString())
			});

			// 🔍 DEBUG: 어떤 파일이 계속 변경되는지 확인
			this._logService.info(FileWatcherManager.LOG_CATEGORY, 'DETAILED FILE CHANGES:', changedFiles.map(f => f.toString()));

			// 대량 변경 시 배칭 처리로 UI 블로킹 방지
			if (changedFiles.length > 10) {
				this.batchProcessFileChanges(changedFiles);
			} else {
				this.processFileChangesSync(changedFiles);
			}
		});
		*/
	}

	/**
	 * 🚨 무한 루프 방지: 관련 있는 파일만 필터링
	 * @deprecated Temporarily unused - will be re-enabled when FileWatcher is fixed
	 */
	private _filterRelevantFiles(files: URI[]): URI[] {
		return files.filter(uri => {
			const path = uri.toString();

			// 제외할 파일 패턴들 (무한 루프 방지)
			const IGNORED_PATTERNS = [
				// VS Code 내부 파일들
				'/.vscode/',
				'/.git/',
				'/node_modules/',
				'/out/',
				'/dist/',

				// 임시 파일들
				'.tmp',
				'.temp',
				'.swp',
				'~$',

				// 로그 파일들
				'.log',

				// 백업 파일들
				'.backup',
				'.bak'
			];

			// 제외 패턴에 걸리는 파일은 무시
			const shouldIgnore = IGNORED_PATTERNS.some(pattern =>
				path.includes(pattern)
			);

			if (shouldIgnore) {
				this._logService.debug(FileWatcherManager.LOG_CATEGORY, `Ignoring file change: ${path}`);
				return false;
			}

			return true;
		});
	}

	/**
	 * 소량 파일 변경 시 동기 처리 (debounce 적용)
	 * @deprecated Temporarily unused - will be re-enabled when FileWatcher is fixed
	 */
	private _processFileChangesSync(changedFiles: URI[]): void {
		this._logService.info(FileWatcherManager.LOG_CATEGORY, `Sync processing ${changedFiles.length} file changes`);

		for (const fileUri of changedFiles) {
			const path = fileUri.toString();

			// 🚨 debounce: 같은 파일의 연속 변경 방지 (100ms)
			const existingTimeout = this._debounceTimeouts.get(path);
			if (existingTimeout) {
				clearTimeout(existingTimeout);
			}

			this._debounceTimeouts.set(path, setTimeout(() => {
				this._fileService.removeSnapshot(path);
				this._logService.debug(FileWatcherManager.LOG_CATEGORY, `Removed snapshot for: ${path}`);
				this._debounceTimeouts.delete(path);
			}, 100));
		}
	}

	/**
	 * 대량 파일 변경 시 배칭 비동기 처리 (UI 블로킹 방지)
	 * @deprecated Temporarily unused - will be re-enabled when FileWatcher is fixed
	 */
	private async _batchProcessFileChanges(changedFiles: URI[]): Promise<void> {
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
