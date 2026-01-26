# TASK_005: 스트리밍 중 입력 큐 시스템

> **응답 중에도 입력 가능, 완료 후 순차 처리**

---

## Overview

| Item | Value |
|------|-------|
| **Priority** | P2 |
| **Difficulty** | Medium |
| **Status** | [x] Done |
| **Dependencies** | None |

---

## Requirements

### 1. 동작 방식
1. Claude 응답 중에도 입력창 활성화 유지
2. 사용자가 메시지 입력 후 Enter
3. 메시지가 큐에 추가됨 (UI에 표시)
4. 현재 응답 완료 후 큐의 메시지 순차 전송

### 2. 큐 UI 표시

**입력창 위에 큐 표시**
```
┌─────────────────────────────────────┐
│ Queued (2):                         │
│  1. "다음 파일도 수정해줘"           │
│  2. "테스트도 작성해줘"              │
│                                [×]  │  ← 전체 취소
├─────────────────────────────────────┤
│ [입력창...]                         │
└─────────────────────────────────────┘
```

### 3. 큐 관리
- 개별 메시지 삭제 가능
- 전체 큐 취소 가능
- 최대 큐 크기 제한? (5개 정도)

### 4. 상태 표시
- 입력창 placeholder: "Type message (will be queued)..."
- 또는 입력창 테두리 색상 변경

---

## Implementation

### Files to Modify

| File | Action |
|------|--------|
| `common/claudeTypes.ts` | MODIFY - 큐 아이템 타입 |
| `browser/claudeService.ts` | MODIFY - 큐 관리 로직 |
| `browser/claudeChatView.ts` | MODIFY - 큐 UI 렌더링 |
| `browser/media/claude.css` | MODIFY - 큐 스타일 |

### Key Changes

1. **큐 타입**
   ```typescript
   interface IClaudeQueuedMessage {
     id: string;
     content: string;
     context?: IClaudeContext;
     timestamp: number;
   }
   ```

2. **서비스 큐 관리**
   ```typescript
   private _messageQueue: IClaudeQueuedMessage[] = [];

   async sendMessage(content: string, options?: Options): Promise<void> {
     if (this._state !== 'idle') {
       this.addToQueue(content, options);
       return;
     }
     // ... 기존 전송 로직
   }

   private async processQueue(): Promise<void> {
     while (this._messageQueue.length > 0) {
       const next = this._messageQueue.shift();
       await this.sendMessage(next.content, next.options);
     }
   }
   ```

3. **UI 업데이트**
   - 큐에 메시지 추가 시 UI 갱신
   - 큐 아이템 삭제 버튼
   - 큐 전체 취소 버튼

---

## Acceptance Criteria

- [ ] 응답 중에도 메시지 입력 가능
- [ ] 큐에 추가된 메시지 UI에 표시
- [ ] 응답 완료 후 큐 메시지 순차 전송
- [ ] 개별/전체 큐 취소 가능
- [ ] 큐 상태 시각적으로 명확함

---

## Notes

- 큐가 길어지면 의도치 않은 동작 가능 → 최대 크기 제한 권장
- 큐에 있는 동안 컨텍스트(선택 영역 등) 변경되면? → 입력 시점 컨텍스트 저장
- AskUser 대기 중에는 큐 처리 일시 중지

---

## Future Enhancement

### 한방에 여러 Task 입력
- 멀티라인 입력 → 자동 분리해서 큐에 추가
- 또는 `/queue` 커맨드로 여러 작업 등록
- 배치 작업 모드

### 현재 명령 취소 기능
- 진행 중인 요청 취소 (기존 `cancelRequest`)
- 큐에서 개별 삭제
- 전체 큐 + 현재 작업 한번에 취소
