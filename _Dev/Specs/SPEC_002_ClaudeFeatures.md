# SPEC_002: Claude Chat Features

> **Claude 채팅창 기능 명세 (Cursor 참고)**

---

## Overview

Cursor 에디터의 AI 기능을 참고하여 Claude 통합 채팅창의 기능 목록을 정의.

---

## 1. 채팅 모드

### 기본 모드 구성

| 모드 | 설명 | 구현 우선순위 |
|------|------|--------------|
| **Ask** | 질문/답변, 사용자가 Apply 선택 | P0 (Phase 1) |
| **Edit** | 코드 편집 제안, Diff 표시 | P1 (Phase 2) |
| **Agent** | 자율 실행, 파일 생성/수정, 터미널 | P2 (Phase 3) |

### 모드 전환
- 채팅창 하단 토글 버튼
- 키보드 단축키: `Ctrl+.` / `Cmd+.`

---

## 2. 컨텍스트 시스템 (@ 멘션)

### 기본 멘션

| 멘션 | 설명 | 우선순위 |
|------|------|---------|
| `@file` | 특정 파일 참조 | P0 |
| `@folder` | 폴더 구조 참조 | P1 |
| `@selection` | 현재 선택 영역 | P0 |
| `@currentFile` | 현재 열린 파일 | P0 |

### 확장 멘션

| 멘션 | 설명 | 우선순위 |
|------|------|---------|
| `@codebase` | 프로젝트 전체 벡터 검색 | P2 |
| `@git` | Git 변경사항/커밋 | P1 |
| `@terminal` | 터미널 출력 | P2 |
| `@problems` | 현재 진단(에러/경고) | P1 |
| `@docs` | 외부 문서 참조 | P3 |
| `@web` | 웹 검색 결과 | P3 |

### 자동 컨텍스트
- `chat.implicitContext.enabled`: 현재 에디터 자동 첨부
- 설정으로 on/off 가능

---

## 3. 입력 기능

### 기본 입력

| 기능 | 단축키 | 설명 |
|------|--------|------|
| 전송 | `Enter` | 메시지 전송 |
| 줄바꿈 | `Shift+Enter` | 입력창 줄바꿈 |
| 히스토리 | `↑` / `↓` | 이전 메시지 불러오기 |
| 컨텍스트 삭제 | `Backspace` (맨 앞) | 첨부된 컨텍스트 제거 |
| 즉시 전송 | `Ctrl+Enter` | Agent 모드에서 큐 무시 |

### 슬래시 커맨드

| 커맨드 | 설명 | 우선순위 |
|--------|------|---------|
| `/clear` | 대화 초기화 | P0 |
| `/summarize` | 대화 요약 (컨텍스트 확보) | P1 |
| `/help` | 도움말 표시 | P0 |
| `/model` | 모델 선택 | P1 |
| 커스텀 | `.claude/commands/` 폴더 | P2 |

---

## 4. 응답 UI

### 메시지 렌더링

| 요소 | 설명 | 우선순위 |
|------|------|---------|
| Markdown | 기본 텍스트 렌더링 | P0 |
| 코드 블록 | 구문 강조 + 복사 버튼 | P0 |
| Diff 뷰 | 변경사항 표시 | P1 |
| 도구 실행 | Tool 호출 표시 | P2 |
| Thinking | 에이전트 사고 과정 | P2 |

### 액션 버튼

| 버튼 | 설명 | 우선순위 |
|------|------|---------|
| **Copy** | 코드 블록 복사 | P0 |
| **Apply** | 에디터에 적용 (Diff) | P0 |
| **Insert** | 커서 위치에 삽입 | P1 |
| **Run** | 터미널 명령 실행 | P2 |

### Apply 동작
1. Apply 클릭 → Diff 상태로 변경사항 표시
2. Accept/Reject 선택
3. Accept: 파일에 적용
4. Reject: 원복

---

## 5. 체크포인트 (Checkpoints)

### 개념
- Agent가 코드 수정 시 자동 스냅샷 생성
- 대화 중간중간 복원 지점 제공

### UI
- 메시지 사이 호버 시 `+` 버튼 표시
- 클릭 시 해당 시점으로 프로젝트 복원

### 구현 (P2)
- Git stash 또는 별도 스토리지 활용
- 파일 단위 스냅샷 관리

---

## 6. 에이전트 기능 (Phase 3)

### 자동 실행

| 기능 | 설명 |
|------|------|
| 파일 생성/수정 | 직접 파일 작성 |
| 터미널 실행 | `npm install` 등 자동 실행 |
| 에러 자동 수정 | 실패 시 재시도 |
| 다중 파일 | 여러 파일 동시 수정 |

### YOLO 모드
- 사용자 승인 없이 자동 실행
- 설정: `claude.agent.autoApprove`
- 위험 작업은 항상 확인 요청

### 권한 관리
```typescript
interface IAgentPermissions {
  fileCreate: boolean;
  fileModify: boolean;
  fileDelete: boolean;
  terminalExecute: boolean;
  webFetch: boolean;
}
```

---

## 7. 프로젝트 설정

### .claude/rules.md
- 프로젝트 루트에 규칙 파일
- 코딩 스타일, 네이밍 컨벤션 등
- 모든 대화에 시스템 프롬프트로 주입

### 예시
```markdown
# Project Rules

## Code Style
- 탭 대신 스페이스 2칸
- 변수명은 camelCase
- 함수는 JSDoc 주석 필수

## Tech Stack
- TypeScript strict mode
- React 18
- Tailwind CSS
```

---

## 8. 설정 항목

### 기본 설정

```typescript
{
  // API
  "claude.apiKey": "",
  "claude.model": "claude-sonnet-4-20250514",
  "claude.maxTokens": 4096,

  // UI
  "claude.fontSize": 14,
  "claude.fontFamily": "default",
  "claude.showThinking": true,

  // 컨텍스트
  "claude.implicitContext": true,
  "claude.maxContextFiles": 10,

  // 에이전트
  "claude.agent.enabled": true,
  "claude.agent.autoApprove": false,
  "claude.agent.maxRequests": 25,

  // 웹
  "claude.web.enabled": false,
  "claude.web.searchProvider": "google"
}
```

---

## 9. 단축키 매핑

| 기능 | Windows | Mac |
|------|---------|-----|
| 채팅창 열기 | `Ctrl+Shift+C` | `Cmd+Shift+C` |
| 인라인 채팅 | `Ctrl+I` | `Cmd+I` |
| 모드 전환 | `Ctrl+.` | `Cmd+.` |
| 선택 영역 질문 | `Ctrl+L` | `Cmd+L` |
| 대화 초기화 | `Ctrl+Shift+K` | `Cmd+Shift+K` |

---

## 10. Phase별 구현 계획

### Phase 1: 기본 채팅 (P0)
- [ ] 채팅 패널 UI
- [ ] Ask 모드
- [ ] @file, @selection 멘션
- [ ] Markdown + 코드 블록 렌더링
- [ ] Copy/Apply 버튼
- [ ] API 연동

### Phase 2: 편의 기능 (P1)
- [ ] Edit 모드
- [ ] Diff 뷰
- [ ] 슬래시 커맨드
- [ ] @git, @problems 멘션
- [ ] 대화 히스토리
- [ ] 프로젝트 규칙 (.claude/rules.md)

### Phase 3: 에이전트 (P2)
- [ ] Agent 모드
- [ ] 파일 생성/수정
- [ ] 터미널 실행
- [ ] 체크포인트
- [ ] @codebase 벡터 검색
- [ ] MCP 서버 연동

---

**Last Updated**: 2025-01-25
