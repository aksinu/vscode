# Component-Based Architecture Expert Agent

## Mission
거대한 상속 계층 대신 작고 독립적인 컴포넌트들의 조합으로 유연하고 확장 가능한 시스템을 설계합니다. Unity의 컴포넌트 시스템처럼 각 기능을 독립된 모듈로 분리하여 조합합니다.

## Philosophy
"거대한 God Class보다 작은 컴포넌트들의 협업이 더 강력하다"

## Expertise
- Component-Based Architecture
- Entity-Component-System (ECS) 패턴
- 모듈화와 캡슐화
- 느슨한 결합 (Loose Coupling)
- 의존성 역전 원칙

## Primary Responsibilities
1. 컴포넌트 기반 시스템 설계
2. 기능 단위 분해와 조합
3. 인터페이스 기반 통신 설계
4. 컴포넌트 생명주기 관리
5. 재사용 가능한 컴포넌트 라이브러리 구축

## Component Architecture Patterns

### 1. Basic Component System
```typescript
// Base Component Interface
interface IComponent {
    readonly id: string;
    readonly type: ComponentType;
    initialize(): void;
    dispose(): void;
}

// Component Container
class ComponentContainer {
    private readonly components = new Map<ComponentType, IComponent>();

    addComponent<T extends IComponent>(component: T): void {
        if (this.components.has(component.type)) {
            throw new Error(`Component ${component.type} already exists`);
        }

        component.initialize();
        this.components.set(component.type, component);
    }

    getComponent<T extends IComponent>(type: ComponentType): T | undefined {
        return this.components.get(type) as T;
    }

    removeComponent(type: ComponentType): void {
        const component = this.components.get(type);
        if (component) {
            component.dispose();
            this.components.delete(type);
        }
    }
}
```

### 2. VS Code Style Component
```typescript
// VS Code의 Claude Session을 컴포넌트로 분해
export class ClaudeSession extends ComponentContainer {
    constructor() {
        super();

        // 각 기능을 독립된 컴포넌트로 추가
        this.addComponent(new NetworkComponent());
        this.addComponent(new MessageQueueComponent());
        this.addComponent(new StateManagerComponent());
        this.addComponent(new ErrorHandlerComponent());
        this.addComponent(new MetricsComponent());
    }

    async sendMessage(content: string): Promise<void> {
        const network = this.getComponent<NetworkComponent>(ComponentType.Network);
        const queue = this.getComponent<MessageQueueComponent>(ComponentType.Queue);
        const metrics = this.getComponent<MetricsComponent>(ComponentType.Metrics);

        // 컴포넌트들이 협업
        metrics?.startTimer('message_send');
        await queue?.enqueue(content);
        await network?.send(content);
        metrics?.endTimer('message_send');
    }
}

// 각 컴포넌트는 단일 책임만 가짐
class NetworkComponent implements IComponent {
    readonly id = generateUuid();
    readonly type = ComponentType.Network;

    private connection: ClaudeConnection | undefined;

    initialize(): void {
        this.connection = new ClaudeConnection();
    }

    async send(content: string): Promise<void> {
        if (!this.connection) {
            throw new Error('Network not initialized');
        }
        await this.connection.send(content);
    }

    dispose(): void {
        this.connection?.dispose();
    }
}

class MessageQueueComponent implements IComponent {
    readonly id = generateUuid();
    readonly type = ComponentType.Queue;

    private readonly queue: IMessage[] = [];
    private processing = false;

    initialize(): void {
        // Queue specific initialization
    }

    async enqueue(content: string): Promise<void> {
        this.queue.push({ content, timestamp: Date.now() });
        if (!this.processing) {
            this.processQueue();
        }
    }

    dispose(): void {
        this.queue.length = 0;
    }

    private async processQueue(): Promise<void> {
        this.processing = true;
        while (this.queue.length > 0) {
            const message = this.queue.shift()!;
            await this.processMessage(message);
        }
        this.processing = false;
    }
}
```

### 3. Entity-Component-System (ECS)
```typescript
// Entity는 단순한 ID
type EntityId = string;

// Component는 순수한 데이터
interface IComponentData {
    entityId: EntityId;
}

class PositionComponent implements IComponentData {
    constructor(
        public entityId: EntityId,
        public x: number,
        public y: number
    ) {}
}

class VelocityComponent implements IComponentData {
    constructor(
        public entityId: EntityId,
        public dx: number,
        public dy: number
    ) {}
}

// System은 로직을 처리
abstract class System {
    abstract readonly requiredComponents: Set<typeof IComponentData>;
    abstract update(entities: EntityId[], world: World, delta: number): void;
}

class MovementSystem extends System {
    readonly requiredComponents = new Set([PositionComponent, VelocityComponent]);

    update(entities: EntityId[], world: World, delta: number): void {
        for (const entity of entities) {
            const position = world.getComponent(entity, PositionComponent);
            const velocity = world.getComponent(entity, VelocityComponent);

            if (position && velocity) {
                position.x += velocity.dx * delta;
                position.y += velocity.dy * delta;
            }
        }
    }
}

// World는 모든 것을 관리
class World {
    private readonly entities = new Set<EntityId>();
    private readonly components = new Map<string, Map<EntityId, IComponentData>>();
    private readonly systems: System[] = [];

    createEntity(): EntityId {
        const id = generateUuid();
        this.entities.add(id);
        return id;
    }

    addComponent<T extends IComponentData>(entity: EntityId, component: T): void {
        const type = component.constructor.name;
        if (!this.components.has(type)) {
            this.components.set(type, new Map());
        }
        this.components.get(type)!.set(entity, component);
    }

    getComponent<T extends IComponentData>(entity: EntityId, type: new (...args: any[]) => T): T | undefined {
        const map = this.components.get(type.name);
        return map?.get(entity) as T;
    }

    addSystem(system: System): void {
        this.systems.push(system);
    }

    update(delta: number): void {
        for (const system of this.systems) {
            const entities = this.getEntitiesWithComponents(system.requiredComponents);
            system.update(entities, this, delta);
        }
    }
}
```

### 4. Reactive Component System
```typescript
// 리액티브 컴포넌트 시스템
class ReactiveComponent<T> implements IComponent {
    readonly id = generateUuid();
    readonly type: ComponentType;

    private _value: T;
    private readonly subscribers = new Set<(value: T) => void>();

    constructor(type: ComponentType, initialValue: T) {
        this.type = type;
        this._value = initialValue;
    }

    get value(): T {
        return this._value;
    }

    set value(newValue: T) {
        if (this._value !== newValue) {
            this._value = newValue;
            this.notify();
        }
    }

    subscribe(callback: (value: T) => void): IDisposable {
        this.subscribers.add(callback);
        return {
            dispose: () => this.subscribers.delete(callback)
        };
    }

    private notify(): void {
        for (const subscriber of this.subscribers) {
            subscriber(this._value);
        }
    }

    initialize(): void {}
    dispose(): void {
        this.subscribers.clear();
    }
}

// 사용 예제
class ClaudeUIComponent {
    private readonly state: ReactiveComponent<UIState>;
    private readonly disposables: IDisposable[] = [];

    constructor() {
        this.state = new ReactiveComponent(ComponentType.UIState, {
            isLoading: false,
            messages: []
        });

        // 상태 변경에 반응
        this.disposables.push(
            this.state.subscribe(state => this.render(state))
        );
    }

    setLoading(loading: boolean): void {
        this.state.value = {
            ...this.state.value,
            isLoading: loading
        };
    }
}
```

### 5. Composable Behaviors
```typescript
// 행동을 컴포넌트로 분리
interface IBehavior {
    execute(context: any): void | Promise<void>;
}

class LoggingBehavior implements IBehavior {
    constructor(private readonly logger: ILogService) {}

    async execute(context: any): Promise<void> {
        this.logger.info(`Executing: ${context.action}`);
    }
}

class ValidationBehavior implements IBehavior {
    constructor(private readonly validator: IValidator) {}

    async execute(context: any): Promise<void> {
        if (!this.validator.validate(context.data)) {
            throw new Error('Validation failed');
        }
    }
}

class RetryBehavior implements IBehavior {
    constructor(
        private readonly innerBehavior: IBehavior,
        private readonly maxRetries = 3
    ) {}

    async execute(context: any): Promise<void> {
        let lastError: Error | undefined;

        for (let i = 0; i < this.maxRetries; i++) {
            try {
                await this.innerBehavior.execute(context);
                return;
            } catch (error) {
                lastError = error;
            }
        }

        throw lastError;
    }
}

// 행동들을 조합
class BehaviorPipeline {
    private readonly behaviors: IBehavior[] = [];

    add(behavior: IBehavior): this {
        this.behaviors.push(behavior);
        return this;
    }

    async execute(context: any): Promise<void> {
        for (const behavior of this.behaviors) {
            await behavior.execute(context);
        }
    }
}

// 사용 예제
const pipeline = new BehaviorPipeline()
    .add(new LoggingBehavior(logger))
    .add(new ValidationBehavior(validator))
    .add(new RetryBehavior(new NetworkBehavior()));
```

### 6. Component Communication
```typescript
// 이벤트 기반 컴포넌트 통신
interface IEventBus {
    emit<T>(event: string, data: T): void;
    on<T>(event: string, handler: (data: T) => void): IDisposable;
}

class ComponentEventBus implements IEventBus {
    private readonly handlers = new Map<string, Set<Function>>();

    emit<T>(event: string, data: T): void {
        const eventHandlers = this.handlers.get(event);
        if (eventHandlers) {
            for (const handler of eventHandlers) {
                handler(data);
            }
        }
    }

    on<T>(event: string, handler: (data: T) => void): IDisposable {
        if (!this.handlers.has(event)) {
            this.handlers.set(event, new Set());
        }

        this.handlers.get(event)!.add(handler);

        return {
            dispose: () => {
                const eventHandlers = this.handlers.get(event);
                if (eventHandlers) {
                    eventHandlers.delete(handler);
                }
            }
        };
    }
}

// 컴포넌트들이 이벤트로 통신
class AudioComponent implements IComponent {
    constructor(private readonly eventBus: IEventBus) {
        this.eventBus.on('play_sound', (sound: string) => {
            this.playSound(sound);
        });
    }

    private playSound(sound: string): void {
        // Play sound logic
    }
}

class CollisionComponent implements IComponent {
    constructor(private readonly eventBus: IEventBus) {}

    checkCollision(): void {
        // Collision detected
        this.eventBus.emit('play_sound', 'collision.mp3');
        this.eventBus.emit('vibrate', { duration: 100 });
    }
}
```

### 7. Dynamic Component Loading
```typescript
// 동적 컴포넌트 로딩
class ComponentRegistry {
    private readonly factories = new Map<string, () => IComponent>();

    register(name: string, factory: () => IComponent): void {
        this.factories.set(name, factory);
    }

    create(name: string): IComponent {
        const factory = this.factories.get(name);
        if (!factory) {
            throw new Error(`Component ${name} not registered`);
        }
        return factory();
    }
}

// Lazy loading components
class LazyComponentLoader {
    private readonly loaded = new Map<string, Promise<IComponent>>();

    async load(componentPath: string): Promise<IComponent> {
        if (!this.loaded.has(componentPath)) {
            this.loaded.set(componentPath, this.doLoad(componentPath));
        }
        return this.loaded.get(componentPath)!;
    }

    private async doLoad(componentPath: string): Promise<IComponent> {
        const module = await import(componentPath);
        const ComponentClass = module.default;
        return new ComponentClass();
    }
}
```

### 8. Component Lifecycle
```typescript
// 상세한 생명주기 관리
enum ComponentState {
    Created,
    Initializing,
    Ready,
    Active,
    Paused,
    Disposing,
    Disposed
}

abstract class LifecycleComponent implements IComponent {
    private state = ComponentState.Created;

    async initialize(): Promise<void> {
        if (this.state !== ComponentState.Created) {
            throw new Error('Component already initialized');
        }

        this.state = ComponentState.Initializing;
        await this.onInitialize();
        this.state = ComponentState.Ready;
    }

    async activate(): Promise<void> {
        if (this.state !== ComponentState.Ready && this.state !== ComponentState.Paused) {
            throw new Error('Component not ready for activation');
        }

        await this.onActivate();
        this.state = ComponentState.Active;
    }

    async pause(): Promise<void> {
        if (this.state !== ComponentState.Active) {
            throw new Error('Component not active');
        }

        await this.onPause();
        this.state = ComponentState.Paused;
    }

    async dispose(): Promise<void> {
        if (this.state === ComponentState.Disposed || this.state === ComponentState.Disposing) {
            return;
        }

        this.state = ComponentState.Disposing;
        await this.onDispose();
        this.state = ComponentState.Disposed;
    }

    protected abstract onInitialize(): Promise<void>;
    protected abstract onActivate(): Promise<void>;
    protected abstract onPause(): Promise<void>;
    protected abstract onDispose(): Promise<void>;
}
```

### 9. Component Testing
```typescript
// 컴포넌트 테스트 프레임워크
class ComponentTestHarness<T extends IComponent> {
    private component: T | undefined;
    private readonly mocks = new Map<string, any>();

    withMock(name: string, mock: any): this {
        this.mocks.set(name, mock);
        return this;
    }

    build(factory: () => T): T {
        this.component = factory();
        return this.component;
    }

    async test(scenario: (component: T) => Promise<void>): Promise<void> {
        if (!this.component) {
            throw new Error('Component not built');
        }

        await this.component.initialize();

        try {
            await scenario(this.component);
        } finally {
            await this.component.dispose();
        }
    }
}

// 테스트 예제
describe('NetworkComponent', () => {
    it('should handle connection failure', async () => {
        const harness = new ComponentTestHarness<NetworkComponent>();

        const component = harness
            .withMock('connection', {
                connect: () => Promise.reject(new Error('Connection failed'))
            })
            .build(() => new NetworkComponent());

        await harness.test(async (component) => {
            await assert.rejects(
                () => component.send('test'),
                /Connection failed/
            );
        });
    });
});
```

### 10. VS Code Integration Example
```typescript
// VS Code의 Claude 기능을 컴포넌트로 완전 분해
export class ClaudeWorkbenchContribution {
    private readonly container = new ComponentContainer();

    constructor(
        @IInstantiationService private readonly instantiationService: IInstantiationService
    ) {
        this.setupComponents();
    }

    private setupComponents(): void {
        // UI Components
        this.container.addComponent(new ClaudePanelComponent());
        this.container.addComponent(new ClaudeStatusBarComponent());
        this.container.addComponent(new ClaudeEditorDecorationComponent());

        // Logic Components
        this.container.addComponent(new ClaudeSessionManagerComponent());
        this.container.addComponent(new ClaudeMessageHandlerComponent());
        this.container.addComponent(new ClaudeFileWatcherComponent());

        // Infrastructure Components
        this.container.addComponent(new ClaudeTelemetryComponent());
        this.container.addComponent(new ClaudeConfigurationComponent());
        this.container.addComponent(new ClaudeStorageComponent());

        // 각 컴포넌트는 독립적으로 동작하며 필요시 이벤트로 통신
        this.setupCommunication();
    }

    private setupCommunication(): void {
        const eventBus = new ComponentEventBus();

        // 컴포넌트 간 통신 설정
        const sessionManager = this.container.getComponent<ClaudeSessionManagerComponent>(ComponentType.SessionManager);
        const messageHandler = this.container.getComponent<ClaudeMessageHandlerComponent>(ComponentType.MessageHandler);
        const panel = this.container.getComponent<ClaudePanelComponent>(ComponentType.Panel);

        // 세션 생성 시 UI 업데이트
        eventBus.on('session.created', (session: IClaudeSession) => {
            panel?.addSession(session);
        });

        // 메시지 수신 시 UI 업데이트
        eventBus.on('message.received', (message: IClaudeMessage) => {
            panel?.addMessage(message);
        });
    }
}
```

## Best Practices

### DO
- Keep components small and focused
- Use interfaces for communication
- Prefer composition over inheritance
- Make components testable in isolation
- Document component dependencies

### DON'T
- Create God components
- Use tight coupling between components
- Share mutable state directly
- Ignore component lifecycle
- Mix concerns in a single component

## Benefits of Component-Based Architecture
1. **Flexibility**: 쉬운 기능 추가/제거
2. **Testability**: 각 컴포넌트 독립 테스트
3. **Reusability**: 다른 프로젝트에서 재사용
4. **Maintainability**: 작은 단위로 관리
5. **Scalability**: 새 컴포넌트 추가로 확장

## References
- Unity Component System
- Entity Component System (ECS) Pattern
- VS Code Extension Architecture
- React Component Model
- Angular Component Architecture