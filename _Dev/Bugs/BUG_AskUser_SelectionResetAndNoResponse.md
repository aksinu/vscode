# BUG: AskUser 선택 리셋 + Submit 후 응답 없음

**상태:** In Progress
**우선순위:** P1 High
**발견일:** 2026-02-23
**모듈:** CLIEventHandler / AssistantMessageRenderer / CLIInstance

---

## 증상 (2가지)

### 이슈 1: 선택지 UI 리셋
- Claude가 AskUserQuestion으로 여러 선택지를 제시
- 사용자가 옵션을 선택하는 도중 UI가 갑자기 리셋됨
- 이미 선택한 항목이 모두 해제되어 처음부터 다시 선택해야 함

### 이슈 2: Submit 후 응답 없음
- 선택지 선택 후 Submit 클릭
- AskUser 응답이 전송됨 (로그에서 resume 확인)
- 하지만 Claude의 후속 응답이 없음 — `streaming → idle`로 바로 전환
- resume CLI가 아무 데이터 이벤트 없이 종료됨

---

## 근본 원인

### 이슈 1: handleComplete의 fireMessageUpdate가 전체 re-render 유발

**문제 위치:** `claudeCLIEventHandler.ts` handleComplete 내 AskUser 대기 분기

```
1. AskUserQuestion tool_use → AskUser UI 렌더링
2. CLI 프로세스 종료 → handleComplete() 호출
3. handleComplete: isWaitingForUser=true, hasAskRequest=true
4. → message.fireMessageUpdate(waitingMessage) 호출
5. → 전체 assistant 메시지 re-render 트리거
6. → renderAskUser 재호출: selections = new Map() ← 선택 상태 초기화!
```

`selections` Map이 `renderAskUser` 내 로컬 변수이므로 re-render 시 새 빈 Map으로 교체됨.
`_submittedAskRequestIds` (클래스 레벨 Set)은 submit된 요청만 보호하므로, 아직 선택 중인 상태는 보호하지 못함.

### 이슈 2: stdin EOF 미전송으로 resume CLI가 프롬프트를 처리하지 못함

**문제 위치:** `claudeCLIInstance.ts` sendPrompt의 stdin 처리

```
1. respondToAskUser → channel.call('sendPrompt', [responseText, {resumeSessionId}])
2. claudeCLIInstance.sendPrompt() 호출
3. CLI 프로세스 spawn: claude --resume <id> --output-format stream-json
4. stdin.write(responseText + '\n') — 프롬프트 전송
5. stdin은 닫지 않음 (input_request 대비)
6. CLI가 stdin EOF를 기다리지만 받지 못함
7. CLI가 입력 없이 즉시 종료 (code 0, 데이터 없음)
```

Normal 프롬프트: CLI가 `\n`으로 구분된 첫 줄을 읽고 처리 (동작함)
Resume: `--resume` 플래그가 있으면 CLI가 EOF를 기다릴 수 있음 → stdin이 열려있어 무한 대기 또는 즉시 종료

---

## 수정 내역

### Fix 1: handleComplete에서 AskUser 대기 시 fireMessageUpdate 제거

**파일:** `claudeCLIEventHandler.ts`

```typescript
// Before:
message.updateSessionMessage(waitingMessage);
message.fireMessageUpdate(waitingMessage);  // ← re-render 유발!

// After:
message.updateSessionMessage(waitingMessage);
// ★ fireMessageUpdate를 호출하지 않음!
// re-render가 renderAskUser의 로컬 selections Map을 초기화함.
// updateSessionMessage만으로 세션 데이터는 저장됨.
```

### Fix 2: resume 시 stdin.end()로 EOF 전송

**파일:** `claudeCLIInstance.ts`

```typescript
// Resume: stdin.end()로 프롬프트 전송 + EOF
if (isResuming) {
    this._process.stdin.end(promptContent + '\n', 'utf8', () => {
        this._stdinOpen = false;
    });
} else {
    // Normal: stdin.write() + 열어둠 (input_request 응답용)
    this._process.stdin.write(promptContent + '\n', 'utf8', ...);
}
```

- Resume: `stdin.end()` = write + close (EOF 전송) → CLI가 즉시 프롬프트 처리
- Normal: `stdin.write()` = write only (stdin 유지) → input_request 응답 가능

---

## 핵심 파일

| 파일 | 변경 | 역할 |
|------|------|------|
| `services/core/claudeCLIEventHandler.ts` | AskUser 대기 시 fireMessageUpdate 제거 | 선택 리셋 방지 |
| `electron-main/claudeCLIInstance.ts` | resume 시 stdin.end() 사용 | EOF 전송으로 CLI 프롬프트 처리 |

---

## 재현 방법

### 이슈 1 (선택 리셋)
1. Claude에 AskUserQuestion이 나오는 작업 요청
2. 선택지가 표시되면 옵션을 선택
3. CLI 프로세스가 종료되면 (handleComplete 호출) 선택이 초기화됨

### 이슈 2 (응답 없음)
1. AskUserQuestion 선택 완료 후 Submit 클릭
2. Resume CLI가 시작되지만 데이터 이벤트 없이 종료
3. `streaming → idle` 전환만 발생, 새 응답 없음
