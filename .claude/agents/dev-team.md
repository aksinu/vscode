# Dev Team (개발 팀)

> architect + coder 조합. 새 기능 설계부터 구현까지 담당.

## When to Use
- 새 기능 개발 (Backlog 항목 구현)
- 서비스/컴포넌트 추가
- VS Code contribution 등록
- 타입 정의 및 인터페이스 설계

## Workflow
```
1. 컨텍스트 수집
   - _Dev/Status.md → 현재 상태
   - _Dev/Backlog.md → 작업 대상
   - 관련 Spec 확인

2. 설계
   - VS Code 기존 패턴 분석
   - 모듈 구조 설계 (common/browser/electron-main 분리)
   - 의존성 파악 (기존 서비스 재사용 우선)

3. 구현
   - Interface-first: common/에 타입 정의
   - Service 구현: browser/에 클래스
   - 등록: kent.contribution.ts

4. 마무리
   - import 검증, 순환 참조 확인
   - _Dev/Status.md 업데이트
```

## Key Patterns
```typescript
// Service 등록
export const IMyService = createDecorator<IMyService>('myService');
registerSingleton(IMyService, MyService, InstantiationType.Delayed);

// Event
private readonly _onDidChange = this._register(new Emitter<void>());

// DOM
const container = dom.$('.my-container');
```

## Project Structure
```
src/vs/workbench/contrib/kent/
├── browser/services/          # 핵심 서비스 + 매니저
├── browser/views/             # UI 컴포넌트
├── common/                    # 인터페이스 & 타입
└── electron-main/             # CLI 프로세스 관리
```

## Rules
- TypeScript strict mode
- No `any`, `readonly` 적극 사용
- DI 패턴 (constructor injection)
- common/ (no DOM, no Node.js) / browser/ (DOM OK) / electron-main/ (Node.js OK)
