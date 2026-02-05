/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * 메시지큐 버그 테스트 실행기 (Node.js)
 */

console.log('🔍 Claude 메시지큐 버그 재현 테스트 시작\n');

/**
 * 버그 재현 테스트 1: handleComplete 에러 시 큐 처리 미실행
 */
async function testBugScenario1() {
	console.log('🐛 테스트 1: handleComplete 에러로 인한 큐 처리 실패');

	let queueProcessed = false;
	let stateChangedToIdle = false;

	// Mock 서비스들 생성
	const mockStateManager = {
		onDidBecomeIdle: {
			fire: (sessionId) => {
				console.log(`✅ onDidBecomeIdle 이벤트 발생: ${sessionId}`);
				stateChangedToIdle = true;
			}
		},
		isInputEnabled: () => true,
		isWaitingForUser: () => false
	};

	const mockQueueService = {
		addToQueue: (content) => {
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

	const mockClaudeService = {
		_chatStateManager: {
			completeStreaming: (sessionId) => {
				console.log(`🔄 completeStreaming 호출: ${sessionId}`);
				mockStateManager.onDidBecomeIdle.fire(sessionId);
			},
			setState: (sessionId, state) => {
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
async function testBugScenario2() {
	console.log('\n🐛 테스트 2: State 이벤트 미발생으로 인한 큐 처리 실패');

	let queueProcessed = false;
	let idleEventFired = false;

	// Mock 서비스
	const mockStateManager = {
		onDidBecomeIdle: {
			fire: (sessionId) => {
				console.log(`✅ onDidBecomeIdle 이벤트 발생: ${sessionId}`);
				idleEventFired = true;
				// 이 이벤트가 큐 처리를 트리거해야 함
				mockQueueService.processQueue('test-session');
			}
		},
		isInputEnabled: () => true,
		isWaitingForUser: () => false
	};

	const mockQueueService = {
		addToQueue: (content) => {
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
async function testNormalScenario() {
	console.log('\n✅ 테스트 3: 정상 동작 시나리오');

	let queueProcessed = false;
	let idleEventFired = false;

	const mockStateManager = {
		onDidBecomeIdle: {
			fire: (sessionId) => {
				console.log(`✅ onDidBecomeIdle 이벤트 발생: ${sessionId}`);
				idleEventFired = true;
				mockQueueService.processQueue(sessionId);
			}
		},
		isInputEnabled: () => true,
		isWaitingForUser: () => false
	};

	const mockQueueService = {
		addToQueue: (content) => {
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
async function runQueueBugTests() {
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

		console.log('\n🔧 구체적 수정 사항:');
		console.log('  - claudeService.ts:406 finally 블록에서 completeStreaming 호출');
		console.log('  - 또는 에러 케이스에서도 상태 변경 보장');
		console.log('  - 큐 처리 재시도 타이머 추가');
	} else {
		console.log('\n✅ 모든 테스트 통과! 큐 처리가 정상 작동합니다.');
	}
}

// 테스트 실행
runQueueBugTests().catch(console.error);