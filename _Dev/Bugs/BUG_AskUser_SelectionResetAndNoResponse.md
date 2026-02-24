# BUG: AskUser 선택 리셋 + Submit 후 응답 없음

**상태:** Fixed
**우선순위:** P1 High
**발견일:** 2026-02-23
**모듈:** CLIEventHandler / AssistantMessageRenderer / CLIInstance

---

## 증상 (2가지)

### 이슈 1: 선택지 UI 리셋 ✅ Fixed
- Claude가 AskUserQuestion으로 여러 선택지를 제시
- 사용자가 옵션을 선택하는 도중 UI가 갑자기 리셋됨
- 이미 선택한 항목이 모두 해제되어 처음부터 다시 선택해야 함

### 이슈 2: Submit 후 응답 없음 ✅ Fixed
- 선택지 선택 후 Submit 클릭
- AskUser 응답이 전송됨 (로그에서 resume 확인)
- 하지만 Claude의 후속 응답이 없음 — `streaming → idle`로 바로 전환
- resume CLI가 `error_during_execution` 에러로 즉시 종료됨

---

## 근본 원인

### 이슈 1: 스트리밍 중 메시지 업데이트가 전체 DOM re-render 유발

**문제 위치:** `assistantMessageRenderer.ts`, `messageListManager.ts`

```
1. AskUserQuestion tool_use → AskUser UI 렌더링
2. 스트리밍 중 다른 메시지 업데이트 → clearNode(container) → 전체 DOM 파괴
3. renderAskUser 재호출: selections = new Map() ← 선택 상태 초기화!
```

`selections` Map이 `renderAskUser` 내 로컬 변수이므로 re-render 시 새 빈 Map으로 교체됨.
handleComplete의 fireMessageUpdate뿐 아니라, 스트리밍 중 발생하는 모든 updateMessage가 문제.

### 이슈 2: resume CLI에 workingDir 미전달 → CLI가 세션 파일을 찾지 못함

**문제 위치:** `claudeCLIEventHandler.ts` respondToAskUser

```
1. respondToAskUser → channel.call('sendPrompt', [responseText, cliOptions])
2. cliOptions에 workingDir 누락!
3. claudeCLIInstance: cwd = options?.workingDir || process.cwd()
4. electron-main의 process.cwd() = VS Code 앱 디렉토리 (워크스페이스가 아님!)
5. CLI가 잘못된 프로젝트 경로에서 세션 파일 검색 → 찾지 못함
6. → error_during_execution (0 turns, 0 API ms)
7. exit code 1
```

**증거:**
- 디버그 로그: resume 결과의 session_id가 원본과 다름 (새 세션 생성됨 = 원본 못 찾음)
- `result.subtype === "error_during_execution"`, `num_turns === 0`, `duration_api_ms === 0`
- 터미널에서 직접 `--resume` 실행 시 정상 작동 (올바른 cwd 사용)
- 정상 프롬프트는 chatManager에서 `workingDir: this._configManager.getWorkingDirectory()` 설정

---

## 수정 내역

### Fix 1: AskUser DOM 보존 (re-render 시 선택 상태 유지)

**파일:** `assistantMessageRenderer.ts`

AskUser DOM 요소를 clearNode 전에 분리, 이후 재부착하여 re-render 사이에 보존.
별도의 DisposableStore로 AskUser 이벤트 핸들러 관리.

```typescript
private _preservedAskUser: {
    requestId: string;
    element: HTMLElement;
    disposables: DisposableStore;
} | undefined;
```

### Fix 2: respondToAskUser에 workingDir/executable 포함

**파일:** `claudeCLIEventHandler.ts`

```typescript
// Before:
const cliOptions = { resumeSessionId, permissionMode };

// After:
const stateCtx = this.getState();
const cliOptions = {
    resumeSessionId,
    permissionMode,
    workingDir: stateCtx.getWorkingDirectory?.(),
    executable: localConfig.executable
};
```

### Fix 3: IStateContext에 getWorkingDirectory 추가

**파일:** `cliEventHandlerContext.ts`, `claudeServiceContextProvider.ts`

```typescript
// IStateContext 인터페이스에 추가
getWorkingDirectory(): string | undefined;

// ContextProvider에서 구현
getWorkingDirectory: () => this.claudeService._configManager.getWorkingDirectory()
```

### Fix 4: result 이벤트의 에러 감지 강화

**파일:** `claudeCLIEventHandler.ts`

```typescript
// result 이벤트에서 is_error=true 감지 → handleError로 전달
if (event.type === 'result' && event.is_error) {
    this.handleError(`CLI 오류: ${errorContent}`);
    return;
}
```

### 보조 수정

**파일:** `claudeCLIInstance.ts`
- 셸 파이프 방식 제거 → 단순 stdin 방식으로 복원
- Resume: stdin.end() (전송+닫기), Normal: stdin.write() (열어둠)
- 에러 결과 디버그 로그 전체 출력 (200자 제한 해제)

---

## 핵심 파일

| 파일 | 변경 | 역할 |
|------|------|------|
| `views/chat/renderers/assistantMessageRenderer.ts` | AskUser DOM 보존 | 선택 리셋 방지 |
| `services/core/claudeCLIEventHandler.ts` | workingDir 추가 + 에러 결과 처리 | resume 경로 수정 |
| `services/core/cliEventHandlerContext.ts` | getWorkingDirectory 인터페이스 | 컨텍스트 확장 |
| `services/core/claudeServiceContextProvider.ts` | getWorkingDirectory 구현 | 워크스페이스 경로 전달 |
| `electron-main/claudeCLIInstance.ts` | stdin 복원 + 에러 로그 강화 | CLI 프로세스 관리 |

---

## 재현 방법

### 이슈 1 (선택 리셋) — Fixed
1. Claude에 AskUserQuestion이 나오는 작업 요청
2. 선택지가 표시되면 옵션을 선택
3. ~~스트리밍 중 메시지 업데이트로 선택이 초기화됨~~ → DOM 보존으로 해결

### 이슈 2 (응답 없음) — Fixed
1. AskUserQuestion 선택 완료 후 Submit 클릭
2. ~~Resume CLI가 error_during_execution으로 즉시 종료~~ → workingDir 전달로 해결
