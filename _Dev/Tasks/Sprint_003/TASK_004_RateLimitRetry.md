# TASK_004: 토큰 소진 시 자동 대기/재시도

> **Rate limit 에러 발생 시 자동으로 대기 후 재시도**

---

## Overview

| Item | Value |
|------|-------|
| **Priority** | P1 |
| **Difficulty** | Medium |
| **Status** | [x] Done |
| **Dependencies** | None |

---

## Requirements

### 1. Rate limit 에러 감지
- stderr에서 rate limit 관련 메시지 파싱
- 다양한 패턴 지원: "rate limit", "429", "quota exceeded", "token exhausted"

### 2. 대기 시간 파싱
- "retry after X seconds/minutes" 패턴 파싱
- 기본값: 60초

### 3. 자동 재시도
- 카운트다운 UI 표시
- 대기 시간 후 자동 재시도
- 수동 취소 가능

### 4. 상세 로그
- 테스트가 어려우므로 디버깅용 로그 상세히 남김
- `debugLog()` 함수로 파일 로깅

---

## Implementation

### 핵심 로직
```typescript
// claudeCLIService.ts - 에러 파싱
function parseRateLimitError(errorText: string): IClaudeRateLimitInfo | null

// claudeService.ts - 재시도 처리
handleRateLimitError(retryAfterSeconds, message)
retryAfterRateLimit()
cancelRateLimitWait()
```

### Files Modified
| File | Action |
|------|--------|
| `common/claudeCLI.ts` | MODIFIED - IClaudeRateLimitInfo 타입 추가 |
| `electron-main/claudeCLIService.ts` | MODIFIED - rate limit 파싱 로직 |
| `browser/claudeService.ts` | MODIFIED - 재시도 로직, 카운트다운 |
| `common/claude.ts` | MODIFIED - 인터페이스에 rate limit 메서드 추가 |

---

## Acceptance Criteria

- [x] Rate limit 에러 감지
- [x] 대기 시간 파싱 (seconds/minutes/hours)
- [x] 카운트다운 UI 표시
- [x] 자동 재시도
- [x] 상세 로그 기록
- [x] 수동 취소 기능
