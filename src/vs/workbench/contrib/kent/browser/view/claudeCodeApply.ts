/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, IDisposable } from '../../../../../base/common/lifecycle.js';
import { ICodeEditor } from '../../../../../editor/browser/editorBrowser.js';
import { IModelService } from '../../../../../editor/common/services/model.js';
import { localize } from '../../../../../nls.js';
import { INotificationService } from '../../../../../platform/notification/common/notification.js';
import { IQuickInputService, IQuickPickItem } from '../../../../../platform/quickinput/common/quickInput.js';
import { IEditorService } from '../../../../services/editor/common/editorService.js';
import { ITextModelService } from '../../../../../editor/common/services/resolverService.js';
import { URI } from '../../../../../base/common/uri.js';
import { Range } from '../../../../../editor/common/core/range.js';
import { basename } from '../../../../../base/common/resources.js';

/**
 * CodeApplyManager 콜백 인터페이스
 */
export interface ICodeApplyCallbacks {
	registerDisposable<T extends IDisposable>(disposable: T): T;
}

/**
 * 코드 적용 매니저
 * Claude가 생성한 코드를 에디터에 적용하는 기능 담당
 */
export class CodeApplyManager extends Disposable {

	constructor(
		private readonly editorService: IEditorService,
		private readonly notificationService: INotificationService,
		private readonly quickInputService: IQuickInputService,
		private readonly modelService: IModelService,
		private readonly textModelService: ITextModelService,
		private readonly callbacks: ICodeApplyCallbacks
	) {
		super();
	}

	/**
	 * 코드 적용 (QuickPick으로 방식 선택)
	 */
	async apply(code: string, _language: string): Promise<void> {
		const editor = this.editorService.activeTextEditorControl;
		if (!editor || !('getModel' in editor)) {
			this.notificationService.info(localize('noActiveEditor', "No active editor to apply code"));
			return;
		}

		const codeEditor = editor as ICodeEditor;
		const model = codeEditor.getModel();
		const selection = codeEditor.getSelection();

		if (!model || !selection) {
			return;
		}

		// 선택 영역이 없으면 전체 파일로 처리
		const hasSelection = !selection.isEmpty();
		const targetRange = hasSelection ? selection : model.getFullModelRange();
		const originalText = model.getValueInRange(targetRange);

		// 변경사항이 없으면 알림
		if (originalText === code) {
			this.notificationService.info(localize('noChanges', "No changes to apply"));
			return;
		}

		// QuickPick으로 적용 방식 선택
		interface IApplyQuickPickItem extends IQuickPickItem {
			id: string;
		}

		const items: IApplyQuickPickItem[] = [
			{
				id: 'preview',
				label: '$(diff) ' + localize('previewDiff', "Preview Diff"),
				description: localize('previewDiffDesc', "Review changes before applying")
			},
			{
				id: 'apply',
				label: '$(check) ' + localize('applyDirectly', "Apply Directly"),
				description: localize('applyDirectlyDesc', "Apply changes immediately")
			}
		];

		const selected = await this.quickInputService.pick(items, {
			placeHolder: localize('selectApplyMethod', "How would you like to apply the code?")
		});

		if (!selected) {
			return;
		}

		const selectedItem = selected as IApplyQuickPickItem;

		if (selectedItem.id === 'apply') {
			// 바로 적용
			this.executeApply(codeEditor, targetRange, code);
		} else {
			// Diff 미리보기
			await this.showDiffPreview(model.uri, targetRange, originalText, code);
		}
	}

	// ========== Private Methods ==========

	/**
	 * 에디터에 코드 직접 적용
	 */
	private executeApply(editor: ICodeEditor, range: Range, code: string): void {
		editor.executeEdits('claude-apply', [{
			range,
			text: code,
			forceMoveMarkers: true
		}]);
		editor.focus();
		this.notificationService.info(localize('codeApplied', "Code applied to editor"));
	}

	/**
	 * Diff 미리보기 표시
	 */
	private async showDiffPreview(uri: URI, range: Range, originalText: string, modifiedText: string): Promise<void> {
		// 임시 URI 생성
		const originalUri = uri.with({ scheme: 'claude-diff-original', query: `range=${range.startLineNumber}-${range.endLineNumber}` });
		const modifiedUri = uri.with({ scheme: 'claude-diff-modified', query: `range=${range.startLineNumber}-${range.endLineNumber}` });

		// 텍스트 콘텐츠 프로바이더에 등록
		const originalDisposable = this.textModelService.registerTextModelContentProvider('claude-diff-original', {
			provideTextContent: async () => {
				return this.modelService.createModel(originalText, null, originalUri);
			}
		});

		const modifiedDisposable = this.textModelService.registerTextModelContentProvider('claude-diff-modified', {
			provideTextContent: async () => {
				return this.modelService.createModel(modifiedText, null, modifiedUri);
			}
		});

		this.callbacks.registerDisposable(originalDisposable);
		this.callbacks.registerDisposable(modifiedDisposable);

		// Diff 에디터 열기
		const fileName = basename(uri);
		await this.editorService.openEditor({
			original: { resource: originalUri },
			modified: { resource: modifiedUri },
			label: localize('diffLabel', "Claude: {0} (Preview)", fileName),
			description: localize('diffDescription', "Review changes and use 'Accept' to apply")
		});

		// Accept/Reject 버튼을 위한 알림 표시
		await this.notificationService.prompt(
			2, // Info severity
			localize('diffPreviewPrompt', "Review the changes in the diff editor. Do you want to apply them?"),
			[
				{
					label: localize('accept', "Accept"),
					run: () => {
						// 원본 파일에 적용
						this.applyDiffChanges(uri, range, modifiedText);
					}
				},
				{
					label: localize('reject', "Reject"),
					run: () => {
						this.notificationService.info(localize('changesRejected', "Changes rejected"));
					}
				}
			]
		);

		// 정리
		originalDisposable.dispose();
		modifiedDisposable.dispose();
	}

	/**
	 * Diff 변경사항 적용
	 */
	private async applyDiffChanges(uri: URI, range: Range, modifiedText: string): Promise<void> {
		// 원본 파일 열기
		const editor = await this.editorService.openEditor({ resource: uri });
		if (!editor) {
			return;
		}

		const control = editor.getControl();
		if (control && 'getModel' in control) {
			const codeEditor = control as ICodeEditor;
			this.executeApply(codeEditor, range, modifiedText);
		}
	}
}
