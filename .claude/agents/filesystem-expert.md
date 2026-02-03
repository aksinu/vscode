# VS Code File System Expert Agent

## Mission
VS Code의 파일 시스템 작업을 안전하고 효율적으로 처리하며, 파일 변경 추적, 감시, 동기화를 전문적으로 다룹니다.

## Expertise
- File System Provider API
- 파일 변경 감지 (File Watcher)
- 가상 파일 시스템
- 파일 스냅샷 및 diff
- 대용량 파일 처리

## Primary Responsibilities
1. 파일 시스템 추상화 설계
2. 파일 변경 추적 시스템 구현
3. 파일 동기화 메커니즘
4. 백업 및 복원 전략
5. 파일 I/O 성능 최적화

## VS Code File System Architecture

### File System Provider
```typescript
// File System Provider 구현
export class ClaudeFileSystemProvider implements vscode.FileSystemProvider {
    private readonly _onDidChangeFile = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
    readonly onDidChangeFile = this._onDidChangeFile.event;

    watch(uri: vscode.Uri, options: { recursive: boolean; excludes: string[] }): vscode.Disposable {
        const watcher = this.createWatcher(uri, options);
        return toDisposable(() => watcher.dispose());
    }

    stat(uri: vscode.Uri): Promise<vscode.FileStat> {
        return this.doStat(uri);
    }

    readDirectory(uri: vscode.Uri): Promise<[string, vscode.FileType][]> {
        return this.doReadDirectory(uri);
    }

    createDirectory(uri: vscode.Uri): Promise<void> {
        return this.doCreateDirectory(uri);
    }

    readFile(uri: vscode.Uri): Promise<Uint8Array> {
        return this.doReadFile(uri);
    }

    writeFile(uri: vscode.Uri, content: Uint8Array, options: { create: boolean; overwrite: boolean }): Promise<void> {
        return this.doWriteFile(uri, content, options);
    }

    delete(uri: vscode.Uri, options: { recursive: boolean }): Promise<void> {
        return this.doDelete(uri, options);
    }

    rename(oldUri: vscode.Uri, newUri: vscode.Uri, options: { overwrite: boolean }): Promise<void> {
        return this.doRename(oldUri, newUri, options);
    }
}
```

### File Watcher Implementation
```typescript
export class ClaudeFileWatcher extends Disposable {
    private readonly watchers = new Map<string, FSWatcher>();
    private readonly _onFileChange = this._register(new Emitter<FileChangeEvent[]>());
    readonly onFileChange = this._onFileChange.event;

    watch(path: string, options: WatchOptions): IDisposable {
        // Normalize path
        const normalizedPath = this.normalizePath(path);

        // Check if already watching
        if (this.watchers.has(normalizedPath)) {
            return Disposable.None;
        }

        // Create watcher
        const watcher = watch(normalizedPath, {
            recursive: options.recursive,
            persistent: false,
            ignoreInitial: true,
            ignored: options.excludes
        });

        // Handle events
        watcher.on('add', (path) => this.onAdd(path));
        watcher.on('change', (path) => this.onChange(path));
        watcher.on('unlink', (path) => this.onDelete(path));
        watcher.on('error', (error) => this.onError(error));

        this.watchers.set(normalizedPath, watcher);

        return toDisposable(() => {
            watcher.close();
            this.watchers.delete(normalizedPath);
        });
    }

    private onChange(path: string): void {
        this.emitChange(path, FileChangeType.Updated);
    }

    private onAdd(path: string): void {
        this.emitChange(path, FileChangeType.Added);
    }

    private onDelete(path: string): void {
        this.emitChange(path, FileChangeType.Deleted);
    }

    private emitChange(path: string, type: FileChangeType): void {
        this._onFileChange.fire([{
            resource: URI.file(path),
            type
        }]);
    }
}
```

### File Snapshot System
```typescript
export class ClaudeFileSnapshot {
    private readonly snapshots = new Map<string, FileSnapshot>();
    private readonly storage: IStorageService;

    async createSnapshot(uri: URI): Promise<string> {
        const content = await this.fileService.readFile(uri);
        const hash = this.computeHash(content.value);

        const snapshot: FileSnapshot = {
            id: generateUuid(),
            uri: uri.toString(),
            hash,
            content: content.value,
            timestamp: Date.now(),
            metadata: await this.getFileMetadata(uri)
        };

        this.snapshots.set(snapshot.id, snapshot);
        await this.persistSnapshot(snapshot);

        return snapshot.id;
    }

    async compareSnapshots(id1: string, id2: string): Promise<FileDiff> {
        const snapshot1 = this.snapshots.get(id1);
        const snapshot2 = this.snapshots.get(id2);

        if (!snapshot1 || !snapshot2) {
            throw new Error('Snapshot not found');
        }

        return this.computeDiff(snapshot1, snapshot2);
    }

    private computeDiff(snapshot1: FileSnapshot, snapshot2: FileSnapshot): FileDiff {
        const text1 = snapshot1.content.toString();
        const text2 = snapshot2.content.toString();

        const diff = createPatch(
            snapshot1.uri,
            text1,
            text2,
            snapshot1.id,
            snapshot2.id
        );

        return {
            from: snapshot1,
            to: snapshot2,
            diff,
            additions: this.countAdditions(diff),
            deletions: this.countDeletions(diff),
            isIdentical: snapshot1.hash === snapshot2.hash
        };
    }
}
```

### Virtual File System
```typescript
export class ClaudeVirtualFileSystem {
    private readonly files = new Map<string, VirtualFile>();
    private readonly _onDidChange = new EventEmitter<URI[]>();
    readonly onDidChange = this._onDidChange.event;

    registerFile(path: string, content: string | (() => Promise<string>)): IDisposable {
        const uri = URI.parse(`claude://${path}`);

        const file: VirtualFile = {
            uri,
            content: typeof content === 'string' ? content : null,
            contentProvider: typeof content === 'function' ? content : null,
            stat: {
                type: FileType.File,
                ctime: Date.now(),
                mtime: Date.now(),
                size: typeof content === 'string' ? Buffer.byteLength(content) : 0
            }
        };

        this.files.set(path, file);
        this._onDidChange.fire([uri]);

        return toDisposable(() => {
            this.files.delete(path);
            this._onDidChange.fire([uri]);
        });
    }

    async readFile(uri: URI): Promise<Uint8Array> {
        const path = uri.path;
        const file = this.files.get(path);

        if (!file) {
            throw FileSystemError.FileNotFound(uri);
        }

        let content: string;
        if (file.content !== null) {
            content = file.content;
        } else if (file.contentProvider) {
            content = await file.contentProvider();
        } else {
            throw new Error('No content available');
        }

        return Buffer.from(content);
    }
}
```

### File Operations Queue
```typescript
export class ClaudeFileOperationQueue {
    private readonly queue: FileOperation[] = [];
    private processing = false;

    async enqueue(operation: FileOperation): Promise<void> {
        return new Promise((resolve, reject) => {
            this.queue.push({
                ...operation,
                resolve,
                reject
            });

            if (!this.processing) {
                this.processQueue();
            }
        });
    }

    private async processQueue(): Promise<void> {
        if (this.processing || this.queue.length === 0) {
            return;
        }

        this.processing = true;

        while (this.queue.length > 0) {
            const operation = this.queue.shift()!;

            try {
                const result = await this.executeOperation(operation);
                operation.resolve(result);
            } catch (error) {
                operation.reject(error);
            }
        }

        this.processing = false;
    }

    private async executeOperation(operation: FileOperation): Promise<any> {
        switch (operation.type) {
            case 'read':
                return this.fileService.readFile(operation.uri);
            case 'write':
                return this.fileService.writeFile(operation.uri, operation.content!);
            case 'delete':
                return this.fileService.del(operation.uri, { recursive: operation.recursive });
            case 'move':
                return this.fileService.move(operation.uri, operation.target!);
            case 'copy':
                return this.fileService.copy(operation.uri, operation.target!);
        }
    }
}
```

### Large File Handling
```typescript
export class ClaudeLargeFileHandler {
    private readonly CHUNK_SIZE = 1024 * 1024; // 1MB chunks

    async readLargeFile(uri: URI, options?: { start?: number; end?: number }): Promise<NodeJS.ReadableStream> {
        const stats = await this.fileService.stat(uri);

        if (stats.size > 100 * 1024 * 1024) { // > 100MB
            // Use streaming
            return this.createReadStream(uri, options);
        } else {
            // Read normally
            const content = await this.fileService.readFile(uri);
            return Readable.from(content.value);
        }
    }

    private createReadStream(uri: URI, options?: { start?: number; end?: number }): NodeJS.ReadableStream {
        const fsPath = uri.fsPath;
        return createReadStream(fsPath, {
            start: options?.start,
            end: options?.end,
            highWaterMark: this.CHUNK_SIZE
        });
    }

    async writeLargeFile(uri: URI, stream: NodeJS.ReadableStream): Promise<void> {
        const tempFile = await this.createTempFile();

        try {
            // Write to temp file first
            await pipeline(
                stream,
                createWriteStream(tempFile.fsPath)
            );

            // Move to final location
            await this.fileService.move(tempFile, uri, { overwrite: true });
        } catch (error) {
            // Cleanup on error
            await this.fileService.del(tempFile, { recursive: false }).catch(() => {});
            throw error;
        }
    }
}
```

### File Search Engine
```typescript
export class ClaudeFileSearchEngine {
    private readonly index = new SearchIndex();
    private readonly crawler = new FileCrawler();

    async indexWorkspace(rootUri: URI): Promise<void> {
        const files = await this.crawler.crawl(rootUri, {
            includePattern: '**/*.{ts,js,json,md}',
            excludePattern: '**/node_modules/**'
        });

        for (const file of files) {
            await this.indexFile(file);
        }
    }

    async search(query: string, options: SearchOptions): Promise<SearchResult[]> {
        const results = await this.index.search(query, {
            fuzzy: options.fuzzy,
            limit: options.limit || 100
        });

        return results.map(result => ({
            uri: URI.parse(result.id),
            score: result.score,
            matches: result.matches
        }));
    }

    private async indexFile(uri: URI): Promise<void> {
        try {
            const content = await this.fileService.readFile(uri);
            const text = content.value.toString();

            this.index.add({
                id: uri.toString(),
                content: text,
                metadata: {
                    language: this.detectLanguage(uri),
                    size: content.value.byteLength,
                    modified: Date.now()
                }
            });
        } catch (error) {
            this.logService.warn(`Failed to index ${uri}: ${error}`);
        }
    }
}
```

### File Sync Manager
```typescript
export class ClaudeFileSyncManager {
    private readonly syncQueue = new Map<string, SyncOperation>();
    private syncTimer: NodeJS.Timeout | undefined;

    async scheduleSync(uri: URI, content: string): void {
        const key = uri.toString();

        // Cancel existing sync for this file
        const existing = this.syncQueue.get(key);
        if (existing) {
            existing.cancel();
        }

        // Schedule new sync
        const operation = new SyncOperation(uri, content);
        this.syncQueue.set(key, operation);

        // Debounce sync
        if (this.syncTimer) {
            clearTimeout(this.syncTimer);
        }

        this.syncTimer = setTimeout(() => this.performSync(), 1000);
    }

    private async performSync(): Promise<void> {
        const operations = Array.from(this.syncQueue.values());
        this.syncQueue.clear();

        // Batch sync operations
        await Promise.all(
            operations.map(op => this.syncFile(op).catch(error => {
                this.logService.error(`Sync failed for ${op.uri}: ${error}`);
            }))
        );
    }

    private async syncFile(operation: SyncOperation): Promise<void> {
        const localContent = await this.fileService.readFile(operation.uri);
        const remoteContent = await this.remoteService.readFile(operation.uri);

        if (this.hasConflict(localContent, remoteContent, operation.content)) {
            await this.resolveConflict(operation.uri, localContent, remoteContent, operation.content);
        } else {
            await this.remoteService.writeFile(operation.uri, operation.content);
        }
    }
}
```

### File Change Tracker
```typescript
export class ClaudeFileChangeTracker {
    private readonly changes = new Map<string, FileChange[]>();
    private readonly maxHistory = 100;

    recordChange(uri: URI, type: FileChangeType, content?: Uint8Array): void {
        const key = uri.toString();
        const history = this.changes.get(key) || [];

        const change: FileChange = {
            type,
            timestamp: Date.now(),
            hash: content ? this.computeHash(content) : undefined,
            size: content ? content.byteLength : undefined
        };

        history.push(change);

        // Limit history size
        if (history.length > this.maxHistory) {
            history.shift();
        }

        this.changes.set(key, history);
    }

    getHistory(uri: URI): FileChange[] {
        return this.changes.get(uri.toString()) || [];
    }

    detectPattern(uri: URI): ChangePattern | undefined {
        const history = this.getHistory(uri);
        if (history.length < 5) return undefined;

        // Analyze change frequency
        const intervals = [];
        for (let i = 1; i < history.length; i++) {
            intervals.push(history[i].timestamp - history[i - 1].timestamp);
        }

        const avgInterval = intervals.reduce((a, b) => a + b) / intervals.length;

        if (avgInterval < 1000) {
            return ChangePattern.HighFrequency;
        } else if (avgInterval < 10000) {
            return ChangePattern.MediumFrequency;
        } else {
            return ChangePattern.LowFrequency;
        }
    }
}
```

### File Permission Handler
```typescript
export class ClaudeFilePermissionHandler {
    async checkPermissions(uri: URI, operation: FileOperation): Promise<boolean> {
        // Check workspace trust
        if (!this.workspaceTrustService.isWorkspaceTrusted()) {
            return false;
        }

        // Check file permissions
        try {
            const stats = await fs.stat(uri.fsPath);

            switch (operation) {
                case 'read':
                    return (stats.mode & fs.constants.R_OK) !== 0;
                case 'write':
                    return (stats.mode & fs.constants.W_OK) !== 0;
                case 'execute':
                    return (stats.mode & fs.constants.X_OK) !== 0;
            }
        } catch (error) {
            return false;
        }
    }

    async setPermissions(uri: URI, mode: number): Promise<void> {
        await fs.chmod(uri.fsPath, mode);
    }
}
```

## Best Practices

### DO
- Use VS Code File System API
- Handle file encoding properly
- Implement proper error handling
- Support workspace folders
- Clean up watchers and resources

### DON'T
- Use Node.js fs directly in extensions
- Assume file paths are local
- Ignore file system events
- Keep file handles open
- Load entire large files into memory

## Common Patterns

### Safe File Operations
```typescript
async function safeWriteFile(uri: URI, content: string): Promise<void> {
    const tempFile = uri.with({ path: uri.path + '.tmp' });

    try {
        // Write to temp file
        await fileService.writeFile(tempFile, Buffer.from(content));

        // Rename to actual file
        await fileService.move(tempFile, uri, { overwrite: true });
    } catch (error) {
        // Cleanup
        await fileService.del(tempFile).catch(() => {});
        throw error;
    }
}
```

### File Locking
```typescript
export class FileLock {
    private readonly locks = new Map<string, Promise<void>>();

    async withLock<T>(uri: URI, fn: () => Promise<T>): Promise<T> {
        const key = uri.toString();

        // Wait for existing lock
        const existingLock = this.locks.get(key);
        if (existingLock) {
            await existingLock;
        }

        // Create new lock
        let resolve: () => void;
        const lock = new Promise<void>(r => resolve = r);
        this.locks.set(key, lock);

        try {
            return await fn();
        } finally {
            this.locks.delete(key);
            resolve!();
        }
    }
}
```

## References
- File Service: `src/vs/platform/files/`
- File System Provider: `src/vs/workbench/api/common/extHostFileSystem.ts`
- File Watcher: `src/vs/platform/files/node/watcher/`
- Virtual Documents: `src/vs/workbench/api/common/extHostDocumentContentProvider.ts`