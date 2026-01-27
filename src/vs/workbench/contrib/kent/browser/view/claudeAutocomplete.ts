/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, append, addDisposableListener, EventType } from '../../../../../base/browser/dom.js';
import { DisposableStore, IDisposable } from '../../../../../base/common/lifecycle.js';
import { ICodeEditor } from '../../../../../editor/browser/editorBrowser.js';
import { localize } from '../../../../../nls.js';
import { IEditorService } from '../../../../services/editor/common/editorService.js';
import { URI } from '../../../../../base/common/uri.js';
import { basename } from '../../../../../base/common/resources.js';

/**
 * 자동완성 아이템 타입
 */
export interface IAutocompleteItem {
	id: string;
	icon: string;
	label: string;
	description?: string;
	type: 'mention' | 'command' | 'file';
	data?: unknown;
}

/**
 * 자동완성 콜백 인터페이스
 */
export interface IAutocompleteCallbacks {
	onAttachFile(uri: URI): Promise<void>;
	onAttachWorkspace(): void;
	onCommandSelected(prompt: string): void;
	registerDisposable<T extends IDisposable>(disposable: T): T;
}

/**
 * 자동완성 매니저
 * @ 멘션과 / 슬래시 커맨드를 처리
 */
export class AutocompleteManager {

	private container: HTMLElement;
	private items: IAutocompleteItem[] = [];
	private selectedIndex = 0;
	private visible = false;
	private prefix = '';
	private triggerChar = '';

	private readonly disposables = new DisposableStore();

	constructor(
		container: HTMLElement,
		private readonly inputEditor: ICodeEditor,
		private readonly editorService: IEditorService,
		private readonly callbacks: IAutocompleteCallbacks
	) {
		this.container = container;
		this.container.style.display = 'none';
	}

	/**
	 * 입력 변경 시 자동완성 체크
	 */
	check(): void {
		const position = this.inputEditor.getPosition();
		if (!position) {
			this.hide();
			return;
		}

		const model = this.inputEditor.getModel();
		if (!model) {
			this.hide();
			return;
		}

		const lineContent = model.getLineContent(position.lineNumber);
		const textBeforeCursor = lineContent.substring(0, position.column - 1);

		// @ 또는 / 패턴 찾기
		const mentionMatch = textBeforeCursor.match(/@(\w*)$/);
		const commandMatch = textBeforeCursor.match(/^\/(\w*)$/);

		if (mentionMatch) {
			this.triggerChar = '@';
			this.prefix = mentionMatch[1].toLowerCase();
			this.showMentionAutocomplete();
		} else if (commandMatch) {
			this.triggerChar = '/';
			this.prefix = commandMatch[1].toLowerCase();
			this.showCommandAutocomplete();
		} else {
			this.hide();
		}
	}

	/**
	 * 키보드 이벤트 처리
	 * @returns 이벤트가 처리되었으면 true
	 */
	handleKeyDown(keyCode: number): boolean {
		if (!this.visible) {
			return false;
		}

		switch (keyCode) {
			case 9: // Escape
				this.hide();
				return true;
			case 16: // UpArrow
				this.selectItem(this.selectedIndex - 1);
				return true;
			case 18: // DownArrow
				this.selectItem(this.selectedIndex + 1);
				return true;
			case 3: // Enter
			case 2: // Tab
				this.acceptItem();
				return true;
		}
		return false;
	}

	/**
	 * 자동완성 표시 여부
	 */
	get isVisible(): boolean {
		return this.visible;
	}

	/**
	 * 자동완성 숨기기
	 */
	hide(): void {
		this.visible = false;
		this.container.style.display = 'none';
		this.items = [];
	}

	dispose(): void {
		this.disposables.dispose();
	}

	// ========== Private Methods ==========

	private showMentionAutocomplete(): void {
		const items: IAutocompleteItem[] = [];

		// 고정 항목들
		const staticItems: IAutocompleteItem[] = [
			{
				id: 'file',
				icon: 'codicon-file-add',
				label: '@file',
				description: localize('mentionFile', "Browse and attach a file"),
				type: 'mention'
			},
			{
				id: 'workspace',
				icon: 'codicon-folder-library',
				label: '@workspace',
				description: localize('mentionWorkspace', "Include workspace context"),
				type: 'mention'
			}
		];

		// 필터링된 고정 항목
		for (const item of staticItems) {
			if (!this.prefix || item.label.toLowerCase().includes(this.prefix)) {
				items.push(item);
			}
		}

		// 열린 에디터 파일 목록
		const openEditors = this.editorService.editors;
		for (const editor of openEditors) {
			const resource = editor.resource;
			if (resource) {
				const fileName = basename(resource);
				if (!this.prefix || fileName.toLowerCase().includes(this.prefix)) {
					items.push({
						id: `file:${resource.toString()}`,
						icon: 'codicon-file',
						label: `@${fileName}`,
						description: resource.fsPath,
						type: 'file',
						data: resource
					});
				}
			}
		}

		this.show(items, localize('mentionHeader', "Mention"));
	}

	private showCommandAutocomplete(): void {
		const commands: IAutocompleteItem[] = [
			{
				id: 'explain',
				icon: 'codicon-lightbulb',
				label: '/explain',
				description: localize('cmdExplain', "Explain the selected code"),
				type: 'command'
			},
			{
				id: 'fix',
				icon: 'codicon-bug',
				label: '/fix',
				description: localize('cmdFix', "Fix bugs in the selected code"),
				type: 'command'
			},
			{
				id: 'test',
				icon: 'codicon-beaker',
				label: '/test',
				description: localize('cmdTest', "Generate tests for the code"),
				type: 'command'
			},
			{
				id: 'refactor',
				icon: 'codicon-edit',
				label: '/refactor',
				description: localize('cmdRefactor', "Refactor the selected code"),
				type: 'command'
			},
			{
				id: 'docs',
				icon: 'codicon-book',
				label: '/docs',
				description: localize('cmdDocs', "Generate documentation"),
				type: 'command'
			},
			{
				id: 'optimize',
				icon: 'codicon-rocket',
				label: '/optimize',
				description: localize('cmdOptimize', "Optimize for performance"),
				type: 'command'
			}
		];

		const filtered = commands.filter(cmd =>
			!this.prefix || cmd.label.toLowerCase().includes(this.prefix)
		);

		this.show(filtered, localize('commandHeader', "Commands"));
	}

	private show(items: IAutocompleteItem[], header: string): void {
		if (items.length === 0) {
			this.hide();
			return;
		}

		this.items = items;
		this.selectedIndex = 0;
		this.visible = true;

		// DOM 초기화
		this.clearContainer();

		// 헤더
		const headerEl = append(this.container, $('.claude-autocomplete-header'));
		headerEl.textContent = header;

		// 리스트
		const list = append(this.container, $('.claude-autocomplete-list'));

		for (let i = 0; i < items.length; i++) {
			const item = items[i];
			const itemEl = append(list, $('.claude-autocomplete-item'));
			itemEl.dataset.index = String(i);

			if (i === 0) {
				itemEl.classList.add('selected');
			}

			// 아이콘
			const iconEl = append(itemEl, $('.claude-autocomplete-item-icon'));
			append(iconEl, $(`.codicon.${item.icon}`));

			// 내용
			const contentEl = append(itemEl, $('.claude-autocomplete-item-content'));
			const labelEl = append(contentEl, $('.claude-autocomplete-item-label'));
			labelEl.textContent = item.label;

			if (item.description) {
				const descEl = append(contentEl, $('.claude-autocomplete-item-desc'));
				descEl.textContent = item.description;
			}

			// 이벤트
			this.callbacks.registerDisposable(addDisposableListener(itemEl, EventType.CLICK, () => {
				this.selectedIndex = i;
				this.acceptItem();
			}));

			this.callbacks.registerDisposable(addDisposableListener(itemEl, EventType.MOUSE_ENTER, () => {
				this.selectItem(i);
			}));
		}

		this.container.style.display = 'block';
	}

	private selectItem(index: number): void {
		if (this.items.length === 0) {
			return;
		}

		// 범위 순환
		if (index < 0) {
			index = this.items.length - 1;
		} else if (index >= this.items.length) {
			index = 0;
		}

		// 이전 선택 해제
		const prevSelected = this.container.querySelector('.claude-autocomplete-item.selected');
		if (prevSelected) {
			prevSelected.classList.remove('selected');
		}

		// 새 선택
		const newSelected = this.container.querySelector(`[data-index="${index}"]`);
		if (newSelected) {
			newSelected.classList.add('selected');
			newSelected.scrollIntoView({ block: 'nearest' });
		}

		this.selectedIndex = index;
	}

	private async acceptItem(): Promise<void> {
		const item = this.items[this.selectedIndex];
		if (!item) {
			this.hide();
			return;
		}

		this.hide();
		this.removeAutocompleteText();

		if (item.type === 'mention') {
			await this.handleMentionItem(item);
		} else if (item.type === 'command') {
			this.handleCommandItem(item);
		} else if (item.type === 'file') {
			await this.handleFileItem(item);
		}
	}

	private async handleMentionItem(item: IAutocompleteItem): Promise<void> {
		if (item.id === 'file') {
			// 현재 에디터 파일 첨부
			const editor = this.editorService.activeTextEditorControl;
			if (editor && 'getModel' in editor) {
				const model = (editor as ICodeEditor).getModel();
				if (model?.uri) {
					await this.callbacks.onAttachFile(model.uri);
				}
			}
		} else if (item.id === 'workspace') {
			await this.callbacks.onAttachWorkspace();
		}
	}

	private handleCommandItem(item: IAutocompleteItem): void {
		const commandPrompts: Record<string, string> = {
			'explain': localize('promptExplain', "Explain this code in detail:"),
			'fix': localize('promptFix', "Find and fix bugs in this code:"),
			'test': localize('promptTest', "Write unit tests for this code:"),
			'refactor': localize('promptRefactor', "Refactor this code to be cleaner and more maintainable:"),
			'docs': localize('promptDocs', "Generate documentation for this code:"),
			'optimize': localize('promptOptimize', "Optimize this code for better performance:")
		};

		const prompt = commandPrompts[item.id] || '';
		this.callbacks.onCommandSelected(prompt);
	}

	private async handleFileItem(item: IAutocompleteItem): Promise<void> {
		const uri = item.data as URI;
		if (uri) {
			await this.callbacks.onAttachFile(uri);
		}
	}

	private removeAutocompleteText(): void {
		const model = this.inputEditor.getModel();
		const position = this.inputEditor.getPosition();
		if (!model || !position) {
			return;
		}

		const lineContent = model.getLineContent(position.lineNumber);
		const textBeforeCursor = lineContent.substring(0, position.column - 1);

		const triggerIndex = textBeforeCursor.lastIndexOf(this.triggerChar);
		if (triggerIndex === -1) {
			return;
		}

		const range = {
			startLineNumber: position.lineNumber,
			startColumn: triggerIndex + 1,
			endLineNumber: position.lineNumber,
			endColumn: position.column
		};

		model.pushEditOperations([], [{
			range,
			text: ''
		}], () => null);
	}

	private clearContainer(): void {
		while (this.container.firstChild) {
			this.container.removeChild(this.container.firstChild);
		}
	}
}
