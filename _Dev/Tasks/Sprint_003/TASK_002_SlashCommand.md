# TASK_002: /슬래시 커맨드

> **입력창에서 /로 빠른 명령 실행**

---

## Overview

| Item | Value |
|------|-------|
| **Priority** | P1 |
| **Difficulty** | Low |
| **Status** | [x] Done |
| **Dependencies** | None |

---

## Requirements

### 1. / 트리거
- 입력창 시작에서 `/` 입력 시 자동완성 팝업
- 명령어 목록 표시

### 2. 커맨드 목록
```
/explain   → 코드 설명
/fix       → 버그 수정
/test      → 테스트 작성
/refactor  → 리팩토링
/docs      → 문서화
/optimize  → 성능 최적화
```

### 3. 동작
- 선택 시 해당 프롬프트로 입력창 교체
- 사용자가 추가 내용 입력 후 전송

---

## Implementation

### 구현 내용
- `checkAutocomplete()` - / 패턴 감지
- `showCommandAutocomplete()` - 커맨드 목록 팝업
- `handleCommandItem()` - 선택 시 프롬프트 삽입

### Files Modified
| File | Action |
|------|--------|
| `browser/claudeChatView.ts` | MODIFIED - @ 멘션과 함께 구현 |
| `browser/media/claude.css` | MODIFIED - 자동완성 스타일 |

---

## Acceptance Criteria

- [x] `/` 입력 시 자동완성 팝업 표시
- [x] 커맨드 목록 표시 (explain, fix, test, refactor, docs, optimize)
- [x] 키보드 네비게이션 (↑/↓, Enter, Esc)
- [x] 선택 시 프롬프트 삽입
