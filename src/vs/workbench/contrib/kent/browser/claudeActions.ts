/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { KeyCode, KeyMod } from '../../../../base/common/keyCodes.js';
import { localize2 } from '../../../../nls.js';
import { Action2, MenuId, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { ContextKeyExpr } from '../../../../platform/contextkey/common/contextkey.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { KeybindingWeight } from '../../../../platform/keybinding/common/keybindingsRegistry.js';
import { IViewsService } from '../../../services/views/common/viewsService.js';
import { IClaudeService } from '../common/claude.js';
import { CONTEXT_CLAUDE_PANEL_FOCUSED, CONTEXT_CLAUDE_REQUEST_IN_PROGRESS } from '../common/claudeContextKeys.js';
import { ClaudeChatViewPane } from './claudeChatView.js';

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

// ========== 액션 등록 ==========

export function registerClaudeActions(): void {
	registerAction2(OpenClaudeChatAction);
	registerAction2(ClearClaudeChatAction);
	registerAction2(CancelClaudeRequestAction);
	registerAction2(NewClaudeSessionAction);
	registerAction2(FocusClaudeInputAction);
}
