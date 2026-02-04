/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../../../base/common/event.js';
import { createDecorator } from '../../../../../platform/instantiation/common/instantiation.js';
import { ClaudeServiceState, IClaudeStatusInfo, IClaudeToolAction } from './claudeTypes.js';

export const IClaudeUIService = createDecorator<IClaudeUIService>('claudeUIService');

/**
 * Claude UI 상태 관리 서비스
 *
 * Claude 서비스의 UI 상태와 이벤트를 관리합니다.
 * 상태 변경, 상태 정보, 툴 액션 등 UI와 관련된 모든 이벤트를 처리합니다.
 */
export interface IClaudeUIService {
	readonly _serviceBrand: undefined;

	// ========== State Events ==========

	/**
	 * 서비스 상태 변경 이벤트
	 */
	readonly onDidChangeState: Event<ClaudeServiceState>;

	/**
	 * 상태 정보 변경 이벤트 (연결 상태, 토큰 사용량 등)
	 */
	readonly onDidChangeStatusInfo: Event<IClaudeStatusInfo>;

	/**
	 * 툴 액션 변경 이벤트
	 */
	readonly onDidChangeToolAction: Event<IClaudeToolAction | undefined>;

	// ========== State Management ==========

	/**
	 * 현재 상태 가져오기
	 */
	getState(): ClaudeServiceState;

	/**
	 * 상태 설정 (이벤트 발송 포함)
	 */
	setState(state: ClaudeServiceState): void;

	/**
	 * 상태 정보 가져오기
	 */
	getStatusInfo(): IClaudeStatusInfo;

	/**
	 * 상태 정보 업데이트 (이벤트 발송 포함)
	 */
	updateStatusInfo(statusInfo: IClaudeStatusInfo): void;

	/**
	 * 툴 액션 가져오기
	 */
	getCurrentToolAction(): IClaudeToolAction | undefined;

	/**
	 * 툴 액션 설정 (이벤트 발송 포함)
	 */
	setToolAction(toolAction: IClaudeToolAction | undefined): void;

	// ========== Event Firing ==========

	/**
	 * 상태 변경 이벤트 발송
	 */
	fireStateChange(state: ClaudeServiceState): void;

	/**
	 * 상태 정보 변경 이벤트 발송
	 */
	fireStatusInfoChange(statusInfo: IClaudeStatusInfo): void;

	/**
	 * 툴 액션 변경 이벤트 발송
	 */
	fireToolActionChange(toolAction: IClaudeToolAction | undefined): void;

	// ========== Delegate Setup ==========

	/**
	 * 상태 관리 델리게이트 설정 (ClaudeService에서 사용)
	 */
	setStateDelegates(
		getStateDelegate: () => ClaudeServiceState,
		getStatusInfoDelegate: () => IClaudeStatusInfo,
		getToolActionDelegate: () => IClaudeToolAction | undefined
	): void;
}