/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { timeout } from '../../../../base/common/async.js';
import { IClaudeUIService } from '../../../common/types/claudeUIService.js';
import { ClaudeServiceState, IClaudeStatusInfo, IClaudeToolAction } from '../../../common/types/claudeTypes.js';
import { IClaudeLogService } from '../../../common/claudeLogService.js';

/**
 * Claude UI 상태 관리 서비스
 *
 * Claude 서비스의 UI 상태와 이벤트를 관리합니다.
 * 상태 변경, 상태 정보, 툴 액션 등 UI와 관련된 모든 이벤트를 처리합니다.
 */
export class ClaudeUIService extends Disposable implements IClaudeUIService {
	declare readonly _serviceBrand: undefined;

	// ========== Events ==========

	private readonly _onDidChangeState = this._register(new Emitter<ClaudeServiceState>());
	readonly onDidChangeState: Event<ClaudeServiceState> = this._onDidChangeState.event;

	private readonly _onDidChangeStatusInfo = this._register(new Emitter<IClaudeStatusInfo>());
	readonly onDidChangeStatusInfo: Event<IClaudeStatusInfo> = this._onDidChangeStatusInfo.event;

	private readonly _onDidChangeToolAction = this._register(new Emitter<IClaudeToolAction | undefined>());
	readonly onDidChangeToolAction: Event<IClaudeToolAction | undefined> = this._onDidChangeToolAction.event;

	// ========== Internal State ==========

	private _currentState: ClaudeServiceState = ClaudeServiceState.Disconnected;
	private _currentStatusInfo: IClaudeStatusInfo | undefined;
	private _currentToolAction: IClaudeToolAction | undefined;

	// ========== Debouncing ==========

	private _pendingStateChange: ClaudeServiceState | null = null;
	private _pendingStatusInfoChange: IClaudeStatusInfo | null = null;
	private _stateChangeTimeout: any = null;
	private _statusInfoChangeTimeout: any = null;
	private static readonly DEBOUNCE_DELAY_MS = 16; // ~60fps

	// ========== Delegates ==========

	private getStateDelegate?: () => ClaudeServiceState;
	private getStatusInfoDelegate?: () => IClaudeStatusInfo;
	private getToolActionDelegate?: () => IClaudeToolAction | undefined;

	constructor(
		@IClaudeLogService private readonly logService: IClaudeLogService
	) {
		super();
		this.logService.info('ClaudeUIService', 'Service initialized');
	}

	// ========== State Management ==========

	getState(): ClaudeServiceState {
		if (this.getStateDelegate) {
			return this.getStateDelegate();
		}
		return this._currentState;
	}

	setState(state: ClaudeServiceState): void {
		const prevState = this._currentState;
		this._currentState = state;

		// 상태가 실제로 변경된 경우에만 이벤트 발송
		if (prevState !== state) {
			this.logService.info('ClaudeUIService', `State changed: ${prevState} -> ${state}`);
			this.fireStateChange(state);
		}
	}

	getStatusInfo(): IClaudeStatusInfo {
		if (this.getStatusInfoDelegate) {
			return this.getStatusInfoDelegate();
		}

		// 기본 상태 정보 반환
		return {
			state: this.getState(),
			isConnected: this.getState() === ClaudeServiceState.Connected,
			connectionStatus: this.getState() === ClaudeServiceState.Connected ? 'connected' : 'disconnected',
			sessionInfo: undefined,
			usage: undefined,
			rateLimitInfo: undefined
		};
	}

	updateStatusInfo(statusInfo: IClaudeStatusInfo): void {
		this._currentStatusInfo = statusInfo;
		this.fireStatusInfoChange(statusInfo);
	}

	getCurrentToolAction(): IClaudeToolAction | undefined {
		if (this.getToolActionDelegate) {
			return this.getToolActionDelegate();
		}
		return this._currentToolAction;
	}

	setToolAction(toolAction: IClaudeToolAction | undefined): void {
		this._currentToolAction = toolAction;
		this.fireToolActionChange(toolAction);
	}

	// ========== Event Firing ==========

	/**
	 * 상태 변경 이벤트 발생 (디바운싱 적용)
	 */
	fireStateChange(state: ClaudeServiceState): void {
		this._pendingStateChange = state;

		// 기존 타이머 취소
		if (this._stateChangeTimeout) {
			clearTimeout(this._stateChangeTimeout);
		}

		// 새 타이머 설정
		this._stateChangeTimeout = setTimeout(() => {
			if (this._pendingStateChange !== null) {
				this._onDidChangeState.fire(this._pendingStateChange);
				this._pendingStateChange = null;
			}
			this._stateChangeTimeout = null;
		}, ClaudeUIService.DEBOUNCE_DELAY_MS);
	}

	/**
	 * 상태 정보 변경 이벤트 발생 (디바운싱 적용)
	 */
	fireStatusInfoChange(statusInfo: IClaudeStatusInfo): void {
		this._pendingStatusInfoChange = statusInfo;

		// 기존 타이머 취소
		if (this._statusInfoChangeTimeout) {
			clearTimeout(this._statusInfoChangeTimeout);
		}

		// 새 타이머 설정
		this._statusInfoChangeTimeout = setTimeout(() => {
			if (this._pendingStatusInfoChange !== null) {
				this._onDidChangeStatusInfo.fire(this._pendingStatusInfoChange);
				this._pendingStatusInfoChange = null;
			}
			this._statusInfoChangeTimeout = null;
		}, ClaudeUIService.DEBOUNCE_DELAY_MS);
	}

	/**
	 * 툴 액션 변경 이벤트 발생 (즉시 발생 - 디바운싱 없음)
	 */
	fireToolActionChange(toolAction: IClaudeToolAction | undefined): void {
		this._onDidChangeToolAction.fire(toolAction);
	}

	// ========== Delegate Setup ==========

	setStateDelegates(
		getStateDelegate: () => ClaudeServiceState,
		getStatusInfoDelegate: () => IClaudeStatusInfo,
		getToolActionDelegate: () => IClaudeToolAction | undefined
	): void {
		this.getStateDelegate = getStateDelegate;
		this.getStatusInfoDelegate = getStatusInfoDelegate;
		this.getToolActionDelegate = getToolActionDelegate;
	}

	// ========== Disposal ==========

	/**
	 * 서비스 정리 시 모든 pending 타이머를 정리
	 * 메모리 누수 방지를 위한 critical 메서드
	 */
	override dispose(): void {
		// 상태 변경 디바운싱 타이머 정리
		if (this._stateChangeTimeout) {
			clearTimeout(this._stateChangeTimeout);
			this._stateChangeTimeout = null;
			this.logService.debug('ClaudeUIService', 'Cleared pending state change timeout');
		}

		// 상태 정보 디바운싱 타이머 정리
		if (this._statusInfoChangeTimeout) {
			clearTimeout(this._statusInfoChangeTimeout);
			this._statusInfoChangeTimeout = null;
			this.logService.debug('ClaudeUIService', 'Cleared pending status info timeout');
		}

		// Pending 상태 정리
		this._pendingStateChange = null;
		this._pendingStatusInfoChange = null;

		this.logService.info('ClaudeUIService', 'Service disposed, all timers cleared');
		super.dispose();
	}
}