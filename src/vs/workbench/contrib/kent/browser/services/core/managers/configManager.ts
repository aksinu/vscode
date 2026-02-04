/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../../../../base/common/lifecycle.js';
import { URI } from '../../../../../../../base/common/uri.js';
import { IFileService } from '../../../../../../../platform/files/common/files.js';
import { IWorkspaceContextService } from '../../../../../../../platform/workspace/common/workspace.js';
import { IClaudeLocalConfig, DEFAULT_LOCAL_CONFIG } from '../../../../common/config/claudeLocalConfig.js';
import { IClaudeLogService } from '../../../../common/claudeLogService.js';

/**
 * ConfigManager - 로컬 설정 관리
 * 책임: loadLocalConfig, reloadLocalConfig, getLocalConfig, getWorkspaceRoot
 */
export class ConfigManager extends Disposable {

	private static readonly LOG_CATEGORY = 'ConfigManager';

	private _localConfig: IClaudeLocalConfig = DEFAULT_LOCAL_CONFIG;

	constructor(
		private readonly _platformFileService: IFileService,
		private readonly _workspaceContextService: IWorkspaceContextService,
		private readonly _logService: IClaudeLogService
	) {
		super();
	}

	/**
	 * 로컬 설정 로드
	 */
	async loadLocalConfig(): Promise<void> {
		try {
			const workspaceFolder = this._workspaceContextService.getWorkspace().folders[0];
			if (!workspaceFolder) {
				this._logService.debug(ConfigManager.LOG_CATEGORY, 'No workspace folder, using default config');
				return;
			}

			const configUri = URI.joinPath(workspaceFolder.uri, '.vscode', 'claude.local.json');
			this._logService.debug(ConfigManager.LOG_CATEGORY, 'Looking for local config at:', configUri.fsPath);

			try {
				const content = await this._platformFileService.readFile(configUri);
				const configData = JSON.parse(content.value.toString()) as IClaudeLocalConfig;
				this._localConfig = { ...DEFAULT_LOCAL_CONFIG, ...configData };
				this._logService.info(ConfigManager.LOG_CATEGORY, 'Local config loaded:', this._localConfig);
			} catch {
				// 파일이 없으면 기본값 사용
				this._logService.debug(ConfigManager.LOG_CATEGORY, 'No local config file, using defaults');
			}
		} catch (e) {
			this._logService.error(ConfigManager.LOG_CATEGORY, 'Failed to load local config:', e);
		}
	}

	/**
	 * 로컬 설정 다시 로드 (UI에서 설정 변경 후 호출)
	 */
	async reloadLocalConfig(): Promise<void> {
		await this.loadLocalConfig();
	}

	/**
	 * 로컬 설정 가져오기
	 */
	getLocalConfig(): IClaudeLocalConfig {
		return this._localConfig;
	}

	/**
	 * 워크스페이스 루트 경로 가져오기
	 */
	getWorkspaceRoot(): string | undefined {
		const workspaceFolder = this._workspaceContextService.getWorkspace().folders[0];
		return workspaceFolder?.uri.fsPath;
	}

	/**
	 * 로컬 설정에서 작업 디렉토리 계산
	 */
	getWorkingDirectory(): string | undefined {
		const root = this.getWorkspaceRoot();
		if (this._localConfig.workingDirectory && root) {
			return `${root}/${this._localConfig.workingDirectory}`;
		}
		return root;
	}
}
