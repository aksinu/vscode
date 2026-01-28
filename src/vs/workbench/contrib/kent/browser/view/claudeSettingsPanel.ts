/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, append, addDisposableListener, EventType } from '../../../../../base/browser/dom.js';
import { Disposable, IDisposable } from '../../../../../base/common/lifecycle.js';
import { URI } from '../../../../../base/common/uri.js';
import { VSBuffer } from '../../../../../base/common/buffer.js';
import { localize } from '../../../../../nls.js';
import { IFileService } from '../../../../../platform/files/common/files.js';
import { INotificationService } from '../../../../../platform/notification/common/notification.js';
import { IWorkspaceContextService } from '../../../../../platform/workspace/common/workspace.js';
import { IClaudeLocalConfig } from '../../common/claudeLocalConfig.js';

/**
 * Claude 전체 설정 패널 콜백
 */
export interface IClaudeSettingsPanelCallbacks {
	reloadLocalConfig(): void;
	getAvailableModels(): string[];
}

/**
 * Claude 전체 설정 패널 (모달 다이얼로그)
 */
export class ClaudeSettingsPanel extends Disposable {

	private overlay: HTMLElement | undefined;
	private configUri: URI | undefined;
	private currentConfig: IClaudeLocalConfig = {};
	private disposables: IDisposable[] = [];

	constructor(
		private readonly fileService: IFileService,
		private readonly workspaceContextService: IWorkspaceContextService,
		private readonly notificationService: INotificationService,
		private readonly callbacks: IClaudeSettingsPanelCallbacks
	) {
		super();
	}

	/**
	 * 설정 패널 열기
	 */
	async open(parentContainer: HTMLElement): Promise<void> {
		// 이미 열려있으면 닫기
		if (this.overlay) {
			this.close();
			return;
		}

		// 워크스페이스 확인
		const workspaceFolder = this.workspaceContextService.getWorkspace().folders[0];
		if (!workspaceFolder) {
			this.notificationService.warn(localize('noWorkspace', "No workspace folder open."));
			return;
		}

		const vscodeFolder = URI.joinPath(workspaceFolder.uri, '.vscode');
		this.configUri = URI.joinPath(vscodeFolder, 'claude.local.json');

		// 현재 설정 로드
		await this.loadConfig();

		// 오버레이 생성
		this.createOverlay(parentContainer);
	}

	/**
	 * 설정 패널 닫기
	 */
	close(): void {
		if (this.overlay) {
			this.overlay.remove();
			this.overlay = undefined;
		}
		this.disposables.forEach(d => d.dispose());
		this.disposables = [];
	}

	/**
	 * 패널이 열려있는지 확인
	 */
	isOpen(): boolean {
		return !!this.overlay;
	}

	// ========== Private Methods ==========

	private async loadConfig(): Promise<void> {
		if (!this.configUri) return;

		try {
			const content = await this.fileService.readFile(this.configUri);
			this.currentConfig = JSON.parse(content.value.toString());
		} catch {
			this.currentConfig = {};
		}
	}

	private async saveConfig(): Promise<void> {
		if (!this.configUri) return;

		// .vscode 폴더 확인/생성
		const vscodeFolder = URI.joinPath(this.configUri, '..');
		try {
			await this.fileService.stat(vscodeFolder);
		} catch {
			await this.fileService.createFolder(vscodeFolder);
		}

		const content = JSON.stringify(this.currentConfig, null, 2);
		await this.fileService.writeFile(this.configUri, VSBuffer.fromString(content));
		this.callbacks.reloadLocalConfig();
	}

	private createOverlay(parentContainer: HTMLElement): void {
		// 오버레이 배경
		this.overlay = append(parentContainer, $('.claude-settings-overlay'));

		// 패널 컨테이너
		const panel = append(this.overlay, $('.claude-settings-dialog'));

		// 헤더
		const header = append(panel, $('.claude-settings-header'));
		const title = append(header, $('h2'));
		title.textContent = localize('globalSettings', "Claude Global Settings");

		const closeBtn = append(header, $('button.claude-settings-close'));
		closeBtn.innerHTML = '&times;';
		this.disposables.push(addDisposableListener(closeBtn, EventType.CLICK, () => this.close()));

		// 컨텐츠
		const content = append(panel, $('.claude-settings-content'));

		// Model 설정
		this.createTextSetting(content, {
			label: localize('model', "Model"),
			description: localize('modelDesc', "Claude model to use (leave empty for default)"),
			placeholder: 'claude-sonnet-4-20250514',
			value: this.currentConfig.model || '',
			hint: `Available: ${this.callbacks.getAvailableModels().join(', ')}`,
			onChange: (value) => { this.currentConfig = { ...this.currentConfig, model: value || undefined }; }
		});

		// Extended Thinking 설정
		this.createToggleSetting(content, {
			label: localize('extendedThinking', "Extended Thinking"),
			description: localize('extendedThinkingDesc', "Enable Claude's extended thinking mode for complex tasks"),
			checked: this.currentConfig.extendedThinking || false,
			onChange: (checked) => { this.currentConfig = { ...this.currentConfig, extendedThinking: checked }; }
		});

		// Auto Accept 설정
		this.createToggleSetting(content, {
			label: localize('autoAccept', "Auto Accept"),
			description: localize('autoAcceptDesc', "Automatically accept Claude's questions (AskUser)"),
			checked: this.currentConfig.autoAccept || false,
			onChange: (checked) => { this.currentConfig = { ...this.currentConfig, autoAccept: checked }; }
		});

		// Script 설정
		const useScript = this.currentConfig.executable?.type === 'script';
		let scriptPathInput: HTMLInputElement | undefined;

		this.createToggleSetting(content, {
			label: localize('useScript', "Use Custom Script"),
			description: localize('useScriptDesc', "Run Claude through a custom script instead of direct CLI"),
			checked: useScript,
			onChange: (checked) => {
				if (scriptPathInput) {
					scriptPathInput.parentElement!.parentElement!.style.display = checked ? 'flex' : 'none';
				}
				if (checked) {
					this.currentConfig = {
						...this.currentConfig,
						executable: { type: 'script', script: scriptPathInput?.value || './scripts/claude.bat' }
					};
				} else {
					this.currentConfig = {
						...this.currentConfig,
						executable: { type: 'command', command: 'claude' }
					};
				}
			}
		});

		// Script Path (조건부 표시)
		const scriptItem = this.createTextSetting(content, {
			label: localize('scriptPath', "Script Path"),
			description: localize('scriptPathDesc', "Path to the script (relative to workspace)"),
			placeholder: './scripts/claude.bat',
			value: this.currentConfig.executable?.script || './scripts/claude.bat',
			onChange: (value) => {
				if (this.currentConfig.executable?.type === 'script') {
					this.currentConfig = {
						...this.currentConfig,
						executable: { type: 'script', script: value }
					};
				}
			}
		});
		scriptPathInput = scriptItem.querySelector('input') as HTMLInputElement;
		scriptItem.style.display = useScript ? 'flex' : 'none';

		// 푸터 (버튼)
		const footer = append(panel, $('.claude-settings-footer'));

		const cancelBtn = append(footer, $('button.claude-settings-btn.secondary'));
		cancelBtn.textContent = localize('cancel', "Cancel");
		this.disposables.push(addDisposableListener(cancelBtn, EventType.CLICK, () => this.close()));

		const saveBtn = append(footer, $('button.claude-settings-btn.primary'));
		saveBtn.textContent = localize('save', "Save");
		this.disposables.push(addDisposableListener(saveBtn, EventType.CLICK, async () => {
			await this.saveConfig();
			this.notificationService.info(localize('settingsSaved', "Settings saved"));
			this.close();
		}));

		// 오버레이 클릭 시 닫기
		this.disposables.push(addDisposableListener(this.overlay, EventType.CLICK, (e) => {
			if (e.target === this.overlay) {
				this.close();
			}
		}));

		// ESC 키로 닫기
		this.disposables.push(addDisposableListener(panel, EventType.KEY_DOWN, (e: KeyboardEvent) => {
			if (e.key === 'Escape') {
				this.close();
			}
		}));

		// 포커스
		panel.focus();
	}

	private createTextSetting(container: HTMLElement, options: {
		label: string;
		description: string;
		placeholder: string;
		value: string;
		hint?: string;
		onChange: (value: string) => void;
	}): HTMLElement {
		const item = append(container, $('.claude-settings-item'));

		const info = append(item, $('.claude-settings-info'));
		const label = append(info, $('.claude-settings-label'));
		label.textContent = options.label;
		const desc = append(info, $('.claude-settings-desc'));
		desc.textContent = options.description;
		if (options.hint) {
			const hint = append(info, $('.claude-settings-hint'));
			hint.textContent = options.hint;
		}

		const control = append(item, $('.claude-settings-control'));
		const input = append(control, $('input.claude-settings-input')) as HTMLInputElement;
		input.type = 'text';
		input.placeholder = options.placeholder;
		input.value = options.value;

		this.disposables.push(addDisposableListener(input, EventType.INPUT, () => {
			options.onChange(input.value);
		}));

		return item;
	}

	private createToggleSetting(container: HTMLElement, options: {
		label: string;
		description: string;
		checked: boolean;
		onChange: (checked: boolean) => void;
	}): HTMLElement {
		const item = append(container, $('.claude-settings-item'));

		const info = append(item, $('.claude-settings-info'));
		const label = append(info, $('.claude-settings-label'));
		label.textContent = options.label;
		const desc = append(info, $('.claude-settings-desc'));
		desc.textContent = options.description;

		const control = append(item, $('.claude-settings-control'));
		const toggle = append(control, $('label.claude-settings-toggle'));
		const checkbox = append(toggle, $('input')) as HTMLInputElement;
		checkbox.type = 'checkbox';
		checkbox.checked = options.checked;
		append(toggle, $('span.claude-settings-toggle-slider'));

		this.disposables.push(addDisposableListener(checkbox, EventType.CHANGE, () => {
			options.onChange(checkbox.checked);
		}));

		return item;
	}
}
