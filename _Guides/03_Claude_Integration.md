# Claude Integration Design

> **Claude 통합 설계 가이드**

---

## Overview

VS Code에 Claude AI를 통합하기 위한 설계 문서.
기존 Chat 모듈(`src/vs/workbench/contrib/chat/`)을 참고하되, 독립적인 `claude/` 모듈로 구현.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        VS Code                              │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─────────────────────┐    ┌─────────────────────────────┐│
│  │   ClaudeChatView    │    │      Editor                 ││
│  │  ┌───────────────┐  │    │                             ││
│  │  │ Message List  │  │◄───┤  - 선택 영역 전달           ││
│  │  │               │  │    │  - 파일 컨텍스트            ││
│  │  ├───────────────┤  │    │                             ││
│  │  │ Input Area    │  │    │                             ││
│  │  └───────────────┘  │    └─────────────────────────────┘│
│  └──────────┬──────────┘                                   │
│             │                                              │
│  ┌──────────▼──────────┐                                   │
│  │   ClaudeService     │                                   │
│  │  ┌───────────────┐  │                                   │
│  │  │ API Client    │──┼──► Anthropic API                  │
│  │  ├───────────────┤  │                                   │
│  │  │ History       │  │                                   │
│  │  ├───────────────┤  │                                   │
│  │  │ Context Mgr   │  │                                   │
│  │  └───────────────┘  │                                   │
│  └─────────────────────┘                                   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## Module Structure

```
src/vs/workbench/contrib/claude/
├── browser/
│   ├── claude.contribution.ts      # 모듈 등록
│   ├── claudeService.ts            # API 서비스 구현
│   ├── claudeChatView.ts           # 채팅 뷰 (ViewPane)
│   ├── claudeChatWidget.ts         # 채팅 UI 위젯
│   ├── claudeInputWidget.ts        # 입력 위젯
│   ├── claudeMessageRenderer.ts    # 메시지 렌더러
│   ├── claudeActions.ts            # 커맨드/액션
│   └── media/
│       └── claude.css
├── common/
│   ├── claude.ts                   # 서비스 인터페이스
│   ├── claudeTypes.ts              # 타입 정의
│   └── claudeContextKeys.ts        # 컨텍스트 키
└── test/
    └── browser/
        └── claudeService.test.ts
```

---

## Core Interfaces

### IClaudeService

```typescript
// common/claude.ts

export const IClaudeService = createDecorator<IClaudeService>('claudeService');

export interface IClaudeService {
    readonly _serviceBrand: undefined;

    // Events
    readonly onDidReceiveMessage: Event<IClaudeMessage>;
    readonly onDidChangeState: Event<ClaudeState>;

    // Chat
    sendMessage(content: string, context?: IClaudeContext): Promise<IClaudeMessage>;
    cancelRequest(): void;

    // History
    getMessages(): IClaudeMessage[];
    clearHistory(): void;

    // State
    getState(): ClaudeState;
}
```

### Types

```typescript
// common/claudeTypes.ts

export interface IClaudeMessage {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    timestamp: number;
    context?: IClaudeContext;
}

export interface IClaudeContext {
    selection?: string;
    filePath?: string;
    language?: string;
    workspaceFolder?: string;
}

export type ClaudeState =
    | 'idle'
    | 'sending'
    | 'receiving'
    | 'error';

export interface IClaudeConfig {
    apiKey: string;
    model: string;
    maxTokens: number;
    systemPrompt?: string;
}
```

---

## Claude CLI Integration ✅ 현재 구현

### IPC 기반 CLI 연동

```typescript
// electron-main/claudeCLIService.ts - Main Process
export class ClaudeCLIService {
    private childProcess?: ChildProcess;

    sendPrompt(prompt: string, options?: IClaudeCLIRequestOptions): Promise<void> {
        const args = [
            '--print',
            '--output-format', 'stream-json',
            '--model', options?.model || 'sonnet',
            '--max-tokens', (options?.maxTokens || 4096).toString()
        ];

        this.childProcess = spawn('claude', args, {
            cwd: options?.workingDir || process.cwd(),
            stdio: ['pipe', 'pipe', 'pipe']
        });

        // stdin으로 프롬프트 전송
        this.childProcess.stdin?.write(prompt + '\n');
        this.childProcess.stdin?.end();

        // stdout 스트림 처리
        this.childProcess.stdout?.on('data', this.handleStreamData.bind(this));
    }
}

// browser/claudeService.ts - Renderer Process
export class ClaudeService {
    sendMessage(content: string): Promise<void> {
        // IPC로 Main Process의 CLI 서비스 호출
        return this.claudeCLIChannel.call('sendPrompt', content);
    }
}
```

### ✅ 장점: Claude CLI 사용
- **도구 지원**: Write, Edit, Bash, Grep 등 내장 도구
- **스트리밍**: `--output-format stream-json`으로 실시간 응답
- **세션 관리**: `--resume`, `--continue` 지원
- **권한 관리**: 자동 권한 요청 시스템

---

## UI Components

### Chat View (ViewPane)

```typescript
// browser/claudeChatView.ts

export class ClaudeChatViewPane extends ViewPane {
    private chatWidget: ClaudeChatWidget;

    constructor(
        options: IViewPaneOptions,
        @IClaudeService private claudeService: IClaudeService,
        @IContextKeyService contextKeyService: IContextKeyService,
        // ... 기타 서비스
    ) {
        super(options, ...);
    }

    protected renderBody(container: HTMLElement): void {
        this.chatWidget = this._register(new ClaudeChatWidget(container, this.claudeService));
    }
}
```

### Message Rendering

- Markdown 렌더링 (기존 MarkdownRenderer 활용)
- 코드 블록 하이라이팅
- 복사 버튼
- 코드 적용 버튼

---

## Context Integration

### 에디터 선택 영역 전달

```typescript
// browser/claudeContextProvider.ts

export class ClaudeContextProvider {
    constructor(
        @IEditorService private editorService: IEditorService
    ) {}

    getCurrentContext(): IClaudeContext | undefined {
        const editor = this.editorService.activeTextEditorControl;
        if (!isCodeEditor(editor)) return undefined;

        const model = editor.getModel();
        const selection = editor.getSelection();

        if (!model || !selection) return undefined;

        return {
            selection: model.getValueInRange(selection),
            filePath: model.uri.fsPath,
            language: model.getLanguageId()
        };
    }
}
```

---

## Configuration

```typescript
// Settings
{
    "claude.apiKey": "",
    "claude.model": "claude-sonnet-4-20250514",
    "claude.maxTokens": 4096,
    "claude.systemPrompt": "You are a helpful coding assistant."
}
```

---

## Phase 1 Implementation Steps

1. **기본 구조 생성**
   - 폴더 구조 생성
   - 인터페이스 정의
   - contribution 등록

2. **API 서비스 구현**
   - API 클라이언트
   - 메시지 히스토리
   - 에러 처리

3. **채팅 UI 구현**
   - ViewPane 등록
   - 메시지 리스트
   - 입력 영역

4. **에디터 통합**
   - 선택 영역 컨텍스트
   - 코드 적용 액션

---

## Reference: Existing Chat Module

참고할 기존 Chat 모듈 파일들:

```
src/vs/workbench/contrib/chat/
├── browser/
│   ├── chat.contribution.ts
│   ├── chatWidget.ts
│   ├── chatInputPart.ts
│   └── chatListRenderer.ts
├── common/
│   ├── chatService.ts
│   └── chatModel.ts
```

---

## Security Considerations

- API 키는 VS Code Secret Storage 사용
- HTTPS 통신만 허용
- 민감 코드 전송 시 사용자 확인
