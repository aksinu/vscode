/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, append, addDisposableListener, EventType } from '../../../../../../base/browser/dom.js';
import { URI } from '../../../../../../base/common/uri.js';
import { VSBuffer } from '../../../../../../base/common/buffer.js';
import { localize } from '../../../../../../nls.js';
import { IFileService } from '../../../../../../platform/files/common/files.js';
import { INotificationService } from '../../../../../../platform/notification/common/notification.js';
import { IWorkspaceContextService } from '../../../../../../platform/workspace/common/workspace.js';
import { IClaudeLocalConfig } from '../../../common/config/claudeLocalConfig.js';
import { validateClaudeModel, getAvailableModelsForUI, resolveModelName, getModelDisplayName, IClaudeModelPickItem } from '../../../common/types/claudeTypes.js';
import { ClaudeModalDialog } from '../ui/claudeModalDialog.js';

/**
 * Claude 전체 설정 패널 콜백
 */
export interface IClaudeSettingsPanelCallbacks {
	reloadLocalConfig(): void;
	getAvailableModels(): string[];
	onModelSaved?(model: string | undefined): void;
	validateModel?(model: string): Promise<{ valid: boolean; error?: string }>;
}

/**
 * Claude 전체 설정 패널 (모달 다이얼로그)
 * 모델은 ~/.claude/settings.json (글로벌)에 저장
 * 나머지 설정은 .vscode/claude.local.json에 저장
 */
export class ClaudeSettingsPanel extends ClaudeModalDialog<IClaudeSettingsPanelCallbacks> {

	private configUri: URI | undefined;
	private currentConfig: IClaudeLocalConfig = {};
	private modelWarningElement: HTMLElement | undefined;
	private selectedModel: string | undefined;

	constructor(
		private readonly fileService: IFileService,
		private readonly workspaceContextService: IWorkspaceContextService,
		private readonly notificationService: INotificationService,
		callbacks: IClaudeSettingsPanelCallbacks
	) {
		super(callbacks);
	}

	/**
	 * 설정 패널 열기
	 */
	override async open(parentContainer: HTMLElement): Promise<void> {
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

		// 모델 초기값 설정
		this.selectedModel = this.currentConfig.model;

		// 부모 클래스의 open 메서드 호출 (오버레이 관리는 베이스 클래스가 처리)
		super.open(parentContainer);
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

		// 모델은 글로벌에 저장하므로 localConfig에서 제외
		const configToSave = { ...this.currentConfig };
		delete configToSave.model;

		const content = JSON.stringify(configToSave, null, 2);
		await this.fileService.writeFile(this.configUri, VSBuffer.fromString(content));
		this.callbacks.reloadLocalConfig();
	}

	protected override createOverlay(parentContainer: HTMLElement): void {
		// 오버레이 배경
		this.overlay = append(parentContainer, $('.claude-settings-overlay'));

		// 패널 컨테이너
		const panel = append(this.overlay, $('.claude-settings-dialog'));

		// 헤더
		const header = append(panel, $('.claude-settings-header'));
		const title = append(header, $('h2'));
		title.textContent = localize('globalSettings', "Claude Global Settings");

		const closeBtn = append(header, $('button.claude-settings-close'));
		closeBtn.textContent = '×';
		this.modalDisposables.push(addDisposableListener(closeBtn, EventType.CLICK, () => this.close()));

		// 컨텐츠
		const content = append(panel, $('.claude-settings-content'));

		// Model 설정 (드롭다운 + 커스텀 입력)
		this.createModelSetting(content);

		// Auto Accept 설정
		this.createToggleSetting(content, {
			label: localize('autoAccept', "Auto Accept"),
			description: localize('autoAcceptDesc', "Automatically accept Claude's questions (AskUser)"),
			checked: this.currentConfig.autoAccept || false,
			onChange: (checked) => { this.currentConfig = { ...this.currentConfig, autoAccept: checked }; }
		});

		// Max Sessions 설정
		this.createNumberSetting(content, {
			label: localize('maxSessions', "Max Sessions"),
			description: localize('maxSessionsDesc', "Maximum number of concurrent chat sessions (oldest removed when exceeded)"),
			value: this.currentConfig.maxSessions ?? 10,
			min: 1,
			max: 100,
			onChange: (value) => { this.currentConfig = { ...this.currentConfig, maxSessions: value }; }
		});

		// Max Turns 설정
		this.createNumberSetting(content, {
			label: localize('maxTurns', "Max Turns"),
			description: localize('maxTurnsDesc', "Maximum conversation turns per session (CLI --max-turns)"),
			value: this.currentConfig.maxTurns ?? 1000,
			min: 1,
			max: 1000,
			onChange: (value) => { this.currentConfig = { ...this.currentConfig, maxTurns: value }; }
		});

		// Max Budget (USD) 설정
		this.createNumberSetting(content, {
			label: localize('maxBudgetUsd', "Max Budget (USD)"),
			description: localize('maxBudgetUsdDesc', "Maximum budget in USD per session (CLI --max-budget-usd)"),
			value: this.currentConfig.maxBudgetUsd ?? 5,
			min: 0.01,
			max: 100,
			step: 0.01,
			onChange: (value) => { this.currentConfig = { ...this.currentConfig, maxBudgetUsd: value }; }
		});

		// Max Tokens 설정
		this.createNumberSetting(content, {
			label: localize('maxTokens', "Max Tokens"),
			description: localize('maxTokensDesc', "Maximum output tokens per response (CLI --max-tokens)"),
			value: this.currentConfig.maxTokens ?? 16000,
			min: 100,
			max: 128000,
			onChange: (value) => { this.currentConfig = { ...this.currentConfig, maxTokens: value }; }
		});

		// 푸터 (버튼)
		const footer = append(panel, $('.claude-settings-footer'));

		const cancelBtn = append(footer, $('button.claude-settings-btn.secondary'));
		cancelBtn.textContent = localize('cancel', "Cancel");
		this.modalDisposables.push(addDisposableListener(cancelBtn, EventType.CLICK, () => this.close()));

		const saveBtn = append(footer, $('button.claude-settings-btn.primary'));
		saveBtn.textContent = localize('save', "Save");
		this.modalDisposables.push(addDisposableListener(saveBtn, EventType.CLICK, async () => {
			await this.handleSave(saveBtn);
		}));

		// 오버레이 클릭 시 닫기
		this.modalDisposables.push(addDisposableListener(this.overlay, EventType.CLICK, (e: MouseEvent) => {
			if (e.target === this.overlay) {
				this.close();
			}
		}));

		// ESC 키로 닫기
		this.modalDisposables.push(addDisposableListener(panel, EventType.KEY_DOWN, (e: KeyboardEvent) => {
			if (e.key === 'Escape') {
				this.close();
			}
		}));

		// 포커스
		panel.focus();
	}

	/**
	 * 저장 처리 (모델 CLI 검증 포함)
	 */
	private async handleSave(saveBtn: HTMLElement): Promise<void> {
		const model = this.selectedModel;

		if (model) {
			const resolved = resolveModelName(model);
			const validation = validateClaudeModel(model);

			// 알려진 모델이면 바로 저장
			if (validation.isValid) {
				this.selectedModel = resolved;
			} else {
				// 커스텀 모델이면 CLI 검증
				if (this.callbacks.validateModel) {
					saveBtn.textContent = localize('validating', "Validating...");
					(saveBtn as HTMLButtonElement).disabled = true;

					try {
						const result = await this.callbacks.validateModel(resolved);
						if (!result.valid) {
							this.updateModelWarning(result.error || `Model "${model}" is not valid`);
							saveBtn.textContent = localize('save', "Save");
							(saveBtn as HTMLButtonElement).disabled = false;
							return; // 저장하지 않음
						}
						this.selectedModel = resolved;
					} catch {
						this.updateModelWarning(`Validation failed for "${model}"`);
						saveBtn.textContent = localize('save', "Save");
						(saveBtn as HTMLButtonElement).disabled = false;
						return;
					}
				}
			}
		}

		// .vscode/claude.local.json 저장 (모델 제외한 나머지 설정)
		await this.saveConfig();

		// 모델은 글로벌 ~/.claude/settings.json에 저장
		this.callbacks.onModelSaved?.(this.selectedModel);

		this.notificationService.info(localize('settingsSaved', "Settings saved"));
		this.close();
	}

	/**
	 * 모델 설정 필드 생성 (드롭다운 + 커스텀 입력)
	 */
	private createModelSetting(container: HTMLElement): HTMLElement {
		const item = append(container, $('.claude-settings-item'));

		const info = append(item, $('.claude-settings-info'));
		const label = append(info, $('.claude-settings-label'));
		label.textContent = localize('model', "Model");
		const desc = append(info, $('.claude-settings-desc'));
		desc.textContent = localize('modelDescGlobal', "Default Claude model (saved to ~/.claude/settings.json)");
		const hint = append(info, $('.claude-settings-hint'));
		hint.textContent = localize('modelHint', "Short names: opus, sonnet, haiku, s35...");

		// 경고 메시지 요소
		const warningElement = append(info, $('.claude-settings-warning'));
		warningElement.style.display = 'none';
		this.modelWarningElement = warningElement;

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
		const currentModel = this.selectedModel;
		if (currentModel) {
			const resolved = resolveModelName(currentModel);
			const inList = models.some((m: IClaudeModelPickItem) => m.model === resolved);
			if (inList) {
				select.value = resolved;
			} else {
				select.value = '__custom__';
				customInput.value = currentModel;
				customInput.style.display = 'block';
			}
		}

		// 드롭다운 변경 이벤트
		this.modalDisposables.push(addDisposableListener(select, EventType.CHANGE, () => {
			const value = select.value;

			if (value === '__custom__') {
				customInput.style.display = 'block';
				customInput.focus();
			} else {
				customInput.style.display = 'none';
				customInput.value = '';
				this.selectedModel = value || undefined;
				this.updateModelWarning('');
			}
		}));

		// 커스텀 입력 변경 이벤트
		this.modalDisposables.push(addDisposableListener(customInput, EventType.INPUT, () => {
			const value = customInput.value.trim();
			if (value) {
				const resolved = resolveModelName(value);
				this.selectedModel = resolved;

				const validation = validateClaudeModel(value);
				if (!validation.isValid) {
					this.updateModelWarning(validation.warning || '');
				} else {
					const displayName = getModelDisplayName(resolved);
					if (displayName !== resolved) {
						this.updateModelWarning(`→ ${displayName}`, false);
					} else {
						this.updateModelWarning('');
					}
				}
			} else {
				this.selectedModel = undefined;
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

	private createNumberSetting(container: HTMLElement, options: {
		label: string;
		description: string;
		value: number;
		min: number;
		max: number;
		step?: number;
		onChange: (value: number) => void;
	}): HTMLElement {
		const item = append(container, $('.claude-settings-item'));

		const info = append(item, $('.claude-settings-info'));
		const label = append(info, $('.claude-settings-label'));
		label.textContent = options.label;
		const desc = append(info, $('.claude-settings-desc'));
		desc.textContent = options.description;

		const control = append(item, $('.claude-settings-control'));
		const input = append(control, $('input.claude-settings-input')) as HTMLInputElement;
		input.type = 'number';
		input.min = options.min.toString();
		input.max = options.max.toString();
		input.value = options.value.toString();
		if (options.step) {
			input.step = options.step.toString();
		}

		const parse = options.step ? parseFloat : parseInt;
		this.modalDisposables.push(addDisposableListener(input, EventType.INPUT, () => {
			const value = Math.max(options.min, Math.min(options.max, parse(input.value) || options.min));
			input.value = value.toString();
			options.onChange(value);
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

		this.modalDisposables.push(addDisposableListener(checkbox, EventType.CHANGE, () => {
			options.onChange(checkbox.checked);
		}));

		return item;
	}
}
