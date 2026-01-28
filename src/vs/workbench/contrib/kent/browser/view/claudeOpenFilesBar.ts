/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, append, addDisposableListener, EventType } from '../../../../../base/browser/dom.js';
import { IDisposable } from '../../../../../base/common/lifecycle.js';
import { URI } from '../../../../../base/common/uri.js';
import { basename } from '../../../../../base/common/resources.js';
import { IEditorService } from '../../../../services/editor/common/editorService.js';

/**
 * OpenFilesBar 콜백 인터페이스
 */
export interface IOpenFilesBarCallbacks {
	isFileAttached(uri: URI): boolean;
	onFileClick(uri: URI): Promise<void>;
	registerDisposable<T extends IDisposable>(disposable: T): T;
}

/**
 * 열린 파일 버튼 바 매니저
 * 현재 열린 에디터 파일들을 버튼으로 표시하고 첨부 기능 제공
 */
export class OpenFilesBar {

	constructor(
		private readonly container: HTMLElement,
		private readonly editorService: IEditorService,
		private readonly callbacks: IOpenFilesBarCallbacks
	) { }

	/**
	 * 열린 파일 UI 업데이트
	 */
	update(): void {
		// 초기화 전이면 무시
		if (!this.container) {
			console.log('[OpenFilesBar] No container');
			return;
		}

		// 기존 UI 초기화
		while (this.container.firstChild) {
			this.container.removeChild(this.container.firstChild);
		}

		// 열린 에디터 목록 가져오기
		const openEditors = this.editorService.editors;
		const uniqueFiles = new Map<string, URI>();

		console.log('[OpenFilesBar] Total editors:', openEditors.length);

		for (const editor of openEditors) {
			const resource = editor.resource;
			console.log('[OpenFilesBar] Editor resource:', resource?.toString(), 'scheme:', resource?.scheme);
			if (resource && resource.scheme === 'file') {
				const key = resource.toString();
				if (!uniqueFiles.has(key)) {
					uniqueFiles.set(key, resource);
				}
			}
		}

		console.log('[OpenFilesBar] Unique files:', uniqueFiles.size);

		// 열린 파일이 없으면 숨김
		if (uniqueFiles.size === 0) {
			this.container.style.display = 'none';
			return;
		}

		this.container.style.display = 'flex';

		// 각 파일에 대해 버튼 생성
		for (const [, uri] of uniqueFiles) {
			this.createFileButton(uri);
		}
	}

	// ========== Private Methods ==========

	private createFileButton(uri: URI): void {
		const fileName = basename(uri);

		// 이미 첨부된 파일인지 확인
		const isAttached = this.callbacks.isFileAttached(uri);

		const button = append(this.container, $('button.claude-open-file-button')) as HTMLButtonElement;
		button.title = uri.fsPath;

		if (isAttached) {
			button.classList.add('attached');
			button.disabled = true;
		}

		// + 아이콘
		const plusIcon = append(button, $('span.claude-open-file-plus'));
		plusIcon.textContent = '+';

		// 파일명
		const nameSpan = append(button, $('span.claude-open-file-name'));
		nameSpan.textContent = fileName;

		if (!isAttached) {
			this.callbacks.registerDisposable(addDisposableListener(button, EventType.CLICK, async () => {
				await this.callbacks.onFileClick(uri);
				this.update(); // 버튼 상태 업데이트
			}));
		}
	}
}
