# Specifications

> **Claude 통합 설계 및 명세 문서**

---

## Spec Index

| Spec | Description | Status |
|------|-------------|--------|
| [SPEC_001_ChatArchitecture](./SPEC_001_ChatArchitecture.md) | VS Code Chat 구조 분석 | ✅ Done |
| [SPEC_002_ClaudeFeatures](./SPEC_002_ClaudeFeatures.md) | Claude 기능 명세 | ✅ Done |

---

## Planned Specs

### Phase 1 - 채팅창 구현
- [x] SPEC_001 - VS Code Chat 아키텍처 분석
- [x] SPEC_002 - Claude 기능 명세 (Cursor 참고)
- [ ] SPEC_003 - Claude 모듈 상세 설계

### Phase 2 - 편의기능
- [ ] SPEC_010 - 인라인 코드 액션
- [ ] SPEC_011 - 코드 적용 (Apply) 기능

---

## Key Decisions

| Date | Decision | Reason |
|------|----------|--------|
| 2025-01-25 | 독립 모듈 방식 | Copilot 분리, 완전 통제 |
| 2025-01-25 | Phase 1은 Ask 모드만 | 빠른 MVP |

---

## Spec Template

```markdown
# SPEC_XXX_Title

> **한 줄 설명**

## Overview
## Requirements
## Design
## Implementation Notes
## References

---
Last Updated: YYYY-MM-DD
```

---

## Status Legend

| Icon | Status |
|------|--------|
| 📝 | Draft |
| 🔄 | Review |
| ✅ | Done |
| ❌ | Deprecated |
