# Development Status

> **현재 개발 진행 상태**

---

## Current Status

| Item | Value |
|------|-------|
| **Phase** | 🎯 **Phase 9 완료** - CLI 기능 확장 + 에디터 통합 + Agent 모드 |
| **Status** | [x] Backlog 전체 완료 (인라인/벡터검색/Agent), ⚠️ 컴파일 필요 |
| **Build** | ⚠️ 컴파일 필요 |
| **Updated** | 2026-02-12 |

---

## Latest Completion

### [x] Agent 모드 구현 — 자율적 파일 생성/수정 (2026-02-12)

**변경 파일 3개:**

| 파일 | 변경 내용 |
|------|----------|
| `browser/views/ui/claudeStatusBar.ts` | Permission Mode 순환에 Agent(bypassPermissions) 추가, ⚡ 아이콘 |
| `browser/views/ui/claudeAutocomplete.ts` | `/agent` 슬래시 커맨드 등록 |
| `browser/views/chat/claudeChatView.ts` | `toggleAgentMode()` 구현, cyclePermissionMode 4단계 순환, /help·/status 업데이트 |

**동작 흐름:**
```
상태바 클릭: default ○ → plan ◐ → accept-edits ● → agent ⚡ → default ○
/agent 커맨드: 현재 모드 ↔ bypass-permissions 토글
CLI 전달: --permission-mode bypassPermissions (기존 인프라 활용)
```

### [x] 슬래시 커맨드 확장 — CLI 레퍼런스 대비 미구현 커맨드 추가 (2026-02-12)

**변경 파일 2개:**

| 파일 | 변경 내용 |
|------|----------|
| `browser/views/ui/claudeAutocomplete.ts` | 7개 새 커맨드 autocomplete 등록 (`/config`, `/context`, `/export`, `/resume`, `/rename`, `/plan`, `/status`) |
| `browser/views/chat/claudeChatView.ts` | 7개 커맨드 핸들러 구현 + `/help` 출력 업데이트 |

**추가된 슬래시 커맨드:**
```
/config   — 설정 패널 열기
/context  — 컨텍스트 사용량 시각화 (프로그레스 바)
/export   — 대화 마크다운으로 클립보드 복사
/resume   — QuickPick으로 이전 세션 재개
/rename   — 현재 세션 이름 변경
/plan     — Plan 권한 모드로 전환
/status   — 연결, 모델, Thinking, Effort 상태 표시
```

### [x] CLI 미구현 기능 보완 (2026-02-12)

**변경 파일 5개:**

| 파일 | 변경 내용 |
|------|----------|
| `electron-main/claudeCLIInstance.ts` | `--max-tokens` CLI 인자 전달 추가 |
| `browser/services/core/managers/chatManager.ts` | `buildCLIOptions()`에 `maxTokens` 로컬 설정 우선순위 반영 |
| `browser/services/core/claudeService.ts` | `clearMessages()` 메서드 구현 (세션 메시지 클리어) |
| `common/services/core/claude.ts` | `IClaudeService`에 `clearMessages?()` 추가 |
| `common/config/claudeLocalConfig.ts` | `IClaudeLocalConfig`에 `maxTokens` 필드 추가 |
| `browser/views/settings/claudeSettingsPanel.ts` | Max Tokens 설정 UI 추가 (100~128000) |

### [x] 에디터 컨텍스트 메뉴 확장 — Claude 서브메뉴 (2026-02-12)

**변경 파일 2개:**

| 파일 | 변경 내용 |
|------|----------|
| `browser/actions/claudeActions.ts` | Claude 서브메뉴 등록 (`MenuId.for`), Explain/Refactor/Find Issues 액션 추가, 기존 Ask/Attach를 서브메뉴로 이동 |
| `browser/views/chat/claudeChatView.ts` | `sendWithContext()` 메서드 추가 — 선택 영역+프롬프트로 바로 전송 |

**에디터 우클릭 메뉴 구조:**
```
우클릭 → Claude ▶
           ├─ Explain Selection   (선택 있을 때)
           ├─ Refactor Selection  (선택 있을 때)
           ├─ Find Issues         (선택 있을 때)
           ├─ Ask Claude...       (선택 있을 때, Ctrl+Shift+A)
           └─ Add File to Claude  (항상)
```

### [x] P1 CLI 기능 구현 완료 (이전 세션)
- `/cost` — 세션 토큰 비용 요약
- `/compact` — 대화 압축 (컨텍스트 토큰 절약)
- 프롬프트 히스토리 (↑↓) — 이전 입력 탐색
- `@selection` 멘션 — 에디터 선택 영역 첨부
- Extended Thinking 토글 — 상태바 Think 버튼
- 코드 블록 Apply 강화 — 파일 경로 자동 감지 + 파일 직접 적용

### [x] 상태 관리 버그 수정 — Cancel 버튼 미표시 문제 (2026-02-12)

**문제**: Claude 응답 중 Cancel 버튼이 표시되지 않는 현상
**원인**: ChatStateManager(새 상태 시스템)와 ClaudeUIService(레거시 UI 상태)가 연결되지 않음

**수정 파일 2개:**

| 파일 | 변경 내용 |
|------|----------|
| `browser/services/core/claudeService.ts` | ChatStateManager.onDidChangeState → UI 상태 매핑 연결, STREAMING CHECK에서 ChatStateManager 활용 |
| `browser/services/ui/claudeUIService.ts` | idle↔non-idle 전환 시 디바운스 없이 즉시 fire, `_currentState` 즉시 동기화 |

**상태 매핑 (ChatSessionState → ClaudeServiceState):**
```
sending    → sending
responding → streaming
asking     → streaming
rateLimit  → streaming
error      → error
idle       → idle
```

### [x] Max Turns / Max Budget 설정 패널 추가 (2026-02-12)

**변경 파일 1개:** `claudeSettingsPanel.ts`
- Max Turns (디폴트: 1000, 범위: 1~1000)
- Max Budget USD (디폴트: 5, 범위: 0.01~100, step: 0.01)
- `createNumberSetting()`에 `step` 옵션 + `parseFloat` 지원 추가

### [x] 모델 설정 리팩토링 + CLI 검증 (2026-02-10)

**변경 파일 10개:**

| 파일 | 변경 내용 |
|------|----------|
| `common/claudeCLI.ts` | `IClaudeCLIMultiService`에 `validateModel` 추가 |
| `common/claudeCLIChannel.ts` | IPC 채널에 `validateModel` 라우팅 추가 |
| `electron-main/claudeCLIProcessManager.ts` | `validateModel` 구현 (CLI 실행, 15초 타임아웃) |
| `browser/services/core/claudeConnection.ts` | `ClaudeMultiConnection`에 `validateModel` 래퍼 |
| `browser/services/core/claudeService.ts` | `validateModel`, `saveGlobalModel` 서비스 메서드 추가 |
| `common/services/core/claude.ts` | `IClaudeService`에 `validateModel`, `saveGlobalModel` 추가 |
| `browser/services/core/managers/configManager.ts` | `saveGlobalModel` 구현 (`~/.claude/settings.json` 읽기/쓰기) |
| `browser/views/settings/claudeSettingsPanel.ts` | 모델 UI: 드롭다운+커스텀, 저장 대상: 글로벌, CLI 검증 |
| `browser/views/settings/claudeSessionSettingsPanel.ts` | 커스텀 모델 저장 시 CLI 검증 추가 |
| `browser/views/chat/claudeChatView.ts` | 글로벌 `onModelSaved` → `saveGlobalModel` 호출로 변경 |

**모델 저장 구조:**
```
글로벌 설정 패널 → ~/.claude/settings.json (글로벌 기본 모델)
세션 설정 패널   → .claude/settings.json (프로젝트별 오버라이드)
```

**모델 우선순위 (변경 없음):**
```
세션 오버라이드 (메모리) > 프로젝트 .claude/settings.json > .vscode/claude.local.json > 글로벌 ~/.claude/settings.json > 기본값
```

**CLI 검증 흐름:**
```
Save 클릭 → resolveModelName → 알려진 모델? → 바로 저장
                              → 커스텀 모델? → CLI validateModel() → valid: 저장 / invalid: 경고
```

### ✅ Phase 6: ClaudeChatViewPane 모듈화 완료 (2026-02-04)
- **결과**: 1682줄 → 1065줄 (~37% 감소)
- **구조**: 5개 Manager 클래스 분리 + 14개 기존 컴포넌트
- **총 모듈**: 19개로 기능별 분리 완료

---

## Architecture Overview

### Core Structure
```
src/vs/workbench/contrib/kent/
├── browser/services/          # 핵심 서비스 (5개 + 5개 매니저)
├── browser/views/            # UI 컴포넌트 (19개 모듈)
├── common/                   # 인터페이스 & 타입
└── electron-main/            # CLI 프로세스 관리
```

### Key Features ✅
- **Claude Chat Integration** - VS Code Panel 내 Claude 채팅
- **File Changes Tracking** - 파일 변경 감지 및 Diff/Revert
- **Multi-Session Support** - 세션별 독립 상태 관리
- **Model Management** - 글로벌/프로젝트별 모델 설정, CLI 검증
- **Advanced UI** - Markdown, 코드 블록, 첨부파일, 드래그드롭
- **Context Menus** - Explorer/Editor 우클릭 연동
- **Performance Optimized** - 메모리 94% 감소, 이벤트 98% 감소

---

## Next Steps

### 🎯 Backlog 전체 완료 ✅
- ~~인라인 코드 제안~~ (P1) ✅
- ~~벡터 검색 @codebase~~ (P2) ✅
- ~~Agent 모드~~ (P2) ✅

### 다음 방향
- 안정화 및 버그 수정
- 사용자 피드백 기반 개선
- MCP 서버 연동 (차기)

### 빌드 & 실행
```bash
yarn compile          # 컴파일 (수 분 소요)
./scripts/code.bat    # VS Code 실행
```

