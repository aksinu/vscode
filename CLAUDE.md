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

## Agent Teams (통합 팀)

작업 유형에 따라 적절한 팀 에이전트 활용:

### 팀 에이전트 (권장)
| Team | 통합 역할 | 언제 사용 |
|------|----------|----------|
| `dev-team` | architect + coder + typescript + contribution | 새 기능 설계 및 구현 |
| `bugfix-team` | debugger + coder + typescript | 버그 분석, 에러 수정, TODO 해결 |
| `ui-team` | ui-designer + coder + component + composition | UI 개발, CSS, 접근성 |
| `quality-team` | reviewer + tester + performance + SOLID + refactoring | 코드 리뷰, 테스트, 최적화 |
| `infra-team` | ipc + filesystem + build-deploy | IPC 통신, 파일 시스템, 빌드 |
| `context-team` | project-status + design-specs + vscode-structure + claude | 프로젝트 상태, 아키텍처 이해 |

### 개별 에이전트 (세부 참조용)
<details>
<summary>20개 개별 에이전트 목록</summary>

**Knowledge**: `vscode-structure`, `contribution-pattern`, `claude-integration`, `project-status`, `design-specs`, `typescript-expert`

**Task**: `architect`, `coder`, `refactoring-expert`, `debugger`, `reviewer`, `tester`

**Specialist**: `ui-designer`, `ipc-expert`, `performance-optimizer`, `filesystem-expert`, `build-deploy-expert`

**Design Philosophy**: `component-architect`, `composition-advocate`, `solid-principles-expert`
</details>

---

## Status Conventions

```
진행 상태: [ ] Pending  [~] In Progress  [x] Done  [!] Blocked
우선순위: P0 Critical | P1 High | P2 Medium | P3 Low
```

---

## 📋 Documentation Management Rules

### Status.md - 핵심 상태만 유지
```
🎯 목적: AI 에이전트가 빠르게 현재 상태 파악
📏 규모: 100줄 내외로 간소화 (상세 이력 X)
📝 내용:
  - 현재 Phase/진행상황
  - 최신 아키텍처 개요
  - 핵심 이슈 3개 이하
  - 다음 우선순위 작업
```

### Specs/ - 핵심 명세만 보관
```
📁 유지: 핵심 아키텍처 SPEC만 (3개 이하)
🗑️ 제거: 완료된 기능의 상세 설계서
🔄 업데이트: 구현 완료 시 "완료 상태"로 전환
📋 내용: 현재 아키텍처 + 미해결 이슈
```

### Backlog.md - 미래 지향적 관리
```
🚀 중심: 차세대 기능 (완료 기능 제거)
📊 우선순위: P0(Critical) → P3(Low) 명확히
💡 복잡도: 구현 방향 및 예상 복잡도 명시
🔄 정리: 분기별 백로그 리뷰 및 정리
```

### RefactoringPlan.md - Phase별 관리
```
📈 진행형: Phase 진행 중일 때만 계획서
✅ 완료형: Phase 완료 시 보고서로 전환
📊 메트릭: 최종 모듈 수, 순환 참조 제거 등
🎯 판단: 추가 리팩토링 필요성 평가
```

### 문서 정리 주기
```
📅 매 Phase 완료 시:
  - Status.md 간소화
  - 완료 SPEC 아카이브 또는 현행화
  - Backlog 우선순위 재조정
  - RefactoringPlan 완료 보고서 전환

💡 무거운 문서 = AI 컨텍스트 낭비
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
