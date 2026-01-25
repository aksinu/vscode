# TASK_004: UI Enhancement

> **Markdown 렌더링 및 코드 블록 기능 구현**

---

## Info

| Item | Value |
|------|-------|
| Task ID | TASK_004 |
| Sprint | Sprint_001 |
| Status | ✅ Done |
| Priority | P0 Critical |
| Created | 2025-01-25 |
| Updated | 2025-01-25 |

---

## Objective

채팅 UI 개선: Markdown 렌더링, 코드 블록 Copy/Apply 버튼, 환영 화면 추가.

---

## Completed Work

### 1. 메시지 렌더러 (claudeMessageRenderer.ts)
- Markdown 렌더링 (기존 `renderMarkdown` 활용)
- 코드 블록 커스텀 렌더러
  - Copy 버튼 (클립보드 복사)
  - Insert 버튼 (커서 위치 삽입)
  - Apply 버튼 (선택 영역 대체)
- 역할별 아이콘 (User: account, Claude: sparkle)
- 타임스탬프 표시
- 컨텍스트 태그 (파일명, 선택 라인 수)

### 2. 채팅 뷰 개선 (claudeChatView.ts)
- 환영 화면 (Welcome Screen)
  - 아이콘 + 설명
  - 힌트 버튼 (Explain, Debug, Refactor, Test)
- 로딩 인디케이터
  - 스피너 애니메이션
  - "Claude is thinking..." 텍스트
- 메시지 리스트
  - 등장 애니메이션
  - 역할별 정렬 (사용자: 오른쪽, Claude: 왼쪽)
- 입력 영역 개선
  - 툴바 (첨부 버튼)
  - 전송 버튼
  - 포커스 시 테두리 강조

### 3. CSS 스타일 (claude.css)
- 환영 화면 스타일
- 메시지 버블 스타일
- 코드 블록 헤더/버튼
- 컨텍스트 태그
- 입력 영역 스타일
- 반응형 대응
- 스크롤바 커스터마이징

---

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `claudeMessageRenderer.ts` | **NEW** | 메시지 렌더러 클래스 |
| `claudeChatView.ts` | UPDATE | 환영화면, 로딩, 렌더러 통합 |
| `media/claude.css` | UPDATE | 스타일 대폭 확장 |

---

## Code Block Features

```typescript
// 버튼 기능
Copy   → clipboardService.writeText(code)
Insert → codeEditor.executeEdits() at cursor
Apply  → codeEditor.executeEdits() at selection
```

### Copy 버튼 피드백
- 클릭 시 아이콘 변경: copy → check
- 2초 후 원복

---

## Verification

- [x] TypeScript 진단 에러 없음
- [x] CSS 구문 오류 없음
- [ ] 빌드 테스트 (npm install 필요)
- [ ] 실제 UI 동작 확인

---

## Notes

### 환영 화면 힌트
```
- Explain this code
- Help me debug this error
- Refactor this function
- Write a unit test
```

### 메시지 애니메이션
```css
@keyframes claude-message-appear {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
}
```

---

## 다음 단계

- 빌드 및 실행 테스트
- 스트리밍 응답 지원 (Phase 1.5)
- @ 멘션 시스템 (Phase 2)

---

**Status: ✅ Done**
