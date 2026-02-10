/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../../../../base/common/lifecycle.js';
import { URI } from '../../../../../../../base/common/uri.js';
import { VSBuffer } from '../../../../../../../base/common/buffer.js';
import { IFileService } from '../../../../../../../platform/files/common/files.js';
import { IWorkspaceContextService } from '../../../../../../../platform/workspace/common/workspace.js';
import { INativeWorkbenchEnvironmentService } from '../../../../../../services/environment/electron-browser/environmentService.js';
import { IClaudeLocalConfig, DEFAULT_LOCAL_CONFIG } from '../../../../common/config/claudeLocalConfig.js';
import { IClaudeLogService } from '../../../../common/claudeLogService.js';

/**
 * 프로젝트 .claude/settings.json 구조
 */
interface IClaudeProjectSettings {
	model?: string;
	[key: string]: unknown;
}

/**
 * 글로벌 ~/.claude/settings.json 구조
 */
interface IClaudeGlobalSettings {
	model?: string;
	[key: string]: unknown;
}

/**
 * ConfigManager - 로컬 설정 관리
 * 책임: loadLocalConfig, reloadLocalConfig, getLocalConfig, getWorkspaceRoot
 *       + 프로젝트 .claude/settings.json 읽기/쓰기
 */
export class ConfigManager extends Disposable {

	private static readonly LOG_CATEGORY = 'ConfigManager';

	private _localConfig: IClaudeLocalConfig = DEFAULT_LOCAL_CONFIG;
	private _projectSettings: IClaudeProjectSettings = {};
	private _globalSettings: IClaudeGlobalSettings = {};

	constructor(
		private readonly _platformFileService: IFileService,
		private readonly _workspaceContextService: IWorkspaceContextService,
		private readonly _environmentService: INativeWorkbenchEnvironmentService,
		private readonly _logService: IClaudeLogService
	) {
		super();
	}

	/**
	 * 로컬 설정 로드 (우선순위: 프로젝트 .claude > .vscode/claude.local > 글로벌 ~/.claude > 기본값)
	 */
	async loadLocalConfig(): Promise<void> {
		try {
			// 0. ~/.claude/settings.json (글로벌 Claude Code 설정 - 최하위 우선순위)
			await this.loadGlobalSettings();
			if (this._globalSettings.model) {
				this._localConfig = { ...this._localConfig, model: this._globalSettings.model };
				this._logService.info(ConfigManager.LOG_CATEGORY, 'Global model default:', this._globalSettings.model);
			}

			const workspaceFolder = this._workspaceContextService.getWorkspace().folders[0];
			if (!workspaceFolder) {
				this._logService.debug(ConfigManager.LOG_CATEGORY, 'No workspace folder, using global/default config');
				return;
			}

			// 1. .vscode/claude.local.json (기존 로컬 설정)
			const configUri = URI.joinPath(workspaceFolder.uri, '.vscode', 'claude.local.json');
			try {
				const content = await this._platformFileService.readFile(configUri);
				const configData = JSON.parse(content.value.toString()) as IClaudeLocalConfig;
				this._localConfig = { ...DEFAULT_LOCAL_CONFIG, ...this._localConfig, ...configData };
				this._logService.info(ConfigManager.LOG_CATEGORY, 'Local config loaded:', this._localConfig);
			} catch {
				this._logService.debug(ConfigManager.LOG_CATEGORY, 'No local config file, using defaults');
			}

			// 2. .claude/settings.json (프로젝트별 Claude Code 설정 - 최상위 우선순위)
			await this.loadProjectSettings(workspaceFolder.uri);

			// 프로젝트 설정의 model이 있으면 localConfig에 병합 (프로젝트 설정 우선)
			if (this._projectSettings.model) {
				this._localConfig = { ...this._localConfig, model: this._projectSettings.model };
				this._logService.info(ConfigManager.LOG_CATEGORY, 'Project model override:', this._projectSettings.model);
			}
		} catch (e) {
			this._logService.error(ConfigManager.LOG_CATEGORY, 'Failed to load local config:', e);
		}
	}

	/**
	 * 글로벌 ~/.claude/settings.json 로드
	 */
	private async loadGlobalSettings(): Promise<void> {
		const globalSettingsUri = URI.joinPath(this._environmentService.userHome, '.claude', 'settings.json');
		try {
			const content = await this._platformFileService.readFile(globalSettingsUri);
			this._globalSettings = JSON.parse(content.value.toString());
			this._logService.info(ConfigManager.LOG_CATEGORY, 'Global settings loaded from ~/.claude/settings.json');
		} catch {
			this._globalSettings = {};
			this._logService.debug(ConfigManager.LOG_CATEGORY, 'No ~/.claude/settings.json found');
		}
	}

	/**
	 * 프로젝트 .claude/settings.json 로드
	 */
	private async loadProjectSettings(workspaceUri: URI): Promise<void> {
		const settingsUri = URI.joinPath(workspaceUri, '.claude', 'settings.json');
		try {
			const content = await this._platformFileService.readFile(settingsUri);
			this._projectSettings = JSON.parse(content.value.toString());
			this._logService.info(ConfigManager.LOG_CATEGORY, 'Project settings loaded from .claude/settings.json');
		} catch {
			this._projectSettings = {};
			this._logService.debug(ConfigManager.LOG_CATEGORY, 'No .claude/settings.json found');
		}
	}

	/**
	 * 프로젝트 .claude/settings.json에 모델 저장
	 */
	async saveProjectModel(model: string | undefined): Promise<void> {
		const workspaceFolder = this._workspaceContextService.getWorkspace().folders[0];
		if (!workspaceFolder) {
			this._logService.error(ConfigManager.LOG_CATEGORY, 'Cannot save model: no workspace folder');
			return;
		}

		const settingsUri = URI.joinPath(workspaceFolder.uri, '.claude', 'settings.json');

		// 기존 설정 읽기 (다른 필드 보존)
		let existingSettings: IClaudeProjectSettings = {};
		try {
			const content = await this._platformFileService.readFile(settingsUri);
			existingSettings = JSON.parse(content.value.toString());
		} catch {
			// 파일 없으면 새로 생성
		}

		// model 필드 업데이트
		if (model) {
			existingSettings.model = model;
		} else {
			delete existingSettings.model;
		}

		// 파일 쓰기
		const jsonContent = JSON.stringify(existingSettings, null, '\t');
		await this._platformFileService.writeFile(settingsUri, VSBuffer.fromString(jsonContent));

		// 캐시 업데이트
		this._projectSettings = existingSettings;
		if (model) {
			this._localConfig = { ...this._localConfig, model };
		}

		this._logService.info(ConfigManager.LOG_CATEGORY, `Project model saved to .claude/settings.json: ${model || '(cleared)'}`);
	}

	/**
	 * 글로벌 ~/.claude/settings.json에 모델 저장
	 */
	async saveGlobalModel(model: string | undefined): Promise<void> {
		const globalSettingsUri = URI.joinPath(this._environmentService.userHome, '.claude', 'settings.json');

		// 기존 설정 읽기 (다른 필드 보존)
		let existingSettings: IClaudeGlobalSettings = {};
		try {
			const content = await this._platformFileService.readFile(globalSettingsUri);
			existingSettings = JSON.parse(content.value.toString());
		} catch {
			// 파일 없으면 새로 생성
		}

		// model 필드 업데이트
		if (model) {
			existingSettings.model = model;
		} else {
			delete existingSettings.model;
		}

		// ~/.claude 폴더 확인/생성
		const claudeFolder = URI.joinPath(this._environmentService.userHome, '.claude');
		try {
			await this._platformFileService.stat(claudeFolder);
		} catch {
			await this._platformFileService.createFolder(claudeFolder);
		}

		// 파일 쓰기
		const jsonContent = JSON.stringify(existingSettings, null, '\t');
		await this._platformFileService.writeFile(globalSettingsUri, VSBuffer.fromString(jsonContent));

		// 캐시 업데이트
		this._globalSettings = existingSettings;
		if (model) {
			this._localConfig = { ...this._localConfig, model };
		}

		this._logService.info(ConfigManager.LOG_CATEGORY, `Global model saved to ~/.claude/settings.json: ${model || '(cleared)'}`);
	}

	/**
	 * 프로젝트 설정 가져오기
	 */
	getProjectSettings(): IClaudeProjectSettings {
		return this._projectSettings;
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
