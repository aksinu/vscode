# 클로드 메시지큐 시스템 테스트

> Claude 모듈의 메시지큐 및 IPC 통신 기능을 종합적으로 테스트하는 Test Suite입니다.

## 📁 테스트 구조

```
test/
├── README.md                      # 이 파일
├── testRunner.ts                  # 통합 테스트 러너 ⭐
├── messageQueue.test.ts           # 메시지큐 서비스 테스트
├── ipcChannel.test.ts             # IPC 채널 통신 테스트
├── queueStateManager.test.ts      # 큐 상태 관리 테스트
└── streamEventProcessor.test.ts   # 스트림 이벤트 처리 테스트
```

## 🚀 빠른 시작

### 전체 테스트 실행

```bash
# VS Code 소스 루트에서
cd src/vs/workbench/contrib/kent/test/
node testRunner.js all
```

### 카테고리별 테스트

```bash
# 핵심 기능 테스트
node testRunner.js core

# 통신 계층 테스트
node testRunner.js communication

# 통합 기능 테스트
node testRunner.js integration
```

### 개별 테스트

```bash
# 메시지큐 서비스
node testRunner.js queue

# IPC 채널 통신
node testRunner.js ipc

# 상태 관리
node testRunner.js state

# 스트림 이벤트 처리
node testRunner.js stream
```

### 스모크 테스트 (빠른 검증)

```bash
node testRunner.js smoke
```

## 🧪 테스트 카테고리

### 📂 핵심 기능 (Core)

**메시지큐 서비스 테스트** (`messageQueue.test.ts`)

- ✅ 기본 큐 조작 (추가, 제거, 수정, 재정렬)
- ✅ 용량 제한 (최대 10개 메시지)
- ✅ 상태 기반 큐 처리
- ✅ 다중 세션 독립성
- ✅ 동시성 제어 (Race Condition 방지)

```bash
# 테스트 항목
1. 메시지 추가/제거/수정
2. 큐 용량 제한 (10개)
3. 세션별 큐 분리
4. 동시 처리 방지
```

### 📡 통신 계층 (Communication)

**IPC 채널 통신 테스트** (`ipcChannel.test.ts`)

- ✅ 기본 Main/Renderer IPC 통신
- ✅ 이벤트 스트리밍 (실시간 데이터 수신)
- ✅ 동시 요청 에러 처리
- ✅ 연결 실패/복구 시나리오
- ✅ 요청 취소 기능
- ✅ 사용자 입력 요청/응답

```bash
# 테스트 항목
1. sendPrompt/checkConnection RPC 호출
2. onDidReceiveData 이벤트 스트리밍
3. 동시 요청 방지 (A request is already in progress)
4. 연결 끊김 처리 및 자동 복구
5. cancelRequest 기능
6. sendUserInput 처리
```

### 🔗 통합 기능 (Integration)

**큐 상태 관리 테스트** (`queueStateManager.test.ts`)

- ✅ 상태 기반 자동 큐 처리
- ✅ 상태 전환 시나리오 (idle ↔ processing ↔ waiting)
- ✅ 다중 세션 상태 독립성
- ✅ 에러 상황 복구
- ✅ 큐 변경 이벤트 발생

```bash
# 테스트 항목
1. idle → 자동 큐 처리
2. processing → 큐 대기
3. waitingForUser → 처리 중단
4. 다중 세션 독립 상태 관리
5. 에러 후 상태 복구
```

**스트림 이벤트 처리 테스트** (`streamEventProcessor.test.ts`)

- ✅ 기본 스트림 이벤트 처리 (message_start → content_block_delta → message_stop)
- ✅ 도구 사용 이벤트 (tool_use → tool_result)
- ✅ 사용자 입력 요청 (input_request, 단일/다중 선택)
- ✅ 에러 처리 (rate_limit, api_error, network_error)
- ✅ 완료 후 추가 이벤트 무시
- ✅ 복합 시나리오 (메시지 + 도구 + 입력 요청)

```bash
# 테스트 항목
1. 텍스트 스트리밍 (청크 단위 누적)
2. 도구 실행 추적 (Read, Write, Bash 등)
3. AskUser 질문/옵션 처리
4. Rate limit/Network 에러 처리
5. 스트림 완료 후 보안 처리
6. 실제 사용 시나리오 통합 테스트
```

## 📊 테스트 결과 예시

```
🚀 클로드 메시지큐 시스템 전체 테스트 시작
================================================================================
📅 실행 시간: 2026-02-05 14:35:22
🧪 총 테스트 스위트: 4

🧪 [CORE] 메시지큐 서비스
📝 메시지 큐의 기본 CRUD 및 용량 제한, 다중 세션 처리
────────────────────────────────────────────────────────────────
✅ 메시지큐 서비스: 성공
⏱️ 실행 시간: 0.85초

🧪 [COMMUNICATION] IPC 채널 통신
📝 Main/Renderer 프로세스 간 IPC 통신 및 이벤트 스트리밍
────────────────────────────────────────────────────────────────
✅ IPC 채널 통신: 성공
⏱️ 실행 시간: 1.24초

🧪 [INTEGRATION] 큐 상태 관리
📝 상태 기반 자동 큐 처리 및 세션별 상태 전환
────────────────────────────────────────────────────────────────
✅ 큐 상태 관리: 성공
⏱️ 실행 시간: 1.56초

🧪 [INTEGRATION] 스트림 이벤트 처리
📝 Claude CLI 스트리밍 응답의 실시간 UI 렌더링
────────────────────────────────────────────────────────────────
✅ 스트림 이벤트 처리: 성공
⏱️ 실행 시간: 0.92초

================================================================================
📊 테스트 실행 결과 요약
────────────────────────────────────────────────────────────────

📈 전체 통계:
   ✅ 성공: 4/4 (100.0%)
   ❌ 실패: 0/4 (0.0%)
   ⏱️ 총 실행 시간: 4.57초

🎉 모든 테스트 통과! 클로드 메시지큐 시스템이 올바르게 구현되었습니다.
🚀 시스템이 프로덕션 환경에서 사용할 준비가 되었습니다.
================================================================================
```

## 🔧 개발자 가이드

### 새 테스트 추가

1. **테스트 파일 생성**
```typescript
// myNewFeature.test.ts
export async function runMyNewTests(): Promise<void> {
  console.log('🧪 새 기능 테스트 시작');
  // 테스트 로직 구현
}
```

2. **testRunner.ts에 등록**
```typescript
// testRunner.ts
import { runMyNewTests } from './myNewFeature.test.js';

// testSuites 배열에 추가
{
  name: '새 기능',
  description: '새 기능에 대한 설명',
  runner: runMyNewTests,
  category: 'core' // 또는 'communication', 'integration'
}
```

### Mock 서비스 패턴

모든 테스트는 실제 서비스 대신 Mock 구현을 사용합니다:

```typescript
// Mock 인터페이스 정의
interface ITestService {
  method1(): Promise<void>;
  method2(param: string): boolean;
}

// Mock 구현
class TestService implements ITestService {
  async method1(): Promise<void> {
    console.log('Mock 실행');
    // 시뮬레이션 로직
  }

  method2(param: string): boolean {
    return param.length > 0;
  }
}
```

### 이벤트 테스트 패턴

Event Emitter 기반 테스트:

```typescript
const service = new TestService();
let events: any[] = [];

// 이벤트 리스너 등록
const disposable = service.onDidSomething(event => {
  events.push(event);
});

// 액션 수행
await service.performAction();

// 결과 검증
console.log(`이벤트 수신: ${events.length}회`);

// 정리
disposable.dispose();
```

### 비동기 테스트 패턴

Promise 기반 대기:

```typescript
// 조건부 대기
await new Promise<void>(resolve => {
  const check = () => {
    if (condition) {
      resolve();
    } else {
      setTimeout(check, 50);
    }
  };
  check();
});

// 시간 기반 대기
await new Promise(resolve => setTimeout(resolve, 100));
```

## 🐛 디버깅

### 로그 수준 조정

각 테스트 파일의 로그 출력을 조정할 수 있습니다:

```typescript
// 상세 로그 (기본)
console.log(`📨 메시지 처리: ${content}`);

// 간단 로그
console.log(`✅ 처리 완료`);

// 에러만
console.error(`❌ 실패: ${error}`);
```

### 개별 테스트 실행

특정 테스트만 실행하여 문제를 격리:

```bash
# 메시지큐만 테스트
node testRunner.js queue

# TypeScript로 직접 실행
npx tsx messageQueue.test.ts
```

### 테스트 데이터 확인

Mock 서비스의 내부 상태를 확인:

```typescript
const queueService = new TestQueueService();
queueService.addToQueue('Test message');

// 현재 상태 확인
console.log('현재 큐:', queueService.getQueuedMessages());
console.log('처리 중:', queueService.isProcessingQueue());
```

## 📋 체크리스트

### 새 기능 추가 시

- [ ] 해당 기능의 Mock 구현 작성
- [ ] 정상 시나리오 테스트 작성
- [ ] 에러 시나리오 테스트 작성
- [ ] 경계값 테스트 작성 (최대/최소값)
- [ ] 동시성 테스트 작성 (필요 시)
- [ ] testRunner에 테스트 등록
- [ ] 문서 업데이트

### 버그 수정 시

- [ ] 버그를 재현하는 테스트 작성
- [ ] 수정 후 테스트 통과 확인
- [ ] 기존 테스트 영향도 확인
- [ ] 관련 에지 케이스 테스트 추가

### 리팩토링 시

- [ ] 리팩토링 전 모든 테스트 통과 확인
- [ ] 리팩토링 후 모든 테스트 통과 확인
- [ ] 필요 시 테스트 업데이트
- [ ] 성능 영향 확인

## 🔮 향후 계획

### Phase 7: 고급 테스트 기능

- [ ] **성능 테스트**: 대용량 큐, 다중 세션 부하 테스트
- [ ] **통합 테스트**: 실제 Claude CLI와의 연동
- [ ] **E2E 테스트**: 전체 워크플로우 시뮬레이션
- [ ] **커버리지 측정**: 코드 커버리지 리포트
- [ ] **자동화**: CI/CD 파이프라인 통합

### 성능 벤치마크

```bash
# 계획된 성능 테스트
- 1000개 메시지 큐 처리 시간
- 10개 세션 동시 처리 성능
- 메모리 사용량 프로파일링
- 스트림 이벤트 지연 시간 측정
```

### 통합 테스트

```bash
# 실제 환경 테스트
- Claude CLI 프로세스 통합
- VS Code Extension Host 연동
- 파일 시스템 실제 변경 확인
- 사용자 시나리오 재현
```

## 🤝 기여하기

1. **이슈 리포트**: 테스트 실패 시 상세한 로그와 함께 이슈 등록
2. **테스트 추가**: 새로운 시나리오나 엣지 케이스 테스트 기여
3. **문서 개선**: 테스트 가이드나 디버깅 팁 추가
4. **Mock 개선**: 더 현실적인 Mock 동작 구현

---

**Made with ❤️ for Claude Code Integration**

> 🎯 **목표**: 안정적이고 신뢰할 수 있는 메시지큐 시스템 구축
> 🚀 **비전**: VS Code에서 Claude를 완벽하게 통합하여 개발자 경험 극대화