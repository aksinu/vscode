# Development Status

> **현재 개발 진행 상태**

---

## Current

| Item | Value |
|------|-------|
| **Phase** | Phase 3 완료 - UX 개선 & 로컬 설정 |
| **Sprint** | Sprint_002 ✅ |
| **Status** | ✅ Sprint 2 전체 완료, 빌드 성공 |
| **Updated** | 2026-01-26 15:28 |
| **Build** | ✅ `yarn compile` 성공 (15:28) |

---

## Now Working On

```
Task: Sprint 2 완료 - 테스트 중
Progress: 100%
Next: 테스트 후 Sprint 3 계획
```

### 빌드 & 실행

```bash
cd D:/_______________Kent/vscode
yarn compile          # 빌드 (약 5분)
./scripts/code.bat    # 실행
```

### Sprint 2 Tasks

| # | Task | Priority | Status | Difficulty |
|---|------|----------|--------|------------|
| 1 | [로컬 설정 + 스크립트 실행](Tasks/Sprint_002/TASK_001_LocalSettings.md) | P1 | [x] | Medium |
| 2 | [모두 OK (Auto Accept)](Tasks/Sprint_002/TASK_002_AutoAccept.md) | P1 | [x] | Low |
| 3 | [대화 복사 기능](Tasks/Sprint_002/TASK_003_MessageCopy.md) | P2 | [x] | Low |
| 4 | [이전 대화 구분선](Tasks/Sprint_002/TASK_004_SessionDivider.md) | P2 | [x] | Low |
| 5 | [스트리밍 중 입력 큐](Tasks/Sprint_002/TASK_005_InputQueue.md) | P2 | [x] | Medium |

### Done (Phase 1 - 기본 구조)
- [x] 프로젝트 문서 구조 설정
- [x] VS Code Chat 모듈 구조 분석
- [x] Claude 모듈 기본 구조 생성
- [x] 서비스 구현 (IClaudeService)
- [x] ViewPane 구현 (ClaudeChatViewPane)
- [x] 액션/커맨드 등록
- [x] 설정 등록
- [x] Markdown 렌더링 구현
- [x] 코드 블록 렌더러 (Copy/Insert/Apply 버튼)
- [x] 환영 화면 (Welcome Screen)
- [x] 로딩 인디케이터
- [x] 컨텍스트 태그 표시
- [x] 드래그/드롭 파일 첨부 기능

### Done (Phase 2 - CLI 연동)
- [x] **코드 재구성** - `claude/` → `kent/` 폴더로 이동
- [x] **Main Process CLI 서비스** - `ClaudeCLIService`
- [x] **IPC 채널 구현** - Renderer ↔ Main 통신
- [x] **stdin 방식 프롬프트 전달** - 명령줄 길이 제한 회피
- [x] **환경변수 정리** - 디버거 자식 프로세스 붙는 문제 해결
- [x] **도구 액션 추적** - tool_use 이벤트 처리 구조
- [x] **대화 기록 저장** - StorageService로 워크스페이스별 저장
- [x] **도구 상태 UI** - 스피너, 완료 표시 CSS

### Done (Phase 2.5 - AskUser & 대화 컨텍스트)
- [x] **AskUser 이벤트 처리** - Claude가 선택 요구 시 UI 표시
- [x] **대화 컨텍스트 전달** - 이전 메시지를 프롬프트에 포함
- [x] **input_request 이벤트 처리** - CLI 직접 형식 지원

### Remaining (Phase 3+)
- [ ] 실시간 글자별 스트리밍 (CLI 제한으로 현재 불가)
- [ ] @ 멘션 시스템 (@file, @workspace)
- [ ] /슬래시 커맨드
- [ ] Diff 뷰 Apply

---

## Architecture

### 폴더 구조 (최종)

```
src/vs/workbench/contrib/kent/
├── browser/                    # Renderer Process
│   ├── kent.contribution.ts    # 서비스/뷰/설정 등록
│   ├── claudeService.ts        # IClaudeService 구현 (IPC 클라이언트)
│   ├── claudeChatView.ts       # 채팅 ViewPane
│   ├── claudeMessageRenderer.ts # 메시지 렌더러
│   ├── claudeActions.ts        # 커맨드/액션
│   └── media/claude.css        # 스타일
├── common/                     # 공통 타입/인터페이스
│   ├── claude.ts               # IClaudeService 인터페이스
│   ├── claudeTypes.ts          # 타입 정의 (IClaudeMessage, IClaudeToolAction 등)
│   ├── claudeContextKeys.ts    # 컨텍스트 키
│   ├── claudeCLI.ts            # CLI 서비스 인터페이스
│   └── claudeCLIChannel.ts     # IPC 채널 정의
└── electron-main/              # Main Process
    └── claudeCLIService.ts     # CLI 실행 서비스

src/vs/code/electron-main/app.ts  # 수정: CLI 서비스/채널 등록
src/vs/workbench/workbench.common.main.ts  # 수정: kent contribution import
```

### IPC 통신 흐름

```
┌─────────────────────────┐        IPC Channel        ┌─────────────────────────┐
│  Renderer Process       │                           │  Main Process           │
│                         │                           │                         │
│  ClaudeService          │ ── sendPrompt ──────────▶ │  ClaudeCLIService       │
│  (claudeService.ts)     │                           │  (claudeCLIService.ts)  │
│                         │                           │                         │
│                         │ ◀── onDidReceiveData ──── │  spawn('claude', args)  │
│                         │ ◀── onDidComplete ─────── │                         │
│                         │ ◀── onDidError ────────── │  stdin.write(prompt)    │
└─────────────────────────┘                           └─────────────────────────┘
```

### CLI 실행 방식

```javascript
// stdin으로 프롬프트 전달 (명령줄 길이 제한 회피)
const args = ['--output-format', 'stream-json', '--verbose'];
this._process = spawn('claude', args, {
    shell: true,
    env: cleanEnv,  // NODE_OPTIONS, VSCODE_INSPECTOR_OPTIONS 제거
});
this._process.stdin.write(prompt);
this._process.stdin.end();
```

---

## 해결된 문제들

### 1. 명령줄 길이 제한 (Windows ~8KB)
- **문제**: `-p "긴 프롬프트"` 사용 시 길이 초과
- **해결**: stdin으로 프롬프트 전달

### 2. 디버거가 자식 프로세스에 붙는 문제
- **문제**: F5 디버그 시 Claude CLI가 멈춤
- **해결**: 환경변수 정리
  ```javascript
  delete cleanEnv.NODE_OPTIONS;
  delete cleanEnv.ELECTRON_RUN_AS_NODE;
  delete cleanEnv.VSCODE_INSPECTOR_OPTIONS;
  ```

### 3. 대화 기록 휘발
- **문제**: F5 재시작 시 대화 사라짐
- **해결**: IStorageService로 워크스페이스별 저장

---

## CLI 이벤트 구조

Claude CLI `--output-format stream-json` 응답:

```json
// 1. 초기화
{"type":"system","subtype":"init","session_id":"...","tools":["Task","Bash",...]}

// 2. 응답 (전체 한 번에)
{"type":"assistant","message":{"content":[{"type":"text","text":"응답 내용"}]}}

// 3. 도구 사용 (있을 경우)
{"type":"tool_use","tool_name":"Read","tool_input":{"file_path":"..."}}
{"type":"tool_result","tool_result":"파일 내용..."}

// 4. 완료
{"type":"result","subtype":"success","result":"최종 응답"}
```

---

## Files Modified (Original VS Code)

| File | Changes |
|------|---------|
| `src/vs/code/electron-main/app.ts` | CLI 서비스 생성 및 IPC 채널 등록 |
| `src/vs/workbench/workbench.common.main.ts` | kent contribution import 추가 |

---

## Created Files (kent/)

### common/
| File | Description |
|------|-------------|
| `claude.ts` | IClaudeService 인터페이스 |
| `claudeTypes.ts` | 타입 정의 (IClaudeMessage, IClaudeToolAction, IClaudeSession, IClaudeQueuedMessage 등) |
| `claudeContextKeys.ts` | 컨텍스트 키 |
| `claudeCLI.ts` | IClaudeCLIService 인터페이스, IClaudeCLIStreamEvent |
| `claudeCLIChannel.ts` | IPC 채널 (ClaudeCLIChannel, ClaudeCLIChannelClient) |
| `claudeLocalConfig.ts` | **[Sprint2]** 로컬 설정 타입/유틸 (스크립트 실행 지원) |

### browser/
| File | Description |
|------|-------------|
| `kent.contribution.ts` | 서비스/뷰/설정 등록 (registerSingleton) |
| `claudeService.ts` | Renderer측 서비스 (IPC 클라이언트, 저장소 연동) |
| `claudeChatView.ts` | 채팅 ViewPane |
| `claudeMessageRenderer.ts` | 메시지 렌더러 (Markdown, 코드 블록, 도구 상태) |
| `claudeActions.ts` | 커맨드/액션 |
| `media/claude.css` | 스타일 (도구 상태 UI 포함) |

### electron-main/
| File | Description |
|------|-------------|
| `claudeCLIService.ts` | Main Process CLI 실행 서비스 |

---

## Commands

| Command | Keybinding | Description |
|---------|------------|-------------|
| `claude.openChat` | `Ctrl+Shift+C` | 채팅 열기 |
| `claude.clearChat` | `Ctrl+Shift+K` | 채팅 비우기 |
| `claude.cancelRequest` | `Escape` | 요청 취소 |
| `claude.newSession` | - | 새 세션 |
| `claude.focusInput` | `Ctrl+L` | 입력창 포커스 |

---

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `claude.model` | `claude-sonnet-4-20250514` | 사용할 모델 |
| `claude.maxTokens` | `4096` | 최대 토큰 수 |
| `claude.systemPrompt` | (기본 프롬프트) | 시스템 프롬프트 |
| `claude.fontSize` | `13` | 채팅 폰트 크기 |

---

## Activity Log

### 2026-01-26 (밤)
- **Sprint 2 완료!**
- **TASK_001: 로컬 설정 시스템 구현**
  - `.vscode/claude.local.json` 설정 파일 지원
  - 스크립트 실행 지원 (bat, sh, ps1, node, python)
  - OS별 인터프리터 분기 처리
  - `claudeLocalConfig.ts` 타입/유틸 생성
  - `claudeCLIService.ts` 스크립트 실행 로직 추가
  - `claudeService.ts` 로컬 설정 로드 로직 추가
- **TASK_002: Auto Accept 모드 구현**
  - `autoAccept: true` 설정 시 자동 승인
  - 자동 선택된 옵션 UI 표시
  - AskUser/InputRequest 모두 지원
- **TASK_003: 대화 복사 기능**
  - 메시지별 복사 버튼 (hover 시 표시)
  - 텍스트 선택 허용 (user-select: text)
- **TASK_004: 이전 대화 구분선**
  - 세션 로드 시 이전/현재 대화 구분선 표시
  - "Previous Session" 라벨
- **TASK_005: 스트리밍 중 입력 큐**
  - 응답 중에도 메시지 입력 가능 → 큐에 추가
  - 큐 UI 표시 (입력창 위)
  - 개별/전체 큐 삭제 기능
  - 응답 완료 후 자동 순차 처리

### 2026-01-26 (저녁)
- **AskUser UI 개선**
  - 선택지 클릭 시 즉시 제출 (기존 동작 유지)
  - Submit 버튼 제거 (불필요)
  - "Other" 입력은 Enter 키로 제출
  - placeholder에 "press Enter" 안내 추가
  - 관련 CSS 정리

### 2026-01-26 (오후)
- **AskUser 이벤트 처리 완료**
  - `handleAskUserQuestion`: tool_use 이벤트에서 AskUserQuestion 처리
  - `handleInputRequest`: input_request 이벤트 처리 (CLI 직접 형식)
  - `respondToAskUser`: 단순 텍스트 응답으로 수정
  - UI: 옵션 버튼, 직접 입력 필드 렌더링
- **대화 컨텍스트 전달 기능**
  - `buildPromptWithContext`: 이전 메시지를 프롬프트에 포함
  - 최근 10개 메시지까지 컨텍스트로 전달
  - 긴 메시지는 2000자로 자름

### 2026-01-26 (오전)
- 코드 재구성: `claude/` → `kent/` 폴더
- Main Process CLI 서비스 구현
- IPC 채널 구현 및 연결
- stdin 방식 프롬프트 전달로 변경
- 환경변수 정리 (디버거 문제 해결)
- 도구 액션 타입 및 UI 추가
- 대화 기록 저장 기능 추가 (IStorageService)
- 도구 상태 CSS 스타일 추가

### 2025-01-25
- 프로젝트 문서 구조 재구성
- VS Code Chat 모듈 구조 분석 완료
- Claude 모듈 기본 구조 생성 완료
- UI 컴포넌트 구현 (Markdown, 코드 블록, 환영 화면)

---

## Known Limitations

1. **실시간 스트리밍 불가**: CLI가 응답을 한 번에 보냄 (글자별 스트리밍 X)
2. ~~**AskUser 미지원**: Claude가 사용자 선택을 요구할 때 UI에 표시 안 됨~~ ✅ 해결
3. ~~**대화 컨텍스트**: CLI 세션이 독립적이라 이전 대화 컨텍스트 전달 안 됨~~ ✅ 해결 (프롬프트에 포함)

---

## Code Quality & Refactoring Analysis

### 파일별 분석

| File | Lines | Status | Notes |
|------|-------|--------|-------|
| `claudeService.ts` | ~690 | ⚠️ Large | CLI 핸들링 + 세션 + 스토리지 혼재 |
| `claudeChatView.ts` | ~670 | ⚠️ Large | UI + 드래그드롭 + 첨부파일 혼재 |
| `claudeMessageRenderer.ts` | ~450 | ✅ OK | 잘 구조화됨 |
| `claudeCLIService.ts` | ~260 | ✅ OK | debugLog 정리 필요 |
| `claudeTypes.ts` | ~140 | ✅ OK | 타입 정의 깔끔 |
| `claude.ts` | ~90 | ✅ OK | 인터페이스 깔끔 |
| `claudeCLI.ts` | ~90 | ✅ OK | CLI 인터페이스 깔끔 |
| `claudeCLIChannel.ts` | ~50 | ✅ OK | IPC 채널 정의 |

### 리팩토링 권장사항 (우선순위순)

#### P2 - 중기 개선
1. **ClaudeService 분리**
   - `ClaudeSessionManager` - 세션/스토리지 관리
   - `ClaudeCLIEventHandler` - CLI 이벤트 처리
   - 현재 ~700줄 → 각 ~250줄로 분리

2. **ClaudeChatView 분리**
   - `ClaudeAttachmentManager` - 첨부파일 관리
   - 드래그/드롭 로직 헬퍼화

#### P3 - 장기 정리
3. **로깅 정리**
   - `console.log` → 로그 레벨 시스템으로 변경
   - `debugLog` 파일 로깅 → 개발 환경에서만 활성화

4. **네이밍 일관성**
   - 폴더: `kent/` vs 파일: `claude*`
   - 현재 의도적 분리이나 문서화 필요

### 현재 판단
- **즉시 리팩토링 불필요**: 작동하고 유지보수 가능
- **기능 추가 시점에 분리 고려**: 코드가 더 커지면 자연스럽게 분리

---

## Next Steps

1. ~~**AskUser 이벤트 처리**~~ ✅ 완료

2. ~~**대화 컨텍스트 전달**~~ ✅ 완료

3. **@ 멘션 시스템** (Phase 3)
   - `@file`, `@workspace` 파싱
   - 자동완성 UI

4. **/슬래시 커맨드** (Phase 3)
   - `/explain`, `/fix`, `/test` 등

5. **Diff 뷰 Apply** (Phase 3)
   - 코드 적용 전 변경사항 미리보기

---

**이 문서는 AI Agent 작업 재개 시 현재 상태 파악용으로 항상 최신 유지**
