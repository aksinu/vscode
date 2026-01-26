# TASK_003: Diff 뷰 Apply

> **코드 적용 전 변경사항 미리보기**

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

### 1. Apply 버튼 동작
- 기존: 바로 코드 삽입
- 개선: QuickPick으로 "Preview Diff" / "Apply Directly" 선택

### 2. Preview Diff
- Diff 에디터로 원본/수정본 비교 표시
- Accept/Reject 알림 표시
- Accept 시 원본 파일에 적용

### 3. Apply Directly
- 기존 동작 유지 (바로 코드 삽입)

---

## Implementation

### 구현 내용
- `applyCode()` - QuickPick으로 적용 방식 선택
- `executeCodeApply()` - 코드 적용 실행
- `showDiffPreview()` - Diff 에디터 표시
- `applyDiffChanges()` - Diff에서 Accept 시 적용

### 핵심 패턴
```typescript
// Diff 에디터 열기
await this.editorService.openEditor({
    original: { resource: originalUri },
    modified: { resource: modifiedUri },
    label: "Claude: filename (Preview)"
});

// Accept/Reject 알림
await this.notificationService.prompt(2, message, [
    { label: "Accept", run: () => this.applyDiffChanges(...) },
    { label: "Reject", run: () => {} }
]);
```

### Files Modified
| File | Action |
|------|--------|
| `browser/claudeChatView.ts` | MODIFIED - applyCode 메서드 확장 |

---

## Acceptance Criteria

- [x] Apply 버튼 클릭 시 QuickPick 표시
- [x] "Preview Diff" 선택 시 Diff 에디터 열림
- [x] "Apply Directly" 선택 시 바로 적용
- [x] Diff에서 Accept 클릭 시 원본 파일에 적용
- [x] Diff에서 Reject 클릭 시 취소
