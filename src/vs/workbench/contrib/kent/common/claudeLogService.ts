/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { Event, Emitter } from '../../../../base/common/event.js';
import { URI } from '../../../../base/common/uri.js';
import { VSBuffer } from '../../../../base/common/buffer.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';

/**
 * 로그 레벨
 */
export enum ClaudeLogLevel {
	DEBUG = 0,
	INFO = 1,
	WARN = 2,
	ERROR = 3,
	OFF = 4
}

/**
 * 로그 엔트리
 */
export interface IClaudeLogEntry {
	timestamp: Date;
	level: ClaudeLogLevel;
	category: string;
	message: string;
	args?: unknown[];
}

/**
 * 로그 설정
 */
export interface IClaudeLogConfig {
	enabled: boolean;
	level: ClaudeLogLevel;
	toFile: boolean;
	toConsole: boolean;
	logPath?: string;  // 기본: .vscode/claude-logs
}

export const IClaudeLogService = createDecorator<IClaudeLogService>('claudeLogService');

export interface IClaudeLogService {
	readonly _serviceBrand: undefined;

	/**
	 * 로그 설정 변경 이벤트
	 */
	readonly onDidChangeConfig: Event<IClaudeLogConfig>;

	/**
	 * 현재 설정
	 */
	readonly config: IClaudeLogConfig;

	/**
	 * 설정 업데이트
	 */
	setConfig(config: Partial<IClaudeLogConfig>): void;

	/**
	 * 로그 메서드
	 */
	debug(category: string, message: string, ...args: unknown[]): void;
	info(category: string, message: string, ...args: unknown[]): void;
	warn(category: string, message: string, ...args: unknown[]): void;
	error(category: string, message: string, ...args: unknown[]): void;

	/**
	 * 로그 파일 경로 반환
	 */
	getLogFilePath(): URI | undefined;

	/**
	 * 로그 플러시 (파일에 즉시 쓰기)
	 */
	flush(): Promise<void>;
}

/**
 * ClaudeLogService 구현
 */
export class ClaudeLogService extends Disposable implements IClaudeLogService {
	readonly _serviceBrand: undefined;

	private readonly _onDidChangeConfig = this._register(new Emitter<IClaudeLogConfig>());
	readonly onDidChangeConfig = this._onDidChangeConfig.event;

	private _config: IClaudeLogConfig = {
		enabled: true,
		level: ClaudeLogLevel.DEBUG,
		toFile: true,
		toConsole: true
	};

	private _logBuffer: string[] = [];
	private _flushTimer: ReturnType<typeof setTimeout> | undefined;
	private _currentLogFile: URI | undefined;
	private _currentLogDate: string | undefined;

	private static readonly FLUSH_INTERVAL = 1000; // 1초마다 플러시
	private static readonly BUFFER_SIZE = 50; // 50개 이상이면 즉시 플러시

	constructor(
		@IFileService private readonly fileService: IFileService,
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService
	) {
		super();
		this.startFlushTimer();
	}

	get config(): IClaudeLogConfig {
		return { ...this._config };
	}

	setConfig(config: Partial<IClaudeLogConfig>): void {
		this._config = { ...this._config, ...config };
		this._onDidChangeConfig.fire(this._config);
	}

	debug(category: string, message: string, ...args: unknown[]): void {
		this.log(ClaudeLogLevel.DEBUG, category, message, args);
	}

	info(category: string, message: string, ...args: unknown[]): void {
		this.log(ClaudeLogLevel.INFO, category, message, args);
	}

	warn(category: string, message: string, ...args: unknown[]): void {
		this.log(ClaudeLogLevel.WARN, category, message, args);
	}

	error(category: string, message: string, ...args: unknown[]): void {
		this.log(ClaudeLogLevel.ERROR, category, message, args);
	}

	getLogFilePath(): URI | undefined {
		return this._currentLogFile;
	}

	async flush(): Promise<void> {
		if (this._logBuffer.length === 0) {
			return;
		}

		if (!this._config.toFile) {
			this._logBuffer = [];
			return;
		}

		const logFile = await this.ensureLogFile();
		if (!logFile) {
			return;
		}

		const content = this._logBuffer.join('\n') + '\n';
		this._logBuffer = [];

		try {
			// 기존 파일에 append
			let existingContent = '';
			try {
				const existing = await this.fileService.readFile(logFile);
				existingContent = existing.value.toString();
			} catch {
				// 파일이 없으면 새로 생성
			}

			await this.fileService.writeFile(logFile, VSBuffer.fromString(existingContent + content));
		} catch (error) {
			// 파일 쓰기 실패 시 콘솔에만 출력
			console.error('[ClaudeLogService] Failed to write log file:', error);
		}
	}

	// ========== Private Methods ==========

	private log(level: ClaudeLogLevel, category: string, message: string, args: unknown[]): void {
		if (!this._config.enabled) {
			return;
		}

		if (level < this._config.level) {
			return;
		}

		const entry = this.formatLogEntry(level, category, message, args);

		// 콘솔 출력
		if (this._config.toConsole) {
			this.writeToConsole(level, category, message, args);
		}

		// 버퍼에 추가 (파일용)
		if (this._config.toFile) {
			this._logBuffer.push(entry);

			// 버퍼가 크면 즉시 플러시
			if (this._logBuffer.length >= ClaudeLogService.BUFFER_SIZE) {
				this.flush();
			}
		}
	}

	private formatLogEntry(level: ClaudeLogLevel, category: string, message: string, args: unknown[]): string {
		const timestamp = new Date().toISOString().replace('T', ' ').replace('Z', '');
		const levelStr = ClaudeLogLevel[level].padEnd(5);
		const argsStr = args.length > 0 ? ' ' + args.map(a => this.stringify(a)).join(' ') : '';

		return `[${timestamp}] [${levelStr}] [${category}] ${message}${argsStr}`;
	}

	private stringify(value: unknown): string {
		if (value === null) return 'null';
		if (value === undefined) return 'undefined';
		if (typeof value === 'string') return value;
		if (typeof value === 'number' || typeof value === 'boolean') return String(value);
		if (value instanceof Error) return `${value.name}: ${value.message}`;

		try {
			return JSON.stringify(value, null, 0);
		} catch {
			return String(value);
		}
	}

	private writeToConsole(level: ClaudeLogLevel, category: string, message: string, args: unknown[]): void {
		const prefix = `[Claude][${category}]`;
		const fullArgs = [prefix, message, ...args];

		switch (level) {
			case ClaudeLogLevel.DEBUG:
				console.debug(...fullArgs);
				break;
			case ClaudeLogLevel.INFO:
				console.info(...fullArgs);
				break;
			case ClaudeLogLevel.WARN:
				console.warn(...fullArgs);
				break;
			case ClaudeLogLevel.ERROR:
				console.error(...fullArgs);
				break;
		}
	}

	private async ensureLogFile(): Promise<URI | undefined> {
		const workspaceFolder = this.workspaceContextService.getWorkspace().folders[0];
		if (!workspaceFolder) {
			return undefined;
		}

		const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

		// 날짜가 바뀌면 새 파일
		if (this._currentLogDate !== today || !this._currentLogFile) {
			this._currentLogDate = today;

			const logPath = this._config.logPath || '.vscode/claude-logs';
			const logDir = URI.joinPath(workspaceFolder.uri, logPath);
			const logFile = URI.joinPath(logDir, `claude-${today}.log`);

			// 로그 디렉토리 생성
			try {
				await this.fileService.createFolder(logDir);
			} catch {
				// 이미 존재하면 무시
			}

			this._currentLogFile = logFile;
		}

		return this._currentLogFile;
	}

	private startFlushTimer(): void {
		this._flushTimer = setInterval(() => {
			this.flush();
		}, ClaudeLogService.FLUSH_INTERVAL);

		this._register({
			dispose: () => {
				if (this._flushTimer) {
					clearInterval(this._flushTimer);
				}
			}
		});
	}

	override dispose(): void {
		// 종료 전 버퍼 플러시
		this.flush();
		super.dispose();
	}
}
