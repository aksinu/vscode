# SPEC_006: Max Budget & Max Turns 글로벌 설정 패널 추가

> **상태**: [x] Done
> **우선순위**: P1 High
> **날짜**: 2026-02-12

---

## 목표

`--max-budget-usd`와 `--max-turns` 설정을 글로벌 설정 패널 UI에 추가하여,
사용자가 VS Code 설정 대신 직관적인 UI로 제어할 수 있게 한다.

---

## 현재 상태 (이미 구현된 부분)

### 1. VS Code Configuration 등록 ✅
- `kent.contribution.ts` (130~144줄)
- `claude.maxTurns`: default 50, min 1, max 1000
- `claude.maxBudgetUsd`: default 5, min 0.01

### 2. Local Config 인터페이스 ✅
- `claudeLocalConfig.ts` — `IClaudeLocalConfig`에 `maxTurns?`, `maxBudgetUsd?` 정의됨

### 3. CLI 전달 ✅
- `chatManager.ts` — `buildCLIOptions()`에서 로컬설정 > VS Code 설정 우선순위로 `maxTurns`, `maxBudgetUsd` 전달

### 4. 글로벌 설정 패널 UI ❌ (미구현)
- `claudeSettingsPanel.ts` — 현재 Model, Auto Accept, Max Sessions만 표시

---

## 구현 계획

### 변경 파일: 1개

**`src/vs/workbench/contrib/kent/browser/views/settings/claudeSettingsPanel.ts`**

### 변경 내용

#### Max Turns 필드 추가
- 위치: Max Sessions 아래
- 타입: `createNumberSetting()` 재사용
- 라벨: "Max Turns"
- 설명: "Maximum conversation turns per session (CLI --max-turns)"
- 기본값: **1000** (최대값으로 설정 = 사실상 제한 없음)
- 범위: min 1, max 1000
- 저장: `this.currentConfig.maxTurns`

#### Max Budget (USD) 필드 추가
- 위치: Max Turns 아래
- 타입: `createNumberSetting()` 재사용
- 라벨: "Max Budget (USD)"
- 설명: "Maximum budget in USD per session (CLI --max-budget-usd)"
- 기본값: **5** (CLI 기본값)
- 범위: min 0.01, max 100 (step 0.01)
- 저장: `this.currentConfig.maxBudgetUsd`

### 저장 흐름
```
Save 클릭
  → saveConfig()
  → .vscode/claude.local.json에 maxTurns, maxBudgetUsd 포함 저장
  → reloadLocalConfig()
  → 다음 CLI 호출 시 chatManager.buildCLIOptions()에서 반영
```

### UI 레이아웃 (변경 후)
```
┌─────────────────────────────────────┐
│  Claude Global Settings         [×] │
├─────────────────────────────────────┤
│  Model          [dropdown/custom]   │
│  Auto Accept    [toggle]            │
│  Max Sessions   [number: 10]        │
│  Max Turns      [number: 1000]  ← NEW
│  Max Budget     [number: 5.00]  ← NEW
├─────────────────────────────────────┤
│              [Cancel] [Save]        │
└─────────────────────────────────────┘
```

---

## 주의사항

1. **디폴트를 최대값으로** — maxTurns 1000, maxBudgetUsd는 CLI 기본값 5
2. **step 속성** — maxBudgetUsd는 소수점 입력이 필요하므로 `step="0.01"` 설정
3. **기존 패턴 준수** — `createNumberSetting()` 메서드 그대로 재사용
4. **저장 위치** — `.vscode/claude.local.json` (기존 패턴 유지)
5. **우선순위 체계 유지** — localConfig > VS Code settings > 기본값

---

## createNumberSetting 수정 필요

현재 `createNumberSetting()`은 정수만 지원 (`parseInt`).
`maxBudgetUsd`는 소수점이 필요하므로 `step` 옵션과 `parseFloat` 지원 추가.

```typescript
// 기존
input.type = 'number';
input.min = options.min.toString();
input.max = options.max.toString();
// parseInt만 사용

// 변경
input.type = 'number';
input.min = options.min.toString();
input.max = options.max.toString();
if (options.step) input.step = options.step.toString();
// options.step이 있으면 parseFloat, 없으면 parseInt
```

---

## 구현 난이도

**Low** — 기존 패턴(`createNumberSetting`) 재사용, 설정 패널에 2개 필드 추가만 필요
