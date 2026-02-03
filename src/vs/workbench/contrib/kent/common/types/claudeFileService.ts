/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../../base/common/event.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { IClaudeFileChange, IClaudeFileChangesSummary, IClaudeSessionChangesHistory } from '../claudeTypes.js';

export const IClaudeFileService = createDecorator<IClaudeFileService>('claudeFileService');

export interface IClaudeFileService {
	readonly _serviceBrand: undefined;

	// File snapshot management
	startCommand(workingDir?: string): void;
	captureBeforeEdit(filePath: string): Promise<void>;
	captureAfterEdit(filePath: string): Promise<void>;
	captureAllPendingModifications(): Promise<void>;
	cleanupInvalidSnapshots(): void;
	removeSnapshot(fileUri: string): void;

	// File changes query
	getChangedFiles(): IClaudeFileChange[];
	getFileChangesSummary(): IClaudeFileChangesSummary;
	getSessionChangesHistory(): IClaudeSessionChangesHistory;
	getSnapshotCount(): number;

	// File operations
	showFileDiff(fileChange: IClaudeFileChange): Promise<void>;
	revertFile(fileChange: IClaudeFileChange): Promise<boolean>;
	revertAllFiles(): Promise<number>;
	revertSelectedFiles(fileChanges: IClaudeFileChange[]): Promise<number>;
	acceptFile(fileChange: IClaudeFileChange): void;
	acceptAllFiles(): void;
	acceptSelectedFiles(fileChanges: IClaudeFileChange[]): void;

	// Delegates for session management
	setFileDelegates(
		getCurrentSession: () => any,
		getSessionChangesHistory: (sessionId: string) => any
	): void;

	// Delegates for core file operations
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
	}): void;

	// Additional file operations
	revertFiles(filePaths: string[]): Promise<number>;
	acceptFiles(filePaths: string[]): void;
}