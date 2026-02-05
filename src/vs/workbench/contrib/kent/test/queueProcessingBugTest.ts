/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * 메시지큐 버그 재현 테스트
 *
 * 문제 상황:
 * - Claude가 작업 중일 때 사용자가 메시지 전송 → 큐에 저장됨
 * - Claude 작업 완료 후 → 큐에서 메시지를 가져와서 처리해야 함
 * - 하지만 처리되지 않고 "Thinking..." 상태로 멈춤
 */

interface MockStateManager {
	onDidBecomeIdle: { fire: (sessionId: string) => void };
	isInputEnabled: (sessionId: string) => boolean;
	isWaitingForUser: (sessionId: string) => boolean;
}

interface MockQueueService {
	addToQueue: (content: string, options?: any, sessionId?: string) => { message: any; added: boolean };
	processQueue: (sessionId?: string) => Promise<void>;
	subscribeToStateManager: (manager: MockStateManager) => void;
	getQueuedMessages: (sessionId?: string) => any[];
}

interface MockClaudeService {
	_chatStateManager: {
		completeStreaming: (sessionId: string) => void;
		setState: (sessionId: string, state: string) => void;
	};
	_queueService: MockQueueService;
	_cliEventHandler: {
		handleComplete: () => Promise<void>;
	};
}

/**
 * 버그 재현 테스트 1: handleComplete 에러 시 큐 처리 미실행
 */
async function testBugScenario1(): Promise<boolean> {
	console.log('🐛 테스트 1: handleComplete 에러로 인한 큐 처리 실패');

	let queueProcessed = false;
	let stateChangedToIdle = false;

	// Mock 서비스들 생성
	const mockStateManager: MockStateManager = {
		onDidBecomeIdle: {
			fire: (sessionId: string) => {
				console.log(`✅ onDidBecomeIdle 이벤트 발생: ${sessionId}`);
				stateChangedToIdle = true;
			}
		},
		isInputEnabled: () => true,
		isWaitingForUser: () => false
	};

	const mockQueueService: MockQueueService = {
		addToQueue: (content: string) => {
			console.log(`📝 메시지 큐에 추가: "${content}"`);
			return { message: { id: '123', content }, added: true };
		},
		processQueue: async () => {
			console.log('🚀 큐 처리 시작!');
			queueProcessed = true;
		},
		subscribeToStateManager: (manager) => {
			manager.onDidBecomeIdle.fire('test-session');
		},
		getQueuedMessages: () => [{ id: '123', content: 'test message' }]
	};

	const mockClaudeService: MockClaudeService = {
		_chatStateManager: {
			completeStreaming: (sessionId: string) => {
				console.log(`🔄 completeStreaming 호출: ${sessionId}`);
				mockStateManager.onDidBecomeIdle.fire(sessionId);
			},
			setState: (sessionId: string, state: string) => {
				console.log(`🔄 setState: ${sessionId} → ${state}`);
			}
		},
		_queueService: mockQueueService,
		_cliEventHandler: {
			handleComplete: async () => {
				console.log('💥 handleComplete에서 에러 발생!');
				throw new Error('처리 중 에러 발생');
			}
		}
	};

	// 시나리오 실행
	try {
		// 1. 사용자가 Claude 작업 중에 메시지 전송 → 큐에 저장
		console.log('👤 사용자가 Claude 작업 중에 메시지 전송');
		mockQueueService.addToQueue('다음 작업 해줘');

		// 2. Claude 작업 완료 시뮬레이션 (handleComplete에서 에러 발생)
		console.log('🤖 Claude 작업 완료 (하지만 handleComplete에서 에러)');
		try {
			await mockClaudeService._cliEventHandler.handleComplete();
			// 정상적이면 여기서 completeStreaming 호출되어야 함
			mockClaudeService._chatStateManager.completeStreaming('test-session');
		} catch (error) {
			console.log('❌ handleComplete 에러로 인해 completeStreaming 호출 안됨');
			// 에러 케이스에서는 상태 변경이 안 일어남!
		}

		// 3. 결과 확인
		await new Promise(resolve => setTimeout(resolve, 100)); // 비동기 처리 대기

		console.log('\n📊 결과:');
		console.log(`  - Idle 상태 변경: ${stateChangedToIdle}`);
		console.log(`  - 큐 처리 실행: ${queueProcessed}`);

		if (!stateChangedToIdle && !queueProcessed) {
			console.log('🐛 버그 재현 성공! 큐가 처리되지 않음');
			return true;
		} else {
			console.log('✅ 정상 동작');
			return false;
		}

	} catch (error) {
		console.error('테스트 실행 중 에러:', error);
		return false;
	}
}

/**
 * 버그 재현 테스트 2: State 이벤트 미발생으로 인한 큐 처리 실패
 */
async function testBugScenario2(): Promise<boolean> {
	console.log('\n🐛 테스트 2: State 이벤트 미발생으로 인한 큐 처리 실패');

	let queueProcessed = false;
	let idleEventFired = false;

	// Mock 서비스
	const mockStateManager: MockStateManager = {
		onDidBecomeIdle: {
			fire: (sessionId: string) => {
				console.log(`✅ onDidBecomeIdle 이벤트 발생: ${sessionId}`);
				idleEventFired = true;
				// 이 이벤트가 큐 처리를 트리거해야 함
				mockQueueService.processQueue('test-session');
			}
		},
		isInputEnabled: () => true,
		isWaitingForUser: () => false
	};

	const mockQueueService: MockQueueService = {
		addToQueue: (content: string) => {
			console.log(`📝 메시지 큐에 추가: "${content}"`);
			return { message: { id: '123', content }, added: true };
		},
		processQueue: async () => {
			console.log('🚀 큐 처리 시작!');
			queueProcessed = true;
		},
		subscribeToStateManager: (manager) => {
			// StateManager 구독 설정됨
			console.log('📡 StateManager 구독 설정');
		},
		getQueuedMessages: () => [{ id: '123', content: 'test message' }]
	};

	try {
		// 1. 큐에 메시지 추가
		console.log('👤 사용자가 메시지 전송');
		mockQueueService.addToQueue('큐 테스트 메시지');

		// 2. StateManager 구독 설정
		mockQueueService.subscribeToStateManager(mockStateManager);

		// 3. 상태 변경 이벤트 의도적으로 미발생 (버그 시뮬레이션)
		console.log('🤖 Claude 작업 완료했지만 idle 이벤트 미발생');
		// completeStreaming 호출 안함 → onDidBecomeIdle 이벤트 안 발생

		await new Promise(resolve => setTimeout(resolve, 200));

		console.log('\n📊 결과:');
		console.log(`  - Idle 이벤트 발생: ${idleEventFired}`);
		console.log(`  - 큐 처리 실행: ${queueProcessed}`);

		if (!idleEventFired && !queueProcessed) {
			console.log('🐛 버그 재현 성공! Idle 이벤트가 발생하지 않아 큐 처리 안됨');
			return true;
		} else {
			console.log('✅ 정상 동작');
			return false;
		}

	} catch (error) {
		console.error('테스트 실행 중 에러:', error);
		return false;
	}
}

/**
 * 정상 동작 테스트 (비교용)
 */
async function testNormalScenario(): Promise<boolean> {
	console.log('\n✅ 테스트 3: 정상 동작 시나리오');

	let queueProcessed = false;
	let idleEventFired = false;

	const mockStateManager: MockStateManager = {
		onDidBecomeIdle: {
			fire: (sessionId: string) => {
				console.log(`✅ onDidBecomeIdle 이벤트 발생: ${sessionId}`);
				idleEventFired = true;
				mockQueueService.processQueue(sessionId);
			}
		},
		isInputEnabled: () => true,
		isWaitingForUser: () => false
	};

	const mockQueueService: MockQueueService = {
		addToQueue: (content: string) => {
			console.log(`📝 메시지 큐에 추가: "${content}"`);
			return { message: { id: '123', content }, added: true };
		},
		processQueue: async () => {
			console.log('🚀 큐 처리 시작!');
			queueProcessed = true;
		},
		subscribeToStateManager: (manager) => {
			console.log('📡 StateManager 구독 설정');
		},
		getQueuedMessages: () => [{ id: '123', content: 'test message' }]
	};

	try {
		// 1. 큐에 메시지 추가
		mockQueueService.addToQueue('정상 처리 테스트');

		// 2. StateManager 구독
		mockQueueService.subscribeToStateManager(mockStateManager);

		// 3. 정상적인 완료 처리
		console.log('🤖 Claude 작업 정상 완료');
		mockStateManager.onDidBecomeIdle.fire('test-session');

		await new Promise(resolve => setTimeout(resolve, 100));

		console.log('\n📊 결과:');
		console.log(`  - Idle 이벤트 발생: ${idleEventFired}`);
		console.log(`  - 큐 처리 실행: ${queueProcessed}`);

		if (idleEventFired && queueProcessed) {
			console.log('✅ 정상 동작 확인!');
			return true;
		} else {
			console.log('❌ 예상과 다른 결과');
			return false;
		}

	} catch (error) {
		console.error('테스트 실행 중 에러:', error);
		return false;
	}
}

/**
 * 메인 테스트 러너
 */
async function runQueueBugTests(): Promise<void> {
	console.log('🔍 Claude 메시지큐 버그 재현 테스트 시작\n');

	const results = {
		bug1: await testBugScenario1(),
		bug2: await testBugScenario2(),
		normal: await testNormalScenario()
	};

	console.log('\n📈 최종 결과:');
	console.log(`  🐛 버그 시나리오 1 (handleComplete 에러): ${results.bug1 ? '재현됨' : '재현 안됨'}`);
	console.log(`  🐛 버그 시나리오 2 (idle 이벤트 미발생): ${results.bug2 ? '재현됨' : '재현 안됨'}`);
	console.log(`  ✅ 정상 시나리오: ${results.normal ? '성공' : '실패'}`);

	if (results.bug1 || results.bug2) {
		console.log('\n🚨 메시지큐 처리 버그가 재현되었습니다!');
		console.log('\n💡 수정 방안:');
		console.log('  1. handleComplete 에러 시에도 completeStreaming 호출 보장');
		console.log('  2. onDidBecomeIdle 이벤트 발생 확실히 보장');
		console.log('  3. 큐 처리 실패 시 재시도 메커니즘 추가');
	} else {
		console.log('\n✅ 모든 테스트 통과! 큐 처리가 정상 작동합니다.');
	}
}

// Node.js에서 실행할 수 있도록
if (typeof module !== 'undefined' && module.exports) {
	module.exports = { runQueueBugTests };
} else {
	// 브라우저에서 실행 시
	runQueueBugTests();
}