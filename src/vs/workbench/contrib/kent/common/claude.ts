/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../../base/common/event.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { IClaudeMessage, IClaudeSendRequestOptions, ClaudeServiceState, IClaudeSession, IClaudeQueuedMessage, IClaudeStatusInfo, IClaudeFileChange, IClaudeFileChangesSummary, IClaudeToolAction } from './claudeTypes.js';

export const IClaudeService = createDecorator<IClaudeService>('claudeService');

/**
 * Claude 서비스 인터페이스
 */
export interface IClaudeService {
	readonly _serviceBrand: undefined;

	// ========== Events ==========

	/**
	 * 메시지 수신 이벤트
	 */
	readonly onDidReceiveMessage: Event<IClaudeMessage>;

	/**
	 * 스트리밍 메시지 업데이트 이벤트
	 */
	readonly onDidUpdateMessage: Event<IClaudeMessage>;

	/**
	 * 상태 변경 이벤트
	 */
	readonly onDidChangeState: Event<ClaudeServiceState>;

	/**
	 * 세션 변경 이벤트
	 */
	readonly onDidChangeSession: Event<IClaudeSession | undefined>;

	/**
	 * 메시지 큐 변경 이벤트
	 */
	readonly onDidChangeQueue: Event<IClaudeQueuedMessage[]>;

	/**
	 * Rate limit 상태 변경 이벤트
	 */
	readonly onDidChangeRateLimitStatus: Event<{ waiting: boolean; countdown: number; message?: string }>;

	// ========== State ==========

	/**
	 * 현재 서비스 상태
	 */
	getState(): ClaudeServiceState;

	/**
	 * 현재 세션
	 */
	getCurrentSession(): IClaudeSession | undefined;

	// ========== Chat ==========

	/**
	 * 메시지 전송
	 */
	sendMessage(content: string, options?: IClaudeSendRequestOptions): Promise<IClaudeMessage>;

	/**
	 * 현재 요청 취소
	 */
	cancelRequest(): void;

	/**
	 * AskUser 질문에 응답
	 */
	respondToAskUser(responses: string[]): Promise<void>;

	// ========== History ==========

	/**
	 * 현재 세션의 모든 메시지 가져오기
	 */
	getMessages(): IClaudeMessage[];

	/**
	 * 대화 기록 초기화
	 */
	clearHistory(): void;

	// ========== Session ==========

	/**
	 * 새 세션 시작
	 */
	startNewSession(): IClaudeSession;

	/**
	 * 세션 목록 가져오기
	 */
	getSessions(): IClaudeSession[];

	/**
	 * 특정 세션으로 전환
	 */
	switchSession?(sessionId: string): IClaudeSession | undefined;

	/**
	 * 세션 삭제
	 */
	deleteSession?(sessionId: string): boolean;

	/**
	 * 세션 제목 변경
	 */
	renameSession?(sessionId: string, title: string): boolean;

	/**
	 * 세션별 모델 오버라이드 설정
	 */
	setSessionModel?(model: string): void;

	/**
	 * 세션별 Ultrathink 오버라이드 설정
	 */
	setSessionUltrathink?(enabled: boolean): void;

	/**
	 * 세션별 Auto Accept 오버라이드 설정
	 */
	setSessionAutoAccept?(enabled: boolean): void;

	/**
	 * Auto Accept 활성화 여부
	 */
	isAutoAcceptEnabled?(): boolean;

	/**
	 * 마지막 세션 이어서 시작 (--continue)
	 */
	continueLastSession?(): Promise<void>;

	// ========== Queue ==========

	/**
	 * 큐에 대기 중인 메시지 가져오기
	 */
	getQueuedMessages(): IClaudeQueuedMessage[];

	/**
	 * 큐에서 메시지 제거
	 */
	removeFromQueue(id: string): void;

	/**
	 * 큐 전체 비우기
	 */
	clearQueue(): void;

	/**
	 * 큐 최대 크기 반환
	 */
	getMaxQueueSize?(): number;

	/**
	 * 큐에 대기 중인 메시지 수정
	 */
	updateQueuedMessage?(id: string, newContent: string): boolean;

	/**
	 * 큐 순서 변경 (드래그 앤 드롭용)
	 */
	reorderQueue?(fromIndex: number, toIndex: number): boolean;

	// ========== Config ==========

	/**
	 * 로컬 설정 다시 로드
	 */
	reloadLocalConfig?(): Promise<void>;

	// ========== Rate Limit ==========

	/**
	 * Rate limit 대기 취소
	 */
	cancelRateLimitWait?(): void;

	/**
	 * Rate limit 상태 조회
	 */
	getRateLimitStatus?(): { waiting: boolean; countdown: number; message?: string };

	// ========== Status ==========

	/**
	 * Claude 상태 정보 변경 이벤트
	 */
	readonly onDidChangeStatusInfo?: Event<IClaudeStatusInfo>;

	/**
	 * 도구 실행 상태 변경 이벤트
	 */
	readonly onDidChangeToolAction?: Event<IClaudeToolAction | undefined>;

	/**
	 * Claude 상태 정보 가져오기
	 */
	getStatusInfo?(): IClaudeStatusInfo;

	/**
	 * 연결 테스트
	 */
	checkConnection?(): Promise<boolean>;

	/**
	 * Ultrathink 토글
	 */
	toggleUltrathink?(): Promise<void>;

	/**
	 * Ultrathink 활성화 여부
	 */
	isUltrathinkEnabled?(): boolean;

	// ========== File Changes ==========

	/**
	 * 변경된 파일 목록 가져오기 (현재 명령)
	 */
	getChangedFiles?(): IClaudeFileChange[];

	/**
	 * 변경사항 요약 가져오기 (현재 명령)
	 */
	getFileChangesSummary?(): IClaudeFileChangesSummary;

	/**
	 * 특정 파일의 Diff 표시
	 */
	showFileDiff?(fileChange: IClaudeFileChange): Promise<void>;

	/**
	 * 파일 변경사항 되돌리기
	 */
	revertFile?(fileChange: IClaudeFileChange): Promise<boolean>;

	/**
	 * 모든 파일 변경사항 되돌리기
	 */
	revertAllFiles?(): Promise<number>;

	/**
	 * 파일 변경사항 수락 (스냅샷 제거)
	 */
	acceptFile?(fileChange: IClaudeFileChange): void;

	/**
	 * 모든 파일 변경사항 수락
	 */
	acceptAllFiles?(): void;

	/**
	 * 선택된 파일들 되돌리기
	 */
	revertSelectedFiles?(fileChanges: IClaudeFileChange[]): Promise<number>;

	/**
	 * 선택된 파일들 수락
	 */
	acceptSelectedFiles?(fileChanges: IClaudeFileChange[]): void;

	/**
	 * 세션 전체 변경사항 히스토리 가져오기
	 * 각 메시지별로 변경된 파일 목록을 시간순으로 반환
	 */
	getSessionChangesHistory?(): IClaudeSessionChangesHistory;
}

/**
 * 세션 변경사항 히스토리
 */
export interface IClaudeSessionChangesHistory {
	/** 세션 ID */
	readonly sessionId: string;
	/** 총 변경된 파일 수 (고유) */
	readonly totalFilesChanged: number;
	/** 총 추가된 라인 */
	readonly totalLinesAdded: number;
	/** 총 삭제된 라인 */
	readonly totalLinesRemoved: number;
	/** 메시지별 변경 항목 (시간순) */
	readonly entries: IClaudeChangesHistoryEntry[];
	/** 파일별 변경 요약 */
	readonly filesSummary: IClaudeFileChangeSummaryItem[];
}

/**
 * 변경 히스토리 항목 (메시지 단위)
 */
export interface IClaudeChangesHistoryEntry {
	/** 메시지 ID */
	readonly messageId: string;
	/** 타임스탬프 */
	readonly timestamp: number;
	/** 사용자 프롬프트 (요약) */
	readonly prompt: string;
	/** 변경된 파일들 */
	readonly changes: IClaudeFileChange[];
}

/**
 * 파일별 변경 요약 항목
 */
export interface IClaudeFileChangeSummaryItem {
	/** 파일 경로 */
	readonly filePath: string;
	/** 파일 이름 */
	readonly fileName: string;
	/** 변경 횟수 */
	readonly changeCount: number;
	/** 최종 상태 */
	readonly finalState: 'created' | 'modified' | 'deleted';
	/** 총 추가 라인 */
	readonly totalLinesAdded: number;
	/** 총 삭제 라인 */
	readonly totalLinesRemoved: number;
	/** 마지막 변경 시간 */
	readonly lastModified: number;
}
