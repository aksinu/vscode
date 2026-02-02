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
	maxLogFiles?: number;  // 최대 보관할 로그 파일 수 (기본: 7일)
	maxLogFileSize?: number;  // 로그 파일 최대 크기 (기본: 10MB)
	cleanupOnStartup?: boolean;  // 시작 시 정리 (기본: true)
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

	/**
	 * 오래된 로그 파일 정리
	 */
	cleanupOldLogs(): Promise<void>;
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
		toConsole: true,
		maxLogFiles: 7,  // 7일간 보관
		maxLogFileSize: 10 * 1024 * 1024,  // 10MB
		cleanupOnStartup: true
	};

	private _logBuffer: string[] = [];
	private _flushTimer: ReturnType<typeof setTimeout> | undefined;
	private _currentLogFile: URI | undefined;
	private _currentLogDate: string | undefined;
	private _cleanupCompleted: boolean = false;

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
			let existingSize = 0;
			try {
				const existing = await this.fileService.readFile(logFile);
				existingContent = existing.value.toString();
				existingSize = existingContent.length;
			} catch {
				// 파일이 없으면 새로 생성
			}

			// 파일 크기 체크 (로테이션)
			const maxSize = this._config.maxLogFileSize || (10 * 1024 * 1024); // 10MB
			if (existingSize + content.length > maxSize) {
				// 기존 파일을 .old로 백업
				const backupFile = URI.joinPath(logFile.with({ path: logFile.path.replace('.log', '.old.log') }));
				try {
					await this.fileService.writeFile(backupFile, VSBuffer.fromString(existingContent));
					// 새 로그 파일로 시작
					existingContent = '';
					this.info('LogService', `Log file rotated: ${logFile.path} -> ${backupFile.path}`);
				} catch (backupError) {
					this.warn('LogService', 'Failed to backup log file:', backupError);
				}
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

			// 새 로그 파일 생성 시 자동 정리 실행
			if (!this._cleanupCompleted) {
				// 비동기로 실행 (로그 생성을 블록하지 않음)
				this.cleanupOldLogs().catch(() => {
					// 정리 실패는 무시 (이미 로그에 기록됨)
				});
			}
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

	async cleanupOldLogs(): Promise<void> {
		if (!this._config.cleanupOnStartup || this._cleanupCompleted) {
			return;
		}

		const workspaceFolder = this.workspaceContextService.getWorkspace().folders[0];
		if (!workspaceFolder) {
			return;
		}

		try {
			const logPath = this._config.logPath || '.vscode/claude-logs';
			const logDir = URI.joinPath(workspaceFolder.uri, logPath);

			// 로그 디렉토리가 없으면 정리할 필요 없음
			try {
				await this.fileService.resolve(logDir);
			} catch {
				this._cleanupCompleted = true;
				return;
			}

			// 로그 파일들 목록 가져오기
			const logFiles = await this.getLogFiles(logDir);

			if (logFiles.length <= (this._config.maxLogFiles || 7)) {
				this._cleanupCompleted = true;
				return;
			}

			// 날짜순으로 정렬 (오래된 것부터)
			logFiles.sort((a, b) => a.date.localeCompare(b.date));

			// 보관할 파일 수를 제외하고 삭제
			const keepCount = this._config.maxLogFiles || 7;
			const filesToDelete = logFiles.slice(0, -keepCount);

			for (const fileInfo of filesToDelete) {
				try {
					await this.fileService.del(fileInfo.uri);
					this.info('LogService', `Deleted old log file: ${fileInfo.name}`);
				} catch (error) {
					this.warn('LogService', `Failed to delete log file ${fileInfo.name}:`, error);
				}
			}

			this._cleanupCompleted = true;

		} catch (error) {
			this.error('LogService', 'Failed to cleanup old logs:', error);
		}
	}

	private async getLogFiles(logDir: URI): Promise<{ uri: URI; name: string; date: string; size: number }[]> {
		try {
			const dirContents = await this.fileService.resolve(logDir);
			const logFiles: { uri: URI; name: string; date: string; size: number }[] = [];

			if (dirContents.children) {
				for (const child of dirContents.children) {
					if (!child.isFile || !child.name.startsWith('claude-') || !child.name.endsWith('.log')) {
						continue;
					}

					// 파일명에서 날짜 추출: claude-2026-02-02.log -> 2026-02-02
					const match = child.name.match(/claude-(\d{4}-\d{2}-\d{2})\.log$/);
					if (match) {
						logFiles.push({
							uri: child.resource,
							name: child.name,
							date: match[1],
							size: child.size || 0
						});
					}
				}
			}

			return logFiles;
		} catch {
			return [];
		}
	}

	override dispose(): void {
		// 종료 전 버퍼 플러시
		this.flush();
		super.dispose();
	}
}
