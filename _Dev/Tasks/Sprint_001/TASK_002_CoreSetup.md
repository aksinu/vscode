# TASK_002: Codebase Analysis

> **VS Code Chat 모듈 구조 분석**

---

## Info

| Item | Value |
|------|-------|
| Task ID | TASK_002 |
| Sprint | Sprint_001 |
| Status | ✅ Done |
| Priority | P0 Critical |
| Created | 2025-01-25 |
| Updated | 2025-01-25 |

---

## Objective

기존 VS Code Chat 모듈 분석하여 Claude 통합 구현 방향 결정.

---

## Completed Analysis

### 폴더 구조
```
src/vs/workbench/contrib/chat/
├── browser/
│   ├── chat.contribution.ts    # 서비스 등록 (1,423줄)
│   ├── widget/
│   │   ├── chatWidget.ts       # 메인 위젯
│   │   ├── chatListWidget.ts   # 메시지 리스트
│   │   └── input/chatInputPart.ts  # 입력 UI
│   └── chatContentParts/       # 렌더러 (25+ 종류)
├── common/
│   ├── chatService/chatService.ts  # 서비스 인터페이스
│   ├── model/chatModel.ts      # 데이터 모델
│   └── participants/chatAgents.ts  # 에이전트 시스템
```

### 핵심 패턴
1. **서비스 DI**: `registerSingleton()` + `InstantiationType.Delayed`
2. **뷰 등록**: `Registry.as<IViewsRegistry>().registerViews()`
3. **Observable**: `IObservable<T>` 기반 반응형 상태
4. **Content Parts**: 플러그인 방식 메시지 렌더러

### 구현 전략 결정
- **Option B: 독립 모듈** 채택
- `src/vs/workbench/contrib/claude/` 새 모듈 생성
- 기존 패턴 참고, Copilot 의존성 배제

---

## Output Documents

| Document | Path |
|----------|------|
| 아키텍처 분석 | `_Dev/Specs/SPEC_001_ChatArchitecture.md` |
| 기능 명세 | `_Dev/Specs/SPEC_002_ClaudeFeatures.md` |

---

## Key Findings

### 컨텍스트 전달 흐름
```
Editor Selection → ChatInputPart.attachmentModel
    → IChatSendRequestOptions.locationData
    → IChatAgentRequest.variables
    → Agent.invoke() → LLM
```

### Cursor 기능 매핑
| Cursor | VS Code 대응 | 구현 |
|--------|-------------|------|
| @ 멘션 | chatVariables | 기존 활용 |
| /커맨드 | IChatSlashCommandService | 기존 활용 |
| Apply | chatDiffBlockPart | 기존 활용 |
| Agent 모드 | ChatModeKind.Agent | 확장 필요 |
| Checkpoints | 없음 | 새로 구현 |

---

## Checklist

- [x] Chat 모듈 구조 분석
- [x] 핵심 인터페이스 정리
- [x] 구현 패턴 파악
- [x] Cursor 기능 매핑
- [x] 구현 전략 결정
- [x] Spec 문서 작성

---

**Status: ✅ Done**
