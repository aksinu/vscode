# Development Guides

> **VS Code 포크 개발 가이드**

---

## Guide Index

| # | Guide | Description |
|---|-------|-------------|
| 01 | [VSCode Structure](./01_VSCode_Structure.md) | VS Code 소스 구조 이해 |
| 02 | [Contribution Pattern](./02_Contribution_Pattern.md) | 모듈 기여 패턴 |
| 03 | [Claude Integration](./03_Claude_Integration.md) | Claude 통합 설계 |

---

## Quick Reference

### VS Code 개발 흐름
```
1. src/vs/workbench/contrib/{module}/ 에 모듈 생성
2. *.contribution.ts 에서 등록
3. workbench.common.main.ts 또는 workbench.desktop.main.ts 에 import 추가
```

### 폴더 구조 규칙
```
{module}/
├── browser/           # UI, 뷰, 렌더러 코드
├── common/            # 공통 타입, 인터페이스, 유틸
├── electron-main/     # 메인 프로세스 코드 (필요시)
└── {module}.contribution.ts  # 기여점 등록
```

---

## Core Principles

### 1. VS Code 패턴 준수
- 기존 모듈 구조와 패턴을 따름
- 의존성 주입(DI) 사용
- 서비스 인터페이스 정의

### 2. 레이어 분리
- `common/` - 플랫폼 독립적 코드
- `browser/` - 웹/렌더러 프로세스
- `node/` - Node.js 전용 코드
- `electron-main/` - 메인 프로세스

### 3. 기존 컴포넌트 재사용
- Tree, List, QuickInput 등 기존 UI 활용
- 서비스 재사용 우선

---

**프로젝트별 상세 설계는 `_Dev/Specs/`에 작성**
