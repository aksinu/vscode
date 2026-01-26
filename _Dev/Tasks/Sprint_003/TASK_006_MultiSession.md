# TASK_006: 다중 세션 관리

> **여러 세션을 동시에 관리하고 전환하는 기능**

---

## Overview

| Item | Value |
|------|-------|
| **Priority** | P2 |
| **Difficulty** | Medium |
| **Status** | [x] Done |
| **Dependencies** | None |

---

## Requirements

### 1. 세션 전환
- A 작업 → B 작업 → A 작업으로 복귀
- 각 세션의 대화 기록 유지

### 2. 세션 관리 UI
- 세션 목록 QuickPick
- 현재 세션 표시 (체크 아이콘)
- 새 세션 생성 옵션

### 3. 세션 데이터
- 세션별 제목 (첫 메시지 기반)
- 메시지 개수 표시
- 마지막 메시지 미리보기

---

## Implementation

### 핵심 로직
```typescript
// claudeService.ts - 세션 관리
switchSession(sessionId: string): IClaudeSession | undefined
deleteSession(sessionId: string): boolean
renameSession(sessionId: string, title: string): boolean

// claudeChatView.ts - UI
showSessionManager()
switchToSession(sessionId: string)
```

### Files Modified
| File | Action |
|------|--------|
| `browser/claudeService.ts` | MODIFIED - 세션 전환/삭제/이름변경 메서드 |
| `browser/claudeChatView.ts` | MODIFIED - 세션 관리 버튼 및 QuickPick UI |
| `common/claude.ts` | MODIFIED - 인터페이스에 세션 관리 메서드 추가 |

---

## Acceptance Criteria

- [x] 세션 목록 QuickPick 표시
- [x] 새 세션 생성
- [x] 세션 간 전환
- [x] 세션별 대화 기록 유지
- [x] 현재 세션 표시
