# Bug Tracker

> 버그 인덱스 — 상세 내용은 개별 파일 참조

---

## 작성 규칙

| 항목 | 설명 |
|------|------|
| **파일명** | `BUG_[모듈]_[간단설명].md` |
| **상태** | `Open` `In Progress` `Fixed` `Closed` |
| **우선순위** | `P0 Critical` `P1 High` `P2 Medium` `P3 Low` |
| **상세 문서** | 증상, 원인 분석, 수정 내역, 재현 방법 포함 |

---

## Active Bugs

| # | 버그 | 상태 | 우선순위 | 파일 |
|---|------|------|----------|------|
| 1 | AskUser 선택지 더블 Submit / UI 재출현 | Fixed | P1 High | [BUG_AskUser_DoubleSubmit.md](BUG_AskUser_DoubleSubmit.md) |
| 2 | CLI exit code 1 에러 (Windows shell) | Open | P2 Medium | — |
| 3 | Pending 메시지 큐 저장소 불일치 (edit/X 미동작, 삭제 메시지 재등장) | Fixed | P1 High | [BUG_Queue_Pending_Inconsistency.md](BUG_Queue_Pending_Inconsistency.md) |
| 4 | AskUser Submit 후 진행 안 됨 (Resume 타이밍 Race) | Fixed | P1 High | [BUG_AskUser_ResumeTimingRace.md](BUG_AskUser_ResumeTimingRace.md) |

---

## Closed Bugs

| # | 버그 | 해결일 | 파일 |
|---|------|--------|------|
| — | AskUser 선택지 클릭 안됨 + Submit 사라짐 | Phase 8 | (Status.md에 기록) |

---

## 새 버그 등록 방법

1. `_Dev/Bugs/BUG_[모듈]_[설명].md` 파일 생성
2. 템플릿:
   ```markdown
   # BUG: [제목]
   ## 상태: Open | 우선순위: P?
   ## 증상
   ## 에러 로그
   ## 핵심 파일
   ## 원인 분석
   ## 수정 내역
   ## 재현 방법
   ```
3. 이 README.md 인덱스 테이블에 추가
4. 수정 완료 시 상태 업데이트 → Closed로 이동
