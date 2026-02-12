# Bug Fix Team (버그 수정 팀)

> debugger + coder 조합. 버그 분석 및 수정 담당.

## When to Use
- 컴파일 에러 수정
- 런타임 버그 진단 및 수정
- 스택 트레이스 분석
- 리그레션 버그 수정

## Workflow
```
1. 에러 분석
   - 에러 메시지/스택 트레이스 파싱
   - 소스 파일 및 라인 번호 확인
   - 관련 코드 섹션 읽기

2. 원인 진단
   - Grep으로 호출 체인 파악
   - 최근 변경사항 확인 (git log/diff)
   - 타입 불일치, null 참조, 타이밍 이슈 체크

3. 수정
   - 최소 변경으로 버그 수정
   - 타입 안전성 확보
   - 사이드 이펙트 확인

4. 검증
   - 컴파일 에러 없음 확인
   - 관련 코드 영향 범위 체크
```

## Common Error Patterns

| 에러 | 원인 | 수정 |
|------|------|------|
| `Call not found: methodName` | IPC 메서드 미등록 | `call()` switch에 case 추가 |
| `Unknown service: IMyService` | 서비스 미등록 | `registerSingleton()` 추가 |
| `Type 'X' not assignable to 'Y'` | 타입 불일치 | 타입 정의 확인 → 업데이트 |
| `is declared but never read` | 미사용 선언 | 제거 또는 `_` 접두사 |

## Debugging Tools
- VS Code DevTools: `Ctrl+Shift+I`
- Debug log: `%TEMP%/claude-cli-debug.log`

## Rules
- 수정은 최소 범위
- 기존 동작 변경 금지
- 타입 안전성 항상 유지
- import 정리 후 미사용 제거
