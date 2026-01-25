# AI Development Rules

> **Claude Code Editor - AI 협업 가이드라인**

---

## Project Context

이 프로젝트는 **VS Code 포크**입니다.
- 기존 VS Code 코드베이스 위에 Claude 기능 추가
- 기존 패턴과 아키텍처를 최대한 따름
- `src/vs/workbench/contrib/` 하위에 새 모듈 추가

---

## Directory Structure

```
ProjectRoot/
├── CLAUDE.md              # AI 룰 (이 파일)
├── PROJECT.md             # 프로젝트 목표 및 아키텍처
│
├── _Dev/                  # 개발 문서
│   ├── Status.md          # 현재 진행 상태
│   ├── Tasks/             # 태스크 기록
│   └── Specs/             # 설계 명세
│
├── _Guides/               # 개발 가이드
│   ├── 01_VSCode_Structure.md
│   ├── 02_Contribution_Pattern.md
│   └── 03_Claude_Integration.md
│
└── src/                   # VS Code 소스
    └── vs/workbench/contrib/claude/  # Claude 모듈 (추가 예정)
```

---

## AI Workflow

### 작업 시작
```
1. PROJECT.md → 목표 확인
2. _Dev/Status.md → 현재 상태 확인
3. 관련 _Guides/ 참조
4. 기존 VS Code 코드 패턴 파악
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
// common/claudeService.ts
export const IClaudeService = createDecorator<IClaudeService>('claudeService');

// browser/claude.contribution.ts
registerSingleton(IClaudeService, ClaudeService, InstantiationType.Delayed);
```

### View Registration
```typescript
// browser/claude.contribution.ts
Registry.as<IViewsRegistry>(ViewExtensions.ViewsRegistry).registerViews([{
    id: 'workbench.view.claude',
    name: 'Claude',
    containerLocation: ViewContainerLocation.Panel
}], ...);
```

---

## Guides Index

| Guide | Description |
|-------|-------------|
| [01_VSCode_Structure](./_Guides/01_VSCode_Structure.md) | VS Code 소스 구조 |
| [02_Contribution_Pattern](./_Guides/02_Contribution_Pattern.md) | Contribution 패턴 |
| [03_Claude_Integration](./_Guides/03_Claude_Integration.md) | Claude 통합 설계 |

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
