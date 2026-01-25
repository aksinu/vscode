# TASK_003: Claude Module Structure

> **Claude 모듈 기본 구조 생성**

---

## Info

| Item | Value |
|------|-------|
| Task ID | TASK_003 |
| Sprint | Sprint_001 |
| Status | ✅ Done |
| Priority | P0 Critical |
| Created | 2025-01-25 |
| Updated | 2025-01-25 |

---

## Objective

`src/vs/workbench/contrib/claude/` 모듈의 기본 구조 생성.

---

## Completed Work

### 생성된 파일 구조
```
src/vs/workbench/contrib/claude/
├── browser/
│   ├── claude.contribution.ts      # 서비스/뷰/설정 등록
│   ├── claudeService.ts            # API 서비스 구현
│   ├── claudeChatView.ts           # 채팅 ViewPane
│   ├── claudeActions.ts            # 커맨드/액션
│   └── media/
│       └── claude.css              # 스타일
├── common/
│   ├── claude.ts                   # IClaudeService 인터페이스
│   ├── claudeTypes.ts              # 타입 정의
│   └── claudeContextKeys.ts        # 컨텍스트 키
└── test/
    └── browser/                    # (테스트 폴더 준비)
```

### 등록된 컴포넌트

#### 서비스
```typescript
registerSingleton(IClaudeService, ClaudeService, InstantiationType.Delayed);
```

#### View Container & View
```typescript
// Panel 위치에 View Container 등록
viewContainer = registerViewContainer({
  id: 'workbench.view.claude',
  title: 'Claude',
  icon: Codicon.comment
}, ViewContainerLocation.Panel);

// View 등록
registerViews([{
  id: 'workbench.panel.claude.chat',
  name: 'Claude Chat'
}], viewContainer);
```

#### 커맨드
| ID | Keybinding | 설명 |
|----|------------|------|
| `claude.openChat` | `Ctrl+Shift+C` | 채팅창 열기 |
| `claude.clearChat` | `Ctrl+Shift+K` | 대화 초기화 |
| `claude.cancelRequest` | `Escape` | 요청 취소 |
| `claude.newSession` | - | 새 세션 |
| `claude.focusInput` | `Ctrl+L` | 입력창 포커스 |

#### 설정
| Key | Type | Default |
|-----|------|---------|
| `claude.apiKey` | string | `""` |
| `claude.model` | enum | `claude-sonnet-4-20250514` |
| `claude.maxTokens` | number | `4096` |
| `claude.systemPrompt` | string | (기본값) |
| `claude.fontSize` | number | `13` |

### Workbench Import
```typescript
// workbench.common.main.ts
import './contrib/claude/browser/claude.contribution.js';
```

---

## Verification

- [x] 폴더 구조 생성
- [x] common/ 인터페이스 정의
- [x] browser/ 서비스 구현
- [x] contribution.ts 등록
- [x] workbench main에 import 추가
- [x] TypeScript 진단 에러 없음

---

## Notes

### API 호출 흐름
```
User Input → ClaudeService.sendMessage()
    → callClaudeAPI() → Anthropic API
    → Response → IClaudeMessage
    → onDidReceiveMessage → UI 업데이트
```

### 컨텍스트 전달
- 현재 에디터의 선택 영역 자동 감지
- `getEditorContext()` → `IClaudeContext`
- 시스템 프롬프트에 컨텍스트 추가

---

## 다음 단계 (TASK_004)

- [ ] Markdown 렌더링 구현
- [ ] 코드 블록 구문 강조
- [ ] Copy/Apply 버튼
- [ ] 스트리밍 응답

---

**Status: ✅ Done**
