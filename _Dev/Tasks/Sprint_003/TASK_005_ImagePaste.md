# TASK_005: 이미지 붙여넣기 기능

> **클립보드에서 이미지 붙여넣기 (Ctrl+V)**

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

### 1. 클립보드 이미지 감지
- Win+Shift+S 캡처 후 Ctrl+V
- 일반 이미지 복사 후 Ctrl+V
- paste 이벤트에서 이미지 타입 확인

### 2. 이미지 처리
- File을 base64로 변환
- 첨부파일로 추가 (type: 'image')

### 3. UI 표시
- 이미지 아이콘으로 표시 (codicon-file-media)
- 파일명: screenshot-{timestamp}.{extension}

---

## Implementation

### 핵심 로직
```typescript
// paste 이벤트 처리
handlePaste(e: ClipboardEvent)
handlePastedImage(file: File)
fileToBase64(file: File): Promise<string>
```

### Files Modified
| File | Action |
|------|--------|
| `browser/claudeChatView.ts` | MODIFIED - paste 이벤트 처리 |
| `common/claudeTypes.ts` | MODIFIED - IClaudeAttachment에 이미지 필드 추가 |
| `browser/claudeService.ts` | MODIFIED - 프롬프트에 이미지 데이터 포함 |

---

## Acceptance Criteria

- [x] Ctrl+V로 이미지 붙여넣기
- [x] 이미지가 첨부파일로 추가됨
- [x] 이미지 아이콘 표시
- [x] Base64 데이터로 변환
- [x] 프롬프트에 이미지 데이터 포함
