/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../../../../base/common/event.js';
import { Disposable } from '../../../../../base/common/lifecycle.js';
import { URI } from '../../../../../base/common/uri.js';
import { IFileService } from '../../../../../platform/files/common/files.js';
import { IModelService } from '../../../../../editor/common/services/model.js';
import { ITextModelService } from '../../../../../editor/common/services/resolverService.js';
import { IEditorService } from '../../../../services/editor/common/editorService.js';
import { basename } from '../../../../../base/common/resources.js';
import { localize } from '../../../../../nls.js';
import { IClaudeLogService } from '../../common/claudeLogService.js';
import { IClaudeFileChange, IClaudeFileChangesSummary } from '../../common/claudeTypes.js';
import { VSBuffer } from '../../../../../base/common/buffer.js';

/**
 * 파일 스냅샷 정보 (내부용)
 */
interface IFileSnapshot {
	readonly filePath: string;
	readonly uri: URI;
	readonly originalContent: string;
	modifiedContent?: string;
	readonly timestamp: number;
	readonly isNew: boolean;
}

/**
 * 파일 스냅샷 매니저
 * Claude가 파일을 수정하기 전/후 상태를 관리하고
 * Diff 표시, Revert 기능 제공
 */
export class FileSnapshotManager extends Disposable {

	private static readonly LOG_CATEGORY = 'FileSnapshot';

	// 현재 명령에서 수정된 파일들의 스냅샷
	private readonly _snapshots = new Map<string, IFileSnapshot>();

	// 작업 디렉토리
	private _workingDir: string | undefined;

	// 변경 이벤트
	private readonly _onDidChangeFiles = this._register(new Emitter<IClaudeFileChangesSummary>());
	readonly onDidChangeFiles: Event<IClaudeFileChangesSummary> = this._onDidChangeFiles.event;

	constructor(
		private readonly fileService: IFileService,
		private readonly modelService: IModelService,
		private readonly textModelService: ITextModelService,
		private readonly editorService: IEditorService,
		private readonly logService: IClaudeLogService
	) {
		super();
	}

	/**
	 * 새 명령 시작 - 스냅샷 초기화
	 */
	startCommand(workingDir?: string): void {
		this._snapshots.clear();
		this._workingDir = workingDir;
		this.logService.debug(FileSnapshotManager.LOG_CATEGORY, 'Command started, snapshots cleared');
	}

	/**
	 * 파일 수정 전 스냅샷 저장
	 * tool_use 이벤트에서 호출
	 */
	async captureBeforeEdit(filePath: string): Promise<void> {
		// 이미 스냅샷이 있으면 스킵 (같은 파일을 여러 번 수정할 수 있음)
		if (this._snapshots.has(filePath)) {
			this.logService.debug(FileSnapshotManager.LOG_CATEGORY, 'Snapshot already exists for:', filePath);
			return;
		}

		try {
			const uri = this.resolveUri(filePath);
			let originalContent = '';
			let isNew = false;

			// 파일이 존재하는지 확인
			try {
				const stat = await this.fileService.stat(uri);
				if (stat) {
					// 열려있는 에디터 모델에서 먼저 확인 (더티 상태 포함)
					const model = this.modelService.getModel(uri);
					if (model) {
						originalContent = model.getValue();
					} else {
						// 파일 시스템에서 읽기
						const content = await this.fileService.readFile(uri);
						originalContent = content.value.toString();
					}
				}
			} catch {
				// 파일이 없으면 새 파일
				isNew = true;
				originalContent = '';
			}

			const snapshot: IFileSnapshot = {
				filePath,
				uri,
				originalContent,
				timestamp: Date.now(),
				isNew
			};

			this._snapshots.set(filePath, snapshot);
			this.logService.debug(FileSnapshotManager.LOG_CATEGORY,
				`Captured snapshot for: ${filePath} (${isNew ? 'new file' : originalContent.length + ' chars'})`);

		} catch (error) {
			this.logService.error(FileSnapshotManager.LOG_CATEGORY, 'Failed to capture snapshot:', filePath, error);
		}
	}

	/**
	 * 파일 수정 후 내용 캡처
	 * tool_result 이벤트에서 호출
	 */
	async captureAfterEdit(filePath: string): Promise<void> {
		const snapshot = this._snapshots.get(filePath);
		if (!snapshot) {
			this.logService.debug(FileSnapshotManager.LOG_CATEGORY, 'No snapshot found for:', filePath);
			return;
		}

		try {
			const uri = snapshot.uri;

			// 열려있는 에디터 모델에서 먼저 확인
			const model = this.modelService.getModel(uri);
			if (model) {
				snapshot.modifiedContent = model.getValue();
			} else {
				// 파일 시스템에서 읽기
				try {
					const content = await this.fileService.readFile(uri);
					snapshot.modifiedContent = content.value.toString();
				} catch {
					// 파일이 삭제된 경우
					snapshot.modifiedContent = '';
				}
			}

			this.logService.debug(FileSnapshotManager.LOG_CATEGORY,
				`Captured modified content for: ${filePath} (${snapshot.modifiedContent?.length || 0} chars)`);

		} catch (error) {
			this.logService.error(FileSnapshotManager.LOG_CATEGORY, 'Failed to capture modified content:', filePath, error);
		}
	}

	/**
	 * 변경된 파일 목록 가져오기
	 */
	getChangedFiles(): IClaudeFileChange[] {
		const changes: IClaudeFileChange[] = [];

		for (const [filePath, snapshot] of this._snapshots) {
			// 수정 후 내용이 없으면 아직 캡처되지 않은 것
			if (snapshot.modifiedContent === undefined) {
				continue;
			}

			// 변경이 없으면 스킵
			if (snapshot.originalContent === snapshot.modifiedContent) {
				continue;
			}

			// 라인 수 계산
			const originalLines = snapshot.originalContent ? snapshot.originalContent.split('\n') : [];
			const modifiedLines = snapshot.modifiedContent ? snapshot.modifiedContent.split('\n') : [];

			const { added, removed } = this.countLineDiff(originalLines, modifiedLines);

			// 변경 타입 결정
			let changeType: 'created' | 'modified' | 'deleted';
			if (snapshot.isNew || snapshot.originalContent === '') {
				changeType = 'created';
			} else if (snapshot.modifiedContent === '') {
				changeType = 'deleted';
			} else {
				changeType = 'modified';
			}

			changes.push({
				filePath,
				fileName: filePath.split(/[/\\]/).pop() || filePath,
				changeType,
				linesAdded: added,
				linesRemoved: removed,
				originalContent: snapshot.originalContent,
				modifiedContent: snapshot.modifiedContent
			});
		}

		return changes;
	}

	/**
	 * 변경사항 요약 가져오기
	 */
	getChangesSummary(): IClaudeFileChangesSummary {
		const changes = this.getChangedFiles();

		let filesCreated = 0;
		let filesModified = 0;
		let filesDeleted = 0;
		let totalLinesAdded = 0;
		let totalLinesRemoved = 0;

		for (const change of changes) {
			switch (change.changeType) {
				case 'created':
					filesCreated++;
					break;
				case 'modified':
					filesModified++;
					break;
				case 'deleted':
					filesDeleted++;
					break;
			}
			totalLinesAdded += change.linesAdded;
			totalLinesRemoved += change.linesRemoved;
		}

		return {
			filesCreated,
			filesModified,
			filesDeleted,
			totalLinesAdded,
			totalLinesRemoved,
			changes
		};
	}

	/**
	 * 파일 변경사항 되돌리기
	 */
	async revertFile(filePath: string): Promise<boolean> {
		const snapshot = this._snapshots.get(filePath);
		if (!snapshot) {
			this.logService.error(FileSnapshotManager.LOG_CATEGORY, 'No snapshot found for revert:', filePath);
			return false;
		}

		try {
			const uri = snapshot.uri;

			if (snapshot.isNew) {
				// 새로 생성된 파일은 삭제
				try {
					await this.fileService.del(uri);
					this.logService.info(FileSnapshotManager.LOG_CATEGORY, 'Deleted new file:', filePath);
				} catch {
					// 이미 삭제되었거나 없는 경우 무시
				}
			} else {
				// 기존 파일은 원본으로 복원
				const content = VSBuffer.fromString(snapshot.originalContent);
				await this.fileService.writeFile(uri, content);

				// 에디터가 열려있으면 새로고침
				const model = this.modelService.getModel(uri);
				if (model) {
					model.setValue(snapshot.originalContent);
				}

				this.logService.info(FileSnapshotManager.LOG_CATEGORY, 'Reverted file:', filePath);
			}

			// 스냅샷에서 제거
			this._snapshots.delete(filePath);

			// 이벤트 발생
			this._onDidChangeFiles.fire(this.getChangesSummary());

			return true;
		} catch (error) {
			this.logService.error(FileSnapshotManager.LOG_CATEGORY, 'Failed to revert file:', filePath, error);
			return false;
		}
	}

	/**
	 * 모든 변경사항 되돌리기
	 */
	async revertAll(): Promise<number> {
		const changes = this.getChangedFiles();
		let revertedCount = 0;

		for (const change of changes) {
			const success = await this.revertFile(change.filePath);
			if (success) {
				revertedCount++;
			}
		}

		this.logService.info(FileSnapshotManager.LOG_CATEGORY, `Reverted ${revertedCount} files`);
		return revertedCount;
	}

	/**
	 * Diff 에디터로 변경사항 표시
	 */
	async showDiff(fileChange: IClaudeFileChange): Promise<void> {
		const uri = this.resolveUri(fileChange.filePath);

		// 임시 URI 생성
		const ts = Date.now();
		const originalUri = uri.with({ scheme: 'claude-original', query: `ts=${ts}` });
		const modifiedUri = uri.with({ scheme: 'claude-modified', query: `ts=${ts}` });

		// 텍스트 콘텐츠 프로바이더 등록
		const originalDisposable = this.textModelService.registerTextModelContentProvider('claude-original', {
			provideTextContent: async () => {
				return this.modelService.createModel(fileChange.originalContent, null, originalUri);
			}
		});

		const modifiedDisposable = this.textModelService.registerTextModelContentProvider('claude-modified', {
			provideTextContent: async () => {
				return this.modelService.createModel(fileChange.modifiedContent, null, modifiedUri);
			}
		});

		this._register(originalDisposable);
		this._register(modifiedDisposable);

		// Diff 에디터 열기
		const fileName = basename(uri);
		await this.editorService.openEditor({
			original: { resource: originalUri },
			modified: { resource: modifiedUri },
			label: localize('claudeDiffLabel', "Claude Changes: {0}", fileName),
			description: fileChange.filePath
		});

		this.logService.debug(FileSnapshotManager.LOG_CATEGORY, 'Opened diff for:', fileChange.filePath);
	}

	/**
	 * 모든 변경 파일의 Diff 표시
	 */
	async showAllDiffs(): Promise<void> {
		const changes = this.getChangedFiles();

		if (changes.length === 0) {
			this.logService.debug(FileSnapshotManager.LOG_CATEGORY, 'No file changes to show');
			return;
		}

		this.logService.debug(FileSnapshotManager.LOG_CATEGORY, `Showing diffs for ${changes.length} files`);

		// 첫 번째 파일만 Diff 표시 (나머지는 클릭으로)
		if (changes.length > 0) {
			await this.showDiff(changes[0]);
		}
	}

	/**
	 * 스냅샷 초기화
	 */
	clear(): void {
		this._snapshots.clear();
		this._workingDir = undefined;
	}

	/**
	 * 현재 스냅샷 개수
	 */
	get snapshotCount(): number {
		return this._snapshots.size;
	}

	/**
	 * 변경된 파일 개수
	 */
	get changedFileCount(): number {
		return this.getChangedFiles().length;
	}

	// ========== Private Methods ==========

	private resolveUri(filePath: string): URI {
		// 절대 경로인지 확인
		if (filePath.startsWith('/') || /^[A-Za-z]:/.test(filePath)) {
			return URI.file(filePath);
		}

		// 상대 경로면 작업 디렉토리 기준
		if (this._workingDir) {
			return URI.file(`${this._workingDir}/${filePath}`);
		}

		return URI.file(filePath);
	}

	/**
	 * 라인 추가/삭제 수 계산 (간단한 diff)
	 */
	private countLineDiff(originalLines: string[], modifiedLines: string[]): { added: number; removed: number } {
		const originalSet = new Set(originalLines);
		const modifiedSet = new Set(modifiedLines);

		let added = 0;
		let removed = 0;

		for (const line of modifiedLines) {
			if (!originalSet.has(line)) {
				added++;
			}
		}

		for (const line of originalLines) {
			if (!modifiedSet.has(line)) {
				removed++;
			}
		}

		return { added, removed };
	}
}
