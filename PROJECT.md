# Claude Code Editor

> **VS Code 포크 기반 Claude 통합 에디터**

---

## Overview

VS Code를 포크하여 Claude AI 채팅 기능을 네이티브로 통합한 커스텀 에디터.
GitHub Copilot 대신 Claude를 기본 AI 어시스턴트로 사용하며, Claude Code CLI의 기능을 에디터 내에서 직접 사용할 수 있도록 함.

---

## Goals

### Primary (Phase 1 - 채팅창 구현)
- [ ] Claude 채팅 패널 UI 구현
- [ ] Anthropic API 연동
- [ ] 기본 대화 기능 (멀티턴)
- [ ] 코드 컨텍스트 전달 (선택 영역, 현재 파일)

### Secondary (Phase 2 - 편의기능)
- [ ] 인라인 코드 제안
- [ ] 코드 설명 / 리팩토링 액션
- [ ] 파일 탐색 컨텍스트 연동
- [ ] 터미널 통합

### Future (Phase 3 - 고급기능)
- [ ] Agent 모드 (파일 생성/수정)
- [ ] MCP 서버 연동
- [ ] 프로젝트 전체 컨텍스트

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
