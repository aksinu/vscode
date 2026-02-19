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
│       ├── project-context.md  # 프로젝트 컨텍스트 (구조+상태+설계)
│       ├── architect.md        # 소프트웨어 설계자
│       ├── coder.md            # 코드 작성 전문가
│       ├── debugger.md         # 디버깅 전문가
│       ├── reviewer.md         # 코드 리뷰어 (테스트+성능+리팩토링 포함)
│       ├── ui-designer.md      # UI/UX 디자인 전문가
│       ├── dev-team.md         # 개발 팀 (architect + coder)
│       ├── bugfix-team.md      # 버그 수정 팀 (debugger + coder)
│       ├── ui-team.md          # UI 팀 (ui-designer + coder)
│       └── quality-team.md     # 품질 팀 (reviewer 기반)
│
├── _Dev/                  # 개발 문서
│   ├── Status.md          # 현재 Sprint 상태 (30~50줄) ★ 작업 시작 시 확인
│   ├── StatusHistory.md   # 완료된 Sprint/작업 히스토리
│   ├── Backlog.md         # 차세대 기능 백로그
│   ├── Bugs/              # 🐛 버그 추적 (README.md = 인덱스, 개별 파일 = 상세)
│   │   ├── README.md      # 버그 인덱스 (목록 + 상태) ★ 버그 발견 시 확인
│   │   └── BUG_*.md       # 개별 버그 상세 (원인 분석, 수정 내역, 재현 방법)
│   └── Specs/             # 설계 명세 (핵심 SPEC만 유지)
│       ├── SPEC_001_ChatArchitecture.md
│       ├── SPEC_002_ClaudeFeatures.md
│       └── SPEC_005_FileChangesTracking.md
│
└── src/                   # VS Code 소스
    └── vs/workbench/contrib/kent/  # Claude 모듈
```

---

## AI Workflow

### 작업 시작
```
1. _Dev/Status.md → 현재 상태 확인 (30~50줄로 빠르게 파악)
2. _Dev/Bugs/README.md → Active Bugs 확인 (관련 버그 있으면 상세 파일 참조)
3. 과거 맥락 필요 시 → _Dev/StatusHistory.md 끝에서부터 읽기
4. 필요시 관련 가이드/스펙 참조
5. 기존 VS Code 코드 패턴 파악
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
1. _Dev/Status.md 업데이트 (30~50줄 유지)
2. 버그 수정 시 → _Dev/Bugs/ 상세 문서 업데이트 + README.md 상태 변경
3. Sprint 완료 시 → Status.md 내용을 StatusHistory.md 맨 아래로 이동
4. 변경사항 요약 기록
```

### 커밋 메시지
```
- 한국어로 변경사항 요약하여 작성
- 형식: 한 줄 제목 + (필요시) 상세 내용
- 예시:
  채팅 말풍선 텍스트 넘침 수정
  AskUser 선택지 클릭 응답 연결 구현
  에이전트 문서 정리 및 CLAUDE.md 업데이트
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

## Agent 활용 원칙

### 적극적 Agent 활용 (필수)
- **사용자가 명시하지 않아도** 작업 특성에 맞는 agent를 적극 활용할 것
- **개발 범위가 큰 경우** agent team을 적극 활용하여 병렬 작업
- 단순 질문이나 1-2줄 수정이 아닌 이상, 관련 agent 참조를 기본으로

### Agent 선택 기준
| 상황 | Agent/Team |
|------|-----------|
| 프로젝트 상태/구조 파악 | `project-context` |
| 새 기능 설계+구현 | `dev-team` (architect + coder) |
| 버그/에러 수정 | `bugfix-team` (debugger + coder) |
| UI/CSS 작업 | `ui-team` (ui-designer + coder) |
| 코드 리뷰/품질 검증 | `quality-team` (reviewer 기반) |
| 설계만 필요 | `architect` 단독 |
| 구현만 필요 | `coder` 단독 |
| 디버깅만 필요 | `debugger` 단독 |

### 개별 에이전트 (6개)
| Agent | 역할 |
|-------|------|
| `project-context` | 프로젝트 상태, VS Code 구조, Claude 모듈 아키텍처 |
| `architect` | 기능 설계, 아키텍처 결정, 모듈 구조 계획 |
| `coder` | TypeScript 코드 작성, VS Code 패턴 준수 |
| `debugger` | 에러 분석, 스택 트레이스, 버그 추적 |
| `reviewer` | 코드 리뷰, 테스트, 성능, 리팩토링 판단 |
| `ui-designer` | UI/UX 설계, CSS, 접근성, 테마 호환 |

### 팀 에이전트 (4개)
| Team | 구성 | 언제 사용 |
|------|------|----------|
| `dev-team` | architect + coder | 새 기능 설계 및 구현 |
| `bugfix-team` | debugger + coder | 버그 분석, 에러 수정 |
| `ui-team` | ui-designer + coder | UI 개발, CSS, 접근성 |
| `quality-team` | reviewer 기반 | 코드 리뷰, 테스트, 최적화 |

---

## Status Conventions

```
진행 상태: [ ] Pending  [~] In Progress  [x] Done  [!] Blocked
우선순위: P0 Critical | P1 High | P2 Medium | P3 Low
```

---

## 📋 Documentation Management Rules

### Status.md + StatusHistory.md (분리 운영)
```
📌 Status.md (30~50줄, 현재 Sprint만)
  - 현재 Sprint/Phase 목표
  - 진행 중인 태스크 (3개 이하)
  - 핵심 이슈/블로커
  - 다음 우선순위 작업

📚 StatusHistory.md (계속 증가 OK)
  - 완료된 Sprint/Phase 기록
  - 과거 작업 이력 (최신이 맨 아래)
  - 필요시 참조용

📖 읽기 규칙:
  - 작업 시작 시: Status.md만 읽으면 OK (30~50줄)
  - 과거 맥락 필요 시: StatusHistory.md를 끝에서부터 읽기
  - Status.md에 Sprint 완료 시 → 해당 내용을 StatusHistory.md로 이동
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

### Bugs/ - 버그 추적 체계
```
📋 README.md: 버그 인덱스 (목록 + 상태 + 우선순위)
  - 작업 시작 시 Active Bugs 확인
  - 새 버그 발견 시 인덱스에 추가

📝 BUG_[모듈]_[설명].md: 개별 버그 상세
  - 증상, 에러 로그, 핵심 파일
  - 원인 분석 (깊은 코드 추적 결과)
  - 수정 내역 (코드 변경 요약)
  - 재현 방법

🔄 상태: Open → In Progress → Fixed → Closed
🏷️ 우선순위: P0 Critical | P1 High | P2 Medium | P3 Low

💡 규칙:
  - 버그 수정 시 반드시 상세 문서 업데이트
  - 근본 원인 분석은 상세 문서에 (컨텍스트 재로딩 시 유용)
  - Fixed 후 재현 테스트 완료 시 Closed로 이동
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
