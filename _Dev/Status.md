# Development Status

> **현재 개발 진행 상태**

---

## Current

| Item | Value |
|------|-------|
| **Phase** | Phase 4 - 고급 UX 기능 |
| **Status** | 연결 오버레이 구현 완료, IPC 버그 수정 중 |
| **Updated** | 2026-01-27 |
| **Build** | 🔨 빌드 필요 |

---

## Now Working On

```
Task: IPC checkConnection 메서드 누락 수정
File: src/vs/code/electron-main/app.ts
Status: 수정 완료, 빌드 필요
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

### 리팩토링
- 로깅 시스템 (`claudeLogService.ts`)
- 연결 오버레이 (`claudeConnectionOverlay.ts`)
- 컴포넌트 분리 (Autocomplete, RateLimit, StatusBar 등)

---

## Remaining

- [ ] 실시간 글자별 스트리밍 (CLI 제한)
- [ ] 파일 탐색기에서 파일 선택
- [ ] 컨텍스트 메뉴 통합

---

## Architecture

### 폴더 구조

```
src/vs/workbench/contrib/kent/
├── browser/                    # Renderer Process
│   ├── kent.contribution.ts    # 서비스/뷰/설정 등록
│   ├── service/                # 서비스 (claudeService, connection, session)
│   ├── view/                   # UI 컴포넌트
│   └── media/claude.css
├── common/                     # 공통 타입/인터페이스
└── electron-main/              # Main Process (CLI 실행)

src/vs/code/electron-main/app.ts  # IPC 채널 등록
```

### IPC 통신 흐름

```
Renderer (ClaudeService) ──IPC──▶ Main (ClaudeCLIService)
         ◀── onDidReceiveData ──        spawn('claude')
         ◀── onDidComplete ────
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

## Activity Log

### 2026-01-27
- IPC `checkConnection`, `sendUserInput` 메서드 app.ts에 추가
- 서브에이전트 10개 구성 (architect, coder, debugger, reviewer, tester + 지식 5개)
- 개발 문서 정리

---

**AI Agent 작업 재개 시 이 문서 먼저 확인**
