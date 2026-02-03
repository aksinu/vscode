/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from '../../../../../platform/instantiation/common/instantiation.js';

export const IClaudeSettingsService = createDecorator<IClaudeSettingsService>('claudeSettingsService');

/**
 * Settings 관련 인터페이스들
 */
export interface IClaudeSettingsPanelCallbacks {
	onApiKeyChanged: (apiKey: string) => void;
	onModelChanged: (model: string) => void;
	onPermissionModeChanged: (mode: string) => void;
	onSettingsUpdated: () => void;
}

export interface ISessionSettings {
	model?: string;
	systemMessage?: string;
	maxTokens?: number;
	temperature?: number;
	customInstructions?: string;
}

export interface ILocalSettingsManager {
	getSettings(): any;
	updateSetting(key: string, value: any): void;
	saveSettings(): void;
	loadSettings(): void;
}

/**
 * Claude Settings Service Interface
 * Settings 관련 로직을 통합 관리
 */
export interface IClaudeSettingsService {
	// Settings Panel 관리
	showSettingsPanel(): void;
	hideSettingsPanel(): void;
	toggleSettingsPanel(): void;

	// Session Settings 관리
	showSessionSettingsPanel(): void;
	hideSessionSettingsPanel(): void;
	updateSessionSettings(sessionId: string, settings: ISessionSettings): void;

	// Local Settings 관리
	getLocalSettings(): any;
	updateLocalSettings(key: string, value: any): void;
	saveLocalSettings(): void;

	// Settings 동기화
	syncSettings(): Promise<void>;
	exportSettings(): Promise<string>;
	importSettings(data: string): Promise<void>;
}