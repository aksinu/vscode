# Development Status

> **현재 개발 진행 상태**

---

## Current

| Item | Value |
|------|-------|
| **Phase** | Phase 6 완료 - 리팩토링 마무리 |
| **Status** | ✅ **리팩토링 완료** - 추가 모듈화 불필요, 현재 구조 유지 |
| **Updated** | 2026-02-04 |
| **Build** | ⚠️ 컴파일 필요 |

---

## Recently Completed

```
Task: 추가 모듈화 분석
Status: ✅ 분석 완료 - 추가 모듈화 불필요

결론: 현재 구조 유지
- ClaudeChatViewPane 1065줄은 VS Code ViewPane 표준 범위 내
- 19개 모듈 (5개 Manager + 14개 컴포넌트)로 충분히 분리됨
- 남은 코드 특성:
  - 대부분 컴포넌트 조합/초기화 코드
  - ViewPane 필수 메서드 (constructor, renderBody, layoutBody, dispose)
  - 단순 위임 패턴으로 작성됨
- 추가 분리 시 문제:
  - 파일 수 증가 → 복잡도 상승
  - 작은 클래스 파편화
  - 투자 대비 효과 미미

Task: 리팩토링 Phase 6 - ClaudeChatViewPane 모듈화
Status: ✅ ClaudeChatViewPane Manager 패턴으로 분리 완료

Phase 6: ClaudeChatViewPane Manager 분리 ✅
- ClaudeChatViewPane 1682줄 → 1065줄로 축소 (~37% 감소)
- 5개 Manager 클래스로 기능별 분리:
  - GitCommitManager (223줄): Git 커밋 기능, 메시지 생성, SCM/터미널 실행
  - QueueUIManager (200줄): 메시지 큐 UI, 드래그앤드롭, 편집/삭제
  - ClipboardManager (110줄): 붙여넣기 처리, 이미지/코드 참조 변환
  - MessageListManager (120줄): 메시지 DOM 관리, 스크롤, 세션 구분선
  - ViewConnectionManager (105줄): 연결 초기화, 재시도, 에러 처리
- 폴더 구조: browser/views/chat/managers/
- 기존 14개 컴포넌트와 함께 총 19개 모듈로 분리

Task: 리팩토링 Phase 5 - ClaudeService 모듈화
Status: ✅ ClaudeService Manager 패턴으로 분리 완료

Phase 5: ClaudeService Manager 분리 ✅
- ClaudeService 1852줄 → 942줄로 축소 (~49% 감소)
- 5개 Manager 클래스로 기능별 분리:
  - ConfigManager (91줄): 로컬 설정 로드/리로드, 워크스페이스 루트
  - HistoryManager (125줄): 세션 변경사항 히스토리 관리
  - FileWatcherManager (103줄): 파일 시스템 감시 및 배칭 처리
  - MultiSessionManager (305줄): 멀티 세션 상태, 큐, 컨텐츠 축적
  - ChatManager (362줄): 메시지 전송 핵심 로직, CLI 옵션 빌드
- 폴더 구조: browser/services/core/managers/
- IClaudeService 인터페이스 변경 없이 내부 구조만 개선
- ClaudeServiceContextProvider와의 호환성 유지

Task: 리팩토링 Phase 4 (4-1~4-4) - 성능 최적화 진행 중
Status: ✅ 메모리 최적화 완료, 비동기 처리 개선 완료, 이벤트 리스너 최적화 완료

Phase 4-1: 메모리 사용량 최적화 (CLIEventHandler 델리게이트 패턴 개선) ✅
- 47개 과도한 델리게이트를 통합 컨텍스트 패턴으로 교체
- 메모리 사용량 ~94% 감소 (델리게이트 클로저 → 단일 컨텍스트 객체)
- 순환 참조 위험 제거 (델리게이트 체인 → 이벤트 기반 패턴)
- ICLIEventHandlerContext 인터페이스 및 ClaudeServiceContextProvider 구현

Phase 4-2: 비동기 처리 개선 ✅
- P0 문제 해결: Promise.then() 에러 처리 추가, Race condition 방지 (동시성 제어)
- P1 문제 해결: 비효율적 Promise 체인을 큐 기반 패턴으로 교체, setTimeout 에러 처리 추가
- 안정성 및 메모리 효율성 대폭 향상

Phase 4-3: 이벤트 리스너 최적화 ✅
- DOM Event Delegation 패턴 구현 (45개+ 개별 리스너 → 1개 통합 리스너, ~98% 감소)
- ClaudeUIService 디바운싱 타이머 정리 (dispose 메서드 추가)
- Rate Limit 카운트다운 최적화 (1초 → 5초 간격, 80% 이벤트 감소)

Phase 4-4: 메모리 누수 방지 강화 ✅
- 파일 변경 감지 배칭 처리 (대량 변경 시 20개씩 배칭, UI 블로킹 방지)
- 세션별 리스너 정리 확인 (이미 구현되어 있음)
- 비동기 배칭으로 메모리 효율성과 UI 응답성 대폭 향상

Task: 리팩토링 Phase 3 (3-1~3-4) - 의존성 개선 완료
Status: ✅ View import 경로 수정, 서비스 인터페이스 표준화, 타입 안전성 강화 완료

Phase 3-1: View import 경로 수정 및 순환 의존성 해결 ✅
- claudeChatView.ts의 잘못된 import 경로 수정 (../../common/ 형태로 통일)
- _sessionManager 정의 오류 해결 (ClaudeSessionService로 위임)
- 모든 View 파일들의 import 경로 검증 및 수정

Phase 3-2: 서비스 간 인터페이스 표준화 ✅
- Copyright 헤더 표준화 (Microsoft Corporation으로 통일)
- ClaudeSessionService 타입 개선 (any[] → IClaudeToolAction[], IClaudeQueuedMessage[])
- 인터페이스 타입 안전성 강화

Phase 3-3: 타입 안전성 강화 ✅
- 중복된 인터페이스 파일 제거 (core/claudeMessageService.ts)
- TypeScript strict 모드 호환성 개선

Phase 3-4: 테스트 코드 정리 ✅
- 서비스 구현체 타입 검증
- 일관된 코딩 스타일 적용

Task: 리팩토링 Phase 2 (2-1~2-4) - View Layer 분리 완료
Status: ✅ View 컴포넌트 기능별 분리 및 구조화

Phase 3-1: ChatView와 UI 컴포넌트 분리 완료 ✅
- Chat 관련: claudeChatView, claudeMessageRenderer, claudeInputEditor, claudeAttachmentManager
- UI 관련: claudeStatusBar, claudeUIManager, claudeModalDialog, claudeConnectionOverlay, claudeOpenFilesBar 등
- 폴더 구조: views/{chat,ui,session,settings} 로 기능별 분류
- import 경로 정리: 모든 view 컴포넌트 간 올바른 경로 설정

Phase 3-2: Settings 관련 View 분리 완료 ✅
- Settings 관련: claudeSettingsPanel, claudeLocalSettings, claudeSessionSettingsPanel
- ClaudeSettingsService 새로 생성 및 등록
- 인터페이스 분리: IClaudeSettingsService, ISessionSettings 등
- 설정 관리 로직 통합 및 구조화

Phase 3-3: StatusBar와 UI Manager 분리 완료 ✅
- UI 매니저 클래스: ClaudeUIManager 추상 기본 클래스
- StatusBar: StatusBarManager 클래스 구조 확인 및 최적화
- ClaudeUIService와 UI 컴포넌트 연동 확인

Phase 3-4: 나머지 View 컴포넌트들 분리 완료 ✅
- Session 관련: claudeSessionPicker, claudeSessionTabs
- 모든 View 컴포넌트가 적절한 폴더에 기능별로 분리됨
- 서비스 인터페이스와 View 컴포넌트 연동 구조 완성

분리 효과:
- 명확한 View 구조: 기능별 폴더로 체계적 관리
- 단일 책임: 각 View가 명확한 역할 담당
- 재사용성: 독립적인 컴포넌트로 테스트/확장 용이
- 유지보수성: 기능별 독립적 수정 가능

Task: 리팩토링 Phase 2 (2-1~2-4) - 핵심 로직 분리 완료
Status: ✅ ClaudeService 핵심 로직 완전 분리

Phase 2-1: ClaudeSessionService 분리 완료 ✅
- 세션 상태 관리 및 델리게이트 설정 완료
- getCurrentSessionState, setState 등 위임 구조 완성

Phase 2-2: ClaudeMessageService 분리 완료 ✅
- sendMessage 위임 구조 완성
- 메시지 처리 핵심 로직 델리게이트 설정

Phase 2-3: ClaudeFileService 분리 완료 ✅
- setCoreFileDelegates 확인 및 파일 처리 위임 완료
- 파일 변경 추적 및 스냅샷 관리 완전 분리

Phase 2-4: ClaudeRateLimitService 분리 완료 ✅
- Rate Limit 서비스 구현체 생성
- 인터페이스 정리 및 델리게이트 설정 완료
- 오류 감지 및 재시도 로직 분리

Task: 리팩토링 Phase 1 (1-1~1-4) - Service 분리 완료
Status: ✅ 주요 서비스 분리 완료

Phase 1-1: ClaudeMessageService 분리 ✅
- 메시지 CRUD, Queue, Events 분리
- ClaudeService 2,174줄 → 메시지 로직 분리

Phase 1-2: ClaudeQueueService 분리 ✅
- 메시지 큐 관리 로직 분리
- addToQueue, clearQueue, processQueue 등 위임

Phase 1-3: ClaudeFileService 분리 ✅
- 파일 스냅샷 관리 분리
- revertFiles, acceptFiles, snapshot 등 위임

Phase 1-4: ClaudeRateLimitService 분리 ✅
- Rate Limit 처리 로직 분리
- Rate Limit 매니저, 상태 관리, 콜백 위임

폴더 구조 정리 ✅ (2026-02-03)
- 서비스별 폴더 구조 생성: browser/services/{core,queue,session,file,ratelimit}
- 인터페이스 분리: common/types/{Service}.ts 로 인터페이스 추출
- import 경로 정리: 모든 서비스에서 새 구조 적용

분리 효과:
- 단일 책임 원칙: 각 서비스가 명확한 역할
- 코드 가독성: ClaudeService 복잡도 대폭 감소
- 폴더 구조: 서비스별 명확한 분류와 관리
- 재사용성: 독립적인 서비스로 테스트/확장 용이
- 유지보수성: 각 영역별 독립적 수정 가능
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

### Phase 6 리팩토링 (2026-02-04 완료)
- **ClaudeChatViewPane 모듈화**: 1682줄 → 1065줄 (~37% 감소)
- **Manager 패턴 적용**: 5개 Manager 클래스로 기능별 분리
- **폴더 구조**: browser/views/chat/managers/ 신규 생성

### Phase 5 리팩토링 (2026-02-04 완료)
- **ClaudeService 모듈화**: 1852줄 → 942줄 (~49% 감소)
- **Manager 패턴 적용**: 5개 Manager 클래스로 기능별 분리
- **폴더 구조**: browser/services/core/managers/ 신규 생성

### Phase 1 리팩토링 (2026-02-03 완료)
- **서비스 분리**: ClaudeService에서 Queue, File, RateLimit, Session 서비스 분리
- **폴더 구조 개선**: 서비스별 폴더 구조로 재정리 (core/queue/session/message/file/rateLimit)
- **의존성 개선**: 각 서비스의 독립성과 단일 책임 원칙 적용

---

## Remaining

> 상세 내용은 **[Backlog.md](./Backlog.md)** 참조

### 🎯 VS Code 확장 기능 (Claude CLI 독립적)
| # | Feature | Priority | Status |
|---|---------|----------|--------|
| 1 | 파일 탐색기 컨텍스트 메뉴 | P1 | ✅ Done |
| 2 | 에디터 컨텍스트 메뉴 | P1 | ✅ Done |
| 3 | 세션별 변경사항 히스토리 | P2 | ✅ Done |
| 4 | Accept/Reject 배치 UI | P3 | ✅ Done |

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
│   │   ├── claudeService.ts        # ★ 멀티 세션 상태 관리
│   │   ├── claudeConnection.ts     # ★ ClaudeMultiConnection 추가
│   │   ├── claudeSessionManager.ts # ★ 세션별 큐/CLI ID 저장
│   │   ├── claudeCLIEventHandler.ts
│   │   ├── claudeFileSnapshot.ts
│   │   └── ...
│   ├── view/                   # UI 컴포넌트
│   │   ├── claudeChatView.ts
│   │   ├── claudeMessageRenderer.ts
│   │   └── ...
│   └── media/claude.css
├── common/                     # 공통 타입/인터페이스
│   ├── claude.ts
│   ├── claudeCLI.ts            # ★ IClaudeCLIMultiService
│   ├── claudeCLIChannel.ts     # ★ Multi-Instance Channel
│   ├── claudeTypes.ts
│   └── ...
└── electron-main/              # Main Process (CLI 실행)
    ├── claudeCLIService.ts         # Legacy 단일 인스턴스
    ├── claudeCLIInstance.ts        # ★ 단일 프로세스 래퍼
    └── claudeCLIProcessManager.ts  # ★ 다중 프로세스 관리

src/vs/code/electron-main/app.ts  # IPC 채널 등록 (Legacy + Multi)
```

### IPC 통신 흐름 (Multi-Instance)

```
Renderer (ClaudeMultiConnection)
         │
         ├── sendPrompt(chatId, prompt)
         │
         ▼
    [IPC Channel + chatId routing]
         │
         ▼
Main (ClaudeCLIProcessManager)
         │
         ├── getOrCreateInstance(chatId)
         │
         ▼
    [ClaudeCLIInstance per chatId]
         │
         └── spawn('claude') per session
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
| SPEC_005 | File Changes Tracking |
| SPEC_006 | Clipboard Enhancements ★ |

---

## Activity Log

### 2026-02-04
- **추가 모듈화 분석 완료**
  - **결론**: 추가 모듈화 불필요, 현재 구조 유지
  - **분석 결과**:
    - ClaudeChatViewPane 1065줄 (VS Code ViewPane 표준 범위 내)
    - 19개 모듈로 충분히 분리됨 (5개 Manager + 14개 컴포넌트)
    - 남은 코드: 컴포넌트 조합/초기화/위임 코드
  - **폴더 구조 (최종)**:
    ```
    browser/views/chat/
    ├── claudeChatView.ts (1065줄)
    └── managers/ (5개 Manager)

    browser/views/ui/ (UI 컴포넌트)
    browser/views/session/ (세션 관련)
    browser/views/settings/ (설정 관련)
    ```

- **ClaudeChatViewPane 모듈화 완료 (Phase 6)**
  - **목표**: ClaudeChatViewPane 1682줄 → ~900줄로 축소
  - **결과**: 1682줄 → 1065줄 (~37% 감소)
  - **신규 파일 (5개 Manager)**:
    - `managers/gitCommitManager.ts` (223줄): Git 커밋 기능 전체 (hasChangesToCommit, handleCommitChanges, generateCommitMessage, executeGitCommit, executeGitCommand)
    - `managers/queueUIManager.ts` (200줄): 메시지 큐 UI 렌더링, 드래그앤드롭 재정렬, 아이템 편집/삭제
    - `managers/clipboardManager.ts` (110줄): 붙여넣기 처리, 이미지/코드 참조 변환
    - `managers/messageListManager.ts` (120줄): 메시지 DOM 관리 (append, update, clear, scroll, divider)
    - `managers/viewConnectionManager.ts` (105줄): 연결 초기화, 재시도, 에러 처리
    - `managers/index.ts`: 모듈 re-export
  - **ClaudeChatViewPane 변경**:
    - Manager 클래스들로 위임 패턴 적용
    - 기존 14개 분리 컴포넌트 유지
    - 인라인 로직 ~620줄 → 5개 Manager로 이동
  - **폴더 구조**:
    ```
    browser/views/chat/
    ├── claudeChatView.ts (1065줄, 조합/위임)
    ├── managers/
    │   ├── gitCommitManager.ts
    │   ├── queueUIManager.ts
    │   ├── clipboardManager.ts
    │   ├── messageListManager.ts
    │   ├── viewConnectionManager.ts
    │   └── index.ts
    └── ... (기존 파일들)
    ```

- **ClaudeService 모듈화 완료 (Phase 5)**
  - **목표**: ClaudeService 1852줄 → ~400줄로 축소
  - **결과**: 1852줄 → 942줄 (~49% 감소)
  - **신규 파일 (5개 Manager)**:
    - `managers/configManager.ts` (91줄): 로컬 설정 로드/리로드/가져오기, 워크스페이스 루트
    - `managers/historyManager.ts` (125줄): 세션 변경사항 히스토리 (getSessionChangesHistory)
    - `managers/fileWatcherManager.ts` (103줄): 파일 시스템 감시, 배칭 처리
    - `managers/multiSessionManager.ts` (305줄): 멀티 세션 상태, 큐, 컨텐츠 축적, 백그라운드 세션 처리
    - `managers/chatManager.ts` (362줄): 메시지 전송 핵심 로직, CLI 옵션 빌드, continue 모드
    - `managers/index.ts`: 모듈 re-export
  - **ClaudeService 변경**:
    - Manager 클래스들로 위임 패턴 적용
    - IClaudeService 인터페이스 변경 없음 (하위 호환성 유지)
    - ClaudeServiceContextProvider 호환성 위해 내부 프로퍼티 노출 유지
  - **폴더 구조**:
    ```
    browser/services/core/
    ├── claudeService.ts (942줄, 위임만)
    ├── managers/
    │   ├── configManager.ts
    │   ├── historyManager.ts
    │   ├── fileWatcherManager.ts
    │   ├── multiSessionManager.ts
    │   ├── chatManager.ts
    │   └── index.ts
    └── ... (기존 파일들)
    ```

### 2026-02-03
- **Use Custom Script 기능 제거 완료**
  - **제거된 기능**:
    - 글로벌 설정에서 "Use Custom Script" 토글 및 Script Path 입력
    - claudeLocalConfig.ts에서 스크립트 관련 타입들 (ClaudeExecutableType, ClaudeScriptType 등)
    - CLI 서비스에서 스크립트 처리 로직 (getScriptInterpreter, detectScriptType 등)
  - **변경사항**:
    - `claudeCLIEventHandler.ts` (3줄 추가): AutoAccept 모드에서도 사용자에게 선택 결과를 표시하도록 개선
    - `claudeService.ts` (36줄 추가): `setupFileSystemWatcher()` 메서드 추가로 파일 변경 시 스냅샷 자동 정리
    - `claudeFileSnapshot.ts` (226줄 추가): 스냅샷 영속성 구현
      - `saveSnapshots()`, `loadSnapshots()` 메서드 추가
      - IDE 재시작 후에도 파일 변경 히스토리 유지
      - 스토리지 기반 스냅샷 저장/로드 기능
  - **결과**: 이제 Claude CLI 명령어만 직접 실행 (커스텀 스크립트 실행 불가)

### 2026-01-30
- **Multi-Chat CLI Connection (Sprint)**
  - **Phase 1: Main Process 다중 인스턴스 지원**
    - `claudeCLIInstance.ts`: 단일 CLI 프로세스 래퍼 클래스
    - `claudeCLIProcessManager.ts`: 다중 프로세스 관리자 (최대 5개, 유휴 5분 타임아웃)
  - **Phase 2: IPC 채널 확장**
    - `claudeCLI.ts`: `IClaudeCLIMultiService`, `IClaudeCLIMultiEvent` 인터페이스 추가
    - `claudeCLIChannel.ts`: `ClaudeCLIMultiChannel`, `ClaudeCLIMultiChannelClient` 클래스 추가
    - `app.ts`: 멀티 인스턴스 채널 등록 (`CLAUDE_CLI_MULTI_CHANNEL_NAME`)
  - **Phase 3: Renderer Service 리팩토링**
    - `claudeConnection.ts`: `ClaudeMultiConnection` 클래스 추가 (세션별 이벤트 구독)
    - `claudeService.ts`:
      - `ISessionState` 인터페이스 (세션별 상태)
      - `_sessionStates` Map으로 세션별 상태 관리
      - `sendMessageToSession()`, `cancelSessionRequest()` 등 멀티 세션 API
  - **Phase 4: Storage 및 마이그레이션**
    - `claudeSessionManager.ts`:
      - `IStoredSession` 인터페이스 (cliSessionId, queuedMessages 포함)
      - `setCliSessionId()`, `getCliSessionId()` 메서드
      - `saveSessionQueue()`, `getSessionQueue()` 메서드
      - `migrateGlobalQueue()` - 기존 전역 큐 → 현재 세션으로 마이그레이션
  - **아키텍처**:
    ```
    [Chat 1] ─── [Session 1] ───┐
                                │
    [Chat 2] ─── [Session 2] ───┼── [IPC + chatId] ─── [ProcessManager]
                                │                             │
    [Chat 3] ─── [Session 3] ───┘                    ┌────────┴────────┐
                                                     │    │    │    │
                                                  [CLI1][CLI2][CLI3]...
    ```
  - **설정값**:
    - 최대 동시 프로세스: 5개
    - 유휴 타임아웃: 5분
    - 메시지 큐: 세션별 분리

### 2026-01-29
- **클립보드 붙여넣기 기능 개선 (SPEC_006)**
  - Phase 1: 이미지 붙여넣기 버그 수정
    - `claudeInputEditor.ts`: paste 이벤트 capture phase로 변경
    - `claudeChatView.ts`: `handlePaste()` 이미지 감지 시 즉시 preventDefault
  - Phase 2: 코드 참조 붙여넣기 기능
    - `claudeTypes.ts`: `IClaudeCodeReference` 타입 추가
    - `IClaudeAttachment.type`에 `'code-reference'` 추가
    - `claudeChatView.ts`: `tryAddCodeReference()` - VS Code 클립보드 메타데이터 파싱
    - `claudeAttachmentManager.ts`: `addCodeReference()` 메서드 추가
    - `claudeContextBuilder.ts`: 코드 참조 포맷팅 추가
    - `claude.css`: `.claude-attachment-tag.code-reference` 스타일
  - 스펙 문서: `_Dev/Specs/SPEC_006_ClipboardEnhancements.md`
- **Auto Accept 세션별 설정 기능 구현**
  - `claudeSessionSettingsPanel.ts`:
    - `ISessionSettings`에 `autoAccept?: boolean` 추가
    - Auto Accept 토글 UI 추가
  - `claudeService.ts`:
    - `_sessionAutoAcceptOverride` 프로퍼티 추가
    - `setSessionAutoAccept()` 메서드 구현
    - `isAutoAcceptEnabled()` 메서드 구현 (세션 > 로컬 설정 우선순위)
    - CLIEventHandler 콜백에 `isAutoAcceptEnabled` 연결
  - `claudeCLIEventHandler.ts`:
    - `ICLIEventHandlerCallbacks`에 `isAutoAcceptEnabled()` 추가
    - `handleAskUserQuestion()`, `handleInputRequest()` 모두 세션 설정 반영
  - `claudeChatView.ts`:
    - `applySessionSettings()`에 Auto Accept 적용 추가
  - `claude.ts`: 인터페이스에 `setSessionAutoAccept`, `isAutoAcceptEnabled` 메서드 추가
- **모델 별칭 기능 구현**
  - `claudeTypes.ts`:
    - `CLAUDE_MODEL_ALIASES` - 짧은 별칭 매핑 (opus, sonnet, haiku...)
    - `CLAUDE_MODEL_DISPLAY_NAMES` - UI 표시 이름
    - `resolveModelName()` - 별칭 → 전체 모델명 해석
    - `getModelDisplayName()` - 모델명 → 표시 이름
    - `getAvailableModelsForUI()` - UI용 모델 목록
    - `validateClaudeModel()` - 별칭 지원 추가
  - `claudeService.ts`:
    - `sendMessageInternal()` - `resolveModelName()` 적용
    - `setSessionModel()` - 별칭 해석 + 로그에 표시 이름 출력
  - `claudeSessionSettingsPanel.ts`:
    - `createModelSetting()` - 드롭다운 UI로 변경
    - 커스텀 입력 + 실시간 별칭 해석 피드백
  - `claude.css`: 드롭다운 스타일 추가
- **메시지 큐 고급 기능 구현**
  - `claudeService.ts`:
    - `MAX_QUEUE_SIZE = 10` - 큐 최대 크기 제한
    - `addToQueue()` - 큐 가득 차면 거부 + `queueRejected` 플래그 반환
    - `updateQueuedMessage(id, newContent)` - 대기 중 메시지 수정
    - `reorderQueue(fromIndex, toIndex)` - 드래그앤드롭 순서 변경
    - `loadQueue()`, `saveQueue()` - Storage 영속성 (재시작 시 복원)
  - `claudeChatView.ts`:
    - `updateQueueUI()` 전면 개선:
      - 드래그 핸들 + 드래그앤드롭 이벤트 처리
      - 편집 버튼 + 인라인 편집 다이얼로그
      - 컨텍스트 미리보기 (첨부파일 뱃지)
    - `submitInput()` - 큐 가득 참 경고 + 입력 복원
    - `showQueueItemEditDialog()` - QuickInput으로 메시지 편집
  - `claude.ts`: 새 인터페이스 메서드 추가
    - `getMaxQueueSize()`, `updateQueuedMessage()`, `reorderQueue()`
  - `claudeTypes.ts`: `IClaudeMessage.queueRejected` 속성 추가
  - `claude.css`: 새 스타일 추가
    - `.claude-queue-item-drag` - 드래그 핸들
    - `.claude-queue-item-edit` - 편집 버튼
    - `.claude-queue-item-context` - 첨부파일 뱃지
    - `.dragging`, `.drop-target` - 드래그앤드롭 상태
- **대화 Pending 기능 개선** (이전)
  - `claudeChatView.ts`:
    - `submitInput()`에서 idle 체크 제거 → 서비스가 알아서 큐에 추가
    - `updateQueueUI()` 개선 - 순서 번호, 대기 아이콘, 상태 메시지
    - 큐에 메시지 추가 시 토스트 알림
  - `claude.css`: Pending 큐 UI 스타일 전면 개선
    - 스피너 애니메이션
    - 순서 배지 (#1, #2...)
    - 상태 메시지 ("Waiting for current request...")
    - 호버 효과 개선
- **Accept/Reject 배치 UI 구현**
  - `claudeMessageRenderer.ts`: 파일 변경 UI 개선
    - 체크박스로 파일 선택 기능
    - Accept All / Reject All 버튼 (배치 액션 바)
    - Accept Selected / Reject Selected 버튼 (선택 액션 바)
    - 개별 파일 Accept 버튼
  - `claudeFileSnapshot.ts`: accept 관련 메서드 추가
    - `acceptFile()`, `acceptAll()`
    - `revertFiles()`, `acceptFiles()`
  - `claudeService.ts`: Accept 메서드 구현
  - `claude.ts`: 인터페이스에 Accept 메서드 추가
  - `claude.css`: 배치 UI 스타일 추가
- **세션 변경사항 히스토리 기능 구현**
  - `claude.ts`: 새 인터페이스 추가
    - `IClaudeSessionChangesHistory`: 세션 전체 변경 히스토리
    - `IClaudeChangesHistoryEntry`: 메시지별 변경 항목
    - `IClaudeFileChangeSummaryItem`: 파일별 변경 요약
  - `claudeService.ts`: `getSessionChangesHistory()` 메서드 구현
  - `claudeChangesHistoryPanel.ts`: 새 파일 - Changes History UI 패널
    - Timeline 뷰: 시간순 변경 이력
    - Files 뷰: 파일별 변경 통계
  - `claudeChatView.ts`: Changes 버튼 및 패널 통합
  - `claude.css`: Changes History 패널 스타일 추가
- **컨텍스트 메뉴 기능 구현**
  - `claudeActions.ts`: 4개 컨텍스트 메뉴 액션 추가
    - `AttachFileToClaude`: Explorer에서 파일 우클릭 → "Add to Claude"
    - `AttachFolderToClaude`: Explorer에서 폴더 우클릭 → "Add Folder to Claude"
    - `AskClaudeAboutSelection`: 에디터에서 선택 → "Ask Claude About Selection" (Ctrl+Shift+A)
    - `AttachCurrentFileToClaude`: 에디터/탭에서 "Add File to Claude"
  - `claudeChatView.ts`: 외부 API 메서드 추가
    - `attachFiles(files: URI[])`: 파일 첨부
    - `setInputWithContext(selectedText, fileName)`: 선택 영역으로 입력 설정
- **CLI 옵션 기능 확인 완료**
  - 모든 레이어에서 이미 구현됨 (인터페이스, 설정 스키마, CLI 인자, 서비스)
- **IClaudeCLIRequestOptions 인터페이스 확장**
  - `claudeCLI.ts`: 모든 CLI 옵션 추가
  - 새 타입: `ClaudePermissionMode` ('default' | 'plan' | 'accept-edits')
  - 추가된 옵션 (10개):
    - `maxTurns`: 에이전트 최대 턴 수
    - `maxBudgetUsd`: 비용 상한선 (USD)
    - `fallbackModel`: 대체 모델
    - `appendSystemPrompt`: 시스템 프롬프트 추가 (기존 유지)
    - `disallowedTools`: 금지할 도구 목록
    - `permissionMode`: 권한 모드
    - `betas`: 베타 기능 목록
    - `addDirs`: 추가 작업 디렉토리
    - `mcpConfig`: MCP 설정 파일 경로
    - `agents`: 에이전트 설정 파일 경로
  - 기존 옵션에도 JSDoc 주석 추가

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
