# Feature Backlog

> **Claude 향후 기능 백로그** (Phase 7 진행중)

---

## Overview

| # | Feature | Priority | Status | Complexity | Notes |
|---|---------|----------|--------|------------|-------|
| 1 | ~~세션 지속성 이슈 해결~~ | ~~P0~~ | **Done** | ~~Medium~~ | ✅ 해결됨 |
| 2 | **모델 설정 리팩토링 + CLI 검증** | **P0** | **Done** | Medium | ✅ 글로벌/프로젝트 분리, CLI 검증 |
| 3 | 에디터 컨텍스트 메뉴 확장 | P1 | Pending | Medium | 우클릭 서브메뉴 추가 |
| 4 | 벡터 검색 (@codebase) | P2 | Research | High | 프로젝트 전체 벡터 검색 |
| 5 | Agent 모드 | P2 | Design | High | 자율적 파일 생성/수정 |

---

## Completed

### ✅ 1. 세션 지속성 이슈 해결 (P0) — Done
- IDE 재시작 시 이전 세션의 파일 변경 UI가 남아있던 문제 해결
- 세션 ID 기반 유효성 검사로 현재 세션만 활성화

### ✅ 2. 모델 설정 리팩토링 + CLI 검증 (P0) — Done (2026-02-10)
- 글로벌 설정 → `~/.claude/settings.json`에 모델 저장
- 세션 설정 → `.claude/settings.json`에 모델 저장
- 모델 선택 UI: 드롭다운 + 커스텀 입력 (양쪽 패널)
- 커스텀 모델 CLI 검증 (`claude -p "hi" --model <model> --max-turns 1`)

---

## Pending Features

### 3. 에디터 컨텍스트 메뉴 확장 (P1)

**현재 상태**: 기본 구현됨
- ✅ `AskClaudeAboutSelection` (Ctrl+Shift+A)
- ✅ Explorer 파일/폴더 우클릭 메뉴

**목표**: 더 풍부한 컨텍스트 메뉴 제공

**메뉴 구조**:
```
우클릭 메뉴
├─ ...기존 메뉴들...
└─ Claude
    ├─ Explain Selection
    ├─ Refactor Selection
    ├─ Find Issues
    └─ Ask Claude...
```

**구현 항목**:
- [ ] `menus.editor/context` contribution 등록
- [ ] Submenu 그룹 생성 ("Claude")
- [ ] 각 액션 구현 (`explainSelection`, `refactorSelection`, `findIssues`, `askAboutSelection`)
- [ ] 선택 영역 정보 추출 + 프롬프트 자동 생성

---

### 4. 벡터 검색 (@codebase) (P2)

**목표**: 프로젝트 전체 코드베이스를 벡터 검색하여 컨텍스트로 활용

**상태**: Research 단계

---

### 5. Agent 모드 (P2)

**목표**: 자율적 파일 생성/수정 에이전트

**상태**: Design 단계

---

## References

- VS Code Contribution Points: `src/vs/workbench/api/browser/mainThreadCommands.ts`
- Menu Registration: `src/vs/platform/actions/common/actions.ts`
- Tree View Example: `src/vs/workbench/contrib/outline/`
- Context Menu Example: `src/vs/workbench/contrib/files/browser/fileActions.contribution.ts`

---

**Updated**: 2026-02-10
