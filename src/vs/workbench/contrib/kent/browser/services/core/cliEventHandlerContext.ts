/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IChannel } from '../../../../../../base/parts/ipc/common/ipc.js';
import { IDisposable } from '../../../../../../base/common/lifecycle.js';
import { IClaudeMessage, IClaudeToolAction, IClaudeAskUserRequest, IClaudeUsageInfo, IClaudeSession, IClaudeStatusInfo, ClaudeServiceState } from '../../../common/types/claudeTypes.js';
import { IClaudeLocalConfig } from '../../../common/config/claudeLocalConfig.js';
import { IClaudeConnection, IClaudeConnectionInfo } from './claudeConnection.js';
import { IClaudeSessionService } from '../../../common/types/claudeSessionService.js';
import { IClaudeMessageService } from '../../../common/types/claudeMessageService.js';
import { IClaudeFileService } from '../../../common/types/claudeFileService.js';
import { IClaudeUIService } from '../../../common/types/claudeUIService.js';
import { IClaudeRateLimitService } from '../../../common/types/claudeRateLimitService.js';

/**
 * CLI 이벤트 핸들러에서 사용하는 컨텍스트 그룹 인터페이스
 * 47개의 개별 콜백을 6개 그룹으로 정리
 */

/**
 * 연결 관련 컨텍스트
 */
export interface IConnectionContext {
	confirmConnected(): void;
	getChannel(): IChannel;
}

/**
 * 상태 관리 컨텍스트
 */
export interface IStateContext {
	setState(state: 'idle' | 'sending' | 'streaming' | 'error'): void;
	getLocalConfig(): IClaudeLocalConfig;
	isAutoAcceptEnabled(): boolean;
	/** 유효 권한 모드 반환 (localConfig > VS Code 설정 > 'default' 순) */
	getEffectivePermissionMode(): string | undefined;
}

/**
 * 메시지 관리 컨텍스트
 */
export interface IMessageContext {
	getCurrentMessageId(): string | undefined;
	setCurrentMessageId(id: string | undefined): void;
	getAccumulatedContent(): string;
	setAccumulatedContent(content: string): void;
	appendContent(text: string): void;
	createAssistantMessage(id: string): void;
	updateSessionMessage(message: IClaudeMessage): void;
	fireMessageUpdate(message: IClaudeMessage): void;
	fireMessageReceive(message: IClaudeMessage): void;
}

/**
 * 도구 액션 관리 컨텍스트
 */
export interface IToolActionContext {
	getToolActions(): IClaudeToolAction[];
	addToolAction(action: IClaudeToolAction): void;
	updateToolAction(id: string, update: Partial<IClaudeToolAction>): void;
	getCurrentToolAction(): IClaudeToolAction | undefined;
	setCurrentToolAction(action: IClaudeToolAction | undefined): void;
}

/**
 * 세션 및 사용자 상호작용 컨텍스트
 */
export interface ISessionInteractionContext {
	// AskUser 관련
	getCurrentAskUserRequest(): IClaudeAskUserRequest | undefined;
	setCurrentAskUserRequest(request: IClaudeAskUserRequest | undefined): void;
	isWaitingForUser(): boolean;
	setWaitingForUser(waiting: boolean): void;

	// 세션 관리
	getCliSessionId(): string | undefined;
	setCliSessionId(id: string | undefined): void;
	hasCurrentSession(): boolean;
	saveSessions(): void;

	// Usage 정보
	getUsage(): IClaudeUsageInfo | undefined;
	setUsage(usage: IClaudeUsageInfo | undefined): void;
}

/**
 * 파일 및 작업 처리 컨텍스트
 */
export interface IFileOperationContext {
	// Rate limit
	startRateLimitHandling(retryAfterSeconds: number, message?: string): void;
	isRateLimitError(error: string): boolean;
	parseRetrySeconds(error: string): number | undefined;

	// 큐 처리
	processQueue(): void;

	// 파일 스냅샷
	captureFileBeforeEdit(filePath: string): Promise<void>;
	captureFileAfterEdit(filePath: string): Promise<void>;
	onCommandComplete(): Promise<void>;
}

/**
 * 통합 컨텍스트 인터페이스
 * 6개의 그룹화된 컨텍스트를 제공
 */
export interface ICLIEventHandlerUnifiedContext {
	readonly connection: IConnectionContext;
	readonly state: IStateContext;
	readonly message: IMessageContext;
	readonly toolAction: IToolActionContext;
	readonly sessionInteraction: ISessionInteractionContext;
	readonly fileOperation: IFileOperationContext;
}

/**
 * 새로운 간소화된 컨텍스트 인터페이스
 * 47개 델리게이트를 대체하는 통합 인터페이스
 */
export interface ICLIEventHandlerContext {
	session: IClaudeSession | undefined;
	getConnection(): IClaudeConnection;
	handleToolAction(toolAction: IClaudeToolAction | undefined): void;
	saveFile(filePath: string, content: string): Promise<void>;
	addMessage(message: IClaudeMessage): void;
	updateStatus(statusInfo: IClaudeStatusInfo): void;
	checkRateLimit(): boolean;

	// Event subscriptions (replacing 47 individual delegates)
	onStateChange(callback: (state: ClaudeServiceState) => void): IDisposable;
	onStatusChange(callback: (statusInfo: IClaudeStatusInfo) => void): IDisposable;
	onToolActionChange(callback: (toolAction: IClaudeToolAction | undefined) => void): IDisposable;
	onMessageReceived(callback: (message: IClaudeMessage) => void): IDisposable;
	onSessionChange(callback: (session: IClaudeSession | undefined) => void): IDisposable;
	onConnectionChange(callback: (info: IClaudeConnectionInfo) => void): IDisposable;

	// Core service access for complex operations
	getSessionService(): IClaudeSessionService;
	getMessageService(): IClaudeMessageService;
	getFileService(): IClaudeFileService;
	getUIService(): IClaudeUIService;
	getRateLimitService(): IClaudeRateLimitService;
}