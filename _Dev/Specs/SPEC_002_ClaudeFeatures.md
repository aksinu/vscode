# SPEC_002: Claude Features Status

> **Claude 기능 구현 상태 (Phase 6 완료)**

---

## Overview

Claude 모듈의 구현된 기능 목록과 향후 확장 계획.

---

## 1. ✅ 완료된 핵심 기능

### Chat & Messaging
- **Claude 채팅 통합** - VS Code Panel 내 실시간 채팅
- **멀티 세션 지원** - 세션별 독립 상태 관리 (최대 5개 CLI 프로세스)
- **메시지 큐** - 대기열 관리, 편집/재정렬, 드래그앤드롭
- **스트리밍 응답** - 실시간 토큰 스트리밍
- **Rate Limit 처리** - 자동 재시도, 카운트다운 UI

### File Integration
- **파일 첨부** - 드래그드롭, 열린 파일 버튼, 클립보드
- **파일 변경 추적** - 수정 전/후 스냅샷, Diff 뷰, Revert 기능
- **코드 블록 처리** - Copy/Insert/Apply 버튼, 언어 감지
- **이미지 붙여넣기** - 클립보드에서 직접 첨부

### Context & Automation
- **컨텍스트 메뉴** - Explorer/Editor 우클릭 → "Add to Claude"
- **에디터 선택 연동** - "Ask Claude About Selection" (Ctrl+Shift+A)
- **Auto Accept 모드** - 세션별 설정 가능
- **로컬 설정** - 모델, Extended Thinking, 권한 모드

### Advanced Features
- **Git 통합** - 커밋 메시지 생성, SCM 패널 연동
- **세션 히스토리** - 파일 변경 히스토리, Timeline 뷰
- **CLI 옵션 지원** - 모든 Claude CLI 옵션 UI로 설정 가능
- **모델 별칭** - 짧은 별칭 지원 (opus, sonnet, haiku)

---

## 2. 🔄 현재 이슈 (사용자 피드백)

### 세션 지속성 문제
- **문제**: IDE 재시작 시 이전 세션 파일 변경 UI가 유효하지 않음
- **상태**: 분석 중
- **우선순위**: P0 (사용자 경험 저해)

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

### 슬래시 커맨드 ✅ 구현 완료

| 커맨드 | 설명 | 상태 |
|--------|------|------|
| `/explain` | 코드 설명 | ✅ |
| `/fix` | 버그 수정 | ✅ |
| `/test` | 테스트 생성 | ✅ |
| `/refactor` | 리팩토링 | ✅ |
| `/docs` | 문서화 | ✅ |
| `/optimize` | 성능 최적화 | ✅ |
| `/cost` | 세션 토큰 비용 | ✅ |
| `/compact` | 대화 압축 | ✅ |
| `/clear` | 대화 초기화 | ✅ |
| `/model` | 모델 변경 | ✅ |
| `/help` | 도움말 | ✅ |
| `/config` | 설정 패널 | ✅ |
| `/context` | 컨텍스트 사용량 | ✅ |
| `/export` | 대화 내보내기 | ✅ |
| `/resume` | 세션 재개 | ✅ |
| `/rename` | 세션 이름 변경 | ✅ |
| `/plan` | Plan 모드 전환 | ✅ |
| `/status` | 상태 정보 | ✅ |

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

## 5. 체크포인트 (Checkpoints) ❌ VS Code 확장에서 구현

### 개념
- Agent가 코드 수정 시 자동 스냅샷 생성
- 대화 중간중간 복원 지점 제공

### UI
- 메시지 사이 호버 시 `+` 버튼 표시
- 클릭 시 해당 시점으로 프로젝트 복원

### 구현 (P2) - VS Code 확장 기능
- ⚠️ **Claude CLI 제한**: CLI는 세션별 스냅샷 관리 없음
- VS Code 확장에서 구현: Git stash 또는 별도 스토리지 활용
- 파일 단위 스냅샷 관리

---

## 6. 에이전트 기능 (Phase 3)

### 자동 실행

| 기능 | 설명 | Claude CLI 지원 |
|------|------|----------------|
| 파일 생성/수정 | 직접 파일 작성 | ✅ Write, Edit, NotebookEdit |
| 터미널 실행 | `npm install` 등 자동 실행 | ✅ Bash 도구 |
| 에러 자동 수정 | 실패 시 재시도 | ✅ 도구 재실행 가능 |
| 다중 파일 | 여러 파일 동시 수정 | ✅ 순차적 도구 실행 |

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
