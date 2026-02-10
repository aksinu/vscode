# Development Status

> **현재 개발 진행 상태**

---

## Current Status

| Item | Value |
|------|-------|
| **Phase** | 🎯 **Phase 7 진행중** - 모델 설정 리팩토링 + CLI 검증 |
| **Status** | [x] 코드 완료, ⚠️ 컴파일 필요 |
| **Build** | ⚠️ 컴파일 필요 |
| **Updated** | 2026-02-10 |

---

## Latest Completion

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

### 🎯 Development Priority
1. **사용자 피드백 문제 해결** - 파일 변경 UI 세션 지속성 이슈
2. **Backlog 기능 구현** - 에디터 컨텍스트 메뉴 확장, 벡터 검색 등
3. **안정성 개선** - 추가 테스트, 에러 핸들링 강화

### 빌드 & 실행
```bash
yarn compile          # 컴파일 (수 분 소요)
./scripts/code.bat    # VS Code 실행
```

