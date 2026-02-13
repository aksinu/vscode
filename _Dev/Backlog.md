# Feature Backlog

> **Claude 향후 기능 백로그** (Phase 7 진행중)

---

## Overview

| # | Feature | Priority | Status | Complexity | Notes |
|---|---------|----------|--------|------------|-------|
| 1 | ~~세션 지속성 이슈 해결~~ | ~~P0~~ | **Done** | ~~Medium~~ | ✅ 해결됨 |
| 2 | **모델 설정 리팩토링 + CLI 검증** | **P0** | **Done** | Medium | ✅ 글로벌/프로젝트 분리, CLI 검증 |
| 3 | ~~에디터 컨텍스트 메뉴 확장~~ | ~~P1~~ | **Done** | ~~Medium~~ | ✅ Claude 서브메뉴 (Explain/Refactor/FindIssues) |
| 4 | ~~인라인 코드 제안~~ | ~~P1~~ | **Done** | ~~High~~ | ✅ 에디터 인라인 Claude 코드 제안 |
| 5 | ~~벡터 검색 (@codebase)~~ | ~~P2~~ | **Done** | ~~High~~ | ✅ BM25 검색 + @codebase 멘션 |
| 6 | ~~Agent 모드~~ | ~~P2~~ | **Done** | ~~High~~ | ✅ bypassPermissions + /agent 토글 |

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

### ✅ 3. 에디터 컨텍스트 메뉴 확장 (P1) — Done (2026-02-12)
- Claude 서브메뉴 등록 (`MenuId.for('claude.editorContext')`)
- Explain Selection / Refactor Selection / Find Issues 액션
- 선택 영역+프롬프트 바로 전송 (`sendWithContext`)
- 기존 Ask Claude / Add File도 서브메뉴로 통합

---

### ✅ 4. 인라인 코드 제안 (P1) — Done (2026-02-12)
- 에디터 인라인 Claude 코드 제안 (`services/inline/`)

### ✅ 5. 벡터 검색 (@codebase) (P2) — Done (2026-02-12)
- BM25 검색 엔진 + 파일 인덱서 (`services/codebase/`)
- `@codebase` 멘션 → 전송 시 BM25 검색 → file 첨부 자동 변환

### ✅ 6. Agent 모드 (P2) — Done (2026-02-12)
- 상태바 Permission Mode 순환에 Agent 추가 (default → plan → accept-edits → agent)
- `/agent` 슬래시 커맨드 (토글식: Agent ON/OFF)
- `bypass-permissions` CLI 옵션 자동 전달
- `/status`에 현재 모드 표시

---

## References

- VS Code Contribution Points: `src/vs/workbench/api/browser/mainThreadCommands.ts`
- Menu Registration: `src/vs/platform/actions/common/actions.ts`
- Tree View Example: `src/vs/workbench/contrib/outline/`
- Context Menu Example: `src/vs/workbench/contrib/files/browser/fileActions.contribution.ts`

---

**Updated**: 2026-02-12
