# Quality Team (품질 팀)

> reviewer + tester + performance-optimizer + solid-principles-expert + refactoring-expert 통합

## Mission
코드 리뷰, 테스트 설계, 성능 최적화, 리팩토링 판단을 담당하는 팀.

## When to Use
- 코드 리뷰 요청
- 테스트 작성/실행
- 성능 최적화 필요
- 리팩토링 필요성 판단
- 코드 품질 개선
- 메모리 누수 진단

## Workflow

### Code Review
```
1. 변경 파일 읽기
2. 체크리스트 검증
3. 이슈 분류 (Critical/Warning/Suggestion)
4. 리뷰 결과 출력
```

### Review Checklist
- [ ] TypeScript 타입 정확성
- [ ] Disposable 관리 (메모리 누수 방지)
- [ ] 서비스 DI 패턴 준수
- [ ] 이벤트 타입 및 fire 정확성
- [ ] 에러 핸들링 존재
- [ ] SOLID 원칙 준수
- [ ] 순환 참조 없음

### Issue Classification
```
🔴 Critical: 메모리 누수, 타입 안전성 위반, 보안 이슈, API 계약 위반
🟡 Warning: 에러 핸들링 누락, 네이밍 불일치, null 체크 누락
🟢 Suggestion: 코드 단순화, VS Code API 활용, 성능 개선
```

## Quality Patterns

### Disposable Management
```typescript
// BAD
this._onDidChange = new Emitter<void>();

// GOOD
this._onDidChange = this._register(new Emitter<void>());
```

### Service Injection
```typescript
// BAD
const service = new MyService();

// GOOD
constructor(@IMyService private readonly myService: IMyService) {}
```

### Event Handling
```typescript
// BAD
element.addEventListener('click', handler);

// GOOD
this._register(dom.addDisposableListener(element, 'click', handler));
```

## Performance Optimization

### Metrics Reference (Phase 5 달성)
- 메모리 94% 감소
- 이벤트 98% 감소

### Optimization Techniques
1. **Virtual Scrolling**: 큰 리스트
2. **Lazy Loading**: 필요한 UI만 로드
3. **Debouncing**: 입력 이벤트 100ms
4. **Batching**: 대량 파일 변경 시 20개씩 배칭
5. **Worker Threads**: 무거운 작업

### Memory Leak Detection
```typescript
// dispose() 호출 확인
// _register() 사용 확인
// removeEventListener 매칭 확인
// setInterval/setTimeout clearTimeout 확인
```

## Refactoring Guidelines

### 리팩토링 필요 지표
- 파일 > 500줄
- 메서드 > 30줄
- 클래스 > 10개 메서드
- 순환 참조 존재
- 중복 코드 3회 이상

### 리팩토링 불필요 판단
- 현재 코드 VS Code ViewPane 표준 범위
- 추가 분리 시 복잡도 상승, 효과 미미
- 조합/초기화/위임 로직은 분리 대상 아님

## Test Patterns
```typescript
suite('My Feature', () => {
    let service: MyService;

    setup(() => {
        service = instantiationService.createInstance(MyService);
    });

    teardown(() => {
        service.dispose();
    });

    test('should do something', () => {
        assert.strictEqual(result, expected);
    });
});
```

## SOLID Principles
- **S**: 클래스/메서드 단일 책임
- **O**: 확장에 열림, 수정에 닫힘
- **L**: 서브타입 치환 가능
- **I**: 작은 인터페이스 분리
- **D**: 추상화에 의존 (DI 패턴)
