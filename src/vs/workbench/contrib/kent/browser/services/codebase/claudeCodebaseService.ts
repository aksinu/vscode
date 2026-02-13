/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../../../../../base/common/event.js';
import { Disposable } from '../../../../../../base/common/lifecycle.js';
import { URI } from '../../../../../../base/common/uri.js';
import { basename } from '../../../../../../base/common/resources.js';
import { IFileService } from '../../../../../../platform/files/common/files.js';
import { IWorkspaceContextService } from '../../../../../../platform/workspace/common/workspace.js';
import { IClaudeCodebaseService, ICodebaseSearchResult, ICodebaseIndexStatus } from '../../../common/types/claudeCodebaseService.js';
import { BM25Index } from './bm25SearchEngine.js';
import { CodebaseIndexer } from './codebaseIndexer.js';

/**
 * Claude 코드베이스 검색 서비스 구현
 * BM25 기반 워크스페이스 파일 검색
 */
export class ClaudeCodebaseService extends Disposable implements IClaudeCodebaseService {

	declare readonly _serviceBrand: undefined;

	private readonly _onDidChangeIndexStatus = this._register(new Emitter<ICodebaseIndexStatus>());
	readonly onDidChangeIndexStatus: Event<ICodebaseIndexStatus> = this._onDidChangeIndexStatus.event;

	private readonly _index: BM25Index;
	private readonly _indexer: CodebaseIndexer;

	private _indexed = false;
	private _indexing = false;
	private _fileCount = 0;
	private _lastIndexedAt: number | undefined;

	constructor(
		@IFileService private readonly fileService: IFileService,
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService
	) {
		super();
		this._index = new BM25Index();
		this._indexer = this._register(new CodebaseIndexer(this.fileService));
	}

	// ========== IClaudeCodebaseService ==========

	async buildIndex(): Promise<void> {
		if (this._indexing) {
			return;
		}

		const folders = this.workspaceContextService.getWorkspace().folders;
		if (folders.length === 0) {
			return;
		}

		this._indexing = true;
		this.fireStatusChange();

		try {
			// 첫 번째 워크스페이스 폴더를 인덱싱
			const rootUri = folders[0].uri;
			const count = await this._indexer.indexWorkspace(rootUri, this._index);

			this._indexed = true;
			this._fileCount = count;
			this._lastIndexedAt = Date.now();
		} finally {
			this._indexing = false;
			this.fireStatusChange();
		}
	}

	async search(query: string, limit: number = 10): Promise<ICodebaseSearchResult[]> {
		// 인덱스가 없으면 자동 빌드
		if (!this._indexed) {
			await this.buildIndex();
		}

		const bm25Results = this._index.search(query, limit);

		const folders = this.workspaceContextService.getWorkspace().folders;
		const rootPath = folders.length > 0 ? folders[0].uri.path : '';
		const rootPrefix = rootPath.endsWith('/') ? rootPath : rootPath + '/';

		// BM25 결과를 ICodebaseSearchResult로 변환
		const results: ICodebaseSearchResult[] = [];
		const maxScore = bm25Results.length > 0 ? bm25Results[0].score : 1;

		for (const result of bm25Results) {
			const uri = URI.parse(result.id);
			const filePath = uri.path;
			const relativePath = filePath.startsWith(rootPrefix)
				? filePath.substring(rootPrefix.length)
				: filePath;

			results.push({
				uri,
				fileName: basename(uri),
				relativePath,
				score: maxScore > 0 ? result.score / maxScore : 0 // 0-1 정규화
			});
		}

		return results;
	}

	getIndexStatus(): ICodebaseIndexStatus {
		return {
			indexed: this._indexed,
			indexing: this._indexing,
			fileCount: this._fileCount,
			lastIndexedAt: this._lastIndexedAt
		};
	}

	clearIndex(): void {
		this._indexer.cancelIndexing();
		this._index.clear();
		this._indexed = false;
		this._fileCount = 0;
		this._lastIndexedAt = undefined;
		this.fireStatusChange();
	}

	// ========== Private ==========

	private fireStatusChange(): void {
		this._onDidChangeIndexStatus.fire(this.getIndexStatus());
	}
}
