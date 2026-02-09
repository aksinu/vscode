# Dev Team (개발 팀)

> architect + coder + typescript-expert + contribution-pattern 통합

## Mission
새 기능 설계부터 구현까지 담당하는 핵심 개발 팀.

## When to Use
- 새 기능 개발 (Backlog 항목 구현)
- 서비스/컴포넌트 추가
- VS Code contribution 등록
- 타입 정의 및 인터페이스 설계

## Workflow

```
1. 컨텍스트 수집
   - _Dev/Status.md → 현재 상태
   - _Dev/Backlog.md → 작업 대상 확인
   - 관련 Spec 확인 (_Dev/Specs/)

2. 설계
   - VS Code 기존 패턴 분석 (contrib/chat/, contrib/terminal/)
   - 모듈 구조 설계 (common/browser/electron-main 분리)
   - 의존성 파악 (기존 서비스 재사용 우선)

3. 구현
   - Interface-first: common/에 타입 정의
   - Service 구현: browser/에 클래스
   - 등록: kent.contribution.ts에 registerSingleton/Views

4. 마무리
   - import 검증, 순환 참조 확인
   - _Dev/Status.md 업데이트
```

## Core Patterns

### Service Pattern
```typescript
// common/types/ - 인터페이스 정의
export const IMyService = createDecorator<IMyService>('myService');
export interface IMyService {
    readonly _serviceBrand: undefined;
    doSomething(): void;
}

// browser/ - 구현
export class MyService extends Disposable implements IMyService {
    declare readonly _serviceBrand: undefined;
    constructor(@ILogService private readonly logService: ILogService) {
        super();
    }
}

// kent.contribution.ts - 등록
registerSingleton(IMyService, MyService, InstantiationType.Delayed);
```

### Event Pattern
```typescript
private readonly _onDidChange = this._register(new Emitter<void>());
readonly onDidChange: Event<void> = this._onDidChange.event;
```

### Disposable Pattern
```typescript
class MyClass extends Disposable {
    constructor() {
        super();
        this._register(someDisposable);
    }
}
```

### DOM Creation
```typescript
const container = dom.$('.my-container');
const button = dom.$('button.my-button', { title: 'Click me' }, 'Button Text');
```

### View Registration
```typescript
Registry.as<IViewsRegistry>(ViewExtensions.ViewsRegistry).registerViews([{
    id: 'workbench.view.claude',
    name: 'Claude',
    containerLocation: ViewContainerLocation.Panel
}], ...);
```

## Rules
- TypeScript strict mode 준수
- `any` 타입 최소화, `readonly` 적극 사용
- DI 패턴 (constructor injection)
- 기존 VS Code 서비스 재사용 우선
- common/ (no DOM, no Node.js) / browser/ (DOM OK) / electron-main/ (Node.js OK)

## Project Structure
```
src/vs/workbench/contrib/kent/
├── browser/services/          # 핵심 서비스 (5개 + 5개 매니저)
├── browser/views/             # UI 컴포넌트 (19개 모듈)
├── common/                    # 인터페이스 & 타입
└── electron-main/             # CLI 프로세스 관리
```

## References
- `contrib/chat/` - Chat UI 패턴
- `contrib/terminal/` - Panel 통합
- `contrib/comments/` - Editor 연동
