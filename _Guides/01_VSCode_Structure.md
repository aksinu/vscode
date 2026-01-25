# VS Code Source Structure

> **VS Code 소스 코드 구조 가이드**

---

## Top-Level Structure

```
src/
├── vs/
│   ├── base/              # 기본 유틸리티, UI 컴포넌트
│   ├── platform/          # 플랫폼 서비스 (파일, 설정 등)
│   ├── editor/            # 모나코 에디터 코어
│   ├── workbench/         # 워크벤치 (메인 UI)
│   └── code/              # Electron 앱 진입점
```

---

## Workbench Structure

```
src/vs/workbench/
├── browser/               # 브라우저/렌더러 진입점
├── common/                # 공통 타입, 인터페이스
├── contrib/               # 기여 모듈들 ★ (우리가 작업할 곳)
│   ├── chat/              # 기존 Chat (Copilot)
│   ├── terminal/          # 터미널
│   ├── search/            # 검색
│   └── ...
├── services/              # 워크벤치 서비스
└── workbench.common.main.ts  # 모듈 등록
```

---

## Key Directories

### `src/vs/base/`
재사용 가능한 기본 컴포넌트
```
base/
├── browser/              # DOM, CSS, 브라우저 유틸
│   └── ui/               # 기본 UI 위젯
├── common/               # 순수 TypeScript 유틸
└── parts/                # 복합 UI 컴포넌트
    ├── tree/             # 트리 뷰
    └── quickinput/       # 퀵 인풋
```

### `src/vs/platform/`
플랫폼 서비스 (DI로 주입)
```
platform/
├── configuration/        # 설정 서비스
├── files/                # 파일 시스템
├── storage/              # 스토리지
└── instantiation/        # DI 컨테이너
```

### `src/vs/workbench/contrib/`
기능 모듈들 (우리가 추가할 곳)
```
contrib/
├── chat/                 # 참고: 기존 Chat 구현
├── inlineChat/           # 참고: 인라인 채팅
├── terminal/             # 참고: 패널 통합
└── claude/               # 추가 예정: Claude 모듈
```

---

## Module Registration

### 1. Contribution 파일 생성
```typescript
// src/vs/workbench/contrib/claude/browser/claude.contribution.ts

import { Registry } from 'vs/platform/registry/common/platform';
import { registerSingleton } from 'vs/platform/instantiation/common/extensions';

// 서비스 등록
registerSingleton(IClaudeService, ClaudeService, InstantiationType.Delayed);

// 뷰 등록
Registry.as<IViewsRegistry>(ViewExtensions.ViewsRegistry).registerViews(...);
```

### 2. Main 파일에 Import 추가
```typescript
// src/vs/workbench/workbench.common.main.ts
import 'vs/workbench/contrib/claude/browser/claude.contribution';
```

---

## Layer Rules

| Layer | 위치 | 용도 | 의존 가능 |
|-------|------|------|----------|
| base | `vs/base/` | 기본 유틸 | 없음 |
| platform | `vs/platform/` | 플랫폼 서비스 | base |
| editor | `vs/editor/` | 에디터 코어 | base, platform |
| workbench | `vs/workbench/` | 워크벤치 UI | 모두 |

---

## Useful Commands

```bash
# 소스 빌드
npm run compile

# Watch 모드
npm run watch

# 개발 버전 실행
./scripts/code.bat

# 특정 모듈만 테스트
npm test -- --grep "Claude"
```

---

## References

- [VS Code Wiki - Source Organization](https://github.com/microsoft/vscode/wiki/Source-Code-Organization)
- [Contributing Guide](https://github.com/microsoft/vscode/blob/main/CONTRIBUTING.md)
