# Feature Backlog

> **Claude 향후 기능 백로그** (Phase 6 완료 후)

---

## Overview

| # | Feature | Priority | Status | Complexity | Notes |
|---|---------|----------|--------|------------|-------|
| 1 | **세션 지속성 이슈 해결** | **P0** | **Pending** | Medium | IDE 재시작 시 파일 변경 UI 문제 |
| 2 | 에디터 컨텍스트 메뉴 확장 | P1 | Pending | Medium | 우클릭 서브메뉴 추가 |
| 3 | 벡터 검색 (@codebase) | P2 | Research | High | 프로젝트 전체 벡터 검색 |
| 4 | Agent 모드 | P2 | Design | High | 자율적 파일 생성/수정 |

---

## Feature Details

### 1. 🔥 세션 지속성 이슈 해결 (P0)

**문제 상황**:
- Claude가 파일을 수정하면 채팅에 변경사항 UI 표시 (정상)
- IDE 재시작 후에도 이전 세션의 변경사항 UI가 남아있음 (문제)
- 오래된 Apply/Revert 버튼이 동작하지 않음

**해결 방향**:
- IDE 재시작 감지 → 이전 세션 파일 변경 UI 비활성화
- 세션 ID 기반 유효성 검사
- 현재 세션에서만 유효한 변경사항만 활성화

---

### 2. 에디터 컨텍스트 메뉴 확장

**현재 상태**: ✅ 기본 구현됨
- ✅ `AskClaudeAboutSelection` (Ctrl+Shift+A)
- ✅ Explorer 파일/폴더 우클릭 메뉴

**목표**: 더 풍부한 컨텍스트 메뉴 제공

**사용 시나리오**:
- 코드 선택 → 우클릭 → "Explain this code" → 설명 요청
- 코드 선택 → 우클릭 → "Refactor with Claude" → 리팩토링 요청
- 코드 선택 → 우클릭 → "Ask Claude..." → 커스텀 질문

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
- [ ] 각 액션 구현:
  - [ ] `claude.explainSelection`
  - [ ] `claude.refactorSelection`
  - [ ] `claude.findIssues`
  - [ ] `claude.askAboutSelection`
- [ ] 선택 영역 정보 추출 (텍스트, 파일, 라인번호)
- [ ] 프롬프트 자동 생성 로직

**관련 파일**:
- `kent.contribution.ts`: 메뉴/액션 등록
- `claudeService.ts`: 프롬프트 생성 + 전송

**프롬프트 템플릿 예시**:
```
[Explain] Explain this code from {filename}:{startLine}-{endLine}:
\`\`\`{language}
{selectedCode}
\`\`\`

[Refactor] Refactor the following code for better readability:
...
```

---

### 3. 세션별 변경사항 히스토리

**목표**: Claude 세션 동안의 모든 파일 변경을 타임라인으로 관리

**사용 시나리오**:
- 세션 중 발생한 모든 변경사항 트리 뷰로 표시
- 특정 시점으로 되돌리기 (time travel)
- 세션 종료 후에도 히스토리 보존
- 이전 세션 히스토리 조회

**UI 구조**:
```
📁 Claude History
├─ 📅 Session: 2026-01-28 14:30 (Current)
│   ├─ 💬 Message #1: "Fix the bug"
│   │   ├─ 📄 service.ts (+10, -3) [Diff] [Revert]
│   │   └─ 📄 test.ts (+25, -0) [Diff] [Revert]
│   └─ 💬 Message #2: "Add validation"
│       └─ 📄 validator.ts (+50, -5) [Diff] [Revert]
├─ 📅 Session: 2026-01-27 10:00
│   └─ ...
```

**구현 항목**:
- [ ] `IClaudeHistoryService` 서비스 정의
- [ ] `IClaudeSessionHistory` 타입 정의
- [ ] Tree View Provider 구현 (`ClaudeHistoryTreeProvider`)
- [ ] 변경사항 timestamp 기록
- [ ] Storage 영구 저장 (IStorageService)
- [ ] 세션 간 히스토리 분리
- [ ] "Revert to this point" 기능

**관련 파일**:
- `claudeHistoryService.ts` (신규)
- `claudeHistoryTreeProvider.ts` (신규)
- `claudeFileSnapshot.ts`: 기존 스냅샷 연동
- `kent.contribution.ts`: View 등록

**데이터 구조**:
```typescript
interface IClaudeSessionHistory {
    sessionId: string;
    startTime: number;
    endTime?: number;
    messages: IClaudeMessageHistory[];
}

interface IClaudeMessageHistory {
    messageId: string;
    timestamp: number;
    prompt: string;
    fileChanges: IClaudeFileChange[];
}
```

---

### 4. Accept/Reject 배치 UI (Enhancement)

**현재 상태**: 메시지별 Revert 기능 구현됨

**추가 목표**: 전체 세션 변경사항을 한 화면에서 일괄 검토

**사용 시나리오**:
- Claude가 여러 파일 수정 완료
- "Review All Changes" 버튼 클릭
- 모든 변경사항 diff 미리보기
- 체크박스로 Accept/Reject 선택
- 일괄 적용

**UI 구조**:
```
┌─────────────────────────────────────────────┐
│ 📋 Review Changes (5 files modified)        │
├─────────────────────────────────────────────┤
│ ☑ service.ts        +10 -3   [View Diff]    │
│ ☑ controller.ts     +25 -10  [View Diff]    │
│ ☐ test.ts           +50 -0   [View Diff]    │
│ ☑ types.ts          +5  -2   [View Diff]    │
│ ☐ readme.md         +3  -0   [View Diff]    │
├─────────────────────────────────────────────┤
│ [✓ Accept Selected] [✗ Reject Selected]     │
│ [✓ Accept All]      [✗ Reject All]          │
└─────────────────────────────────────────────┘
```

**구현 항목**:
- [ ] `ClaudeReviewChangesView` ViewPane 구현
- [ ] 체크박스 리스트 UI
- [ ] 인라인 diff 미리보기
- [ ] 선택적 accept/reject 로직
- [ ] 기존 revert 로직 연동

**관련 파일**:
- `claudeReviewChangesView.ts` (신규)
- `claudeFileSnapshot.ts`: 기존 스냅샷 연동

---

## Implementation Order

**권장 순서**:
1. **Feature 1** (파일 탐색기) - 기본 contribution 패턴 학습
2. **Feature 2** (에디터 메뉴) - 1번과 유사, 확장
3. **Feature 3** (히스토리) - Tree View 패턴 학습, 복잡도 높음
4. **Feature 4** (배치 UI) - 3번 이후, 선택적 구현

---

## References

- VS Code Contribution Points: `src/vs/workbench/api/browser/mainThreadCommands.ts`
- Menu Registration: `src/vs/platform/actions/common/actions.ts`
- Tree View Example: `src/vs/workbench/contrib/outline/`
- Context Menu Example: `src/vs/workbench/contrib/files/browser/fileActions.contribution.ts`

---

**Updated**: 2026-02-03 (Phase 5 완료 후 갱신)
