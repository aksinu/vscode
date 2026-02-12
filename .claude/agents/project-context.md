# Project Context Agent

> vscode-structure + contribution-pattern + claude-integration + project-status + design-specs 통합

프로젝트 상태, VS Code 구조, Claude 모듈 아키텍처에 대한 종합 컨텍스트를 제공하는 에이전트.

## When to Use
- 작업 시작 시 현재 상태 파악
- VS Code 구조/패턴 질문
- Claude 모듈 아키텍처 이해
- 설계 명세 확인
- 다음 작업 우선순위 확인

## Instructions

1. **항상 최신 상태 먼저 확인**: `_Dev/Status.md` 읽기
2. **추측 금지**: 실제 파일을 읽고 정확한 정보 제공
3. **관련 Spec 참조**: `_Dev/Specs/` 하위 문서
4. **Backlog 참조**: `_Dev/Backlog.md`

## Key References

| 문서 | 위치 | 내용 |
|------|------|------|
| Status.md | `_Dev/Status.md` | 현재 Phase, 진행상황, 다음 작업 |
| Backlog.md | `_Dev/Backlog.md` | 기능 백로그, 우선순위 |
| SPEC_001 | `_Dev/Specs/SPEC_001_ChatArchitecture.md` | 채팅 아키텍처 |
| SPEC_002 | `_Dev/Specs/SPEC_002_ClaudeFeatures.md` | Claude 기능 스펙 |
| SPEC_005 | `_Dev/Specs/SPEC_005_FileChangesTracking.md` | 파일 변경 추적 |

## VS Code Layer Structure
```
src/vs/
├── base/           # 기본 유틸리티 (DOM, lifecycle, event)
├── platform/       # 플랫폼 서비스 (files, storage, configuration)
├── editor/         # 에디터 코어
└── workbench/      # 워크벤치
    └── contrib/kent/  # Claude 모듈 ← 여기
```

**Layer Rule**: 상위 레이어만 하위 레이어를 import 가능 (base → platform → editor → workbench)

## Claude Module Architecture
```
src/vs/workbench/contrib/kent/
├── browser/
│   ├── kent.contribution.ts         # 등록 진입점
│   ├── media/claude.css             # 스타일
│   ├── actions/claudeActions.ts     # 액션
│   ├── services/
│   │   ├── core/                    # 핵심 서비스 5개
│   │   │   ├── claudeService.ts     # 오케스트레이터
│   │   │   ├── claudeAPIService.ts
│   │   │   ├── claudeConnection.ts
│   │   │   ├── claudeContextBuilder.ts
│   │   │   └── managers/            # 매니저 6개
│   │   │       ├── chatManager.ts
│   │   │       ├── chatStateManager.ts
│   │   │       ├── configManager.ts
│   │   │       ├── fileWatcherManager.ts
│   │   │       ├── historyManager.ts
│   │   │       └── multiSessionManager.ts
│   │   ├── file/                    # 파일 서비스
│   │   ├── message/                 # 메시지 서비스
│   │   ├── queue/                   # 큐 서비스
│   │   ├── rateLimit/               # Rate Limit
│   │   ├── session/                 # 세션 관리
│   │   ├── settings/                # 설정 서비스
│   │   └── ui/                      # UI 서비스
│   └── views/
│       ├── chat/                    # 채팅 뷰
│       │   ├── claudeChatView.ts    # 메인 ChatView
│       │   ├── renderers/           # 메시지 렌더러
│       │   └── managers/            # 뷰 매니저
│       ├── session/                 # 세션 UI
│       ├── settings/                # 설정 패널
│       └── ui/                      # 공통 UI
├── common/                          # 인터페이스 & 타입
│   ├── claude.ts
│   ├── claudeCLI.ts
│   ├── claudeCLIChannel.ts
│   └── claudeTypes.ts
└── electron-main/                   # Main Process (CLI 관리)
    ├── claudeCLIMainService.ts
    ├── claudeCLIProcessManager.ts
    └── claudeCLIChannel.ts
```

## IPC Communication Flow
```
Renderer (browser/)          Main (electron-main/)
ClaudeService ──sendPrompt──► ClaudeCLIMainService
              ◄──onDidReceive── spawn('claude') CLI
```

## Contribution Pattern
```typescript
// kent.contribution.ts
registerSingleton(IClaudeService, ClaudeService, InstantiationType.Delayed);
Registry.as<IViewsRegistry>(...).registerViews([...]);
registerAction2(class extends Action2 { ... });
```

## Module Boundaries
```
common/        → 인터페이스, 타입 (no DOM, no Node.js)
browser/       → UI, Renderer 프로세스 (DOM OK)
electron-main/ → Main 프로세스 (Node.js OK)
```

## Status Conventions
```
Progress: [ ] Pending  [~] In Progress  [x] Done  [!] Blocked
Priority: P0 Critical | P1 High | P2 Medium | P3 Low
```
