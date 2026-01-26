# SPEC_004: Status Display & Settings Window

> **Claude 상태 표시 및 설정 윈도우**

---

## Overview

Claude 연결 상태, 모델 정보, 설정을 확인하고 관리할 수 있는 UI를 제공한다.

---

## 1. Claude 상태 표시 (Status Bar)

### 1.1 표시 위치
- 채팅창 하단 또는 상단 (입력창 근처)
- 항상 보이는 상태 바

### 1.2 표시 정보

| 항목 | 설명 | 예시 |
|------|------|------|
| 연결 상태 | CLI 연결 여부 | `Connected` / `Disconnected` |
| 모델 | 현재 사용 중인 모델 | `claude-sonnet-4` |
| Think Mode | Extended thinking 활성화 여부 | `Ultra Think: ON` / `OFF` |
| 실행 방식 | CLI 직접 / 스크립트 | `CLI` / `Script: run.bat` |

### 1.3 UI 디자인

```
┌─────────────────────────────────────────────────────────────┐
│ 채팅 영역                                                    │
├─────────────────────────────────────────────────────────────┤
│ ● Connected | claude-sonnet-4 | Ultra: OFF | CLI     [⚙️]  │  ← 상태 바
├─────────────────────────────────────────────────────────────┤
│ 입력창                                                       │
└─────────────────────────────────────────────────────────────┘
```

### 1.4 상태 아이콘

| 상태 | 아이콘 | 색상 |
|------|--------|------|
| Connected | ● (filled circle) | Green |
| Disconnected | ○ (empty circle) | Red |
| Connecting | ◐ (half circle) | Yellow |

---

## 2. 설정 윈도우 (Settings Panel)

### 2.1 접근 방식
- 상태 바의 설정 아이콘(⚙️) 클릭
- 또는 기존 설정 버튼 클릭 시 확장된 패널 표시

### 2.2 표시 정보

#### 계정 정보
| 항목 | 설명 |
|------|------|
| Account | 현재 로그인된 계정 (있으면) |
| API Key Status | API 키 설정 여부 |
| Organization | 소속 조직 (있으면) |

#### 연결 상태
| 항목 | 설명 |
|------|------|
| Connection | Connected / Disconnected |
| Execution Method | CLI (default) / Script |
| Script Path | 스크립트 경로 (스크립트 사용 시) |
| Last Connected | 마지막 연결 시간 |

#### 모델 설정
| 항목 | 설명 |
|------|------|
| Current Model | 현재 모델명 |
| Extended Thinking | ON / OFF |
| Max Tokens | 최대 토큰 수 |

### 2.3 UI 디자인 (QuickPick 또는 별도 패널)

**Option A: QuickPick 방식 (간단)**
```
┌─────────────────────────────────────────┐
│ Claude Settings                          │
├─────────────────────────────────────────┤
│ ● Connection: Connected                  │
│ ○ Model: claude-sonnet-4                 │
│ ○ Execution: CLI (default)               │
│ ○ Extended Thinking: OFF                 │
│ ───────────────────────────────────────  │
│ ○ Change Model...                        │
│ ○ Configure Script...                    │
│ ○ Toggle Extended Thinking               │
│ ○ View Account Info...                   │
│ ───────────────────────────────────────  │
│ ○ Open claude.local.json                 │
└─────────────────────────────────────────┘
```

**Option B: 별도 패널 방식 (상세)**
- ViewPane 내에 설정 섹션 토글
- 더 많은 정보와 컨트롤 제공

### 2.4 기능

1. **연결 테스트**: Claude CLI 연결 확인
2. **모델 변경**: 사용할 모델 선택
3. **스크립트 설정**: 커스텀 실행 스크립트 경로 지정
4. **Extended Thinking 토글**: 활성화/비활성화
5. **설정 파일 열기**: `claude.local.json` 직접 편집

---

## 3. 연결 상태 확인 방법

### 3.1 CLI 연결 확인
```typescript
// claude --version 또는 claude --help 실행하여 확인
async checkConnection(): Promise<boolean> {
  try {
    const result = await exec('claude --version');
    return result.exitCode === 0;
  } catch {
    return false;
  }
}
```

### 3.2 계정 정보 확인
```typescript
// claude config get 또는 유사 명령어로 확인
async getAccountInfo(): Promise<IClaudeAccountInfo | null> {
  try {
    const result = await exec('claude config list --json');
    return JSON.parse(result.stdout);
  } catch {
    return null;
  }
}
```

### 3.3 스크립트 실행 확인
```typescript
// 스크립트 파일 존재 여부 및 실행 가능 여부 확인
async validateScript(scriptPath: string): Promise<boolean> {
  // 1. 파일 존재 확인
  // 2. 실행 권한 확인 (Unix)
  // 3. 테스트 실행 (--version 등)
}
```

---

## 4. 데이터 모델

```typescript
interface IClaudeStatus {
  connected: boolean;
  connecting: boolean;
  model: string;
  extendedThinking: boolean;
  executionMethod: 'cli' | 'script';
  scriptPath?: string;
  lastConnected?: Date;
  error?: string;
}

interface IClaudeAccountInfo {
  email?: string;
  organization?: string;
  apiKeyConfigured: boolean;
  plan?: string;
}

interface IClaudeSettings {
  model: string;
  maxTokens: number;
  extendedThinking: boolean;
  systemPrompt?: string;
  executable: {
    type: 'command' | 'script';
    command?: string;
    script?: string;
  };
  autoAccept: boolean;
}
```

---

## 5. 구현 우선순위

| # | 기능 | 우선순위 |
|---|------|----------|
| 1 | 상태 바 UI (연결, 모델) | P1 |
| 2 | 설정 QuickPick (간단 버전) | P1 |
| 3 | 연결 테스트 기능 | P1 |
| 4 | Extended Thinking 표시/토글 | P2 |
| 5 | 계정 정보 표시 | P2 |
| 6 | 스크립트 검증 및 폴백 | P3 |

---

## 6. 참고

- VS Code의 상태 바 패턴 참고 (`StatusbarAlignment`)
- 기존 `openLocalSettings` 메서드 활용
- Claude CLI의 설정 명령어 확인 필요

---

**Status**: Draft
**Created**: 2026-01-26
**Author**: Kent
