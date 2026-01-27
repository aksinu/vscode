/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../../../../base/common/event.js';
import { Disposable } from '../../../../../base/common/lifecycle.js';
import { IChannel } from '../../../../../base/parts/ipc/common/ipc.js';
import { ClaudeConnectionStatus } from '../../common/claudeTypes.js';
import { CLAUDE_CLI_CHANNEL_NAME } from '../../common/claudeCLIChannel.js';
import type { IMainProcessService } from '../../../../../platform/ipc/common/mainProcessService.js';
import { IClaudeLogService } from '../../common/claudeLogService.js';

/**
 * 연결 정보 인터페이스
 */
export interface IClaudeConnectionInfo {
	status: ClaudeConnectionStatus;
	version?: string;
	lastConnected?: number;
	error?: string;
}

/**
 * Claude CLI 연결 관리자
 * CLI 프로세스와의 연결을 담당
 */
export class ClaudeConnection extends Disposable {

	private static readonly LOG_CATEGORY = 'Connection';

	private _status: ClaudeConnectionStatus = 'disconnected';
	private _version: string | undefined;
	private _lastConnected: number | undefined;
	private _error: string | undefined;
	private _isConnecting = false;

	private readonly channel: IChannel;

	private readonly _onDidChangeStatus = this._register(new Emitter<IClaudeConnectionInfo>());
	readonly onDidChangeStatus: Event<IClaudeConnectionInfo> = this._onDidChangeStatus.event;

	private readonly _onDidConnect = this._register(new Emitter<void>());
	readonly onDidConnect: Event<void> = this._onDidConnect.event;

	private readonly _onDidDisconnect = this._register(new Emitter<string | undefined>());
	readonly onDidDisconnect: Event<string | undefined> = this._onDidDisconnect.event;

	constructor(
		mainProcessService: IMainProcessService,
		private readonly logService: IClaudeLogService
	) {
		super();

		// Main Process의 Claude CLI 채널에 연결
		this.channel = mainProcessService.getChannel(CLAUDE_CLI_CHANNEL_NAME);
		this.logService.info(ClaudeConnection.LOG_CATEGORY, 'Channel obtained:', CLAUDE_CLI_CHANNEL_NAME);
	}

	/**
	 * 현재 연결 상태
	 */
	get status(): ClaudeConnectionStatus {
		return this._status;
	}

	/**
	 * 연결되어 있는지 여부
	 */
	get isConnected(): boolean {
		return this._status === 'connected';
	}

	/**
	 * 연결 중인지 여부
	 */
	get isConnecting(): boolean {
		return this._isConnecting;
	}

	/**
	 * CLI 버전
	 */
	get version(): string | undefined {
		return this._version;
	}

	/**
	 * 마지막 연결 시간
	 */
	get lastConnected(): number | undefined {
		return this._lastConnected;
	}

	/**
	 * 에러 메시지
	 */
	get error(): string | undefined {
		return this._error;
	}

	/**
	 * IPC 채널 가져오기 (ClaudeService에서 사용)
	 */
	getChannel(): IChannel {
		return this.channel;
	}

	/**
	 * 연결 정보 가져오기
	 */
	getInfo(): IClaudeConnectionInfo {
		return {
			status: this._status,
			version: this._version,
			lastConnected: this._lastConnected,
			error: this._error
		};
	}

	/**
	 * CLI 연결 시도
	 */
	async connect(): Promise<boolean> {
		if (this._isConnecting) {
			this.logService.debug(ClaudeConnection.LOG_CATEGORY, Already connecting...');
			return false;
		}

		if (this._status === 'connected') {
			this.logService.debug(ClaudeConnection.LOG_CATEGORY, Already connected');
			return true;
		}

		this._isConnecting = true;
		this._error = undefined;
		this.setStatus('connecting');

		this.logService.debug(ClaudeConnection.LOG_CATEGORY, Connecting to Claude CLI...');

		try {
			// CLI 버전 확인으로 연결 테스트 (5초 타임아웃)
			const result = await Promise.race([
				this.channel.call<{ success: boolean; version?: string; error?: string }>('checkConnection'),
				new Promise<{ success: false; error: string }>((resolve) =>
					setTimeout(() => resolve({ success: false, error: 'Connection timeout' }), 5000)
				)
			]);

			if (result.success) {
				this._version = result.version;
				this._lastConnected = Date.now();
				this.setStatus('connected');
				this._onDidConnect.fire();
				this.logService.debug(ClaudeConnection.LOG_CATEGORY, Connected successfully, version:', this._version);
				return true;
			} else {
				this._error = result.error || 'Connection failed';
				this.setStatus('error');
				this._onDidDisconnect.fire(this._error);
				this.logService.debug(ClaudeConnection.LOG_CATEGORY, Connection failed:', this._error);
				return false;
			}
		} catch (error) {
			this._error = (error as Error).message || 'Unknown error';
			this.setStatus('error');
			this._onDidDisconnect.fire(this._error);
			this.logService.error(ClaudeConnection.LOG_CATEGORY, Connection error:', error);
			return false;
		} finally {
			this._isConnecting = false;
		}
	}

	/**
	 * 연결 해제
	 */
	disconnect(): void {
		if (this._status === 'disconnected') {
			return;
		}

		this.logService.debug(ClaudeConnection.LOG_CATEGORY, Disconnecting...');
		this.setStatus('disconnected');
		this._onDidDisconnect.fire(undefined);
	}

	/**
	 * 재연결 시도
	 */
	async reconnect(): Promise<boolean> {
		this.disconnect();
		return this.connect();
	}

	/**
	 * 연결 상태가 데이터 수신으로 확인됨
	 * (메시지 스트리밍 중 호출)
	 */
	confirmConnected(): void {
		if (this._status !== 'connected') {
			this._lastConnected = Date.now();
			this.setStatus('connected');
			this._onDidConnect.fire();
			this.logService.debug(ClaudeConnection.LOG_CATEGORY, Connection confirmed by data reception');
		}
	}

	/**
	 * 상태 설정 및 이벤트 발생
	 */
	private setStatus(status: ClaudeConnectionStatus): void {
		if (this._status !== status) {
			this._status = status;
			this._onDidChangeStatus.fire(this.getInfo());
		}
	}
}
