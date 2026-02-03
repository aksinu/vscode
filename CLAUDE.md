# AI Development Rules

> **Claude Code Editor - AI 협업 가이드라인**

---

## Project Context

이 프로젝트는 **VS Code 포크**입니다.
- 기존 VS Code 코드베이스 위에 Claude 기능 추가
- 기존 패턴과 아키텍처를 최대한 따름
- `src/vs/workbench/contrib/kent/` 하위에 Claude 모듈 구현

---

## Directory Structure

```
ProjectRoot/
├── CLAUDE.md              # AI 룰 (이 파일)
├── PROJECT.md             # 프로젝트 목표 및 아키텍처
│
├── .claude/
│   ├── settings.local.json  # 로컬 권한 설정
│   └── agents/              # 서브에이전트 정의
│       ├── vscode-structure.md     # VS Code 구조 전문가
│       ├── contribution-pattern.md # Contribution 패턴 전문가
│       ├── claude-integration.md   # Claude 통합 설계 전문가
│       ├── project-status.md       # 프로젝트 상태 추적
│       ├── design-specs.md         # 설계 명세 전문가
│       ├── typescript-expert.md    # TypeScript 전문가
│       ├── ui-designer.md          # UI/UX 디자인 전문가
│       ├── ipc-expert.md           # IPC 통신 전문가
│       ├── performance-optimizer.md # 성능 최적화 전문가
│       ├── filesystem-expert.md    # 파일 시스템 전문가
│       ├── build-deploy-expert.md  # 빌드/배포 전문가
│       ├── component-architect.md  # 컴포넌트 기반 설계자
│       ├── composition-advocate.md # 탈상속주의자
│       ├── solid-principles-expert.md # SOLID 원칙 전도사
│       ├── architect.md            # 소프트웨어 설계자
│       ├── coder.md                # 코드 작성 전문가
│       ├── debugger.md             # 디버깅 전문가
│       ├── reviewer.md             # 코드 리뷰어
│       └── tester.md               # 테스트 전문가
│
├── _Dev/                  # 개발 문서
│   ├── Status.md          # 현재 진행 상태 ★ 작업 시작 시 확인
│   ├── Backlog.md         # 차세대 기능 백로그
│   └── Specs/             # 설계 명세 (핵심 SPEC만 유지)
│       ├── SPEC_001_ChatArchitecture.md
│       ├── SPEC_002_ClaudeFeatures.md
│       └── SPEC_005_FileChangesTracking.md
│
# 제거됨: _Guides/ (Phase 5 완료로 초기 설계 가이드 불필요)
│
└── src/                   # VS Code 소스
    └── vs/workbench/contrib/kent/  # Claude 모듈
```

---

## AI Workflow

### 작업 시작
```
1. _Dev/Status.md → 현재 상태 확인
2. 필요시 관련 가이드/스펙 참조
3. 기존 VS Code 코드 패턴 파악
```

### 작업 중
```
1. VS Code 기존 패턴 준수
2. TypeScript strict mode 준수
3. 의존성 주입(DI) 패턴 사용
4. 기존 서비스 재사용 우선
```

### 작업 완료
```
1. _Dev/Status.md 업데이트
2. 변경사항 요약 기록
```

### 빌드
```
⚠️ 컴파일 직접 실행 금지!
- 컴파일은 시간이 오래 걸림 (수 분)
- 코드 작성 후 "컴파일 필요" 안내만 할 것
- 사용자가 직접 yarn compile 또는 F5 실행
```

---

## VS Code Development Rules

### DO
- 기존 contribution 패턴 따르기 (`*.contribution.ts`)
- 서비스는 `common/`에, UI는 `browser/`에 분리
- `createDecorator`로 서비스 인터페이스 정의
- 기존 UI 컴포넌트 재사용 (Tree, List, QuickInput 등)

### DON'T
- 전역 상태 직접 사용 (서비스 통해 접근)
- DOM 직접 조작 (VS Code API 사용)
- 외부 라이브러리 무분별 추가

---

## Key VS Code Patterns

### Service Registration
```typescript
// common/claude.ts
export const IClaudeService = createDecorator<IClaudeService>('claudeService');

// browser/kent.contribution.ts
registerSingleton(IClaudeService, ClaudeService, InstantiationType.Delayed);
```

### View Registration
```typescript
// browser/kent.contribution.ts
Registry.as<IViewsRegistry>(ViewExtensions.ViewsRegistry).registerViews([{
    id: 'workbench.view.claude',
    name: 'Claude',
    containerLocation: ViewContainerLocation.Panel
}], ...);
```

---

## Subagent Reference

작업 유형에 따라 적절한 에이전트 활용:

### 지식 에이전트 (Knowledge)
| Agent | 용도 | 언제 사용 |
|-------|------|----------|
| `vscode-structure` | VS Code 소스 구조 | 디렉토리 구조, 레이어 규칙 질문 |
| `contribution-pattern` | Contribution 패턴 | 서비스/뷰/커맨드 등록 방법 |
| `claude-integration` | Claude 통합 설계 | IPC, 모듈 아키텍처 질문 |
| `project-status` | 프로젝트 상태 | 현재 진행상황, 완료된 작업 |
| `design-specs` | 설계 명세 | 기능 스펙, 설계 결정 |
| `typescript-expert` | TypeScript 전문 | 타입 시스템, 고급 패턴, VS Code 타입 |

### 작업 에이전트 (Task)
| Agent | 용도 | 언제 사용 |
|-------|------|----------|
| `architect` | 소프트웨어 설계 | 새 기능 설계, 아키텍처 결정 |
| `coder` | 코드 작성 | 구현, 버그 수정, 기본 리팩토링 |
| `refactoring-expert` | 리팩토링 전문 | 코드 냄새 탐지, 구조 개선, 품질 향상 |
| `debugger` | 디버깅 | 오류 분석, 로그 해석, 문제 해결 |
| `reviewer` | 코드 리뷰 | 품질 체크, 패턴 준수 검증 |
| `tester` | 테스트 | 테스트 케이스 설계, 테스트 작성 |

### 전문 에이전트 (Specialist)
| Agent | 용도 | 언제 사용 |
|-------|------|----------|
| `ui-designer` | UI/UX 디자인 | UI 컴포넌트, 사용자 경험 설계 |
| `ipc-expert` | IPC 통신 | Main/Renderer 프로세스 통신, 채널 설계 |
| `performance-optimizer` | 성능 최적화 | 메모리, CPU, 렌더링 최적화 |
| `filesystem-expert` | 파일 시스템 | 파일 처리, 변경 추적, 스냅샷 |
| `build-deploy-expert` | 빌드/배포 | 빌드 시스템, 컴파일 최적화, 패키징 |

### 설계 철학 에이전트 (Design Philosophy)
| Agent | 용도 | 언제 사용 |
|-------|------|----------|
| `component-architect` | 컴포넌트 설계 | 컴포넌트 기반 아키텍처, 조합 설계 |
| `composition-advocate` | 탈상속 설계 | 상속보다 구성, 인터페이스 설계 |
| `solid-principles-expert` | SOLID 원칙 | 단일 책임, SOLID 패턴 적용 |

---

## Status Conventions

```
진행 상태: [ ] Pending  [~] In Progress  [x] Done  [!] Blocked
우선순위: P0 Critical | P1 High | P2 Medium | P3 Low
```

---

## Reference Modules

기존 VS Code에서 참고할 모듈들:

| Module | Path | 참고 포인트 |
|--------|------|------------|
| Chat | `src/vs/workbench/contrib/chat/` | 채팅 UI 패턴 |
| Terminal | `src/vs/workbench/contrib/terminal/` | 패널 통합 |
| Comments | `src/vs/workbench/contrib/comments/` | 에디터 연동 |

---

**"VS Code 패턴을 따르는 일관된 개발"**
