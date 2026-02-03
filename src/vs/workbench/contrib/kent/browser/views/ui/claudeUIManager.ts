/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, IDisposable } from '../../../../../base/common/lifecycle.js';

/**
 * 기본 콜백 인터페이스
 * 모든 UI Manager가 공통으로 사용하는 콜백 메서드들을 정의
 */
export interface IUIManagerCallbacks {
	/**
	 * Disposable 객체를 부모에서 관리하도록 등록
	 * UI Manager의 라이프사이클과 함께 자동으로 dispose됨
	 */
	registerDisposable<T extends IDisposable>(disposable: T): T;
}

/**
 * Claude UI Manager 추상 기본 클래스
 *
 * 모든 Claude UI 매니저 클래스들이 공통으로 가지는 패턴을 추상화:
 * - Disposable 상속으로 자동 리소스 정리
 * - Container 요소 관리
 * - Callbacks 기반 부모 통신
 * - 공통 라이프사이클 메서드
 *
 * @template TCallbacks 구체적인 콜백 인터페이스 타입 (IUIManagerCallbacks 확장 필요)
 */
export abstract class ClaudeUIManager<TCallbacks extends IUIManagerCallbacks> extends Disposable {

	/**
	 * UI가 렌더링될 컨테이너 요소
	 */
	protected readonly container: HTMLElement;

	/**
	 * 부모와의 통신을 위한 콜백 인터페이스
	 */
	protected readonly callbacks: TCallbacks;

	constructor(
		container: HTMLElement,
		callbacks: TCallbacks
	) {
		super();
		this.container = container;
		this.callbacks = callbacks;

		// 자동으로 초기화
		this.initialize();
	}

	/**
	 * 초기화 메서드 (생성자에서 자동 호출)
	 * 하위 클래스에서 필요에 따라 오버라이드 가능
	 */
	protected initialize(): void {
		this.render();
	}

	/**
	 * UI 렌더링 메서드 (추상 메서드)
	 * 하위 클래스에서 반드시 구현해야 함
	 */
	protected abstract render(): void;

	/**
	 * 편의 메서드: 콜백을 통해 Disposable을 부모에서 관리하도록 등록
	 *
	 * @param disposable 관리할 Disposable 객체
	 * @returns 동일한 Disposable 객체 (체이닝 가능)
	 */
	protected registerDisposable<T extends IDisposable>(disposable: T): T {
		return this.callbacks.registerDisposable(disposable);
	}

	/**
	 * UI 업데이트 메서드 (선택적 구현)
	 * 하위 클래스에서 필요에 따라 오버라이드
	 */
	public update?(...args: any[]): void;
}