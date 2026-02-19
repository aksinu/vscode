# BUG: AskUser 선택지 더블 Submit 문제

## 상태: 분석 진행 중 (근본 원인 추적 중)

---

## 증상
- Claude가 AskUser 질문을 보내면 선택지 UI가 표시됨
- 사용자가 선택 후 Submit 클릭 → **같은 선택지 UI가 다시 나타남**
- 두 번째 Submit 클릭 시 "A request is already in progress" 에러 발생

## 에러 로그
```
[AskUser] respondToAskUser called with responses: [선택값]
[AskUser] Resuming session with cliSessionId: xxx, response: 선택값
// ... 첫 번째 resume 시작 ...
[AskUser] respondToAskUser called with responses: [선택값]  ← 두 번째 호출!
Error: A request is already in progress
```

---

## 핵심 파일
| 파일 | 역할 |
|------|------|
| `claudeCLIEventHandler.ts` | `respondToAskUser()`, `handleComplete()`, `updateCurrentMessage()` |
| `claudeService.ts` | `onDidCompleteAny` 핸들러, `respondToAskUser` 래퍼 |
| `claudeServiceContextProvider.ts` | sessionInteraction 위임 (setCurrentAskUserRequest 등) |
| `claudeSessionManager.ts` | `updateMessage()` merge 로직 |
| `assistantMessageRenderer.ts` | AskUser UI 렌더링, `submitted` 플래그 |
| `chatStateManager.ts` | `waitForUser()`, `isWaitingForUser()` 상태 |

---

## 분석된 메커니즘

### 1. AskUser UI 렌더링 조건
`assistantMessageRenderer.ts` line 85:
```typescript
if (message.askUserRequest) {
    this.renderAskUser(message.askUserRequest, messageElement, disposables);
}
```
- `message.askUserRequest`가 truthy이면 AskUser UI 렌더링
- `submitted` 플래그는 렌더 인스턴스에 로컬 → **재렌더링 시 fresh `submitted = false`**

### 2. respondToAskUser 흐름 (CLIEventHandler)
```
1. setWaitingForUser(false)
2. setCurrentAskUserRequest(undefined)   ← askRequest 제거
3. updateCurrentMessage()                ← message에 askUserRequest: undefined 반영
4. setState('streaming')
5. await sendPrompt(resume)              ← CLI 재개
6. handleComplete()                      ← 최종 상태 정리
```

### 3. updateMessage merge 로직 (claudeSessionManager.ts)
```typescript
// merge: 기존 메시지 프로퍼티를 유지하면서 새 값으로 덮어씌움
const merged = { ...existing };
for (const key of Object.keys(message)) {
    if (value !== undefined) {
        merged[key] = value;  // non-undefined만 덮어씀
    }
}
// 명시적 undefined인 키는 delete
for (const key of Object.keys(message)) {
    if (hasOwnProperty(message, key) && message[key] === undefined && !preserveIfMissing.has(key)) {
        delete merged[key];
    }
}
```
- `askUserRequest: undefined` → key가 존재하고 값이 undefined → **delete** (정상)
- `askUserRequest` key 자체가 없으면 → existing의 값 유지 (버그 가능성)

### 4. handleComplete의 finalMessage에 askUserRequest 누락
```typescript
const finalMessage: IClaudeMessage = {
    id, role, content, timestamp,
    isStreaming: false,
    toolActions, currentToolAction: undefined,
    usage, cliSessionId
    // askUserRequest 키 자체가 없음!
};
```
→ merge 시 기존 `askUserRequest`가 삭제되지 않고 남을 수 있음

### 5. claudeService.ts의 _currentAskUserRequest 미정리
- `respondToAskUser`에서 `askRequestFromUI`를 `_currentAskUserRequest`에 저장 (line 665)
- **어디서도 `_currentAskUserRequest = undefined`로 초기화하지 않음**
- `onDidCompleteAny`에서 `!!this._currentAskUserRequest`를 체크 → 항상 truthy → `waitForUser` 호출

---

## 의심 원인 (우선순위)

### 원인 1: onDidCompleteAny의 _currentAskUserRequest 미정리 (High)
`claudeService.ts` line 487-496:
```typescript
const askRequest = this._currentAskUserRequest;  // 한번 set되면 안 지워짐!
const isWaiting = isWaitingLegacy || isWaitingChatState || !!askRequest;
if (isWaiting) {
    this._chatStateManager.waitForUser(event.chatId);  // 다시 asking 상태로!
}
```
- 첫 AskUser 이후 `_currentAskUserRequest`가 영구히 남아있어 이후 모든 complete에서 `waitForUser` 호출

### 원인 2: handleComplete finalMessage에서 askUserRequest key 누락
- `handleComplete`의 `finalMessage`에 `askUserRequest` key가 없음
- merge 로직에서 key 자체가 없으면 기존 값 보존 → askUserRequest가 메시지에 남음
- 이후 `fireMessageUpdate`로 UI 재렌더링 시 AskUser UI 다시 표시

### 원인 3: 타이밍/동시성 문제
- `respondToAskUser` 내에서 `updateCurrentMessage()` 호출 → 메시지 업데이트 + UI 재렌더
- 재렌더 중 `submitted = false`인 새 인스턴스 생성
- 재렌더와 merge 완료 사이의 타이밍 갭에서 AskUser UI 재표시

---

## 적용된 수정 (부분적)

### 1. respondToAskUser 중복 호출 방어 (완료)
```typescript
async respondToAskUser(...) {
    if (this._askUserResumeInProgress) {
        this.logService.info(..., 'respondToAskUser ignored - resume already in progress');
        return;
    }
    // ...
}
```

### 2. handleComplete에서 _askUserResumeInProgress 리셋 제거 (완료)
- `handleComplete`에서 `this._askUserResumeInProgress = false` 제거
- `sendPrompt` resolve 후에만 리셋 → resume 중 모든 stale handleComplete 무시

### 3. respondToAskUser에서 sendPrompt 후 직접 handleComplete 호출 (완료)
```typescript
await channel.call('sendPrompt', [responseText, cliOptions]);
this._askUserResumeInProgress = false;
await this.handleComplete();  // 직접 호출하여 최종 상태 정리
```

---

## TODO (추가 수정 필요)

- [ ] `claudeService.ts`에서 `_currentAskUserRequest` 정리 로직 추가
  - `respondToAskUser` 완료 후 또는 `onDidCompleteAny`에서 정리
- [ ] `handleComplete`의 `finalMessage`에 `askUserRequest: undefined` 명시적 추가
  - merge 시 기존 askUserRequest 확실히 제거
- [ ] 사용자 액션 로깅 추가 (submit 클릭, respondToAskUser 호출 등)
- [ ] 재현 테스트 후 근본 원인 확정

---

## 재현 방법
1. Claude에게 AskUser 질문이 발생하는 프롬프트 전송
2. 선택지 UI에서 옵션 선택 후 Submit 클릭
3. 관찰: 같은 선택지가 다시 나타나는지 확인
4. 콘솔 로그에서 `[AskUser]` 태그 필터링하여 흐름 추적
