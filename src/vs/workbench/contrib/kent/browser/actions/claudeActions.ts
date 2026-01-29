/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Schemas } from '../../../../../base/common/network.js';
import { KeyCode, KeyMod } from '../../../../../base/common/keyCodes.js';
import { URI } from '../../../../../base/common/uri.js';
import { localize2 } from '../../../../../nls.js';
import { Action2, MenuId, registerAction2 } from '../../../../../platform/actions/common/actions.js';
import { ContextKeyExpr } from '../../../../../platform/contextkey/common/contextkey.js';
import { ServicesAccessor } from '../../../../../platform/instantiation/common/instantiation.js';
import { KeybindingWeight } from '../../../../../platform/keybinding/common/keybindingsRegistry.js';
import { IViewsService } from '../../../../services/views/common/viewsService.js';
import { IEditorService } from '../../../../services/editor/common/editorService.js';
import { IExplorerService } from '../../../files/browser/files.js';
import { ExplorerFolderContext } from '../../../files/common/files.js';
import { ResourceContextKey } from '../../../../common/contextkeys.js';
import { EditorContextKeys } from '../../../../../editor/common/editorContextKeys.js';
import { IClaudeService } from '../../common/claude.js';
import { CONTEXT_CLAUDE_PANEL_FOCUSED, CONTEXT_CLAUDE_REQUEST_IN_PROGRESS } from '../../common/claudeContextKeys.js';
import { ClaudeChatViewPane } from '../view/claudeChatView.js';

// ========== 채팅창 열기 ==========

export class OpenClaudeChatAction extends Action2 {
	static readonly ID = 'claude.openChat';

	constructor() {
		super({
			id: OpenClaudeChatAction.ID,
			title: localize2('openClaudeChat', "Open Claude Chat"),
			category: localize2('claude', "Claude"),
			f1: true,
			keybinding: {
				weight: KeybindingWeight.WorkbenchContrib,
				primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KeyC
			}
		});
	}

	override async run(accessor: ServicesAccessor): Promise<void> {
		const viewsService = accessor.get(IViewsService);
		await viewsService.openView(ClaudeChatViewPane.ID, true);
	}
}

// ========== 대화 초기화 ==========

export class ClearClaudeChatAction extends Action2 {
	static readonly ID = 'claude.clearChat';

	constructor() {
		super({
			id: ClearClaudeChatAction.ID,
			title: localize2('clearClaudeChat', "Clear Claude Chat"),
			category: localize2('claude', "Claude"),
			f1: true
			// 메뉴에서 제거 - New Session과 기능 중복
		});
	}

	override run(accessor: ServicesAccessor): void {
		const claudeService = accessor.get(IClaudeService);
		claudeService.clearHistory();
	}
}

// ========== 요청 취소 ==========

export class CancelClaudeRequestAction extends Action2 {
	static readonly ID = 'claude.cancelRequest';

	constructor() {
		super({
			id: CancelClaudeRequestAction.ID,
			title: localize2('cancelClaudeRequest', "Cancel Claude Request"),
			category: localize2('claude', "Claude"),
			f1: true,
			keybinding: {
				weight: KeybindingWeight.WorkbenchContrib,
				primary: KeyCode.Escape,
				when: ContextKeyExpr.and(CONTEXT_CLAUDE_PANEL_FOCUSED, CONTEXT_CLAUDE_REQUEST_IN_PROGRESS)
			}
		});
	}

	override run(accessor: ServicesAccessor): void {
		const claudeService = accessor.get(IClaudeService);
		claudeService.cancelRequest();
	}
}

// ========== 새 세션 ==========

export class NewClaudeSessionAction extends Action2 {
	static readonly ID = 'claude.newSession';

	constructor() {
		super({
			id: NewClaudeSessionAction.ID,
			title: localize2('newSession', "New Session"),
			category: localize2('claude', "Claude"),
			f1: true,
			menu: {
				id: MenuId.ViewTitle,
				when: ContextKeyExpr.equals('view', ClaudeChatViewPane.ID),
				group: 'navigation',
				order: 1
			}
		});
	}

	override run(accessor: ServicesAccessor): void {
		const claudeService = accessor.get(IClaudeService);
		claudeService.startNewSession();
	}
}

// ========== 입력창 포커스 ==========

export class FocusClaudeInputAction extends Action2 {
	static readonly ID = 'claude.focusInput';

	constructor() {
		super({
			id: FocusClaudeInputAction.ID,
			title: localize2('focusClaudeInput', "Focus Claude Input"),
			category: localize2('claude', "Claude"),
			f1: true,
			keybinding: {
				weight: KeybindingWeight.WorkbenchContrib,
				primary: KeyMod.CtrlCmd | KeyCode.KeyL,
				when: CONTEXT_CLAUDE_PANEL_FOCUSED
			}
		});
	}

	override async run(accessor: ServicesAccessor): Promise<void> {
		const viewsService = accessor.get(IViewsService);
		const view = await viewsService.openView(ClaudeChatViewPane.ID, true);
		if (view) {
			view.focus();
		}
	}
}

// ========== 파일 첨부 (Explorer 컨텍스트 메뉴) ==========

export class AttachFileToClaude extends Action2 {
	static readonly ID = 'claude.attachFile';

	constructor() {
		super({
			id: AttachFileToClaude.ID,
			title: localize2('claude.attachFile', "Add to Claude"),
			category: localize2('claude', "Claude"),
			f1: false,
			menu: [{
				id: MenuId.ExplorerContext,
				group: '5_claude',
				order: 1,
				when: ContextKeyExpr.and(
					ExplorerFolderContext.negate(),
					ContextKeyExpr.or(
						ResourceContextKey.Scheme.isEqualTo(Schemas.file),
						ResourceContextKey.Scheme.isEqualTo(Schemas.vscodeRemote)
					)
				)
			}]
		});
	}

	override async run(accessor: ServicesAccessor, resource?: URI): Promise<void> {
		const viewsService = accessor.get(IViewsService);
		const explorerService = accessor.get(IExplorerService);

		// Explorer에서 선택된 파일들 가져오기
		let files: URI[] = [];
		if (resource) {
			files = [resource];
		} else {
			const selection = explorerService.getContext(true);
			files = selection.map(item => item.resource);
		}

		if (files.length === 0) {
			return;
		}

		// Claude 패널 열기
		const view = await viewsService.openView(ClaudeChatViewPane.ID, true) as ClaudeChatViewPane | undefined;
		if (view) {
			view.attachFiles(files);
		}
	}
}

// ========== 폴더 첨부 (Explorer 컨텍스트 메뉴) ==========

export class AttachFolderToClaude extends Action2 {
	static readonly ID = 'claude.attachFolder';

	constructor() {
		super({
			id: AttachFolderToClaude.ID,
			title: localize2('claude.attachFolder', "Add Folder to Claude"),
			category: localize2('claude', "Claude"),
			f1: false,
			menu: [{
				id: MenuId.ExplorerContext,
				group: '5_claude',
				order: 2,
				when: ContextKeyExpr.and(
					ExplorerFolderContext,
					ContextKeyExpr.or(
						ResourceContextKey.Scheme.isEqualTo(Schemas.file),
						ResourceContextKey.Scheme.isEqualTo(Schemas.vscodeRemote)
					)
				)
			}]
		});
	}

	override async run(accessor: ServicesAccessor, resource?: URI): Promise<void> {
		const viewsService = accessor.get(IViewsService);
		const explorerService = accessor.get(IExplorerService);

		// Explorer에서 선택된 폴더 가져오기
		let folders: URI[] = [];
		if (resource) {
			folders = [resource];
		} else {
			const selection = explorerService.getContext(true);
			folders = selection.filter(item => item.isDirectory).map(item => item.resource);
		}

		if (folders.length === 0) {
			return;
		}

		// Claude 패널 열기
		const view = await viewsService.openView(ClaudeChatViewPane.ID, true) as ClaudeChatViewPane | undefined;
		if (view) {
			view.attachFiles(folders);
		}
	}
}

// ========== 선택 영역 Claude에게 질문 (Editor 컨텍스트 메뉴) ==========

export class AskClaudeAboutSelection extends Action2 {
	static readonly ID = 'claude.askAboutSelection';

	constructor() {
		super({
			id: AskClaudeAboutSelection.ID,
			title: localize2('claude.askAboutSelection', "Ask Claude About Selection"),
			category: localize2('claude', "Claude"),
			f1: true,
			keybinding: {
				weight: KeybindingWeight.WorkbenchContrib,
				primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KeyA,
				when: EditorContextKeys.hasNonEmptySelection
			},
			menu: [{
				id: MenuId.EditorContext,
				group: '1_claude',
				order: 1,
				when: EditorContextKeys.hasNonEmptySelection
			}]
		});
	}

	override async run(accessor: ServicesAccessor): Promise<void> {
		const viewsService = accessor.get(IViewsService);
		const editorService = accessor.get(IEditorService);

		// 현재 에디터에서 선택 영역 가져오기
		const editor = editorService.activeTextEditorControl;
		if (!editor) {
			return;
		}

		const model = editor.getModel();
		const selection = editor.getSelection();

		if (!model || !selection || selection.isEmpty()) {
			return;
		}

		const selectedText = model.getValueInRange(selection);
		const fileName = editorService.activeEditor?.getName() || 'unknown';

		// Claude 패널 열기
		const view = await viewsService.openView(ClaudeChatViewPane.ID, true) as ClaudeChatViewPane | undefined;
		if (view) {
			view.setInputWithContext(selectedText, fileName);
		}
	}
}

// ========== 현재 파일 Claude에 첨부 (Editor 컨텍스트 메뉴) ==========

export class AttachCurrentFileToClaude extends Action2 {
	static readonly ID = 'claude.attachCurrentFile';

	constructor() {
		super({
			id: AttachCurrentFileToClaude.ID,
			title: localize2('claude.attachCurrentFile', "Add File to Claude"),
			category: localize2('claude', "Claude"),
			f1: true,
			menu: [{
				id: MenuId.EditorContext,
				group: '1_claude',
				order: 2,
				when: ContextKeyExpr.and(
					EditorContextKeys.hasNonEmptySelection.negate(),
					ContextKeyExpr.or(
						ResourceContextKey.Scheme.isEqualTo(Schemas.file),
						ResourceContextKey.Scheme.isEqualTo(Schemas.vscodeRemote),
						ResourceContextKey.Scheme.isEqualTo(Schemas.untitled)
					)
				)
			}, {
				id: MenuId.EditorTitleContext,
				group: '2_claude',
				order: 1,
				when: ContextKeyExpr.or(
					ResourceContextKey.Scheme.isEqualTo(Schemas.file),
					ResourceContextKey.Scheme.isEqualTo(Schemas.vscodeRemote)
				)
			}]
		});
	}

	override async run(accessor: ServicesAccessor, resource?: URI): Promise<void> {
		const viewsService = accessor.get(IViewsService);
		const editorService = accessor.get(IEditorService);

		// 리소스 결정
		let fileUri: URI | undefined = resource;
		if (!fileUri) {
			const activeEditor = editorService.activeEditor;
			fileUri = activeEditor?.resource;
		}

		if (!fileUri) {
			return;
		}

		// Claude 패널 열기
		const view = await viewsService.openView(ClaudeChatViewPane.ID, true) as ClaudeChatViewPane | undefined;
		if (view) {
			view.attachFiles([fileUri]);
		}
	}
}

// ========== 액션 등록 ==========

export function registerClaudeActions(): void {
	registerAction2(OpenClaudeChatAction);
	registerAction2(ClearClaudeChatAction);
	registerAction2(CancelClaudeRequestAction);
	registerAction2(NewClaudeSessionAction);
	registerAction2(FocusClaudeInputAction);
	// 컨텍스트 메뉴 액션
	registerAction2(AttachFileToClaude);
	registerAction2(AttachFolderToClaude);
	registerAction2(AskClaudeAboutSelection);
	registerAction2(AttachCurrentFileToClaude);
}
