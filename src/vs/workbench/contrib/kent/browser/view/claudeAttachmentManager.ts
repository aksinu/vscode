/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, append, addDisposableListener, EventType } from '../../../../../base/browser/dom.js';
import { Codicon } from '../../../../../base/common/codicons.js';
import { ThemeIcon } from '../../../../../base/common/themables.js';
import { Disposable, IDisposable } from '../../../../../base/common/lifecycle.js';
import { URI } from '../../../../../base/common/uri.js';
import { generateUuid } from '../../../../../base/common/uuid.js';
import { basename } from '../../../../../base/common/resources.js';
import { localize } from '../../../../../nls.js';
import { IFileService } from '../../../../../platform/files/common/files.js';
import { INotificationService } from '../../../../../platform/notification/common/notification.js';
import { IClaudeAttachment } from '../../common/claudeTypes.js';

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

			this.notificationService.info(localize('fileAttached', "Attached: {0}", attachment.name));
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

			this.notificationService.info(localize('imagePasted', "Image pasted: {0}", fileName));
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
		this.notificationService.info(localize('workspaceAttached', "Workspace context attached"));
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
		if (!dataTransfer) return;

		// VS Code 내부 드래그 (탐색기에서)
		const uriList = dataTransfer.getData('text/uri-list');
		if (uriList) {
			const uris = uriList.split('\n').filter(line => line.trim() && !line.startsWith('#'));
			for (const uriStr of uris) {
				try {
					const uri = URI.parse(uriStr.trim());
					await this.addFile(uri);
				} catch {
					// 무효한 URI 무시
				}
			}
			return;
		}

		// 외부 파일 드롭
		if (dataTransfer.files && dataTransfer.files.length > 0) {
			for (let i = 0; i < dataTransfer.files.length; i++) {
				const file = dataTransfer.files[i];
				const filePath = (file as File & { path?: string }).path;
				if (filePath) {
					const uri = URI.file(filePath);
					await this.addFile(uri);
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

			// 아이콘
			const icon = append(tag, $('.claude-attachment-icon'));
			let iconClass = Codicon.file;
			if (attachment.type === 'folder') {
				iconClass = Codicon.folder;
			} else if (attachment.type === 'workspace') {
				iconClass = Codicon.folderLibrary;
			} else if (attachment.type === 'image') {
				iconClass = Codicon.fileMedia;
			}
			icon.classList.add(...ThemeIcon.asClassNameArray(iconClass));

			// 파일명
			const name = append(tag, $('.claude-attachment-name'));
			name.textContent = attachment.name;
			name.title = attachment.uri?.fsPath || attachment.name;

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
