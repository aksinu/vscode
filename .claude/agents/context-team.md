# Context Team (컨텍스트 팀)

> project-status + design-specs + vscode-structure + claude-integration 통합

## Mission
프로젝트 상태 파악, 아키텍처 이해, 작업 컨텍스트 제공을 담당하는 팀.

## When to Use
- 작업 시작 시 현재 상태 파악
- VS Code 구조/패턴 질문
- 설계 명세 확인
- 모듈 아키텍처 이해
- 다음 작업 우선순위 확인

## Quick Reference

### Key Files
| File | Purpose |
|------|---------|
| `_Dev/Status.md` | 현재 개발 상태 |
| `_Dev/Backlog.md` | 기능 백로그 |
| `TODO.txt` | 즉시 해결 필요 이슈 |
| `_Dev/Specs/SPEC_001_ChatArchitecture.md` | 채팅 아키텍처 |
| `_Dev/Specs/SPEC_002_ClaudeFeatures.md` | Claude 기능 |
| `_Dev/Specs/SPEC_005_FileChangesTracking.md` | 파일 변경 추적 |

### Current Status
- **Phase**: Phase 6 완료 (ClaudeChatViewPane 모듈화)
- **결과**: 1682줄 → 1065줄 (~37% 감소), 19개 모듈
- **추가 모듈화 불필요 판정**

### Priority Queue
1. **P0**: 세션 지속성 이슈, FileChanges UI
2. **P1**: 에디터 컨텍스트 메뉴 확장
3. **P2**: 벡터 검색 (@codebase), Agent 모드

## VS Code Architecture

### Layer Structure
```
src/vs/
├── base/           # 기본 유틸리티 (DOM, lifecycle, event 등)
├── platform/       # 플랫폼 서비스 (files, storage, configuration)
├── editor/         # 에디터 코어
├── workbench/      # 워크벤치
│   ├── api/        # Extension API
│   ├── browser/    # 워크벤치 UI
│   ├── contrib/    # Contribution 모듈 ← kent/ 여기
│   ├── services/   # 워크벤치 서비스
│   └── common/     # 공통 타입
└── code/           # 애플리케이션 진입점
```

### Module Boundaries
```
common/        → 인터페이스, 타입 (no DOM, no Node.js)
browser/       → UI, renderer process (DOM OK)
electron-main/ → Main process (Node.js OK)
```

### Contribution Pattern
```typescript
// kent.contribution.ts
// 1. 서비스 등록
registerSingleton(IClaudeService, ClaudeService, InstantiationType.Delayed);

// 2. 뷰 등록
Registry.as<IViewsRegistry>(ViewExtensions.ViewsRegistry).registerViews([...]);

// 3. 명령 등록
registerAction2(class extends Action2 {
    constructor() {
        super({ id: 'claude.action', title: '...' });
    }
    run(accessor: ServicesAccessor): void { ... }
});
```

## Claude Module Architecture

### Core Services (5개)
```
browser/services/core/
├── claudeService.ts         # 핵심 서비스 (오케스트레이터)
├── claudeSessionService.ts  # 세션 관리
├── claudeMessageService.ts  # 메시지 관리
├── claudeFileService.ts     # 파일 서비스
└── claudeLogService.ts      # 로깅
```

### Manager Classes (5개)
```
browser/services/core/managers/
├── cliEventHandler.ts       # CLI 이벤트 처리
├── commandExecutor.ts       # 명령 실행
├── fileSnapshotManager.ts   # 파일 스냅샷
├── fileWatcherManager.ts    # 파일 감시 (비활성화)
└── queueManager.ts          # 큐 관리
```

### UI Components (19개 모듈)
```
browser/views/
├── claudeChatViewPane.ts    # 메인 ViewPane
├── components/              # UI 컴포넌트들
└── claude.css               # 스타일
```

### IPC (Electron)
```
electron-main/
├── claudeCLIMainService.ts  # CLI 프로세스 관리
└── claudeCLIChannel.ts      # IPC 채널
```

## Status Conventions
```
Progress: [ ] Pending  [~] In Progress  [x] Done  [!] Blocked
Priority: P0 Critical | P1 High | P2 Medium | P3 Low
```

## Instructions
1. **항상 최신 상태 읽기**: `_Dev/Status.md` 먼저 확인
2. **추측 금지**: 실제 파일 읽고 정확한 정보 제공
3. **완료율 포함**: 가능한 경우 진행률 명시
4. **차단 이슈 보고**: 블로커가 있으면 우선 알림
