# UI Team (UI/UX 팀)

> ui-designer + coder + component-architect + composition-advocate 통합

## Mission
채팅 UI, FileChanges UI, 테마 호환성 등 사용자 인터페이스를 설계하고 구현하는 팀.

## When to Use
- UI 컴포넌트 개발/수정
- CSS 스타일링 문제
- 텍스트 선택/복사 기능
- FileChanges UI 표시
- 테마 호환성 (다크/라이트)
- 접근성 개선
- 드래그 앤 드롭 기능

## Current UI Issues
- 채팅창 우측 글씨 잘림 (마지막 글씨 반 정도 잘림)
- 말풍선 드래그 복사 불가 (리팩토링 후 리그레션)
- FileChanges UI 미표시
- Apply 후 파일 리스트 말풍선 유지

## UI Module Structure
```
browser/views/
├── claudeChatViewPane.ts        # ViewPane 메인 (1065줄)
├── components/                  # UI 컴포넌트
│   ├── claudeMessageRenderer.ts # 메시지 렌더링
│   ├── claudeMarkdownRenderer.ts# Markdown 렌더링
│   ├── claudeCodeBlockRenderer.ts# 코드 블록
│   ├── claudeInputArea.ts       # 입력 영역
│   └── ...
└── claude.css                   # 스타일
```

## VS Code UI Patterns

### Theme Support (필수)
```css
/* VS Code CSS 변수만 사용 - 고정 색상 금지 */
.claude-chat {
    background-color: var(--vscode-editor-background);
    color: var(--vscode-editor-foreground);
    border: 1px solid var(--vscode-panel-border);
}
.claude-button {
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
}
.claude-button:hover {
    background: var(--vscode-button-hoverBackground);
}
```

### DOM Creation
```typescript
// VS Code 헬퍼 사용
const container = dom.$('.claude-container');
const button = dom.$('button.claude-btn', { title: 'Send' }, 'Send');

// 이벤트 리스너 (반드시 disposable로 등록)
this._register(dom.addDisposableListener(element, 'click', handler));
```

### ViewPane Pattern
```typescript
export class ClaudeView extends ViewPane {
    protected override renderBody(container: HTMLElement): void {
        // UI 렌더링
    }
}
```

### Keyboard Accessibility
```typescript
element.setAttribute('tabindex', '0');
element.setAttribute('role', 'button');
element.setAttribute('aria-label', 'Send message');
```

### Text Selection (CSS)
```css
/* 텍스트 선택 허용 */
.claude-message-content {
    user-select: text;
    -webkit-user-select: text;
    cursor: text;
}
```

## FileChanges UI Spec
```
┌─────────────────────────────────────────────────┐
│ ▼ 📁 2 modified, 1 created  +45 -12  [Revert All] │
├─────────────────────────────────────────────────┤
│ ● claudeService.ts          +30 -8    [Diff][⟲] │
│ ● claudeTypes.ts            +15 -4    [Diff][⟲] │
│ + claudeFileSnapshot.ts     +120      [Diff][⟲] │
└─────────────────────────────────────────────────┘
```

### CSS Classes
```css
.claude-file-changes           /* 컨테이너 */
.claude-file-changes-header    /* 헤더 (토글) */
.claude-file-changes-summary   /* 요약 */
.claude-file-changes-list      /* 파일 목록 */
.claude-file-changes-item      /* 개별 파일 */
.claude-file-status-icon       /* 상태 아이콘 */
.claude-file-name              /* 파일명 */
.claude-file-line-changes      /* 라인 변경 (+/-) */
.claude-file-buttons           /* 버튼 그룹 */
```

## Design Principles
1. **Consistency**: VS Code 기존 UI 패턴 준수
2. **Composition over Inheritance**: 작은 컴포넌트 조합
3. **Simplicity**: 최소 UI로 최대 효과
4. **Responsiveness**: 모든 뷰포트 대응
5. **Accessibility**: WCAG 2.1 AA

## Color System
- Primary: `--vscode-button-background`
- Error: `--vscode-errorForeground`
- Success: `--vscode-terminal-ansiGreen`
- Info: `--vscode-textLink-foreground`
- Added: `--vscode-gitDecoration-addedResourceForeground`
- Deleted: `--vscode-gitDecoration-deletedResourceForeground`
- Modified: `--vscode-gitDecoration-modifiedResourceForeground`

## Rules
- 고정 색상(#fff, rgb 등) 사용 금지 → CSS 변수만
- DOM 직접 조작 최소화 → VS Code API 사용
- 이벤트 리스너는 반드시 disposable 등록
- 컴포넌트는 단일 책임 원칙
