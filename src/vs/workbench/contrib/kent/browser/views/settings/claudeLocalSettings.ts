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
