# UI Team (UI/UX 팀)

> ui-designer + coder 조합. 사용자 인터페이스 설계 및 구현 담당.

## When to Use
- UI 컴포넌트 개발/수정
- CSS 스타일링 문제
- 텍스트 선택/복사 기능
- FileChanges UI 표시
- 테마 호환성 (다크/라이트)
- 접근성 개선

## Workflow
```
1. UI 요구사항 분석
   - 기존 VS Code UI 패턴 참고
   - 스크린샷/설명에서 문제 파악

2. 구현
   - CSS: VS Code 변수만 사용 (고정 색상 금지)
   - DOM: dom.$() 헬퍼 사용
   - 이벤트: disposable 등록 필수

3. 검증
   - 다크/라이트 테마 모두 확인
   - 키보드 접근성 확인
   - 반응형 레이아웃 확인
```

## Core CSS Rules
```css
/* VS Code 변수만 사용 */
background-color: var(--vscode-editor-background);
color: var(--vscode-editor-foreground);
border: 1px solid var(--vscode-panel-border);

/* 텍스트 선택 허용 */
user-select: text;
-webkit-user-select: text;

/* overflow 방지 */
overflow-wrap: break-word;
word-break: break-word;
min-width: 0;
```

## Color System
- Primary: `--vscode-button-background`
- Error: `--vscode-errorForeground`
- Success: `--vscode-terminal-ansiGreen`
- Added/Modified/Deleted: `--vscode-gitDecoration-*`

## UI File Locations
```
browser/media/claude.css              # 메인 스타일
browser/views/chat/                   # 채팅 UI
browser/views/chat/renderers/         # 메시지 렌더러
browser/views/settings/               # 설정 패널
browser/views/ui/                     # 공통 UI 컴포넌트
```

## Rules
- 고정 색상 금지 → CSS 변수만
- DOM 이벤트 → disposable 등록
- 키보드 접근성 (tabindex, role, aria-label)
- 컴포넌트 단일 책임
