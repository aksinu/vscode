/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../../../base/common/lifecycle.js';
import { IClaudeFileService } from '../../../common/types/claudeFileService.js';
import { IClaudeFileChange, IClaudeFileChangesSummary } from '../../../common/types/claudeTypes.js';
import { IClaudeSessionChangesHistory } from '../../../common/services/core/claude.js';
import { IClaudeLogService } from '../../../common/claudeLogService.js';

/**
 * Claude 파일 관리 서비스
 *
 * 파일 스냅샷, 변경 추적, 파일 차이점 관리, 되돌리기 등을 담당합니다.
 */
export class ClaudeFileService extends Disposable implements IClaudeFileService {
	declare readonly _serviceBrand: undefined;

	// ========== Delegates ==========

	// Core file operations delegates
	private _startCommandDelegate?: (workingDir?: string) => void;
	private _captureBeforeEditDelegate?: (filePath: string) => Promise<void>;
	private _captureAfterEditDelegate?: (filePath: string) => Promise<void>;
	private _captureAllPendingModificationsDelegate?: () => Promise<void>;
	private _cleanupInvalidSnapshotsDelegate?: () => void;
	private _removeSnapshotDelegate?: (fileUri: string) => void;

	// File query delegates
	private _getChangedFilesDelegate?: () => IClaudeFileChange[];
	private _getFileChangesSummaryDelegate?: () => IClaudeFileChangesSummary;
	private _getSessionChangesHistoryInternalDelegate?: () => IClaudeSessionChangesHistory;
	private _getSnapshotCountDelegate?: () => number;

	// File operations delegates
	private _showFileDiffDelegate?: (fileChange: IClaudeFileChange) => Promise<void>;
	private _revertFileDelegate?: (fileChange: IClaudeFileChange) => Promise<boolean>;
	private _revertAllFilesDelegate?: () => Promise<number>;
	private _revertSelectedFilesDelegate?: (fileChanges: IClaudeFileChange[]) => Promise<number>;
	private _acceptFileDelegate?: (fileChange: IClaudeFileChange) => void;
	private _acceptAllFilesDelegate?: () => void;
	private _acceptSelectedFilesDelegate?: (fileChanges: IClaudeFileChange[]) => void;

	constructor(
		@IClaudeLogService private readonly logService: IClaudeLogService
	) {
		super();
		this.logService.info('ClaudeFileService', 'Service initialized');
	}

	// ========== File snapshot management ==========

	startCommand(workingDir?: string): void {
		if (this._startCommandDelegate) {
			this._startCommandDelegate(workingDir);
		}
	}

	async captureBeforeEdit(filePath: string): Promise<void> {
		if (this._captureBeforeEditDelegate) {
			return this._captureBeforeEditDelegate(filePath);
		}
	}

	async captureAfterEdit(filePath: string): Promise<void> {
		if (this._captureAfterEditDelegate) {
			return this._captureAfterEditDelegate(filePath);
		}
	}

	async captureAllPendingModifications(): Promise<void> {
		if (this._captureAllPendingModificationsDelegate) {
			return this._captureAllPendingModificationsDelegate();
		}
	}

	cleanupInvalidSnapshots(): void {
		if (this._cleanupInvalidSnapshotsDelegate) {
			this._cleanupInvalidSnapshotsDelegate();
		}
	}

	removeSnapshot(fileUri: string): void {
		if (this._removeSnapshotDelegate) {
			this._removeSnapshotDelegate(fileUri);
		}
	}

	// ========== File changes query ==========

	getChangedFiles(): IClaudeFileChange[] {
		if (this._getChangedFilesDelegate) {
			return this._getChangedFilesDelegate();
		}
		return [];
	}

	getFileChangesSummary(): IClaudeFileChangesSummary {
		if (this._getFileChangesSummaryDelegate) {
			return this._getFileChangesSummaryDelegate();
		}
		return {
			filesCreated: 0,
			filesModified: 0,
			filesDeleted: 0,
			totalLinesAdded: 0,
			totalLinesRemoved: 0,
			changes: []
		};
	}

	getSessionChangesHistory(): IClaudeSessionChangesHistory {
		if (this._getSessionChangesHistoryInternalDelegate) {
			return this._getSessionChangesHistoryInternalDelegate();
		}
		return {
			sessionId: '',
			totalFilesChanged: 0,
			totalLinesAdded: 0,
			totalLinesRemoved: 0,
			entries: [],
			filesSummary: []
		};
	}

	getSnapshotCount(): number {
		if (this._getSnapshotCountDelegate) {
			return this._getSnapshotCountDelegate();
		}
		return 0;
	}

	// ========== File operations ==========

	async showFileDiff(fileChange: IClaudeFileChange): Promise<void> {
		if (this._showFileDiffDelegate) {
			return this._showFileDiffDelegate(fileChange);
		}
	}

	async revertFile(fileChange: IClaudeFileChange): Promise<boolean> {
		if (this._revertFileDelegate) {
			return this._revertFileDelegate(fileChange);
		}
		return false;
	}

	async revertAllFiles(): Promise<number> {
		if (this._revertAllFilesDelegate) {
			return this._revertAllFilesDelegate();
		}
		return 0;
	}

	async revertSelectedFiles(fileChanges: IClaudeFileChange[]): Promise<number> {
		if (this._revertSelectedFilesDelegate) {
			return this._revertSelectedFilesDelegate(fileChanges);
		}
		return 0;
	}

	acceptFile(fileChange: IClaudeFileChange): void {
		if (this._acceptFileDelegate) {
			this._acceptFileDelegate(fileChange);
		}
	}

	acceptAllFiles(): void {
		if (this._acceptAllFilesDelegate) {
			this._acceptAllFilesDelegate();
		}
	}

	acceptSelectedFiles(fileChanges: IClaudeFileChange[]): void {
		if (this._acceptSelectedFilesDelegate) {
			this._acceptSelectedFilesDelegate(fileChanges);
		}
	}

	// Additional file operations
	async revertFiles(filePaths: string[]): Promise<number> {
		// Convert filePaths to file changes and use revertSelectedFiles
		// For now, return 0 as placeholder
		return 0;
	}

	acceptFiles(filePaths: string[]): void {
		// Convert filePaths to file changes and use acceptSelectedFiles
		// For now, do nothing as placeholder
	}

	// ========== Delegates setup ==========

	setFileDelegates(
		_getCurrentSession: () => any,
		_getSessionChangesHistory: (sessionId: string) => any
	): void {
		// These delegates are reserved for future use
	}

	setCoreFileDelegates(delegates: {
		startCommand?: (workingDir?: string) => void;
		captureBeforeEdit?: (filePath: string) => Promise<void>;
		captureAfterEdit?: (filePath: string) => Promise<void>;
		captureAllPendingModifications?: () => Promise<void>;
		cleanupInvalidSnapshots?: () => void;
		removeSnapshot?: (fileUri: string) => void;
		getChangedFiles?: () => IClaudeFileChange[];
		getFileChangesSummary?: () => IClaudeFileChangesSummary;
		getSessionChangesHistory?: () => IClaudeSessionChangesHistory;
		getSnapshotCount?: () => number;
		showFileDiff?: (fileChange: IClaudeFileChange) => Promise<void>;
		revertFile?: (fileChange: IClaudeFileChange) => Promise<boolean>;
		revertAllFiles?: () => Promise<number>;
		revertSelectedFiles?: (fileChanges: IClaudeFileChange[]) => Promise<number>;
		acceptFile?: (fileChange: IClaudeFileChange) => void;
		acceptAllFiles?: () => void;
		acceptSelectedFiles?: (fileChanges: IClaudeFileChange[]) => void;
	}): void {
		this._startCommandDelegate = delegates.startCommand;
		this._captureBeforeEditDelegate = delegates.captureBeforeEdit;
		this._captureAfterEditDelegate = delegates.captureAfterEdit;
		this._captureAllPendingModificationsDelegate = delegates.captureAllPendingModifications;
		this._cleanupInvalidSnapshotsDelegate = delegates.cleanupInvalidSnapshots;
		this._removeSnapshotDelegate = delegates.removeSnapshot;
		this._getChangedFilesDelegate = delegates.getChangedFiles;
		this._getFileChangesSummaryDelegate = delegates.getFileChangesSummary;
		this._getSessionChangesHistoryInternalDelegate = delegates.getSessionChangesHistory;
		this._getSnapshotCountDelegate = delegates.getSnapshotCount;
		this._showFileDiffDelegate = delegates.showFileDiff;
		this._revertFileDelegate = delegates.revertFile;
		this._revertAllFilesDelegate = delegates.revertAllFiles;
		this._revertSelectedFilesDelegate = delegates.revertSelectedFiles;
		this._acceptFileDelegate = delegates.acceptFile;
		this._acceptAllFilesDelegate = delegates.acceptAllFiles;
		this._acceptSelectedFilesDelegate = delegates.acceptSelectedFiles;
	}
}