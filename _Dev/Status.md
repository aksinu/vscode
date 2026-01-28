# Development Status

> **현재 개발 진행 상태**

---

## Current

| Item | Value |
|------|-------|
| **Phase** | Phase 4 - 고급 UX 기능 |
| **Status** | OpenFilesBar UI 개선 완료 |
| **Updated** | 2026-01-28 |
| **Build** | ✅ 빌드 완료 |

---

## Now Working On

```
Task: 설정 윈도우 구현 완료
Status: 컴파일 필요
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

> 상세 내용은 **[Backlog.md](./Backlog.md)** 참조

### 🎯 VS Code 확장 기능 (Claude CLI 독립적)
| # | Feature | Priority | Status |
|---|---------|----------|--------|
| 1 | 파일 탐색기 컨텍스트 메뉴 | P1 | Pending |
| 2 | 에디터 컨텍스트 메뉴 | P1 | Pending |
| 3 | 세션별 변경사항 히스토리 | P2 | Pending |
| 4 | Accept/Reject 배치 UI | P3 | Enhancement |

### ✅ 이미 지원됨 (Claude CLI 기본 기능)
- [x] **실시간 스트리밍**: `--output-format stream-json` 이미 구현됨
- [x] **세션 관리**: `--resume`, `--continue` 지원
- [x] **도구 제한**: `--allowed-tools` 설정 가능

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
- **설정 윈도우 구현**
  - `claudeSettingsPanel.ts`: 전체 설정 모달 (Model, Extended Thinking, Auto Accept, Script)
  - `claudeSessionSettingsPanel.ts`: 세션별 설정 모달 (Session Name, Model Override, Continue)
  - `claudeLocalConfig.ts`: model, extendedThinking 필드 추가
  - `claude.ts`: setSessionModel, setSessionExtendedThinking, continueLastSession 메서드 추가
  - `claudeService.ts`: 세션 오버라이드 로직 구현
  - `claudeCLI.ts`: extendedThinking 옵션 추가
  - `claudeStatusBar.ts`: QuickPick 제거, 세션 설정 윈도우 연동
  - `claude.css`: 설정 다이얼로그 스타일
- **OpenFilesBar UI 개선**
  - 위치 변경: 채팅 상단 → 입력창 바로 위
  - 표시 대상 변경: 모든 열린 파일 → 현재 보이는 에디터만
  - `claudeChatView.ts`: openFilesContainer 위치 이동
  - `claudeOpenFilesBar.ts`: visibleEditors만 사용, 디버그 로그 제거
- **빌드 환경 수정**
  - `.vscode/tasks.json`: preLaunch 태스크가 WSL 대신 cmd.exe 사용하도록 수정
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
