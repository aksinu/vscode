# Bug Fix Team (버그 수정 팀)

> debugger + coder + typescript-expert 통합

## Mission
버그 분석, 컴파일 에러 수정, TODO 이슈 해결을 담당하는 팀.

## When to Use
- 컴파일 에러 수정
- 런타임 버그 진단 및 수정
- TODO.txt 이슈 해결
- 스택 트레이스 분석
- 리그레션 버그 수정

## Current Issues (TODO.txt)
1. Ask 기능 / autoAccept 동작 확인
2. 채팅창 우측 글씨 잘림
3. 말풍선 드래그 복사 불가 (리팩토링 후 리그레션)
4. FileChanges 미표시 문제
5. FileChanges apply 후 파일 리스트 유지

## Workflow

```
1. 에러 분석
   - 에러 메시지/스택 트레이스 파싱
   - 소스 파일 및 라인 번호 확인
   - 관련 코드 섹션 읽기

2. 원인 진단
   - 코드 흐름 추적 (Grep으로 호출 체인 파악)
   - 최근 변경사항 확인 (git log/diff)
   - 타입 불일치, null 참조, 타이밍 이슈 체크

3. 수정
   - 최소 변경으로 버그 수정
   - 타입 안정성 확보
   - 사이드 이펙트 확인

4. 검증
   - 컴파일 에러 없음 확인
   - 관련 코드 영향 범위 체크
```

## Common Error Patterns

### IPC Channel Errors
```
Error: Call not found: methodName
```
**원인**: app.ts 채널에 메서드 미등록
**수정**: `call()` switch에 case 추가

### Service Resolution Errors
```
Error: Unknown service: IMyService
```
**원인**: 서비스 미등록
**수정**: `registerSingleton()` in kent.contribution.ts

### Type Errors
```
Type 'X' is not assignable to type 'Y'
```
**원인**: 인터페이스 불일치, 타입 변경 후 미반영
**수정**: 타입 정의 확인 → 사용 코드 업데이트

### Unused Declarations
```
'X' is declared but its value is never read
```
**수정**: 제거 또는 `_` 접두사 또는 `void` 참조

### Unreachable Code
```
Unreachable code detected
```
**수정**: 도달 불가 코드 제거

## Debugging Tools
- VS Code DevTools: `Ctrl+Shift+I`
- Debug log: `%TEMP%/claude-cli-debug.log`
- Main process: 터미널 출력 확인

## Rules
- 수정은 최소 범위로
- 기존 동작을 변경하지 않는 방향
- 타입 안전성 항상 유지
- import 정리 후 미사용 제거
