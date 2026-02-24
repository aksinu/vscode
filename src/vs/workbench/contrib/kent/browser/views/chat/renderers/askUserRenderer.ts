/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, append } from '../../../../../../../base/browser/dom.js';
import { DisposableStore } from '../../../../../../../base/common/lifecycle.js';
import { localize } from '../../../../../../../nls.js';
import { IClaudeAskUserRequest } from '../../../../common/types/claudeTypes.js';

/**
 * AskUser 렌더링 콜백
 */
export interface IAskUserRendererCallbacks {
	readonly onRespondToAskUser?: (responses: string[], askRequest?: IClaudeAskUserRequest) => void;
}

/**
 * AskUser 렌더러
 * 사용자 질문 UI, 선택 상태 관리, DOM 보존 로직을 담당
 */
export class AskUserRenderer {

	// 이미 submit된 AskUser 요청 ID를 추적 (재렌더링 시에도 submitted 상태 유지)
	private readonly _submittedAskRequestIds = new Set<string>();

	// ★ AskUser DOM 보존: re-render 시 선택 상태를 유지하기 위해
	private _preservedAskUser: {
		requestId: string;
		element: HTMLElement;
		disposables: DisposableStore;
	} | undefined;

	constructor(private readonly callbacks: IAskUserRendererCallbacks) { }

	/**
	 * AskUser 보존 DOM 재사용 가능 여부 확인 + detach
	 * clearNode 전에 호출해야 함
	 * @returns 재사용 가능하면 true
	 */
	prepareForReuse(askRequestId: string | undefined): boolean {
		if (askRequestId &&
			this._preservedAskUser?.requestId === askRequestId &&
			!this._submittedAskRequestIds.has(askRequestId)) {
			if (this._preservedAskUser.element.parentElement) {
				this._preservedAskUser.element.remove();
			}
			return true;
		}
		return false;
	}

	/**
	 * 보존된 DOM을 컨테이너에 재부착
	 */
	reusePreserved(container: HTMLElement): void {
		if (this._preservedAskUser) {
			console.log('[AskUser] Reusing preserved AskUser DOM', { askRequestId: this._preservedAskUser.requestId });
			container.appendChild(this._preservedAskUser.element);
		}
	}

	/**
	 * 새 AskUser UI 생성
	 */
	createNew(
		askRequest: IClaudeAskUserRequest,
		container: HTMLElement,
		parentDisposables: DisposableStore
	): void {
		console.log('[AskUser] Creating new AskUser UI', { askRequestId: askRequest.id });
		this.cleanup();
		const askDisposables = new DisposableStore();
		this.renderAskUser(askRequest, container, askDisposables);
		const askElement = container.querySelector('.claude-ask-user') as HTMLElement;
		if (askElement && askRequest.id) {
			this._preservedAskUser = {
				requestId: askRequest.id,
				element: askElement,
				disposables: askDisposables,
			};
		} else {
			parentDisposables.add(askDisposables);
		}
	}

	/**
	 * 보존된 AskUser DOM 정리
	 */
	cleanup(): void {
		if (this._preservedAskUser) {
			this._preservedAskUser.disposables.dispose();
			this._preservedAskUser = undefined;
		}
	}

	// ========== Private ==========

	private renderAskUser(askRequest: IClaudeAskUserRequest, container: HTMLElement, disposables: DisposableStore): void {
		const askContainer = append(container, $('.claude-ask-user'));

		// 이미 submit된 AskUser
		if (askRequest.id && this._submittedAskRequestIds.has(askRequest.id)) {
			console.log('[AskUser] Skipping re-render of already submitted AskUser', { askRequestId: askRequest.id });
			const submittedElement = append(askContainer, $('.claude-ask-auto-accepted'));
			append(submittedElement, $('.codicon.codicon-check'));
			submittedElement.appendChild(document.createTextNode(' ' + localize('alreadySubmitted', "Response submitted")));
			return;
		}

		// 자동 승인된 경우
		if (askRequest.autoAccepted && askRequest.autoAcceptedOption) {
			const autoElement = append(askContainer, $('.claude-ask-auto-accepted'));
			append(autoElement, $('.codicon.codicon-check'));
			autoElement.appendChild(document.createTextNode(' ' + localize('autoSelected', "[Auto] Selected: \"{0}\"", askRequest.autoAcceptedOption)));
			return;
		}

		// 만료된 AskUser
		if (askRequest.expired) {
			const expiredElement = append(askContainer, $('.claude-ask-expired'));
			append(expiredElement, $('.codicon.codicon-warning'));
			expiredElement.appendChild(document.createTextNode(' ' + localize('askExpired', "This question expired (session ended). Please send a new message to continue.")));
			return;
		}

		const totalQuestions = askRequest.questions.length;
		const selections = new Map<number, string[]>();
		let submitted = false;

		let submitButton: HTMLButtonElement;
		let submitStatusText: HTMLSpanElement;

		const updateSubmitButton = () => {
			if (!submitButton) { return; }
			let answeredCount = 0;
			for (let i = 0; i < totalQuestions; i++) {
				const sel = selections.get(i);
				if (sel && sel.length > 0) {
					answeredCount++;
				}
			}
			const allAnswered = answeredCount === totalQuestions;
			submitButton.disabled = !allAnswered || submitted;
			if (allAnswered && !submitted) {
				submitButton.classList.add('ready');
			} else {
				submitButton.classList.remove('ready');
			}
			if (submitStatusText && !submitted) {
				if (totalQuestions > 1) {
					submitStatusText.textContent = localize('selectionProgress', "{0}/{1} answered", answeredCount, totalQuestions);
				} else {
					submitStatusText.textContent = allAnswered ? '' : localize('selectOption', "Select an option above");
				}
			}
		};

		// 질문들 렌더링
		askRequest.questions.forEach((question, qIndex) => {
			selections.set(qIndex, []);

			const questionContainer = append(askContainer, $('.claude-ask-question'));

			if (question.header) {
				const headerEl = append(questionContainer, $('.claude-ask-header'));
				headerEl.textContent = question.header;
			}

			const questionText = append(questionContainer, $('.claude-ask-text'));
			questionText.textContent = question.question;

			if (question.multiSelect) {
				const hint = append(questionContainer, $('.claude-ask-hint'));
				hint.textContent = localize('multiSelectHint', "(Multiple selection allowed)");
			}

			const optionsContainer = append(questionContainer, $('.claude-ask-options'));
			for (const option of question.options) {
				const button = append(optionsContainer, $('button.claude-ask-option'));

				const labelSpan = append(button, $('span.claude-ask-option-label'));
				labelSpan.textContent = option.label;
				if (option.description) {
					const descSpan = append(button, $('span.claude-ask-option-desc'));
					descSpan.textContent = option.description;
				}

				const clickHandler = () => {
					if (submitted) { return; }

					const currentSel = selections.get(qIndex) || [];

					if (question.multiSelect) {
						const idx = currentSel.indexOf(option.label);
						if (idx >= 0) {
							currentSel.splice(idx, 1);
							button.classList.remove('selected');
						} else {
							currentSel.push(option.label);
							button.classList.add('selected');
						}
					} else {
						const allButtons = optionsContainer.querySelectorAll('.claude-ask-option');
						allButtons.forEach(btn => btn.classList.remove('selected'));
						button.classList.add('selected');
						currentSel.length = 0;
						currentSel.push(option.label);
					}

					selections.set(qIndex, currentSel);
					updateSubmitButton();
				};
				button.addEventListener('click', clickHandler);
				disposables.add({ dispose: () => button.removeEventListener('click', clickHandler) });
			}
		});

		// Submit 버튼 영역
		const realSubmitContainer = append(askContainer, $('.claude-ask-submit-container'));
		submitStatusText = append(realSubmitContainer, $('span.claude-ask-submit-status'));
		submitButton = append(realSubmitContainer, $('button.claude-ask-submit')) as HTMLButtonElement;
		append(submitButton, $('.codicon.codicon-send'));
		submitButton.appendChild(document.createTextNode(' ' + localize('submitAnswer', "Submit")));
		submitButton.disabled = true;

		const submitHandler = () => {
			console.log('[AskUser] Submit button clicked', { submitted, disabled: submitButton?.disabled, askRequestId: askRequest.id });
			if (submitted || !submitButton || submitButton.disabled) {
				console.log('[AskUser] Submit blocked - already submitted or disabled');
				return;
			}
			submitted = true;
			if (askRequest.id) {
				this._submittedAskRequestIds.add(askRequest.id);
			}

			askContainer.querySelectorAll('.claude-ask-option').forEach(btn => {
				(btn as HTMLButtonElement).disabled = true;
			});
			submitButton.disabled = true;
			submitButton.classList.remove('ready');
			submitButton.classList.add('submitted');
			while (submitButton.firstChild) { submitButton.removeChild(submitButton.firstChild); }
			append(submitButton, $('.codicon.codicon-check'));
			submitButton.appendChild(document.createTextNode(' ' + localize('submitted', "Submitted")));
			if (submitStatusText) {
				submitStatusText.textContent = '';
			}

			const responses: string[] = [];
			for (let i = 0; i < totalQuestions; i++) {
				const sel = selections.get(i) || [];
				responses.push(sel.join(', '));
			}

			console.log('[AskUser] Calling onRespondToAskUser with responses:', responses, 'askRequestId:', askRequest.id);
			if (this.callbacks.onRespondToAskUser) {
				this.callbacks.onRespondToAskUser(responses, askRequest);
			}
		};
		submitButton.addEventListener('click', submitHandler);
		disposables.add({ dispose: () => submitButton?.removeEventListener('click', submitHandler) });

		updateSubmitButton();
	}
}
