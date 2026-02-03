/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $ } from '../../../../../base/browser/dom.js';
import { Disposable, IDisposable } from '../../../../../base/common/lifecycle.js';

/**
 * Claude 모달 다이얼로그 추상 기본 클래스
 *
 * 모든 Claude 모달 패널들이 공통으로 가지는 패턴을 추상화:
 * - 오버레이 생성 및 관리
 * - 열기/닫기 상태 관리
 * - Disposable 리스너들 자동 정리
 * - 일관된 모달 동작 패턴
 *
 * @template TCallbacks 구체적인 콜백 인터페이스 타입
 */
export abstract class ClaudeModalDialog<TCallbacks = any> extends Disposable {

	/**
	 * 모달 오버레이 요소 (null이면 닫힌 상태)
	 */
	protected overlay: HTMLElement | undefined;

	/**
	 * 모달 전용 disposables 배열
	 * 모달이 닫힐 때 자동으로 정리됨
	 */
	protected modalDisposables: IDisposable[] = [];

	/**
	 * 부모와의 통신을 위한 콜백 인터페이스
	 */
	protected readonly callbacks: TCallbacks;

	constructor(callbacks: TCallbacks) {
		super();
		this.callbacks = callbacks;
	}

	/**
	 * 모달 다이얼로그 열기
	 * 이미 열려있으면 닫기
	 *
	 * @param parentContainer 모달이 추가될 부모 컨테이너
	 */
	public open(parentContainer: HTMLElement): void {
		// 이미 열려있으면 토글 (닫기)
		if (this.overlay) {
			this.close();
			return;
		}

		// 오버레이 생성
		this.createOverlay(parentContainer);
	}

	/**
	 * 모달 다이얼로그 닫기
	 * 오버레이 제거 및 리소스 정리
	 */
	public close(): void {
		// 오버레이 제거
		if (this.overlay) {
			this.overlay.remove();
			this.overlay = undefined;
		}

		// 모달 전용 disposables 정리
		this.modalDisposables.forEach(disposable => disposable.dispose());
		this.modalDisposables = [];

		// 하위 클래스에서 추가 정리 작업 수행
		this.onClose();
	}

	/**
	 * 모달이 열려있는지 확인
	 *
	 * @returns 열려있으면 true, 닫혀있으면 false
	 */
	public isOpen(): boolean {
		return !!this.overlay;
	}

	/**
	 * 오버레이 생성 메서드 (추상 메서드)
	 * 하위 클래스에서 반드시 구현해야 함
	 *
	 * @param parentContainer 모달이 추가될 부모 컨테이너
	 */
	protected abstract createOverlay(parentContainer: HTMLElement): void;

	/**
	 * 모달 닫기 후 호출되는 훅 메서드
	 * 하위 클래스에서 필요시 오버라이드하여 추가 정리 작업 수행
	 */
	protected onClose(): void {
		// 기본적으로는 아무것도 하지 않음
		// 하위 클래스에서 필요에 따라 오버라이드
	}

	/**
	 * 편의 메서드: 모달 전용 Disposable 등록
	 * 모달이 닫힐 때 자동으로 dispose됨
	 *
	 * @param disposable 관리할 Disposable 객체
	 * @returns 동일한 Disposable 객체 (체이닝 가능)
	 */
	protected registerModalDisposable<T extends IDisposable>(disposable: T): T {
		this.modalDisposables.push(disposable);
		return disposable;
	}

	/**
	 * 편의 메서드: 기본 오버레이 컨테이너 생성
	 * 하위 클래스에서 createOverlay 구현시 사용 가능
	 *
	 * @param parentContainer 부모 컨테이너
	 * @returns 생성된 오버레이 요소
	 */
	protected createBaseOverlay(parentContainer: HTMLElement): HTMLElement {
		this.overlay = $('.overlay');
		parentContainer.appendChild(this.overlay);
		return this.overlay;
	}

	/**
	 * 편의 메서드: 모달 컨텐츠 컨테이너 생성
	 * 일반적인 모달 구조를 위한 헬퍼 메서드
	 *
	 * @param overlay 오버레이 요소
	 * @param className 추가할 CSS 클래스명 (선택사항)
	 * @returns 생성된 모달 컨텐츠 컨테이너
	 */
	protected createModalContent(overlay: HTMLElement, className?: string): HTMLElement {
		const modalContent = $('.modal-content');
		if (className) {
			modalContent.classList.add(className);
		}
		overlay.appendChild(modalContent);
		return modalContent;
	}
}