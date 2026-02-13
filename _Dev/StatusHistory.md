# Status History

> **완료된 Sprint/Phase 히스토리** (최신이 맨 아래)

---

## Phase 6: ClaudeChatViewPane 모듈화 (2026-02-04)
- **결과**: 1682줄 → 1065줄 (~37% 감소)
- **구조**: 5개 Manager 클래스 분리 + 14개 기존 컴포넌트
- **총 모듈**: 19개로 기능별 분리 완료

---

## Phase 7~8: 모델 설정 리팩토링 + CLI 기능 확장 (2026-02-10~12)

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

**모델 우선순위:**
```
세션 오버라이드 (메모리) > 프로젝트 .claude/settings.json > .vscode/claude.local.json > 글로벌 ~/.claude/settings.json > 기본값
```

### [x] Max Turns / Max Budget 설정 패널 추가 (2026-02-12)
- Max Turns (디폴트: 1000, 범위: 1~1000)
- Max Budget USD (디폴트: 5, 범위: 0.01~100, step: 0.01)

### [x] 상태 관리 버그 수정 — Cancel 버튼 미표시 문제 (2026-02-12)
**상태 매핑 (ChatSessionState → ClaudeServiceState):**
```
sending → sending, responding → streaming, asking → streaming
rateLimit → streaming, error → error, idle → idle
```

### [x] P1 CLI 기능 구현 완료
- `/cost`, `/compact`, 프롬프트 히스토리 (↑↓), `@selection` 멘션
- Extended Thinking 토글, 코드 블록 Apply 강화

---

## Phase 9: CLI 기능 확장 + 에디터 통합 + Agent 모드 (2026-02-12)

### [x] 에디터 컨텍스트 메뉴 확장 — Claude 서브메뉴
```
우클릭 → Claude ▶
           ├─ Explain Selection / Refactor Selection / Find Issues
           ├─ Ask Claude... (Ctrl+Shift+A)
           └─ Add File to Claude
```

### [x] 슬래시 커맨드 확장
```
/config, /context, /export, /resume, /rename, /plan, /status
```

### [x] CLI 미구현 기능 보완
- `--max-tokens` CLI 인자 전달, `clearMessages()` 구현
- Max Tokens 설정 UI 추가 (100~128000)

### [x] Agent 모드 구현
```
상태바 클릭: default ○ → plan ◐ → accept-edits ● → agent ⚡ → default ○
/agent 커맨드: 현재 모드 ↔ bypass-permissions 토글
```
