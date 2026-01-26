# TASK_003: 대화 기록 복사 기능

> **드래그/드롭 또는 클릭으로 메시지 복사**

---

## Overview

| Item | Value |
|------|-------|
| **Priority** | P2 |
| **Difficulty** | Low |
| **Status** | [x] Done |
| **Dependencies** | None |

---

## Requirements

### 1. 복사 방식

**Option A: 드래그로 선택**
- 텍스트 드래그하면 선택 → Ctrl+C로 복사
- 기본 브라우저 동작 활용

**Option B: 메시지 단위 복사 버튼**
- 각 메시지에 복사 버튼 (hover 시 표시)
- 클릭 시 전체 메시지 복사

**Option C: 둘 다 지원** ← 권장

### 2. 복사 버튼 UI
```
┌─────────────────────────────────────┐
│ Claude                    [📋] [⋯] │
│ Here is the code...                 │
└─────────────────────────────────────┘
         ↑ hover 시 표시
```

### 3. 복사 피드백
- 버튼 아이콘 변경 (copy → check)
- 또는 토스트 알림

---

## Implementation

### Files to Modify

| File | Action |
|------|--------|
| `browser/claudeMessageRenderer.ts` | MODIFY - 복사 버튼 추가 |
| `browser/media/claude.css` | MODIFY - 복사 버튼 스타일 |

### Key Changes

1. **메시지 헤더에 복사 버튼 추가**
   ```typescript
   const copyButton = append(headerElement, $('button.claude-message-copy'));
   copyButton.title = 'Copy message';
   // hover 시에만 표시 (CSS)
   ```

2. **텍스트 선택 허용**
   ```css
   .claude-message-content {
     user-select: text;
   }
   ```

---

## Acceptance Criteria

- [ ] 메시지 텍스트 드래그 선택 가능
- [ ] 각 메시지에 복사 버튼 (hover 시 표시)
- [ ] 복사 성공 시 피드백 표시
- [ ] 코드 블록은 기존 복사 버튼 유지

---

## Notes

- Markdown 렌더링된 내용 vs 원본 텍스트 중 선택 필요
- 코드 블록은 이미 복사 버튼 있음 → 중복 주의
