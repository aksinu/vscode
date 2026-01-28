/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Codicon } from '../../../../base/common/codicons.js';
import { localize, localize2 } from '../../../../nls.js';
import { SyncDescriptor } from '../../../../platform/instantiation/common/descriptors.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { ViewPaneContainer } from '../../../browser/parts/views/viewPaneContainer.js';
import { IViewContainersRegistry, IViewsRegistry, Extensions as ViewExtensions, ViewContainerLocation } from '../../../common/views.js';
import { IClaudeService } from '../common/claude.js';
import { IClaudeLogService, ClaudeLogService } from '../common/claudeLogService.js';
import { ClaudeService } from './service/claudeService.js';
import { ClaudeChatViewPane } from './view/claudeChatView.js';
import { registerClaudeActions } from './actions/claudeActions.js';
import { Extensions as ConfigurationExtensions, IConfigurationRegistry } from '../../../../platform/configuration/common/configurationRegistry.js';
import './media/claude.css';

// ========== 서비스 등록 ==========

registerSingleton(IClaudeLogService, ClaudeLogService, InstantiationType.Eager);
registerSingleton(IClaudeService, ClaudeService, InstantiationType.Delayed);

// ========== View Container 등록 ==========

const VIEW_CONTAINER_ID = 'workbench.view.claude';

const viewContainersRegistry = Registry.as<IViewContainersRegistry>(ViewExtensions.ViewContainersRegistry);

const viewContainer = viewContainersRegistry.registerViewContainer({
	id: VIEW_CONTAINER_ID,
	title: localize2('claude', "Claude"),
	icon: Codicon.comment,
	order: 100,
	ctorDescriptor: new SyncDescriptor(ViewPaneContainer, [VIEW_CONTAINER_ID, { mergeViewWithContainerWhenSingleView: true }]),
	storageId: VIEW_CONTAINER_ID,
	hideIfEmpty: false
}, ViewContainerLocation.AuxiliaryBar, { isDefault: true });

// ========== View 등록 ==========

const viewsRegistry = Registry.as<IViewsRegistry>(ViewExtensions.ViewsRegistry);

viewsRegistry.registerViews([{
	id: ClaudeChatViewPane.ID,
	name: localize2('claudeChat', "Claude Chat"),
	containerIcon: Codicon.comment,
	canToggleVisibility: true,
	canMoveView: true,
	ctorDescriptor: new SyncDescriptor(ClaudeChatViewPane),
	order: 0
}], viewContainer);

// ========== 설정 등록 ==========

const configurationRegistry = Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration);

configurationRegistry.registerConfiguration({
	id: 'claude',
	title: localize('claude', "Claude"),
	order: 100,
	type: 'object',
	properties: {
		'claude.apiKey': {
			type: 'string',
			default: '',
			description: localize('claude.apiKey', "Anthropic API Key for Claude"),
			scope: 1 // ConfigurationScope.APPLICATION
		},
		'claude.model': {
			type: 'string',
			default: 'claude-sonnet-4-20250514',
			enum: [
				'claude-sonnet-4-20250514',
				'claude-opus-4-20250514',
				'claude-3-5-sonnet-20241022',
				'claude-3-5-haiku-20241022'
			],
			enumDescriptions: [
				'Claude Sonnet 4 - Latest, balanced performance',
				'Claude Opus 4 - Most capable',
				'Claude 3.5 Sonnet - Fast and efficient',
				'Claude 3.5 Haiku - Fastest'
			],
			description: localize('claude.model', "Claude model to use for chat")
		},
		'claude.maxTokens': {
			type: 'number',
			default: 4096,
			minimum: 1,
			maximum: 200000,
			description: localize('claude.maxTokens', "Maximum number of tokens in Claude response")
		},
		'claude.systemPrompt': {
			type: 'string',
			default: '',  // 빈 문자열 = Claude CLI 자체 시스템 프롬프트 사용
			description: localize('claude.systemPrompt', "System prompt for Claude (leave empty to use Claude CLI default)")
		},
		'claude.fontSize': {
			type: 'number',
			default: 13,
			minimum: 8,
			maximum: 24,
			description: localize('claude.fontSize', "Font size for Claude chat messages")
		}
	}
});

// ========== 액션 등록 ==========

registerClaudeActions();
