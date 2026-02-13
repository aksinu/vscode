/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * BM25 검색 엔진
 * Okapi BM25 알고리즘 구현 (외부 의존 없음)
 *
 * 참고: https://en.wikipedia.org/wiki/Okapi_BM25
 * score(D,Q) = Σ IDF(qi) * (f(qi,D) * (k1+1)) / (f(qi,D) + k1 * (1 - b + b * |D|/avgdl))
 */

// ========== 토크나이저 ==========

const STOP_WORDS = new Set([
	'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
	'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
	'should', 'may', 'might', 'can', 'shall', 'must', 'need', 'dare',
	'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from', 'as',
	'into', 'through', 'during', 'before', 'after', 'above', 'below',
	'between', 'out', 'off', 'over', 'under', 'again', 'further', 'then',
	'once', 'here', 'there', 'when', 'where', 'why', 'how', 'all', 'each',
	'every', 'both', 'few', 'more', 'most', 'other', 'some', 'such', 'no',
	'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very',
	'and', 'but', 'or', 'nor', 'if', 'else', 'this', 'that', 'these', 'those',
	'it', 'its', 'i', 'me', 'my', 'we', 'our', 'you', 'your', 'he', 'him',
	'his', 'she', 'her', 'they', 'them', 'their', 'what', 'which', 'who',
	// 코드 공통 키워드 (너무 흔해서 제외)
	'import', 'export', 'from', 'return', 'const', 'let', 'var', 'new'
]);

/**
 * 텍스트를 토큰으로 분리
 * camelCase, PascalCase, snake_case 분리 지원
 */
export function tokenize(text: string): string[] {
	// camelCase/PascalCase 분리: "getUserName" → "get user name"
	const expanded = text.replace(/([a-z])([A-Z])/g, '$1 $2')
		.replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2');

	// 단어 추출 (알파벳/숫자 + 밑줄, 최소 2글자)
	const words = expanded.toLowerCase().match(/[a-z_$][a-z0-9_$]{1,}/g) || [];

	// stop words 제거
	return words.filter(w => !STOP_WORDS.has(w));
}

// ========== BM25 인덱스 ==========

/**
 * 문서 항목
 */
interface BM25Document {
	/** 문서 ID */
	id: string;
	/** 토큰 목록 */
	tokens: string[];
	/** 문서 길이 (토큰 수) */
	length: number;
	/** 용어 빈도 캐시: term → count */
	termFreq: Map<string, number>;
}

/**
 * BM25 검색 결과
 */
export interface BM25Result {
	id: string;
	score: number;
}

/**
 * BM25 인덱스
 */
export class BM25Index {
	/** BM25 파라미터 */
	private static readonly K1 = 1.2;
	private static readonly B = 0.75;

	/** 문서들 */
	private readonly documents: Map<string, BM25Document> = new Map();
	/** 역 인덱스: term → Set<docId> */
	private readonly invertedIndex: Map<string, Set<string>> = new Map();
	/** 평균 문서 길이 */
	private avgDocLength = 0;
	/** 총 문서 수 */
	private docCount = 0;

	/**
	 * 문서 추가
	 */
	addDocument(id: string, text: string): void {
		const tokens = tokenize(text);
		const termFreq = new Map<string, number>();

		for (const token of tokens) {
			termFreq.set(token, (termFreq.get(token) || 0) + 1);
		}

		const doc: BM25Document = {
			id,
			tokens,
			length: tokens.length,
			termFreq
		};

		this.documents.set(id, doc);

		// 역 인덱스 업데이트
		for (const term of termFreq.keys()) {
			let postings = this.invertedIndex.get(term);
			if (!postings) {
				postings = new Set();
				this.invertedIndex.set(term, postings);
			}
			postings.add(id);
		}

		// 통계 갱신
		this.docCount = this.documents.size;
		this.recalcAvgDocLength();
	}

	/**
	 * 문서 제거
	 */
	removeDocument(id: string): void {
		const doc = this.documents.get(id);
		if (!doc) {
			return;
		}

		// 역 인덱스에서 제거
		for (const term of doc.termFreq.keys()) {
			const postings = this.invertedIndex.get(term);
			if (postings) {
				postings.delete(id);
				if (postings.size === 0) {
					this.invertedIndex.delete(term);
				}
			}
		}

		this.documents.delete(id);
		this.docCount = this.documents.size;
		this.recalcAvgDocLength();
	}

	/**
	 * 쿼리 검색 — 상위 N개 결과 반환
	 */
	search(query: string, limit: number = 10): BM25Result[] {
		const queryTokens = tokenize(query);
		if (queryTokens.length === 0 || this.docCount === 0) {
			return [];
		}

		// 쿼리 토큰이 포함된 문서만 후보로
		const candidateIds = new Set<string>();
		for (const token of queryTokens) {
			const postings = this.invertedIndex.get(token);
			if (postings) {
				for (const docId of postings) {
					candidateIds.add(docId);
				}
			}
		}

		// 각 후보 문서의 BM25 점수 계산
		const results: BM25Result[] = [];
		for (const docId of candidateIds) {
			const doc = this.documents.get(docId)!;
			let score = 0;

			for (const token of queryTokens) {
				const idf = this.computeIDF(token);
				const tf = doc.termFreq.get(token) || 0;
				const tfNorm = (tf * (BM25Index.K1 + 1)) /
					(tf + BM25Index.K1 * (1 - BM25Index.B + BM25Index.B * doc.length / this.avgDocLength));
				score += idf * tfNorm;
			}

			if (score > 0) {
				results.push({ id: docId, score });
			}
		}

		// 점수 내림차순 정렬, 상위 limit개
		results.sort((a, b) => b.score - a.score);
		return results.slice(0, limit);
	}

	/**
	 * 인덱스 초기화
	 */
	clear(): void {
		this.documents.clear();
		this.invertedIndex.clear();
		this.avgDocLength = 0;
		this.docCount = 0;
	}

	/**
	 * 인덱싱된 문서 수
	 */
	get size(): number {
		return this.docCount;
	}

	// ========== Private ==========

	/**
	 * IDF (Inverse Document Frequency) 계산
	 */
	private computeIDF(term: string): number {
		const postings = this.invertedIndex.get(term);
		const df = postings ? postings.size : 0;
		if (df === 0) {
			return 0;
		}
		// IDF = ln((N - df + 0.5) / (df + 0.5) + 1)
		return Math.log((this.docCount - df + 0.5) / (df + 0.5) + 1);
	}

	/**
	 * 평균 문서 길이 재계산
	 */
	private recalcAvgDocLength(): void {
		if (this.docCount === 0) {
			this.avgDocLength = 0;
			return;
		}
		let totalLength = 0;
		for (const doc of this.documents.values()) {
			totalLength += doc.length;
		}
		this.avgDocLength = totalLength / this.docCount;
	}
}
