# TASK_001: 로컬 설정 시스템

> **프로젝트별 로컬 설정 (`.gitignore` 대상)**

---

## Overview

| Item | Value |
|------|-------|
| **Priority** | P1 |
| **Difficulty** | Medium |
| **Status** | [x] Done |
| **Dependencies** | None |

---

## Requirements

### 1. 설정 파일 위치
```
{workspace}/.vscode/claude.local.json
```
- `.gitignore`에 추가 권장 (개발자별 설정)
- 없으면 기본값 사용

### 2. 설정 항목

```json
{
  "claude.executable": {
    "type": "command" | "script",
    "command": "claude",           // type: "command"일 때
    "script": "./scripts/claude.bat", // type: "script"일 때
    "scriptType": "bat" | "sh" | "ps1" | "node" | "python"
  },
  "claude.autoAccept": false,      // 모두 OK 모드
  "claude.workingDirectory": "."   // 작업 디렉토리
}
```

### 3. OS별 분기
- Windows: `.bat`, `.ps1`
- macOS/Linux: `.sh`
- Cross-platform: `node`, `python`

### 4. 스크립트 예시

**Windows (claude.bat)**
```batch
@echo off
set ANTHROPIC_API_KEY=sk-xxx
claude %*
```

**Unix (claude.sh)**
```bash
#!/bin/bash
export ANTHROPIC_API_KEY=sk-xxx
claude "$@"
```

---

## Implementation

### Files to Create/Modify

| File | Action |
|------|--------|
| `common/claudeLocalConfig.ts` | CREATE - 로컬 설정 타입/로더 |
| `browser/claudeService.ts` | MODIFY - 설정 로드 로직 |
| `electron-main/claudeCLIService.ts` | MODIFY - 스크립트 실행 지원 |

### Key Changes

1. **설정 로더**
   - 워크스페이스 루트에서 `.vscode/claude.local.json` 읽기
   - 없으면 기본값 반환

2. **CLI 서비스 수정**
   - `spawn('claude', ...)` → 설정에 따라 분기
   - 스크립트 실행 시 적절한 인터프리터 사용

---

## Acceptance Criteria

- [ ] `.vscode/claude.local.json` 파일로 설정 가능
- [ ] 스크립트 파일(bat/sh)로 Claude 실행 가능
- [ ] OS별 적절한 실행 방식 선택
- [ ] 설정 파일 없어도 기본 동작 유지

---

## Notes

- 설정 파일에 API 키 저장하지 않도록 주의 (스크립트 내부에서 처리)
- 스크립트 경로는 워크스페이스 상대 경로 지원
