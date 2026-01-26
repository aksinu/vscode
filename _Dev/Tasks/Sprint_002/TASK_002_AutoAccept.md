# TASK_002: 모두 OK (Auto Accept) 모드

> **"나한테 묻지말고 그냥 진행해" 기능**

---

## Overview

| Item | Value |
|------|-------|
| **Priority** | P1 |
| **Difficulty** | Low |
| **Status** | [x] Done |
| **Dependencies** | TASK_001 (설정 시스템) |

---

## Requirements

### 1. 동작 방식
- AskUser 질문이 오면 자동으로 첫 번째 옵션 선택
- UI에 잠깐 표시 후 자동 응답 (사용자가 뭘 선택했는지 알 수 있게)
- 또는 토글로 활성화/비활성화

### 2. 설정

**로컬 설정 (claude.local.json)**
```json
{
  "claude.autoAccept": true
}
```

**UI 토글**
- 채팅창 상단 또는 툴바에 토글 버튼
- 아이콘: `$(check-all)` 또는 비슷한 것

### 3. 자동 응답 시 표시
```
┌─────────────────────────────────────┐
│ [Auto] Selected: "Option A"         │
│ (Auto-accept enabled)               │
└─────────────────────────────────────┘
```

---

## Implementation

### Files to Modify

| File | Action |
|------|--------|
| `browser/claudeService.ts` | MODIFY - 자동 응답 로직 |
| `browser/claudeChatView.ts` | MODIFY - 토글 버튼 UI |
| `browser/claudeMessageRenderer.ts` | MODIFY - 자동 선택 표시 |
| `browser/media/claude.css` | MODIFY - 자동 선택 스타일 |

### Key Changes

1. **자동 응답 로직**
   ```typescript
   if (this._autoAcceptEnabled && askUserRequest) {
     const firstOption = askUserRequest.questions[0].options[0].label;
     await this.respondToAskUser([firstOption]);
   }
   ```

2. **UI 토글**
   - 상태 저장 (세션 or 설정)
   - 시각적 피드백 (활성/비활성)

---

## Acceptance Criteria

- [ ] 설정에서 `autoAccept: true` 시 자동 응답
- [ ] UI에서 토글 가능
- [ ] 자동 선택 시 어떤 옵션이 선택됐는지 표시
- [ ] 비활성화 시 기존 동작 유지

---

## Notes

- 위험한 작업(파일 삭제 등)도 자동 승인되므로 주의 문구 필요
- 추후: 특정 도구만 자동 승인하는 세분화 옵션
