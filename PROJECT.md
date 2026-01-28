# Claude Code Editor

> **VS Code 포크 기반 Claude 통합 에디터**

---

## Overview

VS Code를 포크하여 Claude AI 채팅 기능을 네이티브로 통합한 커스텀 에디터.
GitHub Copilot 대신 Claude를 기본 AI 어시스턴트로 사용하며, Claude Code CLI의 기능을 에디터 내에서 직접 사용할 수 있도록 함.

---

## Goals

### Primary (Phase 1 - 기본 채팅) ✅ 완료
- [x] Claude 채팅 패널 UI 구현
- [x] Claude CLI 연동 (IPC)
- [x] 기본 대화 기능 (멀티턴)
- [x] 코드 컨텍스트 전달 (파일 첨부, 선택 영역)

### Secondary (Phase 2-4 - 고급 기능) ✅ 대부분 완료
- [x] 실시간 스트리밍, 마크다운 렌더링
- [x] 코드 블록 (Copy/Insert/Apply), Diff 뷰
- [x] 파일 변경 추적, 되돌리기
- [x] Rate limit 처리, AskUser 상호작용
- [x] 세션 관리, 대화 기록

### VS Code 확장 기능 (Claude CLI 독립적)
- [ ] 파일 탐색기 우클릭 연동
- [ ] 에디터 컨텍스트 메뉴
- [ ] 워크스페이스 파일 자동 인덱싱
- [ ] 실시간 문제(Problems) 패널 연동

---

## Tech Stack

| Category | Technology |
|----------|------------|
| Base | VS Code (Electron + Node.js) |
| Language | TypeScript |
| AI API | Anthropic Claude API |
| UI | VS Code Webview API |
| Build | Gulp, Webpack |

---

## Architecture

```
┌─────────────────────────────────────────────────┐
│                 VS Code Shell                   │
├─────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────────────────┐  │
│  │   Editor    │  │    Claude Chat Panel    │  │
│  │             │  │  ┌───────────────────┐  │  │
│  │             │  │  │  Message List     │  │  │
│  │             │  │  ├───────────────────┤  │  │
│  │             │  │  │  Input Area       │  │  │
│  │             │  │  └───────────────────┘  │  │
│  └─────────────┘  └─────────────────────────┘  │
├─────────────────────────────────────────────────┤
│              Claude Service Layer               │
│  ┌─────────────────────────────────────────┐   │
│  │  API Client  │  Context  │  History     │   │
│  └─────────────────────────────────────────┘   │
└─────────────────────────────────────────────────┘
```

---

## Key Files (예상)

```
src/
├── vs/workbench/contrib/claude/       # Claude 통합 메인
│   ├── browser/
│   │   ├── claudeChat.ts              # 채팅 패널
│   │   ├── claudeChatView.ts          # 뷰 컨트롤러
│   │   └── claudeChatWidget.ts        # UI 위젯
│   ├── common/
│   │   ├── claudeService.ts           # API 서비스
│   │   └── claudeTypes.ts             # 타입 정의
│   └── claude.contribution.ts         # 기여점 등록
```

---

## Quick Start

### Prerequisites
- Node.js 18+
- Python 3
- Git
- C++ Build Tools (Windows)

### Build
```bash
# 의존성 설치
npm install

# 컴파일
npm run compile

# 실행
./scripts/code.bat  # Windows
./scripts/code.sh   # Linux/Mac
```

### Development
```bash
# Watch 모드로 개발
npm run watch

# 테스트
npm test
```

---

## References

- [VS Code 소스 구조](https://github.com/microsoft/vscode/wiki/Source-Code-Organization)
- [VS Code API](https://code.visualstudio.com/api)
- [Anthropic API Docs](https://docs.anthropic.com/)
- [Claude Code](https://github.com/anthropics/claude-code)

---

## Links

- [Development Status](./_Dev/Status.md)
- [Specifications](./_Dev/Specs/)
- [AI Rules](./CLAUDE.md)

---

**Last Updated**: 2025-01-25
