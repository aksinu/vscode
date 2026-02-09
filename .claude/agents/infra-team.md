# Infra Team (인프라 팀)

> ipc-expert + filesystem-expert + build-deploy-expert 통합

## Mission
IPC 통신, 파일 시스템 처리, 빌드 시스템을 담당하는 팀.

## When to Use
- IPC 채널 추가/수정
- Main/Renderer 프로세스 통신 문제
- 파일 변경 추적/스냅샷
- 빌드 에러 해결
- CLI 프로세스 관리

## Architecture

### Process Model
```
┌─────────────┐     IPC      ┌──────────────┐
│    Main     │◄────────────►│   Renderer   │
│   Process   │              │   Process    │
│  (Node.js)  │              │  (Browser)   │
│             │              │              │
│ claudeCLI   │              │ claudeService│
│ MainService │              │ (browser/)   │
└─────────────┘              └──────────────┘
```

### File Structure
```
electron-main/
├── claudeCLIMainService.ts    # CLI 프로세스 관리
└── claudeCLIChannel.ts        # IPC 채널

browser/services/
├── core/
│   ├── claudeService.ts       # 핵심 서비스
│   └── managers/
│       ├── fileSnapshotManager.ts  # 스냅샷
│       └── fileWatcherManager.ts   # 파일 감시
```

## IPC Patterns

### Channel Definition
```typescript
// IPC 채널 등록 (app.ts)
const claudeChannel = accessor.get(IClaudeCLIChannel);
services.set(IClaudeCLIChannel, claudeChannel);
```

### Service Interface (common/)
```typescript
export interface IClaudeCLIService {
    sendPrompt(prompt: string, options?: any): Promise<void>;
    sendUserInput(input: string): Promise<void>;
    cancelRequest(): Promise<void>;
    readonly onDidReceiveData: Event<IClaudeCLIStreamEvent>;
    readonly onDidComplete: Event<void>;
    readonly onDidError: Event<string>;
}
```

### Server Channel (Main Process)
```typescript
listen<T>(_ctx: string, event: string): Event<T> {
    switch (event) {
        case 'onDidReceiveData':
            return this.service.onDidReceiveData as Event<T>;
    }
}

async call<T>(_ctx: string, command: string, args?: unknown[]): Promise<T> {
    switch (command) {
        case 'sendPrompt':
            return this.service.sendPrompt(args[0], args[1]) as T;
    }
}
```

## File Changes Tracking

### Data Flow
```
Tool Use Event (Edit/Write)
    → CLIEventHandler.isFileModifyTool()
    → FileSnapshotManager.captureBeforeEdit()
    → FileSnapshotManager.captureAfterEdit()
    → ClaudeService.handleCommandComplete()
    → ClaudeMessageRenderer.renderFileChanges()
```

### FileSnapshot API
```typescript
class FileSnapshotManager {
    startCommand(workingDir?: string): void;
    captureBeforeEdit(filePath: string): Promise<void>;
    captureAfterEdit(filePath: string): Promise<void>;
    getChangedFiles(): IClaudeFileChange[];
    getChangesSummary(): IClaudeFileChangesSummary;
    showDiff(fileChange: IClaudeFileChange): Promise<void>;
    revertFile(filePath: string): Promise<boolean>;
    revertAll(): Promise<number>;
}
```

### Tool Detection
```typescript
private isFileModifyTool(toolName: string): boolean {
    return ['Edit', 'Write', 'NotebookEdit'].includes(toolName);
}
```

## Build System

### Commands
```bash
yarn compile          # 전체 컴파일 (수 분)
./scripts/code.bat    # VS Code 실행
```

### Common Build Issues
1. **Import 경로 오류**: `.js` 확장자 필수
2. **순환 참조**: common/ ↔ browser/ 간 금지
3. **미사용 변수**: TypeScript strict mode에서 에러
4. **타입 불일치**: 인터페이스 변경 후 구현 미반영

## FileWatcher (현재 비활성화)
```
⚠️ 무한 루프 문제로 임시 비활성화
TODO: 무한 루프 완전 해결 후 다시 활성화
- 파일 패턴 필터링으로 무한 루프 방지 필요
- .vscode, .git, node_modules, out, dist 제외
```

## Rules
- IPC 입력 항상 검증 및 정제
- Main process에서 무거운 작업 차단 금지
- Renderer 입력 신뢰 금지
- 동기 IPC 호출 사용 금지
- 파일 작업 시 debounce 적용
