# Development Status

> **현재 Sprint 상태** | 과거 이력은 → `StatusHistory.md`

---

## Current Status

| Item | Value |
|------|-------|
| **Phase** | Phase 9 완료 — CLI 기능 확장 + 에디터 통합 + Agent 모드 |
| **Build** | ⚠️ 컴파일 필요 |
| **Updated** | 2026-02-14 |

---

## Architecture Overview

```
src/vs/workbench/contrib/kent/
├── browser/services/          # 핵심 서비스 (5개 + 5개 매니저)
├── browser/views/            # UI 컴포넌트 (19개 모듈)
├── common/                   # 인터페이스 & 타입
└── electron-main/            # CLI 프로세스 관리
```

---

## Active Issues

- [x] AskUser 선택지 클릭 안됨 + Submit 버튼 사라짐 — CLI 완료 시 asking 상태가 idle로 덮어써지는 타이밍 문제 (4파일 수정)
- [ ] CLI exit code 1 에러 — Windows에서 `shell: true` + 긴 인자 문제 (조사 중)

---

## Next Steps

- 안정화 및 버그 수정 (CLI 에러 해결 우선)
- 사용자 피드백 기반 개선
- MCP 서버 연동 (차기)

---

## Build & Run

```bash
yarn compile          # 컴파일 (수 분 소요)
./scripts/code.bat    # VS Code 실행
```
