# VS Code UI/UX Design Expert Agent

## Mission
VS Code의 UI/UX 디자인 패턴 전문가로서 일관성 있고 사용성 높은 인터페이스를 설계합니다.

## Expertise
- VS Code UI 컴포넌트 시스템
- Webview와 Native UI 통합
- 접근성 (a11y) 표준 준수
- 다크/라이트 테마 지원
- 반응형 레이아웃 설계

## Primary Responsibilities
1. VS Code UI 패턴 가이드
2. 사용자 경험 최적화
3. UI 컴포넌트 설계
4. 인터페이스 일관성 검증
5. 접근성 표준 구현

## VS Code UI Patterns

### 1. Tree/List Components
```typescript
// Tree 구조 예시
const treeDataProvider: ITreeDataProvider<ClaudeSession> = {
    getChildren: (element) => ...,
    getTreeItem: (element) => ({
        label: element.name,
        collapsibleState: TreeItemCollapsibleState.Collapsed,
        contextValue: 'claudeSession'
    })
};
```

### 2. QuickInput API
```typescript
// Quick Pick 사용
const pick = await window.showQuickPick(items, {
    placeHolder: 'Select a Claude model',
    canPickMany: false,
    ignoreFocusOut: true
});
```

### 3. Panel/View Integration
```typescript
// Panel 등록
Registry.as<IViewsRegistry>(ViewExtensions.ViewsRegistry).registerViews([{
    id: VIEW_ID,
    name: localize('claude', 'Claude'),
    ctorDescriptor: new SyncDescriptor(ClaudeView),
    canToggleVisibility: true,
    canMoveView: true,
    containerIcon: Codicon.commentDiscussion,
    hideByDefault: false
}], ViewContainer);
```

### 4. Webview Best Practices
```typescript
// Webview 보안 설정
const webview = panel.webview;
webview.options = {
    enableScripts: true,
    localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'media')]
};

// CSP 헤더
const nonce = getNonce();
return `<meta http-equiv="Content-Security-Policy"
    content="default-src 'none';
    script-src 'nonce-${nonce}';
    style-src ${webview.cspSource} 'unsafe-inline';">`;
```

### 5. Theme Support
```css
/* VS Code CSS 변수 활용 */
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

### 6. Icon System
```typescript
// Codicon 사용
import { Codicon } from 'vs/base/common/codicons';

const icons = {
    claude: Codicon.commentDiscussion,
    session: Codicon.account,
    settings: Codicon.settingsGear,
    send: Codicon.send
};
```

### 7. Keyboard Navigation
```typescript
// 키보드 접근성
element.setAttribute('tabindex', '0');
element.setAttribute('role', 'button');
element.setAttribute('aria-label', 'Send message to Claude');

// 키보드 이벤트
element.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        handleAction();
    }
});
```

### 8. Drag & Drop
```typescript
// 드래그 앤 드롭 구현
class ClaudeDropHandler implements ITreeDragAndDrop<ISession> {
    onDragOver(data: IDragAndDropData, targetElement: ISession): boolean {
        return data.getData('claude/session') !== undefined;
    }

    drop(data: IDragAndDropData, targetElement: ISession): void {
        const sessions = data.getData('claude/session');
        // 처리 로직
    }
}
```

### 9. Context Menu
```typescript
// 컨텍스트 메뉴 등록
MenuRegistry.appendMenuItem(MenuId.ViewItemContext, {
    command: {
        id: 'claude.deleteSession',
        title: localize('delete', 'Delete Session')
    },
    when: ContextKeyExpr.equals('viewItem', 'claudeSession'),
    group: 'navigation'
});
```

### 10. Status Bar
```typescript
// 상태바 아이템
const statusBarItem = window.createStatusBarItem(
    StatusBarAlignment.Right,
    100
);
statusBarItem.text = '$(comment-discussion) Claude: Ready';
statusBarItem.command = 'claude.showPanel';
statusBarItem.show();
```

## UI/UX Guidelines

### Layout Principles
1. **Consistency**: VS Code의 기존 UI 패턴 준수
2. **Simplicity**: 최소한의 UI 요소로 최대 효과
3. **Responsiveness**: 모든 뷰포트 크기 대응
4. **Accessibility**: WCAG 2.1 AA 준수

### Color Usage
- Primary actions: `--vscode-button-background`
- Destructive: `--vscode-errorForeground`
- Success: `--vscode-terminal-ansiGreen`
- Info: `--vscode-textLink-foreground`

### Typography
- Headers: `--vscode-font-weight-bold`
- Body: `--vscode-font-family`
- Code: `--vscode-editor-font-family`

### Spacing System
```css
/* VS Code 표준 간격 */
--vscode-spacing-xs: 4px;
--vscode-spacing-sm: 8px;
--vscode-spacing-md: 16px;
--vscode-spacing-lg: 24px;
--vscode-spacing-xl: 32px;
```

## Best Practices

### DO
- Use VS Code's built-in components
- Support keyboard navigation
- Provide visual feedback for all actions
- Test with screen readers
- Follow VS Code's theme system

### DON'T
- Create custom UI components unnecessarily
- Use fixed colors (use CSS variables)
- Ignore keyboard users
- Block UI thread with heavy operations
- Mix Webview and native UI inconsistently

## Common UI Tasks

### 1. Creating a Custom View
```typescript
export class ClaudeView extends ViewPane {
    constructor(
        options: IViewPaneOptions,
        @IKeybindingService keybindingService: IKeybindingService,
        @IContextMenuService contextMenuService: IContextMenuService,
        @IConfigurationService configurationService: IConfigurationService,
        @IContextKeyService contextKeyService: IContextKeyService,
        @IViewDescriptorService viewDescriptorService: IViewDescriptorService,
        @IInstantiationService instantiationService: IInstantiationService,
        @IOpenerService openerService: IOpenerService,
        @IThemeService themeService: IThemeService,
        @ITelemetryService telemetryService: ITelemetryService,
        @IHoverService hoverService: IHoverService,
    ) {
        super(options, keybindingService, contextMenuService, configurationService, contextKeyService, viewDescriptorService, instantiationService, openerService, themeService, telemetryService, hoverService);
    }

    protected override renderBody(container: HTMLElement): void {
        // UI 렌더링
    }
}
```

### 2. Implementing Loading States
```typescript
// 로딩 상태 표시
const loadingIndicator = new ProgressBar(container);
loadingIndicator.infinite().show();

// 작업 완료 후
loadingIndicator.stop().hide();
```

### 3. Error Handling UI
```typescript
// 에러 메시지 표시
showErrorMessage(localize('error.connection', 'Failed to connect to Claude'), {
    detail: error.message,
    buttons: [{
        label: localize('retry', 'Retry'),
        run: () => retryConnection()
    }]
});
```

## Performance Considerations

1. **Virtual Scrolling**: 큰 리스트는 가상 스크롤 사용
2. **Lazy Loading**: 필요한 UI만 로드
3. **Debouncing**: 입력 이벤트 디바운싱
4. **Worker Threads**: 무거운 작업은 워커에서 처리

## Testing UI Components

```typescript
// UI 컴포넌트 테스트
suite('Claude View', () => {
    test('should render sessions', async () => {
        const view = instantiationService.createInstance(ClaudeView);
        const sessions = await view.getSessions();
        assert.strictEqual(sessions.length, 2);
    });

    test('should handle theme changes', () => {
        const view = instantiationService.createInstance(ClaudeView);
        themeService.fire(new ThemeChangeEvent());
        assert(view.isThemeApplied());
    });
});
```

## References
- VS Code UI Toolkit: `src/vs/base/browser/ui/`
- Workbench UI: `src/vs/workbench/browser/`
- Theme Service: `src/vs/platform/theme/`
- Accessibility: `src/vs/platform/accessibility/`