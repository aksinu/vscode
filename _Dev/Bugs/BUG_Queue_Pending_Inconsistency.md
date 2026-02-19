# BUG: Pending 메시지 큐 저장소 불일치

**상태:** Fixed
**우선순위:** P1 High
**발견일:** 2026-02-19
**모듈:** Queue / ClaudeService

---

## 증상

1. **메시지 우측 수정(edit)/X(삭제) 버튼 미동작** — 클릭해도 아무 반응 없음
2. **pending 메시지 삭제 후 재전송 시 이전 삭제 메시지 재등장** — X로 삭제했지만 새 메시지 보내면 이전 메시지도 함께 pending
3. **pending 메시지 수정 불가** — 편집 다이얼로그에서 수정해도 반영 안 됨
4. **말풍선 우상단 X(전체 취소)는 동작** — 하지만 실제 글로벌 큐에는 메시지가 남아있음

---

## 근본 원인

**큐 저장소가 3개로 분산되어 있고, 저장/조회 경로가 불일치**

### 큐 저장소 3개
| 저장소 | 위치 | 역할 |
|--------|------|------|
| `queueService._sessionQueues` | `claudeQueueService.ts` | 세션별 큐 (메인 큐) |
| `queueService._globalQueue` | `claudeQueueService.ts` | 글로벌 큐 (sessionId 없을 때) |
| `multiSessionManager.messageQueue` | `multiSessionManager.ts` | 세션 상태 내 큐 |

### 불일치 경로
| 동작 | 경로 | 저장소 |
|------|------|--------|
| **추가** (streaming 중) | `messageService.addToQueueDelegate` → sessionId가 undefined → 글로벌 큐 | `queueService._globalQueue` |
| **추가** (asking 상태) | `chatManager.sendMessageInternal` → queueService.addToQueue(sessionId) | `queueService._sessionQueues` |
| **추가** (sendMessageToSession) | `addToSessionQueue` → multiSessionManager | `multiSessionManager.messageQueue` |
| **조회** | `getQueuedMessages` → queueService(sessionId) | `queueService._sessionQueues` |
| **삭제** | `removeFromQueue` → queueService(sessionId) | `queueService._sessionQueues` |
| **수정** | `updateQueuedMessage` → queueService(sessionId) | `queueService._sessionQueues` |
| **전체삭제** | `clearQueue` → queueService(sessionId) | `queueService._sessionQueues` (글로벌 미삭제!) |

**결과**: 글로벌 큐나 multiSessionManager에 저장된 메시지는 조회/삭제/수정 불가

---

## 수정 내역

**파일:** `src/vs/workbench/contrib/kent/browser/services/core/claudeService.ts`

### 1. addToQueueDelegate 통일 (핵심 수정)
- `messageService.setQueueDelegates`의 addToQueue 콜백에서 항상 `queueService.addToQueue()` 사용
- sessionId가 없으면 `this._sessionService.getCurrentSession()?.id`로 보충
- multiSessionManager.addToSessionQueue() 사용 제거

### 2. addToSessionQueue 통일
- `claudeService.addToSessionQueue()` 메서드에서 `multiSessionManager` 대신 `queueService.addToQueue(content, options, sessionId)` 사용

### 3. getSessionQueue 통일
- `claudeService.getSessionQueue()` → `queueService.getQueuedMessages(sessionId)` 사용

### 4. getQueuedMessages 보강
- 세션 큐 + 글로벌 큐 합쳐서 반환 (하위 호환)

### 5. removeFromQueue 보강
- 세션 큐에서 못 찾으면 글로벌 큐에서도 시도 (하위 호환)

### 6. clearQueue 보강
- 세션 큐와 글로벌 큐 모두 비움

### 7. updateQueuedMessage 보강
- 세션 큐에서 못 찾으면 글로벌 큐에서도 시도 (하위 호환)

### 8. saveSessionQueue fallback 수정
- `multiSessionManager.getSessionQueue()` 대신 `queueService.getSessionQueue()` 사용

### 9. messageService getQueue 델리게이트 통일
- `sessionService.getSessionQueue()` 대신 `queueService.getQueuedMessages(sessionId)` 사용

---

## 핵심 파일

| 파일 | 변경 | 역할 |
|------|------|------|
| `services/core/claudeService.ts` | 수정 | 큐 저장소를 queueService로 통일 |
| `services/queue/claudeQueueService.ts` | 변경 없음 | 큐 서비스 (정상) |
| `views/chat/managers/queueUIManager.ts` | 변경 없음 | 큐 UI (이벤트 핸들러 정상) |

---

## 재현 방법

1. Claude에 메시지 전송 (streaming 시작)
2. streaming 중에 추가 메시지 전송 → pending 표시
3. pending 메시지의 X 버튼 클릭 → **수정 전: 삭제 안 됨**
4. pending 메시지의 편집 버튼 클릭 → **수정 전: 수정 안 됨**
5. 말풍선 우상단 X로 전체 취소 → 화면에서 사라짐
6. 다시 새 메시지 전송 → **수정 전: 이전 삭제한 메시지도 함께 재등장**
