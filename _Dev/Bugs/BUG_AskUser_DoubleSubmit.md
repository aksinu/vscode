# BUG: AskUser 선택지 더블 Submit 문제

## 상태: Fixed | 우선순위: P1 High | 수정일: 2026-02-19

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

## 원인 분석

### 원인 1: onDidCompleteAny의 _currentAskUserRequest 미정리
`claudeService.ts`에서 `_currentAskUserRequest`가 한번 설정되면 절대 초기화되지 않았음.
→ 이후 모든 `onDidCompleteAny`에서 `isWaiting = true`로 판단 → `waitForUser()` 호출 → asking 상태 재설정

### 원인 2: handleComplete finalMessage에서 askUserRequest key 누락
`handleComplete`의 `finalMessage`에 `askUserRequest` key가 없었음.
→ merge 로직에서 key 자체가 없으면 기존 값 보존 → askUserRequest가 메시지에 잔류

### 원인 3: submitted 플래그가 렌더 인스턴스에 로컬
`assistantMessageRenderer.ts`의 `submitted = false`가 렌더 함수 내부 지역 변수.
→ 메시지 재렌더링 시 fresh `submitted = false` 생성 → AskUser UI 다시 활성화

### 원인 4: respondToAskUser 중복 호출 미방어
`_askUserResumeInProgress` 플래그는 `sendPrompt` 직전에만 설정됨.
→ 그 전에 두 번째 호출이 들어오면 차단 불가

---

## 수정 내역

### 1. respondToAskUser 즉시 중복 방어 (`claudeCLIEventHandler.ts`)
```typescript
private _respondToAskUserInProgress = false;

async respondToAskUser(...) {
    if (this._respondToAskUserInProgress || this._askUserResumeInProgress) {
        return; // 즉시 차단
    }
    this._respondToAskUserInProgress = true;
    try { ... } finally { this._respondToAskUserInProgress = false; }
}
```

### 2. handleComplete finalMessage에 askUserRequest 명시 (`claudeCLIEventHandler.ts`)
```typescript
const finalMessage: IClaudeMessage = {
    // ...
    askUserRequest: undefined,   // 명시적으로 merge 시 삭제
    isWaitingForUser: false,
};
```

### 3. 서비스 레벨 상태 클리어 (`claudeService.ts`)
```typescript
async respondToAskUser(...) {
    await this._cliEventHandler.respondToAskUser(responses, askRequestFromUI);
    // 응답 완료 후 서비스 레벨 상태 클리어
    this._currentAskUserRequest = undefined;
    this._isWaitingForUser = false;
}
```

### 4. 클래스 레벨 submitted 추적 (`assistantMessageRenderer.ts`)
```typescript
private readonly _submittedAskRequestIds = new Set<string>();

renderAskUser(askRequest, ...) {
    if (this._submittedAskRequestIds.has(askRequest.id)) {
        // "Response submitted" 표시만 하고 UI 재생성 안함
        return;
    }
    // submit 시:
    this._submittedAskRequestIds.add(askRequest.id);
}
```

### 5. 사용자 액션 로깅 추가 (`assistantMessageRenderer.ts`, `claudeCLIEventHandler.ts`)
- AskUser UI 렌더링 시 `console.log` (askRequestId, isWaitingForUser)
- Submit 버튼 클릭 시 `console.log` (submitted, disabled 상태)
- `respondToAskUser` 호출/차단/완료 시 `console.log`

---

## 재현 방법
1. Claude에게 AskUser 질문이 발생하는 프롬프트 전송
2. 선택지 UI에서 옵션 선택 후 Submit 클릭
3. 관찰: 같은 선택지가 다시 나타나는지 확인
4. 콘솔 로그에서 `[AskUser]` 태그 필터링하여 흐름 추적

---

## 참고: updateMessage merge 로직 (`claudeSessionManager.ts`)
```typescript
const merged = { ...existing };
for (const key of Object.keys(message)) {
    if (value !== undefined) merged[key] = value;   // non-undefined만 덮어씀
}
for (const key of Object.keys(message)) {
    if (hasOwnProperty && value === undefined && !preserveIfMissing.has(key)) {
        delete merged[key];   // 명시적 undefined → delete
    }
}
```
- `askUserRequest: undefined` → key 존재 + undefined → **delete** (정상)
- `askUserRequest` key 자체 없음 → existing의 값 유지 (원인 2의 핵심)
