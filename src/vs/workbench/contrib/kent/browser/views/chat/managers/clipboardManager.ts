/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../../../../base/common/uri.js';
import { IEditorService } from '../../../../../../services/editor/common/editorService.js';
import { AttachmentManager } from '../claudeAttachmentManager.js';

/**
 * 클립보드 처리 매니저
 * 책임: 붙여넣기 처리, 이미지/코드 참조 변환
 */
export class ClipboardManager {

	constructor(
		private readonly attachmentManager: AttachmentManager,
		private readonly editorService: IEditorService
	) {}

	/**
	 * 붙여넣기 이벤트 처리
	 */
	async handlePaste(e: ClipboardEvent): Promise<boolean> {
		const clipboardData = e.clipboardData;
		if (!clipboardData) {
			return false;
		}

		// 1. 이미지 파일 체크 (동기적으로 먼저 확인)
		let imageFile: File | null = null;

		// DataTransferItemList에서 이미지 찾기
		for (const item of clipboardData.items) {
			if (item.type.startsWith('image/')) {
				imageFile = item.getAsFile();
				break;
			}
		}

		// FileList에서 이미지 찾기 (일부 브라우저)
		if (!imageFile) {
			for (const file of clipboardData.files) {
				if (file.type.startsWith('image/')) {
					imageFile = file;
					break;
				}
			}
		}

		// 이미지가 있으면 즉시 기본 동작 차단 (텍스트 삽입 방지)
		if (imageFile) {
			e.preventDefault();
			e.stopPropagation();
			// 비동기 작업은 이벤트 차단 후 수행
			await this.attachmentManager.addImage(imageFile);
			return true;
		}

		// 2. VS Code 에디터에서 복사한 코드인지 확인 (코드 참조 기능)
		const vsCodeData = clipboardData.getData('vscode-editor-data');
		if (vsCodeData) {
			try {
				const metadata = JSON.parse(vsCodeData);
				const plainText = clipboardData.getData('text/plain');

				// 코드 참조로 변환할 수 있는지 확인
				if (this.tryAddCodeReference(metadata, plainText)) {
					e.preventDefault();
					e.stopPropagation();
					return true;
				}
			} catch {
				// 파싱 실패 시 기본 텍스트 붙여넣기
			}
		}

		// 3. 일반 텍스트는 기본 동작 유지
		return false;
	}

	/**
	 * VS Code 에디터 메타데이터에서 코드 참조 생성 시도
	 * @returns 코드 참조로 변환 성공 여부
	 */
	tryAddCodeReference(metadata: unknown, content: string): boolean {
		// VS Code 클립보드 메타데이터 구조 확인
		if (!metadata || typeof metadata !== 'object') {
			return false;
		}

		const meta = metadata as Record<string, unknown>;

		// mode (언어 ID)가 있어야 에디터에서 복사한 것
		if (!meta.mode || typeof meta.mode !== 'string') {
			return false;
		}

		// 현재 활성 에디터에서 선택 영역 정보 가져오기
		const activeEditor = this.editorService.activeTextEditorControl;
		if (!activeEditor || !('getModel' in activeEditor) || !('getSelection' in activeEditor)) {
			return false;
		}

		const model = (activeEditor as { getModel: () => { uri?: URI } | null }).getModel();
		const selection = (activeEditor as { getSelection: () => { startLineNumber: number; endLineNumber: number } | null }).getSelection();

		if (!model?.uri || !selection) {
			return false;
		}

		// 파일 경로와 라인 범위 추출
		const filePath = model.uri.fsPath;
		const fileName = filePath.split(/[/\\]/).pop() || filePath;
		const startLine = selection.startLineNumber;
		const endLine = selection.endLineNumber;

		// 코드 참조로 첨부
		this.attachmentManager.addCodeReference?.({
			type: 'code-reference',
			filePath,
			fileName,
			startLine,
			endLine,
			content,
			languageId: meta.mode as string
		});

		return true;
	}
}
