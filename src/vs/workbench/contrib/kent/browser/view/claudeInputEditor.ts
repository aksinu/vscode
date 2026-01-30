/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, append, addDisposableListener, EventType } from '../../../../../base/browser/dom.js';
import { Disposable, IDisposable } from '../../../../../base/common/lifecycle.js';
import { ICodeEditor } from '../../../../../editor/browser/editorBrowser.js';
import { CodeEditorWidget } from '../../../../../editor/browser/widget/codeEditor/codeEditorWidget.js';
import { IEditorConstructionOptions } from '../../../../../editor/browser/config/editorConfiguration.js';
import { EditorExtensionsRegistry } from '../../../../../editor/browser/editorExtensions.js';
import { IModelService } from '../../../../../editor/common/services/model.js';
import { ILanguageService } from '../../../../../editor/common/languages/language.js';
import { localize } from '../../../../../nls.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { IInstantiationService } from '../../../../../platform/instantiation/common/instantiation.js';
import { URI } from '../../../../../base/common/uri.js';

/**
 * InputEditorManager 콜백 인터페이스
 */
export interface IInputEditorCallbacks {
	onSubmit(): void;
	onFocusChange(focused: boolean): void;
	onContentChange(): void;
	onPaste(e: ClipboardEvent): void;
	onKeyDown(keyCode: number): boolean;
	registerDisposable<T extends IDisposable>(disposable: T): T;
}

// 입력 에디터 상수
const INPUT_EDITOR_MIN_HEIGHT = 68; // 최소 높이 (2줄 + 패딩)
const INPUT_EDITOR_MAX_HEIGHT = 200; // 최대 높이 (약 8줄)

/**
 * 입력 에디터 매니저
 * Claude 채팅 입력창 생성 및 관리
 */
export class InputEditorManager extends Disposable {

	private readonly editor: ICodeEditor;
	private readonly placeholder: HTMLElement;
	private readonly editorWrapper: HTMLElement;
	private readonly editorContainer: HTMLElement;
	private inputEditorHeight: number = INPUT_EDITOR_MIN_HEIGHT;
	private cachedWidth: number = 0;

	constructor(
		container: HTMLElement,
		private readonly instantiationService: IInstantiationService,
		private readonly modelService: IModelService,
		private readonly languageService: ILanguageService,
		private readonly configurationService: IConfigurationService,
		private readonly callbacks: IInputEditorCallbacks
	) {
		super();

		// 에디터 영역
		this.editorWrapper = append(container, $('.claude-input-editor-wrapper'));
		this.editorContainer = append(this.editorWrapper, $('.claude-input-editor'));

		// 플레이스홀더
		this.placeholder = append(this.editorWrapper, $('.claude-input-placeholder'));
		this.placeholder.textContent = localize('claudeInputPlaceholder', "Ask Claude anything... (Enter to send, Shift+Enter for new line)");

		// 에디터 옵션
		const editorOptions: IEditorConstructionOptions = {
			lineNumbers: 'off',
			glyphMargin: false,
			lineDecorationsWidth: 0,
			lineNumbersMinChars: 0,
			folding: false,
			minimap: { enabled: false },
			scrollbar: {
				vertical: 'hidden',
				horizontal: 'hidden',
				handleMouseWheel: true,
				alwaysConsumeMouseWheel: false,
				useShadows: false
			},
			overviewRulerLanes: 0,
			overviewRulerBorder: false,
			hideCursorInOverviewRuler: true,
			renderLineHighlight: 'none',
			wordWrap: 'on',
			wrappingStrategy: 'advanced',
			scrollBeyondLastLine: false,
			automaticLayout: false, // 수동으로 레이아웃 관리
			padding: { top: 12, bottom: 12 },
			lineHeight: 20,
			fontSize: 13,
			fontFamily: this.configurationService.getValue<string>('editor.fontFamily'),
			ariaLabel: localize('claudeInputAriaLabel', "Claude chat input")
		};

		// 에디터 위젯 생성
		const codeEditorWidgetOptions = {
			contributions: EditorExtensionsRegistry.getSomeEditorContributions([
				'editor.contrib.bracketMatching',
				'editor.contrib.wordHighlighter'
			])
		};

		this.editor = this._register(this.instantiationService.createInstance(
			CodeEditorWidget,
			this.editorContainer,
			editorOptions,
			codeEditorWidgetOptions
		));

		// 빈 모델 설정
		const model = this.modelService.createModel('', this.languageService.createById('plaintext'), URI.parse('claude-input://input'));
		this.editor.setModel(model);

		// 이벤트 설정
		this.setupEvents();

		// 초기 레이아웃
		this.updateEditorHeight();
	}

	/**
	 * 에디터 인스턴스 반환
	 */
	get editorInstance(): ICodeEditor {
		return this.editor;
	}

	/**
	 * 현재 입력값 반환
	 */
	getValue(): string {
		return this.editor.getValue();
	}

	/**
	 * 입력값 설정
	 */
	setValue(value: string): void {
		this.editor.setValue(value);
	}

	/**
	 * 에디터 포커스
	 */
	focus(): void {
		this.editor.focus();
	}

	/**
	 * 커맨드 프롬프트 설정
	 */
	setCommandPrompt(prompt: string): void {
		const model = this.editor.getModel();
		if (!model) {
			return;
		}

		model.setValue(prompt + '\n');

		const lineCount = model.getLineCount();
		const lastLineLength = model.getLineLength(lineCount);
		this.editor.setPosition({ lineNumber: lineCount, column: lastLineLength + 1 });
		this.editor.focus();
	}

	/**
	 * 에디터 레이아웃 업데이트
	 */
	layout(): void {
		const rect = this.editorWrapper.getBoundingClientRect();
		if (rect.width > 0) {
			this.cachedWidth = rect.width;
			this.updateEditorLayout();
		}
	}

	/**
	 * 에디터 높이 업데이트 (컨텐츠 기반)
	 */
	private updateEditorHeight(): void {
		const contentHeight = this.editor.getContentHeight();
		const newHeight = Math.max(INPUT_EDITOR_MIN_HEIGHT, Math.min(contentHeight, INPUT_EDITOR_MAX_HEIGHT));

		if (this.inputEditorHeight !== newHeight) {
			this.inputEditorHeight = newHeight;
			this.editorContainer.style.height = `${newHeight}px`;
			this.updateEditorLayout();
		}
	}

	/**
	 * 에디터 레이아웃 적용
	 */
	private updateEditorLayout(): void {
		if (this.cachedWidth > 0) {
			this.editor.layout({ width: this.cachedWidth, height: this.inputEditorHeight });
		}
	}

	// ========== Private Methods ==========

	private setupEvents(): void {
		// 플레이스홀더 표시/숨김
		const updatePlaceholder = () => {
			const hasText = this.editor.getValue().length > 0;
			this.placeholder.style.display = hasText ? 'none' : 'block';
		};

		this._register(this.editor.onDidChangeModelContent(() => {
			updatePlaceholder();
			this.callbacks.onContentChange();
		}));
		updatePlaceholder();

		// 컨텐츠 높이 변경 시 에디터 높이 자동 조절
		this._register(this.editor.onDidContentSizeChange(e => {
			if (e.contentHeightChanged) {
				this.updateEditorHeight();
			}
		}));

		// 포커스 이벤트
		this._register(this.editor.onDidFocusEditorText(() => {
			this.callbacks.onFocusChange(true);
			this.editorWrapper.parentElement?.classList.add('focused');
		}));

		this._register(this.editor.onDidBlurEditorText(() => {
			this.callbacks.onFocusChange(false);
			this.editorWrapper.parentElement?.classList.remove('focused');
		}));

		// 클립보드 붙여넣기 이벤트 (이미지 지원)
		// capture: true로 Monaco 에디터보다 먼저 이벤트를 처리
		this.callbacks.registerDisposable(addDisposableListener(this.editorContainer, EventType.PASTE, (e: ClipboardEvent) => {
			this.callbacks.onPaste(e);
		}, true /* useCapture */));

		// 키보드 이벤트 처리
		this._register(this.editor.onKeyDown(e => {
			// 외부 키보드 핸들러 (autocomplete 등)
			if (this.callbacks.onKeyDown(e.keyCode)) {
				e.preventDefault();
				e.stopPropagation();
				return;
			}

			// Enter 키 처리 (Shift+Enter는 줄바꿈)
			if (e.keyCode === 3 /* Enter */ && !e.shiftKey && !e.ctrlKey && !e.altKey) {
				e.preventDefault();
				e.stopPropagation();
				this.callbacks.onSubmit();
			}
		}));
	}
}
