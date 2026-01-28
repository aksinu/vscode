# SPEC_005: File Changes Tracking

> **Claude 파일 변경사항 추적 및 Diff/Revert 기능**

---

## Overview

Claude가 파일을 수정할 때 변경 전/후 상태를 추적하고, 사용자에게 변경사항을 시각적으로 표시하며, 필요시 되돌리기(Revert) 기능을 제공.

---

## 1. 핵심 기능

### 기능 목록

| 기능 | 설명 | 상태 |
|------|------|------|
| 스냅샷 캡처 | 파일 수정 전/후 내용 저장 | [x] 완료 |
| 변경 감지 | Edit, Write, NotebookEdit 도구 감지 | [x] 완료 |
| Diff 표시 | VS Code Diff 에디터로 변경사항 표시 | [x] 완료 |
| UI 표시 | 메시지에 파일 변경 목록 표시 | [x] 완료 |
| 개별 Revert | 특정 파일 변경 되돌리기 | [x] 완료 |
| 전체 Revert | 모든 변경사항 되돌리기 | [x] 완료 |
| 라인 통계 | 추가/삭제 라인 수 계산 | [x] 완료 |

---

## 2. 아키텍처

### 데이터 흐름

```
Tool Use Event (Edit/Write)
         │
         ▼
┌─────────────────────────────┐
│    CLIEventHandler          │
│  - isFileModifyTool()       │
│  - extractFilePath()        │
└─────────────────────────────┘
         │
         ▼
┌─────────────────────────────┐
│   FileSnapshotManager       │
│  - captureBeforeEdit()      │  ← 수정 전 내용 저장
│  - captureAfterEdit()       │  ← 수정 후 내용 저장
│  - getChangesSummary()      │
└─────────────────────────────┘
         │
         ▼
┌─────────────────────────────┐
│     ClaudeService           │
│  - handleCommandComplete()  │  ← 메시지에 변경사항 추가
└─────────────────────────────┘
         │
         ▼
┌─────────────────────────────┐
│   ClaudeMessageRenderer     │
│  - renderFileChanges()      │  ← UI 렌더링
└─────────────────────────────┘
```

### 파일 구조

```
src/vs/workbench/contrib/kent/
├── browser/
│   └── service/
│       └── claudeFileSnapshot.ts    # 스냅샷 매니저
├── common/
│   └── claudeTypes.ts               # IClaudeFileChange 타입
└── browser/
    └── view/
        └── claudeMessageRenderer.ts # UI 렌더링
```

---

## 3. 타입 정의

### IClaudeFileChange

```typescript
interface IClaudeFileChange {
  readonly filePath: string;           // 전체 경로
  readonly fileName: string;           // 파일명만
  readonly changeType: 'created' | 'modified' | 'deleted';
  readonly linesAdded: number;
  readonly linesRemoved: number;
  readonly originalContent: string;    // Revert용
  readonly modifiedContent: string;
  reverted?: boolean;                  // Revert 완료 여부
}
```

### IClaudeFileChangesSummary

```typescript
interface IClaudeFileChangesSummary {
  readonly filesCreated: number;
  readonly filesModified: number;
  readonly filesDeleted: number;
  readonly totalLinesAdded: number;
  readonly totalLinesRemoved: number;
  readonly changes: IClaudeFileChange[];
}
```

---

## 4. UI 컴포넌트

### 파일 변경 목록 (메시지 내)

```
┌─────────────────────────────────────────────────┐
│ ▼ 📁 2 modified, 1 created  +45 -12  [Revert All] │
├─────────────────────────────────────────────────┤
│ ● claudeService.ts          +30 -8    [Diff][⟲] │
│ ● claudeTypes.ts            +15 -4    [Diff][⟲] │
│ + claudeFileSnapshot.ts     +120      [Diff][⟲] │
└─────────────────────────────────────────────────┘
```

### UI 요소

| 요소 | 설명 |
|------|------|
| 헤더 | 토글 가능, 파일 수/라인 변경 요약 |
| 파일 목록 | 각 파일별 상태, 라인 변경, 버튼 |
| 상태 아이콘 | 🟢 created, 🟡 modified, 🔴 deleted |
| Diff 버튼 | 클릭 시 VS Code Diff 에디터 열기 |
| Revert 버튼 | 개별 파일 되돌리기 |
| Revert All | 모든 변경 되돌리기 |

### CSS 클래스

```css
.claude-file-changes           /* 컨테이너 */
.claude-file-changes-header    /* 헤더 (토글 가능) */
.claude-file-changes-summary   /* 요약 텍스트 */
.claude-file-changes-list      /* 파일 목록 */
.claude-file-changes-item      /* 개별 파일 */
.claude-file-status-icon       /* 상태 아이콘 */
.claude-file-name              /* 파일명 */
.claude-file-line-changes      /* 라인 변경 (+/-) */
.claude-file-buttons           /* 버튼 그룹 */
.claude-file-button            /* 개별 버튼 */
```

---

## 5. 서비스 API

### IClaudeService 추가 메서드

```typescript
interface IClaudeService {
  // 기존 메서드...

  // File Changes
  getChangedFiles?(): IClaudeFileChange[];
  getFileChangesSummary?(): IClaudeFileChangesSummary;
  showFileDiff?(fileChange: IClaudeFileChange): Promise<void>;
  revertFile?(fileChange: IClaudeFileChange): Promise<boolean>;
  revertAllFiles?(): Promise<number>;
}
```

### FileSnapshotManager 메서드

```typescript
class FileSnapshotManager {
  // 명령 시작/종료
  startCommand(workingDir?: string): void;
  clear(): void;

  // 스냅샷
  captureBeforeEdit(filePath: string): Promise<void>;
  captureAfterEdit(filePath: string): Promise<void>;

  // 조회
  getChangedFiles(): IClaudeFileChange[];
  getChangesSummary(): IClaudeFileChangesSummary;
  get snapshotCount(): number;
  get changedFileCount(): number;

  // Diff
  showDiff(fileChange: IClaudeFileChange): Promise<void>;
  showAllDiffs(): Promise<void>;

  // Revert
  revertFile(filePath: string): Promise<boolean>;
  revertAll(): Promise<number>;

  // 이벤트
  readonly onDidChangeFiles: Event<IClaudeFileChangesSummary>;
}
```

---

## 6. 도구 감지

### 파일 수정 도구

| 도구 | 파일 경로 필드 |
|------|---------------|
| Edit | `file_path` |
| Write | `file_path` |
| NotebookEdit | `notebook_path` |

### CLIEventHandler 처리

```typescript
private isFileModifyTool(toolName: string): boolean {
  return ['Edit', 'Write', 'NotebookEdit'].includes(toolName);
}

private extractFilePath(toolName: string, input: unknown): string | undefined {
  // Edit, Write: input.file_path
  // NotebookEdit: input.notebook_path
}
```

---

## 7. Diff 에디터 통합

### 커스텀 URI 스키마

```typescript
// 원본 내용
const originalUri = uri.with({
  scheme: 'claude-original',
  query: `ts=${Date.now()}`
});

// 수정된 내용
const modifiedUri = uri.with({
  scheme: 'claude-modified',
  query: `ts=${Date.now()}`
});
```

### TextModelContentProvider

```typescript
textModelService.registerTextModelContentProvider('claude-original', {
  provideTextContent: async () => {
    return modelService.createModel(originalContent, null, originalUri);
  }
});
```

---

## 8. 제한사항 및 향후 개선

### 현재 제한사항

- 명령 단위로만 추적 (세션 전체 X)
- 같은 파일 여러 번 수정 시 최초 원본만 저장
- 바이너리 파일 미지원

### 향후 개선 사항

| 기능 | 우선순위 | 설명 |
|------|---------|------|
| 세션 히스토리 | P2 | 전체 세션 변경사항 기록 |
| 부분 Revert | P3 | 특정 hunk만 되돌리기 |
| Accept/Reject | P2 | 변경사항 수락/거부 UI |
| Inline Diff | P3 | 에디터 내 인라인 표시 |

---

## 9. 관련 파일

| 파일 | 역할 |
|------|------|
| `claudeFileSnapshot.ts` | 스냅샷 매니저 구현 |
| `claudeTypes.ts` | 타입 정의 |
| `claudeService.ts` | 서비스 구현 |
| `claudeCLIEventHandler.ts` | 도구 감지 |
| `claudeMessageRenderer.ts` | UI 렌더링 |
| `claude.css` | 스타일 |

---

**작성일**: 2026-01-28
**상태**: 구현 완료
