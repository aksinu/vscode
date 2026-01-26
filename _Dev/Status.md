# Development Status

> **현재 개발 진행 상태**

---

## Current

| Item | Value |
|------|-------|
| **Phase** | Phase 4 - 고급 UX 기능 |
| **Sprint** | Sprint_003 ✅ |
| **Status** | ✅ Sprint 3 완료 + 상태바 & 설정 시스템 |
| **Updated** | 2026-01-26 22:30 |
| **Build** | ✅ 타입체크 성공 |

---

## Now Working On

```
Task: Sprint 3 완료
Progress: 100%
Next: 테스트 후 Sprint 4 계획
```

### 빌드 & 실행

```bash
cd D:/_______________Kent/vscode
yarn compile          # 빌드 (약 5분)
./scripts/code.bat    # 실행
```

### Sprint 3 Tasks

| # | Task | Priority | Status | Difficulty |
|---|------|----------|--------|------------|
| 1 | [@ 멘션 시스템](Tasks/Sprint_003/TASK_001_AtMention.md) | P1 | [x] | Medium |
| 2 | [/슬래시 커맨드](Tasks/Sprint_003/TASK_002_SlashCommand.md) | P1 | [x] | Low |
| 3 | [Diff 뷰 Apply](Tasks/Sprint_003/TASK_003_DiffApply.md) | P1 | [x] | Medium |
| 4 | [토큰 소진 시 자동 대기/재시도](Tasks/Sprint_003/TASK_004_RateLimitRetry.md) | P1 | [x] | Medium |
| 5 | [이미지 붙여넣기](Tasks/Sprint_003/TASK_005_ImagePaste.md) | P1 | [x] | Low |
| 6 | [다중 세션 관리](Tasks/Sprint_003/TASK_006_MultiSession.md) | P2 | [x] | Medium |

### Sprint 2 Tasks (완료)

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
- [x] **파일 첨부 시스템 (3가지 방식)**
  - [x] 열린 파일 버튼 (`+ 파일명` 클릭)
  - [x] 드래그 앤 드롭
  - [x] Ctrl+C/V (이미지 붙여넣기)

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

### Done (Phase 4 - 고급 UX)
- [x] @ 멘션 시스템 (@file, @workspace, 열린 파일 목록)
- [x] /슬래시 커맨드 (/explain, /fix, /test, /refactor, /docs, /optimize)
- [x] Diff 뷰 Apply (코드 적용 전 미리보기)

### Remaining (Phase 4+)
- [ ] 실시간 글자별 스트리밍 (CLI 제한으로 현재 불가)
- [ ] 파일 탐색기에서 파일 선택 (@file 개선)
- [ ] 컨텍스트 메뉴 통합 (우클릭 → Claude에게 물어보기)

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

### 2026-01-26 (밤4)
- **버그 수정**
  - Error 상태 → 응답 데이터 수신 시 즉시 Connected로 변경
  - checkConnection 실패 시 Error 대신 Disconnected 표시
- **모델 변경 기능 추가**
  - 설정(⚙️) → Change Model 메뉴 추가
  - Opus/Sonnet/Haiku 선택 가능
- **응답 취소 버튼 추가**
  - 스트리밍 중 전송 버튼 → 취소 버튼(🔴)으로 변경
  - 클릭 시 요청 취소

### Known Bugs (수정 필요)
| # | 버그 | 상태 |
|---|------|------|
| 1 | 스트리밍 시 채팅창 깜빡임 + 진행상황 불명확 | 🔴 |
| 2 | 입력창 - 전송버튼 좌측 이상한 공간 | 🔴 |
| 3 | 채팅창 width 조절 시 전송버튼 사라짐 | 🔴 |
| 4 | 터미널 conpty.node 에러 (빌드) | 🟡 P3 |

### 2026-01-26 (밤3)
- **파일 첨부 시스템 스펙 정리** (SPEC_003)
  - 3가지 첨부 방식 정의: 열린 파일 버튼, 드래그/드롭, Ctrl+C/V
  - 명시적 첨부만 전송 (자동 전송 X)
- **열린 파일 버튼 UI 구현**
  - 채팅창 상단에 열린 파일 목록 표시 (`+ a.cs + b.ts`)
  - 클릭 시 첨부 목록에 추가
  - 이미 첨부된 파일은 비활성화 표시
  - editorService.onDidVisibleEditorsChange로 실시간 업데이트
  - 버그 수정: openFilesContainer null 체크 추가
- **상태 & 설정 시스템 구현** (SPEC_004)
  - Claude 상태 바 UI (연결 상태, 모델, 실행 방식)
  - 설정 QuickPick (연결 테스트, Extended Thinking 토글, 설정 파일 열기)
  - IClaudeStatusInfo/IClaudeAccountInfo 타입 추가
  - checkConnection() 메서드 구현 (CLI 버전 확인)
  - toggleExtendedThinking() 메서드 구현

### 2026-01-26 (밤2)
- **Sprint 3 완료! (6개 태스크)**
- **TASK_001: @ 멘션 시스템**
  - `@` 입력 시 자동완성 팝업 표시
  - `@file` - 현재 에디터 파일 첨부
  - `@workspace` - 워크스페이스 컨텍스트 첨부
  - 열린 에디터 파일 목록 표시
  - 키보드 네비게이션 (↑↓, Enter, Esc)
- **TASK_002: /슬래시 커맨드**
  - `/` 입력 시 커맨드 목록 팝업
  - `/explain`, `/fix`, `/test`, `/refactor`, `/docs`, `/optimize`
  - 선택 시 해당 프롬프트로 입력창 교체
- **TASK_003: Diff 뷰 Apply**
  - Apply 버튼 클릭 시 QuickPick 표시
  - "Preview Diff" - Diff 에디터로 미리보기
  - "Apply Directly" - 바로 적용
  - Accept/Reject 알림으로 확인
- **TASK_004: 토큰 소진 시 자동 대기/재시도**
  - Rate limit 에러 감지 (429, quota exceeded, token exhausted)
  - 대기 시간 파싱 (seconds/minutes/hours)
  - 카운트다운 UI 표시
  - 자동 재시도
  - 상세 디버그 로그 (`debugLog()`)
- **TASK_005: 이미지 붙여넣기**
  - Ctrl+V로 클립보드 이미지 붙여넣기
  - Win+Shift+S 캡처 후 바로 첨부 가능
  - Base64 변환 및 프롬프트에 포함
- **TASK_006: 다중 세션 관리**
  - 세션 관리 버튼 (레이어 아이콘)
  - QuickPick으로 세션 목록 표시
  - 새 세션 생성 / 세션 전환
  - 세션별 대화 기록 유지

### 2026-01-26 (밤1)
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

3. ~~**@ 멘션 시스템**~~ ✅ 완료 (Sprint 3)
   - `@file`, `@workspace` 파싱
   - 자동완성 UI
   - 열린 파일 목록 표시

4. ~~**/슬래시 커맨드**~~ ✅ 완료 (Sprint 3)
   - `/explain`, `/fix`, `/test`, `/refactor`, `/docs`, `/optimize`

5. ~~**Diff 뷰 Apply**~~ ✅ 완료 (Sprint 3)
   - 코드 적용 전 변경사항 미리보기
   - Accept/Reject 선택

6. **향후 개선 사항** (Phase 4+)
   - 파일 탐색기 통합 (파일 선택 다이얼로그)
   - 컨텍스트 메뉴 통합
   - 인라인 코드 제안

---

**이 문서는 AI Agent 작업 재개 시 현재 상태 파악용으로 항상 최신 유지**
