# TASK_004: 이전 대화 구분선

> **세션 시작 시 이전 대화와 현재 대화 구분 표시**

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

### 1. 구분선 표시 시점
- 새 세션 시작 시 (F5 재시작 후 등)
- 저장된 대화 기록 로드 시

### 2. 구분선 UI

```
│ ... 이전 대화 ...                    │
│                                      │
├──────── Previous Session ────────────┤
│          2026-01-26 14:30            │
│                                      │
│ ... 현재 대화 ...                    │
```

또는 더 심플하게:

```
│ ... 이전 대화 ...                    │
│                                      │
│  ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─  │
│                                      │
│ ... 현재 대화 ...                    │
```

### 3. 구분선 정보
- 이전 세션 종료 시간 (선택)
- "Previous conversation" 레이블

---

## Implementation

### Files to Modify

| File | Action |
|------|--------|
| `common/claudeTypes.ts` | MODIFY - 세션 구분 타입 추가 |
| `browser/claudeChatView.ts` | MODIFY - 구분선 렌더링 |
| `browser/claudeService.ts` | MODIFY - 세션 로드 시 마커 추가 |
| `browser/media/claude.css` | MODIFY - 구분선 스타일 |

### Key Changes

1. **세션 구분 마커 타입**
   ```typescript
   interface IClaudeSessionDivider {
     type: 'session-divider';
     timestamp: number;
     label?: string;
   }
   ```

2. **구분선 렌더링**
   ```typescript
   private renderSessionDivider(timestamp: number): HTMLElement {
     const divider = $('.claude-session-divider');
     // ...
   }
   ```

3. **CSS 스타일**
   ```css
   .claude-session-divider {
     display: flex;
     align-items: center;
     margin: 16px 0;
     color: var(--vscode-descriptionForeground);
   }
   .claude-session-divider::before,
   .claude-session-divider::after {
     content: '';
     flex: 1;
     border-bottom: 1px dashed var(--vscode-panel-border);
   }
   ```

---

## Acceptance Criteria

- [ ] 저장된 대화 로드 시 구분선 표시
- [ ] 구분선에 시간 정보 표시
- [ ] 시각적으로 명확하게 구분됨
- [ ] 새 대화는 구분선 없이 시작

---

## Notes

- 너무 눈에 띄지 않게 subtle한 디자인
- 구분선 클릭 시 접기/펼치기? (추후 고려)
