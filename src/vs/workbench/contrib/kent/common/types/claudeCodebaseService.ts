/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../../../base/common/event.js';
import { URI } from '../../../../../base/common/uri.js';
import { createDecorator } from '../../../../../platform/instantiation/common/instantiation.js';

export const IClaudeCodebaseService = createDecorator<IClaudeCodebaseService>('claudeCodebaseService');

/**
 * 코드베이스 검색 결과
 */
export interface ICodebaseSearchResult {
	/** 파일 URI */
	readonly uri: URI;
	/** 파일 이름 */
	readonly fileName: string;
	/** 상대 경로 */
	readonly relativePath: string;
	/** 관련도 점수 (0-1) */
	readonly score: number;
	/** 매칭 스니펫 (상위 매칭 부분) */
	readonly snippet?: string;
}

/**
 * 인덱스 상태
 */
export interface ICodebaseIndexStatus {
	/** 인덱싱 완료 여부 */
	readonly indexed: boolean;
	/** 인덱싱 중 여부 */
	readonly indexing: boolean;
	/** 인덱싱된 파일 수 */
	readonly fileCount: number;
	/** 마지막 인덱싱 시간 */
	readonly lastIndexedAt?: number;
}

/**
 * Claude 코드베이스 검색 서비스
 * BM25 기반 관련 파일 검색
 */
export interface IClaudeCodebaseService {
	readonly _serviceBrand: undefined;

	/** 인덱스 상태 변경 이벤트 */
	readonly onDidChangeIndexStatus: Event<ICodebaseIndexStatus>;

	/**
	 * 워크스페이스 인덱스 빌드/갱신
	 */
	buildIndex(): Promise<void>;

	/**
	 * 쿼리로 관련 파일 검색
	 * @param query 검색 쿼리 (사용자 프롬프트)
	 * @param limit 최대 결과 수 (기본 10)
	 */
	search(query: string, limit?: number): Promise<ICodebaseSearchResult[]>;

	/**
	 * 현재 인덱스 상태
	 */
	getIndexStatus(): ICodebaseIndexStatus;

	/**
	 * 인덱스 초기화 (강제 재빌드)
	 */
	clearIndex(): void;
}
