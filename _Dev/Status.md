# Development Status

> **현재 개발 진행 상태**

---

## Current

| Item | Value |
|------|-------|
| **Phase** | Phase 4 - 고급 UX 기능 |
| **Status** | File Changes Tracking 구현 완료 |
| **Updated** | 2026-01-28 |
| **Build** | 🔨 빌드 필요 |

---

## Now Working On

```
Task: File Changes Tracking 기능 완료
Status: 구현 완료, 빌드 및 테스트 필요
```

### 빌드 & 실행

```bash
cd D:/_______________Kent/vscode
yarn compile          # 빌드
./scripts/code.bat    # 실행
```

---

## Completed Features

### Phase 1 - 기본 구조
- Claude 모듈 기본 구조, 서비스, ViewPane, 액션/커맨드
- Markdown 렌더링, 코드 블록 (Copy/Insert/Apply)
- 파일 첨부 (열린 파일 버튼, 드래그드롭, 클립보드)

### Phase 2 - CLI 연동
- Main Process CLI 서비스, IPC 채널
- stdin 프롬프트 전달, 환경변수 정리
- 대화 기록 저장 (IStorageService)

### Phase 2.5 - AskUser & 컨텍스트
- AskUser 이벤트 처리, 대화 컨텍스트 전달

### Phase 4 - 고급 UX (Sprint 2-3)
- @ 멘션, /슬래시 커맨드, Diff 뷰 Apply
- Rate limit 재시도, 이미지 붙여넣기, 다중 세션
- 로컬 설정, Auto Accept, 대화 복사, 입력 큐

### Phase 4 - File Changes Tracking (2026-01-28)
- **FileSnapshotManager**: 파일 수정 전/후 스냅샷 관리
- **변경 감지**: Edit, Write, NotebookEdit 도구 자동 감지
- **UI 표시**: 메시지에 파일 변경 목록 표시
- **Diff 표시**: VS Code Diff 에디터 연동
- **Revert**: 개별/전체 파일 되돌리기
- **라인 통계**: 추가/삭제 라인 수 표시

### 리팩토링
- 로깅 시스템 (`claudeLogService.ts`)
- 연결 오버레이 (`claudeConnectionOverlay.ts`)
- 컴포넌트 분리 (Autocomplete, RateLimit, StatusBar 등)

---

## Remaining

- [ ] 실시간 글자별 스트리밍 (CLI 제한)
- [ ] 파일 탐색기에서 파일 선택
- [ ] 컨텍스트 메뉴 통합
- [ ] 세션 전체 변경사항 히스토리
- [ ] Accept/Reject 변경사항 UI

---

## Architecture

### 폴더 구조

```
src/vs/workbench/contrib/kent/
├── browser/                    # Renderer Process
│   ├── kent.contribution.ts    # 서비스/뷰/설정 등록
│   ├── service/                # 서비스
│   │   ├── claudeService.ts
│   │   ├── claudeConnection.ts
│   │   ├── claudeSessionManager.ts
│   │   ├── claudeCLIEventHandler.ts
│   │   ├── claudeFileSnapshot.ts    # ★ 파일 스냅샷
│   │   └── ...
│   ├── view/                   # UI 컴포넌트
│   │   ├── claudeChatView.ts
│   │   ├── claudeMessageRenderer.ts # ★ 파일 변경 UI
│   │   └── ...
│   └── media/claude.css
├── common/                     # 공통 타입/인터페이스
│   ├── claude.ts
│   ├── claudeTypes.ts          # ★ IClaudeFileChange
│   └── ...
└── electron-main/              # Main Process (CLI 실행)

src/vs/code/electron-main/app.ts  # IPC 채널 등록
```

### IPC 통신 흐름

```
Renderer (ClaudeService) ──IPC──▶ Main (ClaudeCLIService)
         ◀── onDidReceiveData ──        spawn('claude')
         ◀── onDidComplete ────
```

### File Changes 흐름

```
tool_use (Edit/Write) ──▶ captureBeforeEdit()
tool_result           ──▶ captureAfterEdit()
onDidComplete         ──▶ handleCommandComplete()
                           └── 메시지에 fileChanges 추가
                               └── renderFileChanges() UI
```

---

## Known Issues

| # | 버그 | 상태 |
|---|------|------|
| 1 | 터미널 conpty.node 에러 (빌드) | 🟡 P3 |

---

## Quick Reference

### Commands
| Command | Keybinding |
|---------|------------|
| `claude.openChat` | `Ctrl+Shift+C` |
| `claude.clearChat` | `Ctrl+Shift+K` |
| `claude.focusInput` | `Ctrl+L` |

### Settings
| Setting | Default |
|---------|---------|
| `claude.model` | `claude-sonnet-4-20250514` |
| `claude.maxTokens` | `4096` |

---

## Specs Reference

| Spec | 설명 |
|------|------|
| SPEC_001 | Chat Architecture 분석 |
| SPEC_002 | Claude Features 명세 |
| SPEC_003 | File Attachment 기능 |
| SPEC_004 | Status & Settings |
| SPEC_005 | File Changes Tracking ★ |

---

## Activity Log

### 2026-01-28
- File Changes Tracking 기능 구현
  - `claudeFileSnapshot.ts`: 스냅샷 매니저
  - `claudeTypes.ts`: IClaudeFileChange, IClaudeFileChangesSummary 타입
  - `claudeMessageRenderer.ts`: renderFileChanges() UI
  - `claude.css`: 파일 변경 스타일
  - `claudeService.ts`: showFileDiff, revertFile, revertAllFiles
- SPEC_005_FileChangesTracking.md 문서 작성

### 2026-01-27
- IPC `checkConnection`, `sendUserInput` 메서드 app.ts에 추가
- 서브에이전트 10개 구성 (architect, coder, debugger, reviewer, tester + 지식 5개)
- 개발 문서 정리

---

**AI Agent 작업 재개 시 이 문서 먼저 확인**
