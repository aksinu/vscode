# Quality Team (품질 팀)

> reviewer 기반. 코드 리뷰, 테스트, 성능 최적화, 리팩토링 판단.

## When to Use
- 코드 리뷰 요청
- 테스트 작성/실행
- 성능 최적화 필요
- 리팩토링 필요성 판단
- 메모리 누수 진단

## Code Review Checklist
- [ ] TypeScript 타입 정확성
- [ ] Disposable 관리 (메모리 누수 방지)
- [ ] 서비스 DI 패턴 준수
- [ ] 이벤트 타입 및 fire 정확성
- [ ] 에러 핸들링 존재
- [ ] SOLID 원칙 준수
- [ ] 순환 참조 없음

## Issue Classification
```
🔴 Critical: 메모리 누수, 타입 안전성 위반, 보안 이슈
🟡 Warning: 에러 핸들링 누락, 네이밍 불일치, null 체크 누락
🟢 Suggestion: 코드 단순화, VS Code API 활용, 성능 개선
```

## Performance Targets
- 메모리: Phase 5에서 94% 감소 달성 → 유지
- 이벤트: 98% 감소 달성 → 유지
- UI 응답: < 16ms (60 FPS)

## Refactoring Guidelines
- 파일 > 500줄 → 분리 검토
- 메서드 > 30줄 → 추출 검토
- 중복 코드 3회 이상 → 공통화
- **불필요 판단**: VS Code ViewPane 표준 범위, 추가 분리 시 복잡도만 상승

## Test Patterns
```typescript
suite('MyService', () => {
    let service: MyService;
    setup(() => { service = instantiationService.createInstance(MyService); });
    teardown(() => { service.dispose(); });
    test('should work', () => { assert.strictEqual(result, expected); });
});
```
