/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../../base/common/uri.js';
import { VSBuffer } from '../../../../../base/common/buffer.js';
import { localize } from '../../../../../nls.js';
import { IFileService } from '../../../../../platform/files/common/files.js';
import { INotificationService } from '../../../../../platform/notification/common/notification.js';
import { IQuickInputService, IQuickPickItem } from '../../../../../platform/quickinput/common/quickInput.js';
import { IWorkspaceContextService } from '../../../../../platform/workspace/common/workspace.js';
import { IEditorService } from '../../../../services/editor/common/editorService.js';
import { IClaudeLocalConfig } from '../../common/claudeLocalConfig.js';

/**
 * LocalSettingsManager 콜백 인터페이스
 */
export interface ILocalSettingsCallbacks {
	reloadLocalConfig(): void;
}

/**
 * 로컬 설정 관리자
 * .vscode/claude.local.json 파일 관리
 */
export class LocalSettingsManager {

	constructor(
		private readonly workspaceContextService: IWorkspaceContextService,
		private readonly fileService: IFileService,
		private readonly quickInputService: IQuickInputService,
		private readonly notificationService: INotificationService,
		private readonly editorService: IEditorService,
		private readonly callbacks: ILocalSettingsCallbacks
	) { }

	/**
	 * 로컬 설정 열기 (QuickPick UI)
	 */
	async open(): Promise<void> {
		const workspaceFolder = this.workspaceContextService.getWorkspace().folders[0];
		if (!workspaceFolder) {
			this.notificationService.warn(localize('noWorkspace', "No workspace folder open. Please open a folder first."));
			return;
		}

		const vscodeFolder = URI.joinPath(workspaceFolder.uri, '.vscode');
		const configUri = URI.joinPath(vscodeFolder, 'claude.local.json');

		// 현재 설정 로드
		let config: IClaudeLocalConfig = {};
		try {
			const content = await this.fileService.readFile(configUri);
			config = JSON.parse(content.value.toString());
		} catch {
			// 파일 없음 - 기본값 사용
		}

		// 현재 상태 표시용
		const autoAcceptStatus = config.autoAccept ? '$(check) ON' : '$(close) OFF';
		const scriptPath = config.executable?.type === 'script' ? config.executable.script : undefined;
		const scriptStatus = scriptPath ? `$(file) ${scriptPath}` : '$(terminal) claude (default)';

		interface ISettingsQuickPickItem extends IQuickPickItem {
			id: string;
		}

		const items: ISettingsQuickPickItem[] = [
			{
				id: 'autoAccept',
				label: `$(symbol-boolean) Auto Accept`,
				description: autoAcceptStatus,
				detail: localize('autoAcceptDetail', "Automatically accept Claude's questions (AskUser)")
			},
			{
				id: 'script',
				label: `$(file-code) Claude Script`,
				description: scriptStatus,
				detail: localize('scriptDetail', "Custom script to run Claude CLI (e.g., set API key)")
			},
			{
				id: 'separator',
				label: '',
				kind: 1 // separator
			} as ISettingsQuickPickItem,
			{
				id: 'editJson',
				label: `$(json) Edit JSON directly`,
				detail: localize('editJsonDetail', "Open claude.local.json in editor")
			}
		];

		const selected = await this.quickInputService.pick(items, {
			placeHolder: localize('selectSetting', "Claude Local Settings"),
			canPickMany: false
		});

		if (!selected) {
			return;
		}

		const selectedItem = selected as ISettingsQuickPickItem;

		switch (selectedItem.id) {
			case 'autoAccept':
				await this.toggleAutoAccept(configUri, config);
				break;
			case 'script':
				await this.selectClaudeScript(configUri, config, workspaceFolder.uri);
				break;
			case 'editJson':
				await this.openOrCreateConfigFile(configUri, vscodeFolder, config);
				break;
		}
	}

	/**
	 * Auto Accept 토글
	 */
	private async toggleAutoAccept(configUri: URI, config: IClaudeLocalConfig): Promise<void> {
		const newValue = !config.autoAccept;
		const newConfig = { ...config, autoAccept: newValue };

		await this.saveConfig(configUri, newConfig);

		const status = newValue ? 'ON' : 'OFF';
		this.notificationService.info(localize('autoAcceptChanged', "Auto Accept: {0}", status));

		// 서비스에 알림 (설정 다시 로드하도록)
		this.callbacks.reloadLocalConfig();
	}

	/**
	 * Claude 스크립트 선택
	 */
	private async selectClaudeScript(configUri: URI, config: IClaudeLocalConfig, workspaceUri: URI): Promise<void> {
		interface IScriptQuickPickItem extends IQuickPickItem {
			id: string;
		}

		const items: IScriptQuickPickItem[] = [
			{
				id: 'default',
				label: '$(terminal) Use default claude command',
				description: config.executable?.type !== 'script' ? '(current)' : ''
			},
			{
				id: 'browse',
				label: '$(folder-opened) Browse for script file...',
				detail: localize('browseDetail', "Select .bat, .sh, .ps1, .js, or .py file")
			}
		];

		// 현재 스크립트가 있으면 표시
		if (config.executable?.type === 'script' && config.executable.script) {
			items.splice(1, 0, {
				id: 'current',
				label: `$(file) ${config.executable.script}`,
				description: '(current)',
				detail: localize('currentScript', "Currently configured script")
			});
		}

		const selected = await this.quickInputService.pick(items, {
			placeHolder: localize('selectScript', "Select Claude execution method")
		});

		if (!selected) {
			return;
		}

		const selectedItem = selected as IScriptQuickPickItem;

		if (selectedItem.id === 'default') {
			// 기본 명령어로 변경
			const newConfig: IClaudeLocalConfig = {
				...config,
				executable: { type: 'command', command: 'claude' }
			};
			await this.saveConfig(configUri, newConfig);
			this.notificationService.info(localize('usingDefaultClaude', "Using default 'claude' command"));
			this.callbacks.reloadLocalConfig();

		} else if (selectedItem.id === 'browse') {
			// 파일 선택 다이얼로그
			const result = await this.fileService.resolve(workspaceUri);
			if (!result) {
				return;
			}

			// QuickPick으로 파일 입력 받기 (간단한 방식)
			const scriptPath = await this.quickInputService.input({
				placeHolder: localize('enterScriptPath', "Enter script path (relative to workspace)"),
				prompt: localize('scriptPathPrompt', "e.g., ./scripts/claude.bat or scripts/run-claude.sh"),
				value: config.executable?.script || './scripts/claude.bat'
			});

			if (scriptPath) {
				const newConfig: IClaudeLocalConfig = {
					...config,
					executable: { type: 'script', script: scriptPath }
				};
				await this.saveConfig(configUri, newConfig);
				this.notificationService.info(localize('scriptConfigured', "Script configured: {0}", scriptPath));
				this.callbacks.reloadLocalConfig();
			}
		}
	}

	/**
	 * 설정 저장
	 */
	private async saveConfig(configUri: URI, config: IClaudeLocalConfig): Promise<void> {
		// .vscode 폴더 확인/생성
		const vscodeFolder = URI.joinPath(configUri, '..');
		try {
			await this.fileService.stat(vscodeFolder);
		} catch {
			await this.fileService.createFolder(vscodeFolder);
		}

		const content = JSON.stringify(config, null, 2);
		await this.fileService.writeFile(configUri, VSBuffer.fromString(content));
	}

	/**
	 * 설정 파일 열기 또는 생성
	 */
	private async openOrCreateConfigFile(configUri: URI, vscodeFolder: URI, existingConfig: IClaudeLocalConfig): Promise<void> {
		try {
			await this.fileService.stat(configUri);
		} catch {
			// 파일 없으면 생성
			try {
				await this.fileService.stat(vscodeFolder);
			} catch {
				await this.fileService.createFolder(vscodeFolder);
			}

			const defaultConfig = {
				...existingConfig,
				executable: existingConfig.executable || { type: 'command', command: 'claude' },
				autoAccept: existingConfig.autoAccept ?? false
			};

			await this.fileService.writeFile(configUri, VSBuffer.fromString(JSON.stringify(defaultConfig, null, 2)));
		}

		await this.editorService.openEditor({ resource: configUri });
	}
}
