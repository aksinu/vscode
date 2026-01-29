# SPEC_006: Clipboard Enhancements

> **클립보드 붙여넣기 기능 개선**

---

## Overview

Claude 채팅 입력창의 클립보드 붙여넣기 기능을 개선합니다:
1. 이미지 붙여넣기 버그 수정 (텍스트 중복 삽입 방지)
2. VS Code 에디터에서 복사한 코드를 참조 형태로 표시

---

## Phase 1: 이미지 붙여넣기 버그 수정

### 문제
스크린샷을 Ctrl+V로 붙여넣으면:
- 이미지는 첨부파일로 정상 추가됨
- 하지만 "image.png" 텍스트도 입력창에 삽입됨

### 원인 분석
클립보드에 이미지 + 텍스트("image.png" 파일명)가 함께 있을 때:
- `handlePaste`에서 이미지 감지 후 `e.preventDefault()` 호출
- 하지만 Monaco 에디터가 이미 텍스트를 처리했거나, 이벤트 버블링으로 텍스트가 삽입됨

### 해결 방안
```typescript
// claudeChatView.ts - handlePaste
private async handlePaste(e: ClipboardEvent): Promise<void> {
    const clipboardData = e.clipboardData;
    if (!clipboardData) return;

    // 이미지 파일 찾기
    let imageFile: File | null = null;
    for (const item of clipboardData.items) {
        if (item.type.startsWith('image/')) {
            imageFile = item.getAsFile();
            break;
        }
    }

    // 이미지가 있으면 텍스트 삽입 차단
    if (imageFile) {
        e.preventDefault();
        e.stopPropagation();
        await this.attachmentManager.addImage(imageFile);
        return;  // 텍스트 처리 안 함
    }
    // 텍스트는 기본 동작 유지
}
```

### 추가 검토
- `InputEditorManager`의 paste 이벤트 핸들러 순서 확인
- Monaco 에디터의 기본 paste 동작과 충돌 여부 확인

---

## Phase 2: 코드 참조 붙여넣기 기능

### 요구사항
VS Code 에디터에서 코드 선택 후 Ctrl+C → 채팅 입력창에 Ctrl+V 시:
- **현재**: 원시 텍스트가 그대로 삽입됨
- **개선**: `📄 fileName.ts (L10-25)` 형태의 참조로 표시

### VS Code 클립보드 메타데이터

VS Code는 코드 복사 시 클립보드에 여러 MIME 타입 데이터 저장:
- `text/plain`: 선택된 텍스트
- `vscode-editor-data`: JSON 형태의 메타데이터

```typescript
// vscode-editor-data 구조 (예상)
interface VSCodeEditorClipboardData {
    version: number;
    isFromEmptySelection: boolean;
    multicursorText?: string[];
    mode?: string;
    // 소스 정보
    source?: {
        uri: string;        // 파일 URI
        startLine: number;  // 시작 줄
        endLine: number;    // 종료 줄
    };
}
```

### 타입 정의

```typescript
// claudeTypes.ts
export interface IClaudeCodeReference {
    /** 참조 유형 */
    type: 'code-reference';
    /** 파일 경로 */
    filePath: string;
    /** 파일 이름 */
    fileName: string;
    /** 시작 줄 번호 */
    startLine: number;
    /** 종료 줄 번호 */
    endLine: number;
    /** 코드 내용 */
    content: string;
    /** 언어 ID (syntax highlighting용) */
    languageId?: string;
}

// IClaudeAttachment 확장
export interface IClaudeAttachment {
    type: 'file' | 'image' | 'workspace' | 'code-reference';
    // ... 기존 필드
    codeReference?: IClaudeCodeReference;
}
```

### UI 표시

첨부파일 영역에 코드 참조 pill 표시:
```
┌──────────────────────────────────┐
│ 📄 claudeService.ts (L100-150)  ✕│
└──────────────────────────────────┘
```

- 클릭: 해당 파일/라인으로 이동
- ✕: 참조 제거
- 호버: 코드 미리보기 툴팁

### 구현 흐름

```
1. handlePaste() 호출
   ↓
2. clipboardData에서 'vscode-editor-data' MIME 확인
   ↓
3. 메타데이터 파싱 (파일 경로, 라인 범위)
   ↓
4. IClaudeCodeReference 객체 생성
   ↓
5. attachmentManager.addCodeReference(ref) 호출
   ↓
6. UI에 코드 참조 pill 렌더링
   ↓
7. 프롬프트 빌드 시 코드 내용 포함
```

### ContextBuilder 처리

```typescript
// claudeContextBuilder.ts
private formatCodeReference(ref: IClaudeCodeReference): string {
    return `
## Code from ${ref.fileName} (Lines ${ref.startLine}-${ref.endLine})

\`\`\`${ref.languageId || ''}
${ref.content}
\`\`\`
`;
}
```

---

## 파일 변경 목록

### Phase 1
| 파일 | 변경 내용 |
|------|----------|
| `claudeChatView.ts` | `handlePaste()` 이미지 처리 개선 |
| `claudeInputEditor.ts` | paste 이벤트 처리 순서 확인 |

### Phase 2
| 파일 | 변경 내용 |
|------|----------|
| `claudeTypes.ts` | `IClaudeCodeReference` 타입 추가 |
| `claudeChatView.ts` | `handlePaste()` 코드 참조 감지 추가 |
| `claudeAttachmentManager.ts` | `addCodeReference()` 메서드 추가 |
| `claudeContextBuilder.ts` | 코드 참조 포맷팅 추가 |
| `claude.css` | 코드 참조 pill 스타일 |

---

## 테스트 케이스

### Phase 1
- [ ] 스크린샷 Ctrl+V → 이미지만 첨부, 텍스트 없음
- [ ] 클립보드 이미지 Ctrl+V → 이미지만 첨부
- [ ] 일반 텍스트 Ctrl+V → 텍스트 정상 삽입

### Phase 2
- [ ] VS Code 에디터에서 코드 복사 → 참조로 표시
- [ ] 참조 pill 클릭 → 해당 파일/라인 열기
- [ ] 참조 삭제 후 다시 붙여넣기 → 정상 동작
- [ ] Ctrl+Shift+V (플레인 텍스트) → 원시 텍스트 삽입
- [ ] 외부 앱에서 복사한 텍스트 → 일반 텍스트로 처리

---

## 우선순위

1. **P0**: Phase 1 - 이미지 버그 수정 (현재 사용성 저해)
2. **P1**: Phase 2 - 코드 참조 기능 (UX 개선)

---

## 참고

- Monaco Editor Clipboard API
- VS Code Clipboard implementation: `src/vs/editor/contrib/clipboard/`
- DataTransfer API: https://developer.mozilla.org/en-US/docs/Web/API/DataTransfer
