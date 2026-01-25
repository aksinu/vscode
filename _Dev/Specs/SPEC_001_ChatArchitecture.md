# SPEC_001: Chat Architecture Analysis

> **VS Code Chat 모듈 구조 분석 결과**

---

## Overview

VS Code의 기존 Chat 모듈(`src/vs/workbench/contrib/chat/`)을 분석하여 Claude 통합 구현 방향을 결정하기 위한 문서.

---

## 1. 폴더 구조

```
src/vs/workbench/contrib/chat/
├── browser/                          # UI 구현
│   ├── chat.contribution.ts          # 메인 등록 (1,423줄)
│   ├── chat.ts                       # 위젯 서비스 인터페이스
│   ├── widget/
│   │   ├── chatWidget.ts             # 메인 위젯 컨테이너
│   │   ├── chatListWidget.ts         # 가상 리스트 렌더러
│   │   ├── input/
│   │   │   └── chatInputPart.ts      # 입력 UI (128KB)
│   │   └── chatContentParts/         # 메시지 렌더러들 (25+ 종류)
│   ├── widgetHosts/
│   │   └── editor/chatEditor.ts      # 에디터 통합
│   └── attachments/
│       └── chatAttachmentModel.ts    # 첨부 컨텍스트 모델
├── common/                           # 플랫폼 독립 코드
│   ├── chatService/
│   │   ├── chatService.ts            # 서비스 인터페이스 (1,291줄)
│   │   └── chatServiceImpl.ts        # 구현체
│   ├── model/
│   │   └── chatModel.ts              # 데이터 모델
│   ├── participants/
│   │   └── chatAgents.ts             # 에이전트 시스템
│   └── attachments/
│       └── chatVariables.ts          # 변수 해석 시스템
└── test/
```

---

## 2. 핵심 서비스 패턴

### 서비스 등록 (DI)

```typescript
// browser/chat.contribution.ts
registerSingleton(IChatService, ChatService, InstantiationType.Delayed);
registerSingleton(IChatWidgetService, ChatWidgetService, InstantiationType.Delayed);
registerSingleton(IChatAgentService, ChatAgentService, InstantiationType.Delayed);
registerSingleton(ILanguageModelsService, LanguageModelsService, InstantiationType.Delayed);
registerSingleton(IChatEditingService, ChatEditingService, InstantiationType.Delayed);
registerSingleton(IChatSlashCommandService, ChatSlashCommandService, InstantiationType.Delayed);
```

### Workbench Contribution 등록

```typescript
// 등록 시점별 분류
BlockStartup: ChatResolverContribution     // 필수 초기화
BlockRestore: LanguageModels, Tools        // 복원 전
AfterRestored: UI overlays, StatusBar      // UI
Eventually: Optional features              // 선택적
```

---

## 3. 주요 인터페이스

### IChatService

```typescript
interface IChatService {
  // 세션 관리
  startSession(location: ChatAgentLocation, options?: IChatSessionStartOptions): IChatModelReference;
  getSession(sessionResource: URI): IChatModel | undefined;

  // 요청/응답
  sendRequest(sessionResource: URI, message: string, options?: IChatSendRequestOptions): Promise<IChatSendRequestData>;
  resendRequest(request: IChatRequestModel, options?: IChatSendRequestOptions): Promise<void>;
  appendProgress(request: IChatRequestModel, progress: IChatProgress): void;

  // 이벤트
  readonly onDidSubmitRequest: Event<{ readonly chatSessionResource: URI }>;
  readonly onDidCreateModel: Event<IChatModel>;

  // 히스토리
  getLocalSessionHistory(): Promise<IChatDetail[]>;
  removeHistoryEntry(sessionResource: URI): Promise<void>;
}
```

### IChatWidget

```typescript
interface IChatWidget {
  readonly domNode: HTMLElement;
  readonly viewModel: IChatViewModel | undefined;
  readonly inputEditor: ICodeEditor;
  readonly location: ChatAgentLocation;
  readonly input: ChatInputPart;
  readonly attachmentModel: ChatAttachmentModel;

  // 입력 처리
  acceptInput(query?: string, options?: IChatAcceptInputOptions): Promise<IChatResponseModel>;
  setInput(query?: string): void;
  getInput(): string;

  // 이벤트
  readonly onDidChangeViewModel: Event<IChatWidgetViewModelChangeEvent>;
  readonly onDidAcceptInput: Event<void>;
}
```

### IChatAgent

```typescript
interface IChatAgentData {
  id: string;
  name: string;
  description?: string;
  extensionId: ExtensionIdentifier;
  isDefault?: boolean;
  metadata: IChatAgentMetadata;
  slashCommands: IChatAgentCommand[];
  locations: ChatAgentLocation[];        // Chat, EditorInline, Terminal 등
  modes: ChatModeKind[];                 // Ask, Edit, Agent 모드
}

interface IChatAgentImplementation {
  invoke(request: IChatAgentRequest, progress: (parts: IChatProgress[]) => void,
         history: IChatAgentHistoryEntry[], token: CancellationToken): Promise<IChatAgentResult>;
  provideFollowups?(request, result, history, token): Promise<IChatFollowup[]>;
  provideChatTitle?(history, token): Promise<string | undefined>;
}
```

---

## 4. UI 컴포넌트 구조

```
ChatWidget
├── ChatListWidget (가상 리스트)
│   └── ChatListRenderer
│       └── Content Parts (25+ 종류)
│           ├── chatMarkdownContentPart     # 마크다운
│           ├── codeBlockPart               # 코드 블록
│           ├── chatDiffBlockPart           # Diff 뷰
│           ├── chatToolInvocationPart      # 도구 실행
│           ├── chatThinkingPart            # 에이전트 사고
│           └── chatConfirmationContentPart # 확인 다이얼로그
│
├── ChatInputPart
│   ├── CodeEditorWidget (입력 에디터)
│   ├── Toolbar
│   │   ├── Mode picker
│   │   ├── Agent/Model picker
│   │   └── Execute button
│   └── Attachments panel
│
└── ChatViewWelcomePart (환영 메시지)
```

---

## 5. 컨텍스트 전달 시스템

### 에디터 → 채팅 흐름

```
Editor Selection
       ↓
ChatInputPart.attachmentModel
       ↓ (사용자 전송)
IChatSendRequestOptions {
  locationData: IChatEditorLocationData,
  attachedContext: IChatRequestVariableEntry[]
}
       ↓
IChatService.sendRequest()
       ↓
IChatAgentRequest {
  message,
  variables,
  locationData,
  location: ChatAgentLocation
}
       ↓
Agent.invoke() → LLM
```

### 컨텍스트 타입들

```typescript
type IChatLocationData =
  | IChatEditorLocationData      // 에디터 선택
  | IChatNotebookLocationData    // 노트북 셀
  | IChatTerminalLocationData;   // 터미널

interface IChatEditorLocationData {
  type: ChatAgentLocation.EditorInline;
  document: URI;
  selection: ISelection;
  wholeRange: IRange;
}

type IChatRequestVariableEntry =
  | IChatRequestVariableFileEntry       // 파일
  | IChatRequestVariableSymbolEntry     // 심볼
  | IChatRequestVariableDiagnosticsEntry // 진단
  | IChatRequestVariableSourceControlEntry; // Git
```

---

## 6. 모드 시스템 (Cursor 대응)

| VS Code Mode | Cursor 대응 | 설명 |
|--------------|-------------|------|
| `ChatModeKind.Ask` | Ask | 질문/답변만 |
| `ChatModeKind.Edit` | - | 코드 편집 |
| `ChatModeKind.Agent` | Agent | 자율 실행 |

---

## 7. 주요 설정 키

```typescript
'chat.fontSize'                      // 메시지 폰트 크기
'chat.implicitContext.enabled'       // 현재 에디터 자동 첨부
'chat.detectParticipant.enabled'     // @참가자 자동 감지
'chat.tools.autoApprove.edits'       // 편집 자동 승인 패턴
'chat.agent.maxRequests'             // 턴당 최대 요청
```

---

## 8. Cursor 기능 → VS Code 매핑

| Cursor 기능 | VS Code 대응 | 구현 필요 |
|------------|--------------|----------|
| @ 멘션 (Files, Folders) | `chatVariables` 시스템 | 기존 활용 |
| @Codebase | 벡터 검색 | 별도 구현 |
| @Git | SourceControl 변수 | 기존 활용 |
| 이미지 인식 | Attachment model | 확장 필요 |
| /슬래시 커맨드 | `IChatSlashCommandService` | 기존 활용 |
| Apply 버튼 | `chatDiffBlockPart` | 기존 활용 |
| Checkpoints | 별도 시스템 | 새로 구현 |
| YOLO 모드 | `autoApprove` 설정 | 기존 활용 |
| .cursorrules | 프로젝트 설정 | 새로 구현 |

---

## 9. Claude 통합 전략

### Option A: 기존 Chat 모듈 확장
- `IChatAgentService`에 Claude 에이전트 등록
- 기존 UI 컴포넌트 재사용
- 장점: 빠른 구현, 일관된 UX
- 단점: Copilot 의존성 분리 어려움

### Option B: 독립 모듈 (Recommended)
- `src/vs/workbench/contrib/claude/` 새 모듈
- 핵심 패턴만 참고하여 구현
- 장점: 완전한 통제, Copilot 제거 가능
- 단점: 구현량 증가

### 권장: Option B + 점진적 통합
1. Phase 1: 독립 Claude 모듈로 기본 채팅
2. Phase 2: 기존 Chat UI 컴포넌트 선택적 재사용
3. Phase 3: Copilot 코드 제거, Claude로 완전 대체

---

## 10. 참고 파일 경로

| 파일 | 참고 포인트 |
|------|------------|
| `browser/chat.contribution.ts` | 서비스 등록 패턴 |
| `browser/widget/chatWidget.ts` | 위젯 구조 |
| `browser/widget/input/chatInputPart.ts` | 입력 UI |
| `common/chatService/chatService.ts` | 서비스 인터페이스 |
| `common/model/chatModel.ts` | 데이터 모델 |
| `common/participants/chatAgents.ts` | 에이전트 시스템 |

---

**Last Updated**: 2025-01-25
