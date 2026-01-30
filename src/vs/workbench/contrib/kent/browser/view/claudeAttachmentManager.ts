/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, append, addDisposableListener, EventType } from '../../../../../base/browser/dom.js';
import { DataTransfers } from '../../../../../base/browser/dnd.js';
import { Codicon } from '../../../../../base/common/codicons.js';
import { ThemeIcon } from '../../../../../base/common/themables.js';
import { Disposable, IDisposable } from '../../../../../base/common/lifecycle.js';
import { URI } from '../../../../../base/common/uri.js';
import { generateUuid } from '../../../../../base/common/uuid.js';
import { basename } from '../../../../../base/common/resources.js';
import { localize } from '../../../../../nls.js';
import { IFileService } from '../../../../../platform/files/common/files.js';
import { INotificationService } from '../../../../../platform/notification/common/notification.js';
import { IClaudeAttachment, IClaudeCodeReference } from '../../common/claudeTypes.js';
import { CodeDataTransfers, getPathForFile } from '../../../../../platform/dnd/browser/dnd.js';

/**
 * AttachmentManager 콜백 인터페이스
 */
export interface IAttachmentManagerCallbacks {
	onAttachmentsChanged(): void;
	registerDisposable<T extends IDisposable>(disposable: T): T;
}

/**
 * 첨부파일 관리자
 * 파일 첨부, 이미지 붙여넣기, 드래그/드롭 처리
 */
export class AttachmentManager extends Disposable {

	private readonly _attachments: IClaudeAttachment[] = [];
	private readonly container: HTMLElement;
	private readonly dropOverlay: HTMLElement;

	constructor(
		attachmentsContainer: HTMLElement,
		dropOverlay: HTMLElement,
		private readonly fileService: IFileService,
		private readonly notificationService: INotificationService,
		private readonly callbacks: IAttachmentManagerCallbacks
	) {
		super();
		this.container = attachmentsContainer;
		this.dropOverlay = dropOverlay;
	}

	/**
	 * 현재 첨부파일 목록
	 */
	get attachments(): readonly IClaudeAttachment[] {
		return this._attachments;
	}

	/**
	 * 첨부파일 개수
	 */
	get count(): number {
		return this._attachments.length;
	}

	/**
	 * 파일 첨부 추가
	 */
	async addFile(uri: URI): Promise<void> {
		// 중복 체크
		if (this._attachments.some(a => a.uri?.toString() === uri.toString())) {
			this.notificationService.info(localize('fileAlreadyAttached', "File is already attached"));
			return;
		}

		try {
			const stat = await this.fileService.stat(uri);
			const isDirectory = stat.isDirectory;

			// 파일 내용 읽기 (디렉토리가 아닌 경우)
			let content: string | undefined;
			if (!isDirectory) {
				try {
					const fileContent = await this.fileService.readFile(uri);
					content = fileContent.value.toString();

					// 너무 큰 파일은 내용을 자름
					if (content.length > 50000) {
						content = content.substring(0, 50000) + '\n... (truncated)';
					}
				} catch {
					// 바이너리 파일 등
					content = undefined;
				}
			}

			const attachment: IClaudeAttachment = {
				id: generateUuid(),
				type: isDirectory ? 'folder' : 'file',
				uri,
				name: basename(uri),
				content
			};

			this._attachments.push(attachment);
			this.updateUI();
			// 알림 제거 - 첨부 태그가 UI에 표시되므로 별도 알림 불필요
		} catch (error) {
			this.notificationService.error(localize('attachError', "Failed to attach file: {0}", (error as Error).message));
		}
	}

	/**
	 * 이미지 첨부 (붙여넣기)
	 */
	async addImage(file: File): Promise<void> {
		try {
			console.log('[AttachmentManager] Adding image:', file.name, file.type, file.size);

			const base64 = await this.fileToBase64(file);

			const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
			const extension = file.type.split('/')[1] || 'png';
			const fileName = `screenshot-${timestamp}.${extension}`;

			const attachment: IClaudeAttachment = {
				id: generateUuid(),
				type: 'image',
				name: fileName,
				content: `[Image: ${fileName}] (${Math.round(file.size / 1024)}KB)`,
				imageData: base64,
				mimeType: file.type
			};

			this._attachments.push(attachment);
			this.updateUI();
			// 알림 제거 - 첨부 태그가 UI에 표시되므로 별도 알림 불필요
		} catch (error) {
			console.error('[AttachmentManager] Failed to add image:', error);
			this.notificationService.error(localize('imagePasteError', "Failed to paste image: {0}", (error as Error).message));
		}
	}

	/**
	 * 워크스페이스 컨텍스트 첨부
	 */
	addWorkspace(name: string, uri: URI): void {
		const attachment: IClaudeAttachment = {
			id: generateUuid(),
			type: 'workspace',
			uri,
			name: `Workspace: ${name}`,
			content: `Workspace: ${name}\nPath: ${uri.fsPath}`
		};

		this._attachments.push(attachment);
		this.updateUI();
		// 알림 제거 - 첨부 태그가 UI에 표시되므로 별도 알림 불필요
	}

	/**
	 * 코드 참조 첨부 (에디터에서 복사한 코드)
	 */
	addCodeReference(ref: IClaudeCodeReference): void {
		// 같은 파일의 같은 범위가 이미 첨부되어 있는지 확인
		const existing = this._attachments.find(a =>
			a.type === 'code-reference' &&
			a.codeReference?.filePath === ref.filePath &&
			a.codeReference?.startLine === ref.startLine &&
			a.codeReference?.endLine === ref.endLine
		);

		if (existing) {
			this.notificationService.info(localize('codeReferenceAlreadyAttached', "Code reference already attached"));
			return;
		}

		const lineRange = ref.startLine === ref.endLine
			? `L${ref.startLine}`
			: `L${ref.startLine}-${ref.endLine}`;

		const attachment: IClaudeAttachment = {
			id: generateUuid(),
			type: 'code-reference',
			name: `${ref.fileName} (${lineRange})`,
			content: ref.content,
			codeReference: ref
		};

		this._attachments.push(attachment);
		this.updateUI();
		// 알림 제거 - 첨부 태그가 UI에 표시되므로 별도 알림 불필요
	}

	/**
	 * 첨부파일 제거
	 */
	remove(id: string): void {
		const index = this._attachments.findIndex(a => a.id === id);
		if (index !== -1) {
			this._attachments.splice(index, 1);
			this.updateUI();
		}
	}

	/**
	 * 모든 첨부파일 제거
	 */
	clear(): void {
		this._attachments.length = 0;
		this.updateUI();
	}

	/**
	 * 첨부파일이 있는지 확인
	 */
	has(uri: URI): boolean {
		return this._attachments.some(a => a.uri?.toString() === uri.toString());
	}

	/**
	 * 드롭 이벤트 처리
	 */
	async handleDrop(e: DragEvent): Promise<void> {
		const dataTransfer = e.dataTransfer;
		if (!dataTransfer) {
			return;
		}

		const addedUris = new Set<string>(); // 중복 방지

		// 1. VS Code ResourceURLs (탐색기에서 여러 파일 드래그)
		const resourcesData = dataTransfer.getData(DataTransfers.RESOURCES);
		if (resourcesData) {
			try {
				const resources: string[] = JSON.parse(resourcesData);
				for (const resourceStr of resources) {
					if (resourceStr && resourceStr.indexOf(':') > 0) {
						const uri = URI.parse(resourceStr);
						if (!addedUris.has(uri.toString())) {
							addedUris.add(uri.toString());
							await this.addFile(uri);
						}
					}
				}
			} catch {
				// 무효한 JSON 무시
			}
		}

		// 2. CodeEditors (에디터 탭 드래그)
		const editorsData = dataTransfer.getData(CodeDataTransfers.EDITORS);
		if (editorsData) {
			try {
				const editors: Array<{ resource?: string }> = JSON.parse(editorsData);
				for (const editor of editors) {
					if (editor.resource) {
						const uri = URI.parse(editor.resource);
						if (!addedUris.has(uri.toString())) {
							addedUris.add(uri.toString());
							await this.addFile(uri);
						}
					}
				}
			} catch {
				// 무효한 JSON 무시
			}
		}

		// 3. CodeFiles (파일 경로 배열)
		const codeFilesData = dataTransfer.getData(CodeDataTransfers.FILES);
		if (codeFilesData) {
			try {
				const codeFiles: string[] = JSON.parse(codeFilesData);
				for (const filePath of codeFiles) {
					const uri = URI.file(filePath);
					if (!addedUris.has(uri.toString())) {
						addedUris.add(uri.toString());
						await this.addFile(uri);
					}
				}
			} catch {
				// 무효한 JSON 무시
			}
		}

		// 4. text/uri-list (표준 형식)
		const uriList = dataTransfer.getData('text/uri-list');
		if (uriList) {
			const uris = uriList.split('\n').filter(line => line.trim() && !line.startsWith('#'));
			for (const uriStr of uris) {
				try {
					const uri = URI.parse(uriStr.trim());
					if (!addedUris.has(uri.toString())) {
						addedUris.add(uri.toString());
						await this.addFile(uri);
					}
				} catch {
					// 무효한 URI 무시
				}
			}
		}

		// 5. 네이티브 파일 드롭 (외부에서 드래그)
		if (dataTransfer.files && dataTransfer.files.length > 0) {
			for (let i = 0; i < dataTransfer.files.length; i++) {
				const file = dataTransfer.files[i];
				const filePath = getPathForFile(file);
				if (filePath) {
					const uri = URI.file(filePath);
					if (!addedUris.has(uri.toString())) {
						addedUris.add(uri.toString());
						await this.addFile(uri);
					}
				}
			}
		}
	}

	/**
	 * 드래그 오버레이 표시
	 */
	showDropOverlay(): void {
		this.dropOverlay.classList.add('visible');
	}

	/**
	 * 드래그 오버레이 숨김
	 */
	hideDropOverlay(): void {
		this.dropOverlay.classList.remove('visible');
	}

	// ========== Private Methods ==========

	private updateUI(): void {
		// 기존 UI 초기화
		while (this.container.firstChild) {
			this.container.removeChild(this.container.firstChild);
		}

		// 콜백 호출 (열린 파일 버튼 업데이트 등)
		this.callbacks.onAttachmentsChanged();

		if (this._attachments.length === 0) {
			this.container.style.display = 'none';
			return;
		}

		this.container.style.display = 'flex';

		for (const attachment of this._attachments) {
			const tag = append(this.container, $('.claude-attachment-tag'));

			// 코드 참조는 특별한 스타일 적용
			if (attachment.type === 'code-reference') {
				tag.classList.add('code-reference');
			}

			// 아이콘
			const icon = append(tag, $('.claude-attachment-icon'));
			let iconClass = Codicon.file;
			if (attachment.type === 'folder') {
				iconClass = Codicon.folder;
			} else if (attachment.type === 'workspace') {
				iconClass = Codicon.folderLibrary;
			} else if (attachment.type === 'image') {
				iconClass = Codicon.fileMedia;
			} else if (attachment.type === 'code-reference') {
				iconClass = Codicon.code;
			}
			icon.classList.add(...ThemeIcon.asClassNameArray(iconClass));

			// 파일명
			const name = append(tag, $('.claude-attachment-name'));
			name.textContent = attachment.name;

			// 툴팁: 코드 참조인 경우 미리보기 표시
			if (attachment.type === 'code-reference' && attachment.codeReference) {
				const preview = attachment.codeReference.content.substring(0, 200);
				name.title = `${attachment.codeReference.filePath}\n\n${preview}${attachment.codeReference.content.length > 200 ? '...' : ''}`;
			} else {
				name.title = attachment.uri?.fsPath || attachment.name;
			}

			// 삭제 버튼
			const removeBtn = append(tag, $('.claude-attachment-remove'));
			removeBtn.classList.add(...ThemeIcon.asClassNameArray(Codicon.close));
			removeBtn.title = localize('removeAttachment', "Remove attachment");

			this.callbacks.registerDisposable(addDisposableListener(removeBtn, EventType.CLICK, (e) => {
				e.stopPropagation();
				this.remove(attachment.id);
			}));
		}
	}

	private fileToBase64(file: File): Promise<string> {
		return new Promise((resolve, reject) => {
			const reader = new FileReader();
			reader.onload = () => {
				const result = reader.result as string;
				const base64 = result.split(',')[1] || result;
				resolve(base64);
			};
			reader.onerror = () => reject(reader.error);
			reader.readAsDataURL(file);
		});
	}
}
