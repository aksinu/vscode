/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, append, addDisposableListener, EventType } from '../../../../../base/browser/dom.js';
import { Disposable, IDisposable } from '../../../../../base/common/lifecycle.js';
import { localize } from '../../../../../nls.js';
import { validateClaudeModel, CLAUDE_DEFAULT_MODEL, getAvailableModelsForUI, resolveModelName, getModelDisplayName } from '../../common/claudeTypes.js';

/**
 * 세션 설정 데이터
 */
export interface ISessionSettings {
	name: string;
	model?: string;
	ultrathink?: boolean;
	autoAccept?: boolean;
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
	private modelWarningElement: HTMLElement | undefined;

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
		this.createModelSetting(content);

		// Ultrathink 오버라이드
		this.createToggleSetting(content, {
			label: localize('ultrathinkOverride', "Ultrathink"),
			description: localize('ultrathinkOverrideDesc', "Enable ultrathink mode (adds ultrathink keyword to prompt)"),
			checked: this.currentSettings.ultrathink || false,
			onChange: (checked) => { this.currentSettings.ultrathink = checked; }
		});

		// Auto Accept 설정
		this.createToggleSetting(content, {
			label: localize('autoAccept', "Auto Accept"),
			description: localize('autoAcceptDesc', "Automatically accept AskUser prompts (tool permissions)"),
			checked: this.currentSettings.autoAccept || false,
			onChange: (checked) => { this.currentSettings.autoAccept = checked; }
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
			// 모델 유효성 검증 - 유효하지 않으면 기본 모델로 대체
			if (this.currentSettings.model) {
				const validation = validateClaudeModel(this.currentSettings.model);
				if (!validation.isValid) {
					this.currentSettings.model = validation.model || CLAUDE_DEFAULT_MODEL;
				}
			}
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

	/**
	 * 모델 설정 필드 생성 (드롭다운 + 커스텀 입력)
	 */
	private createModelSetting(container: HTMLElement): HTMLElement {
		const item = append(container, $('.claude-settings-item'));

		const info = append(item, $('.claude-settings-info'));
		const label = append(info, $('.claude-settings-label'));
		label.textContent = localize('modelOverride', "Model Override");
		const desc = append(info, $('.claude-settings-desc'));
		desc.textContent = localize('modelOverrideDesc', "Override the default model for this session");
		const hint = append(info, $('.claude-settings-hint'));
		hint.textContent = localize('modelHint', "Short names: opus, sonnet, haiku, s35...");

		// 경고 메시지 요소
		this.modelWarningElement = append(info, $('.claude-settings-warning'));
		this.modelWarningElement.style.display = 'none';

		const control = append(item, $('.claude-settings-control'));

		// 드롭다운 + 커스텀 입력 컨테이너
		const modelSelector = append(control, $('.claude-model-selector'));

		// 드롭다운
		const select = append(modelSelector, $('select.claude-settings-select')) as HTMLSelectElement;

		// 기본 옵션: 비어있음 (기본 모델 사용)
		const defaultOption = append(select, $('option')) as HTMLOptionElement;
		defaultOption.value = '';
		defaultOption.textContent = localize('useDefault', "(Use default)");

		// 모델 목록 추가
		const models = getAvailableModelsForUI();
		for (const model of models) {
			const option = append(select, $('option')) as HTMLOptionElement;
			option.value = model.model;
			option.textContent = `${model.displayName} (${model.aliases[0]})`;
		}

		// 커스텀 옵션
		const customOption = append(select, $('option')) as HTMLOptionElement;
		customOption.value = '__custom__';
		customOption.textContent = localize('custom', "Custom...");

		// 커스텀 입력 필드 (처음에는 숨김)
		const customInput = append(modelSelector, $('input.claude-settings-input.claude-model-custom')) as HTMLInputElement;
		customInput.type = 'text';
		customInput.placeholder = localize('enterModel', "Enter model name or alias");
		customInput.style.display = 'none';

		// 현재 설정된 모델 확인 및 선택
		const currentModel = this.currentSettings.model;
		if (currentModel) {
			// 별칭 해석
			const resolved = resolveModelName(currentModel);
			// 목록에 있는지 확인
			const inList = models.some(m => m.model === resolved);
			if (inList) {
				select.value = resolved;
			} else {
				select.value = '__custom__';
				customInput.value = currentModel;
				customInput.style.display = 'block';
			}
		}

		// 드롭다운 변경 이벤트
		this.disposables.push(addDisposableListener(select, EventType.CHANGE, () => {
			const value = select.value;

			if (value === '__custom__') {
				customInput.style.display = 'block';
				customInput.focus();
				// 커스텀 입력 대기 - 현재 설정은 그대로 유지
			} else {
				customInput.style.display = 'none';
				customInput.value = '';
				this.currentSettings.model = value || undefined;
				this.updateModelWarning('');
			}
		}));

		// 커스텀 입력 변경 이벤트
		this.disposables.push(addDisposableListener(customInput, EventType.INPUT, () => {
			const value = customInput.value.trim();
			if (value) {
				// 별칭 해석 시도
				const resolved = resolveModelName(value);
				this.currentSettings.model = resolved;

				// 유효성 검증
				const validation = validateClaudeModel(value);
				if (!validation.isValid) {
					this.updateModelWarning(validation.warning || '');
				} else {
					// 해석된 모델명 표시
					const displayName = getModelDisplayName(resolved);
					if (displayName !== resolved) {
						this.updateModelWarning(`→ ${displayName}`, false);
					} else {
						this.updateModelWarning('');
					}
				}
			} else {
				this.currentSettings.model = undefined;
				this.updateModelWarning('');
			}
		}));

		return item;
	}

	/**
	 * 모델 경고/정보 메시지 업데이트
	 */
	private updateModelWarning(message: string, isError: boolean = true): void {
		if (!this.modelWarningElement) {
			return;
		}

		if (message) {
			this.modelWarningElement.textContent = isError ? `⚠️ ${message}` : `✓ ${message}`;
			this.modelWarningElement.style.display = 'block';
			this.modelWarningElement.style.color = isError
				? 'var(--vscode-errorForeground)'
				: 'var(--vscode-textLink-foreground)';
		} else {
			this.modelWarningElement.style.display = 'none';
		}
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
