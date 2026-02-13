/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken, CancellationTokenSource } from '../../../../../../base/common/cancellation.js';
import { Disposable } from '../../../../../../base/common/lifecycle.js';
import { URI } from '../../../../../../base/common/uri.js';
import { IFileService, IFileStatWithMetadata } from '../../../../../../platform/files/common/files.js';
import { BM25Index } from './bm25SearchEngine.js';

/**
 * 인덱싱 제외 패턴
 */
const EXCLUDE_PATTERNS = new Set([
	'node_modules', '.git', '.svn', '.hg', 'dist', 'build', 'out',
	'.next', '.nuxt', '.cache', '.vscode', '.idea', '.vs',
	'coverage', '__pycache__', '.tox', 'vendor', 'target',
	'bin', 'obj', '.gradle', '.maven'
]);

/**
 * 인덱싱 대상 확장자
 */
const INDEXABLE_EXTENSIONS = new Set([
	// 프로그래밍
	'.ts', '.tsx', '.js', '.jsx', '.mts', '.cts',
	'.py', '.rb', '.go', '.rs', '.java', '.kt', '.scala',
	'.c', '.cpp', '.h', '.hpp', '.cs', '.swift', '.m',
	'.php', '.lua', '.r', '.jl', '.dart', '.elm', '.ex', '.exs',
	// 웹
	'.html', '.htm', '.css', '.scss', '.less', '.vue', '.svelte',
	// 설정/데이터
	'.json', '.yaml', '.yml', '.toml', '.xml',
	// 문서
	'.md', '.txt', '.rst',
	// 쉘
	'.sh', '.bash', '.zsh', '.fish', '.ps1', '.bat', '.cmd',
	// 기타
	'.sql', '.graphql', '.proto', '.dockerfile'
]);

/**
 * 최대 파일 크기 (100KB)
 */
const MAX_FILE_SIZE = 100 * 1024;

/**
 * 최대 인덱싱 파일 수
 */
const MAX_FILES = 5000;

/**
 * 코드베이스 파일 인덱서
 * 워크스페이스 파일을 순회하며 BM25 인덱스에 등록
 */
export class CodebaseIndexer extends Disposable {

	private _cancellation: CancellationTokenSource | undefined;
	private _indexedCount = 0;

	constructor(
		private readonly fileService: IFileService
	) {
		super();
	}

	/**
	 * 워크스페이스의 모든 파일을 인덱싱
	 * @param workspaceUri 워크스페이스 루트 URI
	 * @param index BM25 인덱스
	 */
	async indexWorkspace(workspaceUri: URI, index: BM25Index, token?: CancellationToken): Promise<number> {
		// 이전 인덱싱 취소
		this._cancellation?.cancel();
		this._cancellation = new CancellationTokenSource();
		const cancellation = token || this._cancellation.token;

		this._indexedCount = 0;
		index.clear();

		await this.indexDirectory(workspaceUri, workspaceUri, index, cancellation);
		return this._indexedCount;
	}

	/**
	 * 현재 인덱싱 취소
	 */
	cancelIndexing(): void {
		this._cancellation?.cancel();
	}

	override dispose(): void {
		this._cancellation?.cancel();
		this._cancellation?.dispose();
		super.dispose();
	}

	// ========== Private ==========

	/**
	 * 디렉토리 재귀 순회
	 */
	private async indexDirectory(
		dirUri: URI,
		rootUri: URI,
		index: BM25Index,
		token: CancellationToken
	): Promise<void> {
		if (token.isCancellationRequested || this._indexedCount >= MAX_FILES) {
			return;
		}

		let stat: IFileStatWithMetadata;
		try {
			stat = await this.fileService.resolve(dirUri, { resolveMetadata: true });
		} catch {
			return;
		}

		if (!stat.children) {
			return;
		}

		for (const child of stat.children) {
			if (token.isCancellationRequested || this._indexedCount >= MAX_FILES) {
				return;
			}

			const name = child.name;

			if (child.isDirectory) {
				// 제외 디렉토리 스킵
				if (EXCLUDE_PATTERNS.has(name) || name.startsWith('.')) {
					continue;
				}
				await this.indexDirectory(child.resource, rootUri, index, token);
			} else {
				await this.indexFile(child.resource, rootUri, child.size, index, token);
			}
		}
	}

	/**
	 * 단일 파일 인덱싱
	 */
	private async indexFile(
		fileUri: URI,
		rootUri: URI,
		size: number | undefined,
		index: BM25Index,
		token: CancellationToken
	): Promise<void> {
		if (token.isCancellationRequested) {
			return;
		}

		// 확장자 체크
		const path = fileUri.path;
		const dotIndex = path.lastIndexOf('.');
		if (dotIndex === -1) {
			return;
		}
		const ext = path.substring(dotIndex).toLowerCase();
		if (!INDEXABLE_EXTENSIONS.has(ext)) {
			return;
		}

		// 파일 크기 체크
		if (size && size > MAX_FILE_SIZE) {
			return;
		}

		try {
			const content = await this.fileService.readFile(fileUri);
			const text = content.value.toString();

			// 비어있으면 스킵
			if (text.length === 0) {
				return;
			}

			// 상대 경로 생성
			const rootPath = rootUri.path.endsWith('/') ? rootUri.path : rootUri.path + '/';
			const relativePath = fileUri.path.startsWith(rootPath)
				? fileUri.path.substring(rootPath.length)
				: fileUri.path;

			// 파일 경로도 인덱스 텍스트에 포함 (경로 기반 검색도 가능하도록)
			const indexText = `${relativePath}\n${text}`;

			index.addDocument(fileUri.toString(), indexText);
			this._indexedCount++;
		} catch {
			// 읽기 실패 시 무시
		}
	}
}
