# Development Status

> **현재 개발 진행 상태**

---

## Current

| Item | Value |
|------|-------|
| **Phase** | Phase 1.5 - 기능 개선 |
| **Sprint** | Sprint_001 |
| **Status** | ✅ 빌드 환경 완료, UI 동작 확인 |
| **Updated** | 2026-01-25 |

---

## Now Working On

```
Task: Phase 1.5 - 추가 기능 구현
Progress: 20%
Next: 스트리밍 응답 또는 @ 멘션 시스템
```

### Done (Phase 1)
- [x] 프로젝트 문서 구조 설정
- [x] VS Code Chat 모듈 구조 분석
- [x] Claude 모듈 기본 구조 생성
- [x] 서비스 구현 (IClaudeService)
- [x] ViewPane 구현 (ClaudeChatViewPane)
- [x] 액션/커맨드 등록
- [x] 설정 등록
- [x] Markdown 렌더링 구현
- [x] 코드 블록 렌더러 (Copy/Insert/Apply 버튼)
- [x] 환영 화면 (Welcome Screen)
- [x] 로딩 인디케이터
- [x] 컨텍스트 태그 표시
- [x] 향상된 CSS 스타일
- [x] **TypeScript 타입 체크 통과**
- [x] **빌드 환경 구성 (VS 2022)**
- [x] **UI 동작 확인**
- [x] **채팅창 위치 변경 (AuxiliaryBar - Copilot 스타일)**
- [x] **드래그/드롭 파일 첨부 기능**

### Remaining (Phase 1.5+)
- [~] 스트리밍 응답 지원 - **CLI 연동 방식으로 변경 중**
- [ ] @ 멘션 시스템 (@file, @workspace)
- [ ] /슬래시 커맨드
- [ ] Diff 뷰 Apply

---

## Architecture Decision

### Claude 백엔드 연동 방식

**결정: Claude CLI 사용 (API 키 직접 사용 안 함)**

```
┌─────────────────┐     IPC      ┌─────────────────┐     spawn     ┌─────────────┐
│  Renderer       │ ──────────▶  │  Main Process   │ ──────────▶   │  Claude CLI │
│  (ClaudeService)│              │  (IPC Handler)  │               │  (claude -p)│
└─────────────────┘              └─────────────────┘               └─────────────┘
```

**이유:**
- 사용자가 이미 Claude CLI로 로그인되어 있음
- API 키 별도 관리 불필요
- CLI의 모든 기능(MCP, tools 등) 활용 가능

**구현 방식:**
- Main process에 IPC handler 등록
- `claude -p "prompt" --output-format stream-json` 실행
- 스트리밍 JSON 응답 파싱

---

## Sprint_001 Tasks

| Task | Status | Description |
|------|--------|-------------|
| TASK_001 | ✅ Done | 프로젝트 문서 설정 |
| TASK_002 | ✅ Done | Chat 모듈 분석 |
| TASK_003 | ✅ Done | Claude 모듈 구조 생성 |
| TASK_004 | ✅ Done | UI 개선 (Markdown, 코드 블록) |

```
Progress: ████████████████████ 100%
```

---

## Created Files Summary

### common/
| File | Description |
|------|-------------|
| `claude.ts` | IClaudeService 인터페이스 |
| `claudeTypes.ts` | 타입 정의 |
| `claudeContextKeys.ts` | 컨텍스트 키 |

### browser/
| File | Description |
|------|-------------|
| `claude.contribution.ts` | 서비스/뷰/설정 등록 |
| `claudeService.ts` | API 서비스 구현 |
| `claudeChatView.ts` | 채팅 ViewPane (업데이트됨) |
| `claudeMessageRenderer.ts` | **NEW** 메시지 렌더러 |
| `claudeActions.ts` | 커맨드/액션 |
| `media/claude.css` | 스타일 (확장됨) |

---

## Implemented Features

### UI Components
| Component | Status | Description |
|-----------|--------|-------------|
| Welcome Screen | ✅ | 힌트 버튼 포함 |
| Message List | ✅ | 역할별 스타일링 |
| Markdown Rendering | ✅ | 기본 마크다운 지원 |
| Code Block | ✅ | Copy/Insert/Apply 버튼 |
| Input Editor | ✅ | Monaco 에디터 기반 |
| Loading Indicator | ✅ | 스피너 애니메이션 |
| Context Tags | ✅ | 파일/선택 영역 표시 |

### Commands
| Command | Keybinding | Status |
|---------|------------|--------|
| `claude.openChat` | `Ctrl+Shift+C` | ✅ |
| `claude.clearChat` | `Ctrl+Shift+K` | ✅ |
| `claude.cancelRequest` | `Escape` | ✅ |
| `claude.newSession` | - | ✅ |
| `claude.focusInput` | `Ctrl+L` | ✅ |

---

## Next Steps

1. **빌드 테스트**
   ```bash
   npm install
   npm run compile
   ./scripts/code.bat
   ```

2. **Phase 1.5: 스트리밍**
   - SSE 기반 실시간 응답
   - 타이핑 애니메이션

3. **Phase 2: 편의 기능**
   - @ 멘션 시스템
   - /슬래시 커맨드
   - Diff 뷰 Apply

---

## Activity Log

### 2025-01-25
- 프로젝트 문서 구조 재구성
- VS Code Chat 모듈 구조 분석 완료
- Claude 모듈 기본 구조 생성 완료
- Markdown 렌더링 및 코드 블록 구현
- 환영 화면, 로딩 인디케이터 추가
- CSS 스타일 대폭 개선
- **TypeScript 타입 체크 완료**
  - claudeMessageRenderer.ts: renderMarkdown() 시그니처 수정
  - claudeActions.ts: 미사용 import 제거
  - claudeChatView.ts: ViewPane 생성자 파라미터 수정 (IContextMenuService, IHoverService 추가)

---

**이 문서는 AI Agent 작업 재개 시 현재 상태 파악용으로 항상 최신 유지**
