# VS Code Contribution Pattern

> **모듈 기여 패턴 가이드**

---

## Module Structure

새 모듈 추가 시 표준 구조:

```
src/vs/workbench/contrib/{module}/
├── browser/
│   ├── {module}.contribution.ts   # 등록 진입점
│   ├── {module}View.ts            # 뷰 컨트롤러
│   ├── {module}Widget.ts          # UI 위젯
│   └── media/                     # CSS, 아이콘
│       └── {module}.css
├── common/
│   ├── {module}.ts                # 서비스 인터페이스
│   └── {module}Types.ts           # 타입 정의
└── test/
    └── browser/
        └── {module}.test.ts
```

---

## Service Pattern

### 1. 인터페이스 정의 (common/)

```typescript
// common/claude.ts
import { createDecorator } from 'vs/platform/instantiation/common/instantiation';

export const IClaudeService = createDecorator<IClaudeService>('claudeService');

export interface IClaudeService {
    readonly _serviceBrand: undefined;

    // 메서드 정의
    sendMessage(message: string): Promise<string>;
    getHistory(): IChatMessage[];
}

export interface IChatMessage {
    role: 'user' | 'assistant';
    content: string;
    timestamp: number;
}
```

### 2. 구현 (browser/)

```typescript
// browser/claudeService.ts
import { IClaudeService, IChatMessage } from '../common/claude';

export class ClaudeService implements IClaudeService {
    readonly _serviceBrand: undefined;

    constructor(
        @IConfigurationService private configService: IConfigurationService,
        @IStorageService private storageService: IStorageService
    ) {}

    async sendMessage(message: string): Promise<string> {
        // 구현
    }

    getHistory(): IChatMessage[] {
        // 구현
    }
}
```

### 3. 등록 (contribution.ts)

```typescript
// browser/claude.contribution.ts
import { registerSingleton, InstantiationType } from 'vs/platform/instantiation/common/extensions';
import { IClaudeService } from '../common/claude';
import { ClaudeService } from './claudeService';

registerSingleton(IClaudeService, ClaudeService, InstantiationType.Delayed);
```

---

## View Pattern

### Panel View 등록

```typescript
// browser/claude.contribution.ts
import { Registry } from 'vs/platform/registry/common/platform';
import { ViewContainerLocation, IViewsRegistry, Extensions as ViewExtensions } from 'vs/workbench/common/views';

// View Container (패널 그룹)
const VIEW_CONTAINER = Registry.as<IViewContainersRegistry>(ViewExtensions.ViewContainersRegistry)
    .registerViewContainer({
        id: 'workbench.view.claude',
        title: 'Claude',
        icon: Codicon.comment,
        order: 1,
        ctorDescriptor: new SyncDescriptor(ViewPaneContainer, ['workbench.view.claude', { mergeViewWithContainerWhenSingleView: true }]),
        storageId: 'workbench.view.claude',
    }, ViewContainerLocation.Panel);

// View 등록
Registry.as<IViewsRegistry>(ViewExtensions.ViewsRegistry).registerViews([{
    id: 'workbench.panel.claude.chat',
    name: 'Chat',
    containerIcon: Codicon.comment,
    canToggleVisibility: true,
    canMoveView: true,
    ctorDescriptor: new SyncDescriptor(ClaudeChatViewPane),
}], VIEW_CONTAINER);
```

---

## Command Pattern

```typescript
// browser/claude.contribution.ts
import { registerAction2, Action2 } from 'vs/platform/actions/common/actions';
import { KeyCode, KeyMod } from 'vs/base/common/keyCodes';

class OpenClaudeChatAction extends Action2 {
    constructor() {
        super({
            id: 'claude.openChat',
            title: { value: 'Open Claude Chat', original: 'Open Claude Chat' },
            category: 'Claude',
            f1: true,  // Command Palette에 표시
            keybinding: {
                weight: KeybindingWeight.WorkbenchContrib,
                primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KeyC,
            }
        });
    }

    async run(accessor: ServicesAccessor): Promise<void> {
        const viewsService = accessor.get(IViewsService);
        await viewsService.openView('workbench.panel.claude.chat');
    }
}

registerAction2(OpenClaudeChatAction);
```

---

## Configuration Pattern

```typescript
// browser/claude.contribution.ts
import { Extensions as ConfigurationExtensions, IConfigurationRegistry } from 'vs/platform/configuration/common/configurationRegistry';

Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration).registerConfiguration({
    id: 'claude',
    title: 'Claude',
    properties: {
        'claude.apiKey': {
            type: 'string',
            default: '',
            description: 'Anthropic API Key'
        },
        'claude.model': {
            type: 'string',
            default: 'claude-sonnet-4-20250514',
            enum: ['claude-sonnet-4-20250514', 'claude-opus-4-20250514'],
            description: 'Claude model to use'
        }
    }
});
```

---

## Main File Import

마지막으로 workbench main에 import 추가:

```typescript
// src/vs/workbench/workbench.common.main.ts
// ... 기존 imports ...

// Claude
import 'vs/workbench/contrib/claude/browser/claude.contribution';
```

---

## Checklist

새 모듈 추가 시 체크리스트:

- [ ] `common/` - 인터페이스, 타입 정의
- [ ] `browser/` - 서비스 구현
- [ ] `browser/` - 뷰/위젯 구현
- [ ] `browser/` - contribution.ts 등록
- [ ] `media/` - CSS 스타일
- [ ] `workbench.common.main.ts` - import 추가
- [ ] `test/` - 테스트 작성
