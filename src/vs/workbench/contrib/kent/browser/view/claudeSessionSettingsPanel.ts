/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, append, addDisposableListener, EventType } from '../../../../../base/browser/dom.js';
import { Disposable, IDisposable } from '../../../../../base/common/lifecycle.js';
import { localize } from '../../../../../nls.js';

/**
 * 세션 설정 데이터
 */
export interface ISessionSettings {
	name: string;
	model?: string;
	ultrathink?: boolean;
}

/**
 * 세션 설정 패널 콜백
 */
export interface ISessionSettingsPanelCallbacks {
	getCurrentSettings(): ISessionSettings;
	onSave(settings: ISessionSettings): void;
	onContinue(): void;
	getAvailableModels(): string[];
}

/**
 * 세션별 설정 패널 (모달 다이얼로그)
 */
export class SessionSettingsPanel extends Disposable {

	private overlay: HTMLElement | undefined;
	private currentSettings: ISessionSettings = { name: '' };
	private disposables: IDisposable[] = [];

	constructor(
		private readonly callbacks: ISessionSettingsPanelCallbacks
	) {
		super();
	}

	/**
	 * 설정 패널 열기
	 */
	open(parentContainer: HTMLElement): void {
		// 이미 열려있으면 닫기
		if (this.overlay) {
			this.close();
			return;
		}

		// 현재 설정 로드
		this.currentSettings = { ...this.callbacks.getCurrentSettings() };

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

	private createOverlay(parentContainer: HTMLElement): void {
		// 오버레이 배경
		this.overlay = append(parentContainer, $('.claude-settings-overlay'));

		// 패널 컨테이너
		const panel = append(this.overlay, $('.claude-settings-dialog'));

		// 헤더
		const header = append(panel, $('.claude-settings-header'));
		const title = append(header, $('h2'));
		title.textContent = localize('sessionSettings', "Session Settings");

		const closeBtn = append(header, $('button.claude-settings-close'));
		closeBtn.textContent = '×';
		this.disposables.push(addDisposableListener(closeBtn, EventType.CLICK, () => this.close()));

		// 컨텐츠
		const content = append(panel, $('.claude-settings-content'));

		// 세션 이름
		this.createTextSetting(content, {
			label: localize('sessionName', "Session Name"),
			description: localize('sessionNameDesc', "Display name for this chat session"),
			placeholder: 'My Chat Session',
			value: this.currentSettings.name || '',
			onChange: (value) => { this.currentSettings.name = value; }
		});

		// 모델 오버라이드
		this.createTextSetting(content, {
			label: localize('modelOverride', "Model Override"),
			description: localize('modelOverrideDesc', "Override the default model for this session (leave empty for default)"),
			placeholder: 'claude-sonnet-4-20250514',
			value: this.currentSettings.model || '',
			hint: `Available: ${this.callbacks.getAvailableModels().join(', ')}`,
			onChange: (value) => { this.currentSettings.model = value || undefined; }
		});

		// Ultrathink 오버라이드
		this.createToggleSetting(content, {
			label: localize('ultrathinkOverride', "Ultrathink"),
			description: localize('ultrathinkOverrideDesc', "Enable ultrathink mode (adds ultrathink keyword to prompt)"),
			checked: this.currentSettings.ultrathink || false,
			onChange: (checked) => { this.currentSettings.ultrathink = checked; }
		});

		// Continue 섹션
		const continueSection = append(content, $('.claude-settings-section'));
		const continueTitle = append(continueSection, $('.claude-settings-section-title'));
		continueTitle.textContent = localize('continueSession', "Continue Previous Session");

		const continueDesc = append(continueSection, $('.claude-settings-section-desc'));
		continueDesc.textContent = localize('continueDesc', "Resume the last Claude session with --continue flag");

		const continueBtn = append(continueSection, $('button.claude-settings-btn.continue'));
		const continueIcon = append(continueBtn, $('span.codicon.codicon-history'));
		continueIcon.setAttribute('aria-hidden', 'true');
		append(continueBtn, document.createTextNode(' ' + localize('continue', "Continue Last Session")));
		this.disposables.push(addDisposableListener(continueBtn, EventType.CLICK, () => {
			this.callbacks.onContinue();
			this.close();
		}));

		// 푸터 (버튼)
		const footer = append(panel, $('.claude-settings-footer'));

		const cancelBtn = append(footer, $('button.claude-settings-btn.secondary'));
		cancelBtn.textContent = localize('cancel', "Cancel");
		this.disposables.push(addDisposableListener(cancelBtn, EventType.CLICK, () => this.close()));

		const saveBtn = append(footer, $('button.claude-settings-btn.primary'));
		saveBtn.textContent = localize('save', "Save");
		this.disposables.push(addDisposableListener(saveBtn, EventType.CLICK, () => {
			this.callbacks.onSave(this.currentSettings);
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
