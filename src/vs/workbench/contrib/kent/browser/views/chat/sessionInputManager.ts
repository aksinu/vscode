/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../../../base/common/lifecycle.js';
import { IClaudeAttachment } from '../../../common/types/claudeTypes.js';
import { InputEditorManager, IInputEditorCallbacks } from './claudeInputEditor.js';
import { AttachmentManager } from './claudeAttachmentManager.js';
import { IPosition } from '../../../../../../editor/common/core/position.js';

/**
 * 세션별 입력 상태
 */
interface IInputSessionState {
	/** 미완성 입력 텍스트 */
	text: string;
	/** 첨부파일들 */
	attachments: IClaudeAttachment[];
	/** 커서 위치 */
	cursorPosition?: IPosition;
}

/**
 * 프롬프트 히스토리 상수
 */
const PROMPT_HISTORY_MAX_SIZE = 50;

/**
 * SessionInputManager 콜백 인터페이스
 */
export interface ISessionInputCallbacks extends IInputEditorCallbacks {
	/** 세션 상태 변경 콜백 */
	onSessionStateChanged?(sessionId: string, hasContent: boolean): void;
}

/**
 * 세션별 입력 상태 관리자
 *
 * 각 Claude 세션마다 독립적인 입력 상태(텍스트, 첨부파일, 커서 위치)를 유지하고,
 * 세션 전환 시 자동으로 상태를 저장/복원합니다.
 */
export class SessionInputManager extends Disposable {

	/** 세션별 입력 상태 저장소 */
	private readonly sessionStates = new Map<string, IInputSessionState>();

	/** 현재 활성 세션 ID */
	private currentSessionId: string | undefined;

	/** 실제 입력 에디터 매니저 */
	private readonly inputEditor: InputEditorManager;

	/** 첨부파일 매니저 */
	private readonly attachmentManager: AttachmentManager;

	/** 프롬프트 히스토리 (최근 전송 메시지) */
	private readonly promptHistory: string[] = [];

	/** 히스토리 탐색 인덱스 (-1 = 현재 입력) */
	private historyIndex: number = -1;

	/** 히스토리 탐색 시작 시 현재 입력 내용 임시 저장 */
	private historyDraftText: string = '';

	constructor(
		inputEditor: InputEditorManager,
		attachmentManager: AttachmentManager,
		private readonly callbacks: ISessionInputCallbacks
	) {
		super();

		this.inputEditor = inputEditor;
		this.attachmentManager = attachmentManager;

		this.setupEventHandlers();
	}

	/**
	 * 이벤트 핸들러 설정
	 */
	private setupEventHandlers(): void {
		// 입력 내용 변경 시 현재 세션 상태 업데이트
		const originalContentChange = this.callbacks.onContentChange;
		this.callbacks.onContentChange = () => {
			this.saveCurrentSessionState();
			if (originalContentChange) {
				originalContentChange();
			}
		};

		// 첨부파일 변경 시 현재 세션 상태 업데이트
		// AttachmentManager의 이벤트를 감지하여 상태 저장
		// (실제 구현에서는 AttachmentManager에 콜백 추가 필요)
	}

	/**
	 * 세션 전환
	 * 현재 상태를 저장하고 새 세션 상태를 복원합니다.
	 */
	public async switchToSession(sessionId: string): Promise<void> {
		// 현재 세션 상태 저장
		this.saveCurrentSessionState();

		// 새 세션으로 전환
		const previousSessionId = this.currentSessionId;
		this.currentSessionId = sessionId;

		// 새 세션 상태 복원
		await this.restoreSessionState(sessionId);

		// 상태 변경 알림
		if (previousSessionId !== sessionId) {
			this.notifySessionStateChange();
		}
	}

	/**
	 * 현재 세션의 입력 상태 저장
	 */
	public saveCurrentSessionState(): void {
		if (!this.currentSessionId) {
			return;
		}

		const text = this.inputEditor.getValue();
		const attachments = [...this.attachmentManager.attachments];
		const cursorPosition = this.inputEditor.editorInstance.getPosition();

		const state: IInputSessionState = {
			text,
			attachments,
			cursorPosition: cursorPosition || undefined
		};

		this.sessionStates.set(this.currentSessionId, state);
	}

	/**
	 * 지정된 세션의 입력 상태 복원
	 */
	private async restoreSessionState(sessionId: string): Promise<void> {
		const state = this.sessionStates.get(sessionId);

		if (state) {
			// 텍스트 복원
			this.inputEditor.setValue(state.text);

			// 첨부파일 복원
			this.attachmentManager.clear();
			for (const attachment of state.attachments) {
				if (attachment.uri) {
					await this.attachmentManager.addFile(attachment.uri);
				}
			}

			// 커서 위치 복원
			if (state.cursorPosition) {
				this.inputEditor.editorInstance.setPosition(state.cursorPosition);
			}
		} else {
			// 새 세션이면 빈 상태로 초기화
			this.inputEditor.setValue('');
			this.attachmentManager.clear();
		}
	}

	/**
	 * 현재 세션 상태 초기화 (메시지 전송 후 호출)
	 */
	public clearCurrentSessionState(): void {
		if (!this.currentSessionId) {
			return;
		}

		// 전송된 내용을 히스토리에 추가
		const text = this.inputEditor.getValue().trim();
		if (text) {
			this.addToHistory(text);
		}

		// 실제 UI 초기화
		this.inputEditor.setValue('');
		this.attachmentManager.clear();

		// 저장된 상태도 초기화
		const emptyState: IInputSessionState = {
			text: '',
			attachments: [],
			cursorPosition: undefined
		};

		this.sessionStates.set(this.currentSessionId, emptyState);
		this.notifySessionStateChange();
	}

	/**
	 * 세션 삭제 시 상태 정리
	 */
	public removeSession(sessionId: string): void {
		this.sessionStates.delete(sessionId);

		// 현재 세션이 삭제되면 currentSessionId 초기화
		if (this.currentSessionId === sessionId) {
			this.currentSessionId = undefined;
		}
	}

	/**
	 * 세션에 미완성 내용이 있는지 확인
	 */
	public hasContent(sessionId: string): boolean {
		const state = this.sessionStates.get(sessionId);
		if (!state) {
			return false;
		}

		return state.text.trim().length > 0 || state.attachments.length > 0;
	}

	/**
	 * 현재 세션에 미완성 내용이 있는지 확인
	 */
	public hasCurrentContent(): boolean {
		if (!this.currentSessionId) {
			return false;
		}
		return this.hasContent(this.currentSessionId);
	}

	/**
	 * 상태 변경 알림
	 */
	private notifySessionStateChange(): void {
		if (this.currentSessionId && this.callbacks.onSessionStateChanged) {
			const hasContent = this.hasCurrentContent();
			this.callbacks.onSessionStateChanged(this.currentSessionId, hasContent);
		}
	}

	/**
	 * 현재 활성 세션 ID 반환
	 */
	public getCurrentSessionId(): string | undefined {
		return this.currentSessionId;
	}

	/**
	 * 입력 에디터 참조 반환 (기존 API 호환성)
	 */
	public get editorManager(): InputEditorManager {
		return this.inputEditor;
	}

	/**
	 * 첨부파일 매니저 참조 반환 (기존 API 호환성)
	 */
	public get attachments(): AttachmentManager {
		return this.attachmentManager;
	}

	/**
	 * 포커스 설정
	 */
	public focus(): void {
		this.inputEditor.focus();
	}

	/**
	 * 입력값 반환 (현재 에디터의 값)
	 */
	public getValue(): string {
		return this.inputEditor.getValue();
	}

	/**
	 * 입력값 설정 (현재 에디터에 설정 후 상태 저장)
	 */
	public setValue(value: string): void {
		this.inputEditor.setValue(value);
		this.saveCurrentSessionState();
	}

	/**
	 * 커맨드 프롬프트 설정
	 */
	public setCommandPrompt(prompt: string): void {
		this.inputEditor.setCommandPrompt(prompt);
		this.saveCurrentSessionState();
	}

	/**
	 * 레이아웃 업데이트
	 */
	public layout(): void {
		this.inputEditor.layout();
	}

	// ========== 프롬프트 히스토리 ==========

	/**
	 * 히스토리에 추가
	 */
	private addToHistory(text: string): void {
		// 중복 방지 (마지막 항목과 같으면 무시)
		if (this.promptHistory.length > 0 && this.promptHistory[this.promptHistory.length - 1] === text) {
			this.resetHistoryNavigation();
			return;
		}

		this.promptHistory.push(text);

		// 최대 크기 제한
		if (this.promptHistory.length > PROMPT_HISTORY_MAX_SIZE) {
			this.promptHistory.shift();
		}

		this.resetHistoryNavigation();
	}

	/**
	 * 히스토리 탐색 초기화
	 */
	private resetHistoryNavigation(): void {
		this.historyIndex = -1;
		this.historyDraftText = '';
	}

	/**
	 * 히스토리 위로 탐색 (↑ 키)
	 * @returns 탐색되었으면 true
	 */
	public navigateHistoryUp(): boolean {
		if (this.promptHistory.length === 0) {
			return false;
		}

		// 첫 번째 탐색 시 현재 입력 내용 저장
		if (this.historyIndex === -1) {
			this.historyDraftText = this.inputEditor.getValue();
		}

		const nextIndex = this.historyIndex === -1
			? this.promptHistory.length - 1
			: Math.max(0, this.historyIndex - 1);

		if (nextIndex === this.historyIndex) {
			return false; // 이미 가장 오래된 항목
		}

		this.historyIndex = nextIndex;
		this.inputEditor.setValue(this.promptHistory[this.historyIndex]);
		this.moveCursorToEnd();
		return true;
	}

	/**
	 * 히스토리 아래로 탐색 (↓ 키)
	 * @returns 탐색되었으면 true
	 */
	public navigateHistoryDown(): boolean {
		if (this.historyIndex === -1) {
			return false; // 이미 현재 입력
		}

		if (this.historyIndex >= this.promptHistory.length - 1) {
			// 현재 입력으로 복원
			this.historyIndex = -1;
			this.inputEditor.setValue(this.historyDraftText);
			this.moveCursorToEnd();
			return true;
		}

		this.historyIndex++;
		this.inputEditor.setValue(this.promptHistory[this.historyIndex]);
		this.moveCursorToEnd();
		return true;
	}

	/**
	 * 커서를 입력 끝으로 이동
	 */
	private moveCursorToEnd(): void {
		const model = this.inputEditor.editorInstance.getModel();
		if (model) {
			const lastLine = model.getLineCount();
			const lastColumn = model.getLineMaxColumn(lastLine);
			this.inputEditor.editorInstance.setPosition({ lineNumber: lastLine, column: lastColumn });
		}
	}

	override dispose(): void {
		// 마지막으로 현재 상태 저장
		this.saveCurrentSessionState();
		super.dispose();
	}
}