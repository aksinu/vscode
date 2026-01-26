# TASK_001: @ 멘션 시스템

> **입력창에서 @로 파일/워크스페이스 멘션**

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

### 1. @ 트리거
- 입력창에서 `@` 입력 시 자동완성 팝업
- `@file` - 파일 선택
- `@workspace` - 워크스페이스 정보

### 2. 자동완성 항목
```
@file         → 파일 선택기 열기 (현재 에디터 파일)
@workspace    → 워크스페이스 컨텍스트 첨부
@<열린파일>   → 현재 열린 파일 목록에서 선택
```

### 3. 동작
- 선택 시 첨부파일로 추가 (기존 드래그/드롭과 동일)
- 입력창에서 `@xxx` 텍스트 제거

---

## Implementation

### 구현 내용
- `checkAutocomplete()` - @ 패턴 감지
- `showMentionAutocomplete()` - 멘션 항목 팝업
- `handleMentionItem()` - @file, @workspace 처리
- `handleFileItem()` - 열린 파일 선택 처리
- `attachWorkspaceContext()` - 워크스페이스 컨텍스트 첨부
- `removeAutocompleteText()` - 입력창에서 @xxx 제거

### 키보드 네비게이션
- `↑/↓` - 항목 선택
- `Enter/Tab` - 선택 확정
- `Esc` - 팝업 닫기

### Files Modified
| File | Action |
|------|--------|
| `browser/claudeChatView.ts` | MODIFIED - 자동완성 로직 추가 |
| `browser/media/claude.css` | MODIFIED - 자동완성 팝업 스타일 |
| `common/claudeTypes.ts` | MODIFIED - IClaudeAttachment에 'workspace' 타입 추가 |

---

## Acceptance Criteria

- [x] `@` 입력 시 자동완성 팝업 표시
- [x] 열린 파일 목록 표시
- [x] `@file` 선택 시 현재 에디터 파일 첨부
- [x] `@workspace` 선택 시 워크스페이스 정보 첨부
- [x] 선택된 항목이 첨부파일로 추가됨
- [x] 키보드 네비게이션 지원
