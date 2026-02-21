# BUG: AskUser Submit 후 진행 안 됨 (Resume 타이밍 Race Condition)

**상태:** Fixed
**우선순위:** P1 High
**발견일:** 2026-02-21
**모듈:** CLIEventHandler / AskUser

---

## 증상

- Claude가 AskUserQuestion으로 선택지를 제시 (CLI 프로세스 아직 실행 중)
- 사용자가 선택 후 Submit 클릭
- 응답이 전송되지만 **이후 아무 진행 없음** — idle 상태로 멈춤
- Cancel 버튼이 보였으므로 CLI가 아직 streaming 중이었던 상황

---

## 근본 원인

**`_askUserResumeInProgress` 플래그가 `waitForProcessCompletion` 이후에 설정되는 타이밍 레이스**

### 문제 시퀀스

```
1. AskUserQuestion tool_use 이벤트 → UI 렌더링
2. 사용자 Submit → respondToAskUser()
3. setWaitingForUser(false), setCurrentAskUserRequest(undefined) ← 즉시 리셋
4. isRunning 체크 → true → waitForProcessCompletion() 대기 시작
   ─── await 중 ───
5. CLI 프로세스 종료 → onDidComplete 이벤트 발생
6. handleComplete() 호출
   → _askUserResumeInProgress = false (아직 설정 안 됨!)
   → AskUser 상태 이미 리셋됨 (step 3) → 정상 종료로 처리
   → setState('idle')
   → setCurrentMessageId(undefined)  ★ 핵심! 메시지 ID 소멸
   ─── await 해제 ───
7. _askUserResumeInProgress = true  ← 너무 늦음!
8. sendPrompt(resume) 호출
9. CLI 프로세스 데이터 이벤트 → handleData에서 getCurrentMessageId() = undefined → 무시됨
10. CLI 종료 → handleComplete → "no message or session" → 실패
```

### 수정 후 시퀀스

```
1~3. (동일)
4. _askUserResumeInProgress = true  ★ waitForProcessCompletion 전에 설정!
5. waitForProcessCompletion() 대기 시작
   ─── await 중 ───
6. CLI 종료 → handleComplete() 호출
   → _askUserResumeInProgress = true → 스킵! (return false)
   → currentMessageId 보존됨
   ─── await 해제 ───
7. sendPrompt(resume) → 정상 처리
8. 최종 handleComplete → currentMessageId 있음 → 정상 종료
```

---

## 수정 내역

**파일:** `src/vs/workbench/contrib/kent/browser/services/core/claudeCLIEventHandler.ts`

### 변경: `_askUserResumeInProgress` 플래그 설정 위치 이동

**Before:**
```typescript
// waitForProcessCompletion 후에 설정 (line 530)
if (isStillRunning) {
    await this.waitForProcessCompletion(channel, 30000);
}
this._askUserResumeInProgress = true;  // 너무 늦음!
```

**After:**
```typescript
// waitForProcessCompletion 전에 설정 (line 519)
this._askUserResumeInProgress = true;  // ★ 먼저 설정!
if (isStillRunning) {
    await this.waitForProcessCompletion(channel, 30000);
}
```

---

## 핵심 파일

| 파일 | 변경 | 역할 |
|------|------|------|
| `services/core/claudeCLIEventHandler.ts` | `_askUserResumeInProgress` 설정 위치 이동 | AskUser resume 타이밍 레이스 해결 |

---

## 재현 방법

1. Claude에 복잡한 작업 요청 (파일 수정 등)
2. Claude가 AskUserQuestion을 보냄 (CLI 프로세스가 아직 종료 전)
3. 즉시 선택 후 Submit 클릭
4. **수정 전:** 진행 안 됨 (idle 상태로 멈춤)
5. **수정 후:** 정상적으로 resume되어 작업 계속

---

## 후속 이슈: ClaudeService 레벨 상태 전환 누락 (2026-02-21)

### 증상

- 이전 수정(플래그 위치 이동) 적용 후에도, AskUser 응답 후 **UI가 streaming 상태에 멈추는** 케이스 발생
- Stop 버튼이 계속 표시되고, 입력란이 비활성화 상태
- CLIEventHandler 내부 상태는 idle로 전환되지만, **UI에는 반영 안 됨**

### 근본 원인

`onDidCompleteAny` → `handleComplete()` → `wasProcessed=false` (stale로 스킵) → **ClaudeService 레벨 상태 업데이트 전부 스킵됨**

이전 수정으로 stale completion을 올바르게 무시하고, `respondToAskUser` 내에서 직접 `handleComplete()`를 호출하여 CLIEventHandler 레벨 상태는 idle로 전환됨. 하지만:

- `ClaudeService._state = 'idle'` ❌ (누락)
- `ClaudeService._uiService.fireStateChange('idle')` ❌ (누락)
- `ClaudeService._chatStateManager.completeStreaming(sessionId)` ❌ (누락)

이 세 가지는 정상적으로 `onDidCompleteAny`가 처리될 때만 호출됨. Resume 경로에서는 stale로 스킵되므로 누락.

### 수정

**파일:** `src/vs/workbench/contrib/kent/browser/services/core/claudeService.ts`

`respondToAskUser` 메서드 끝에서 CLIEventHandler 호출 후, ClaudeService 레벨 상태도 정리:

```typescript
await this._cliEventHandler.respondToAskUser(responses, askRequestFromUI);

this._currentAskUserRequest = undefined;
this._isWaitingForUser = false;

// ★ 추가: Resume 경로에서 누락되는 ClaudeService 레벨 상태 전환
const currentSessionId = this._sessionService.getCurrentSession()?.id;
if (currentSessionId && this._state !== 'idle') {
    this._state = 'idle';
    this._uiService.fireStateChange('idle');
    this._chatStateManager.completeStreaming(currentSessionId);
}
```

`_state !== 'idle'` 조건으로 Input Request 경로(onDidCompleteAny가 정상 처리하는 경우)에서의 중복 호출을 방지.
