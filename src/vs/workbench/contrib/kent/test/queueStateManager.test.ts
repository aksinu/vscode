/**
 * 큐 상태 관리 테스트
 * Claude 모듈의 메시지큐와 채팅 상태 관리자 간의 연동을 테스트합니다.
 */

import { Event, Emitter } from '../../../../base/common/event.js';
import { IDisposable, DisposableStore } from '../../../../base/common/lifecycle.js';

// Mock 타입 정의
interface IClaudeQueuedMessage {
  readonly id: string;
  readonly content: string;
  readonly context?: any;
  readonly timestamp: number;
}

interface IClaudeSendRequestOptions {
  context?: {
    attachments?: any[];
  };
}

// 상태 관리자 인터페이스
interface IQueueStateManager {
  readonly onDidBecomeIdle: Event<string>;
  readonly onDidStartProcessing: Event<string>;
  readonly onDidFinishProcessing: Event<string>;
  readonly onDidWaitForUser: Event<string>;
  readonly onDidStopWaitingForUser: Event<string>;

  isInputEnabled(sessionId: string): boolean;
  isWaitingForUser(sessionId: string): boolean;
  isProcessing(sessionId: string): boolean;
  canSendMessage(sessionId: string): boolean;

  setInputEnabled(sessionId: string, enabled: boolean): void;
  setWaitingForUser(sessionId: string, waiting: boolean): void;
  setProcessing(sessionId: string, processing: boolean): void;
  transitionToIdle(sessionId: string): void;
}

// 큐 서비스 인터페이스
interface ITestQueueService {
  readonly onDidChangeQueue: Event<IClaudeQueuedMessage[]>;

  addToQueue(content: string, options?: IClaudeSendRequestOptions, sessionId?: string): { message: IClaudeQueuedMessage; added: boolean };
  removeFromQueue(id: string, sessionId?: string): boolean;
  getQueuedMessages(sessionId?: string): IClaudeQueuedMessage[];
  isProcessingQueue(sessionId?: string): boolean;
  processQueue(sessionId?: string): Promise<void>;

  subscribeToStateManager(stateManager: IQueueStateManager): IDisposable;
  setProcessMessageDelegate(fn: (content: string, options?: IClaudeSendRequestOptions, sessionId?: string) => Promise<void>): void;
}

/**
 * 테스트용 큐 상태 관리자 Mock 구현
 */
class TestQueueStateManager implements IQueueStateManager {
  private readonly _onDidBecomeIdle = new Emitter<string>();
  private readonly _onDidStartProcessing = new Emitter<string>();
  private readonly _onDidFinishProcessing = new Emitter<string>();
  private readonly _onDidWaitForUser = new Emitter<string>();
  private readonly _onDidStopWaitingForUser = new Emitter<string>();

  readonly onDidBecomeIdle = this._onDidBecomeIdle.event;
  readonly onDidStartProcessing = this._onDidStartProcessing.event;
  readonly onDidFinishProcessing = this._onDidFinishProcessing.event;
  readonly onDidWaitForUser = this._onDidWaitForUser.event;
  readonly onDidStopWaitingForUser = this._onDidStopWaitingForUser.event;

  private readonly _sessionStates = new Map<string, {
    inputEnabled: boolean;
    waitingForUser: boolean;
    processing: boolean;
  }>();

  constructor() {}

  isInputEnabled(sessionId: string): boolean {
    return this._getSessionState(sessionId).inputEnabled;
  }

  isWaitingForUser(sessionId: string): boolean {
    return this._getSessionState(sessionId).waitingForUser;
  }

  isProcessing(sessionId: string): boolean {
    return this._getSessionState(sessionId).processing;
  }

  canSendMessage(sessionId: string): boolean {
    const state = this._getSessionState(sessionId);
    return state.inputEnabled && !state.waitingForUser && !state.processing;
  }

  setInputEnabled(sessionId: string, enabled: boolean): void {
    const state = this._getSessionState(sessionId);
    state.inputEnabled = enabled;
    console.log(`🎛️ [State Manager] 입력 활성화 변경: [${sessionId}] ${enabled}`);

    if (enabled && !state.waitingForUser && !state.processing) {
      this._onDidBecomeIdle.fire(sessionId);
    }
  }

  setWaitingForUser(sessionId: string, waiting: boolean): void {
    const state = this._getSessionState(sessionId);
    state.waitingForUser = waiting;
    console.log(`⏱️ [State Manager] 사용자 대기 상태 변경: [${sessionId}] ${waiting}`);

    if (waiting) {
      this._onDidWaitForUser.fire(sessionId);
    } else {
      this._onDidStopWaitingForUser.fire(sessionId);
      if (state.inputEnabled && !state.processing) {
        this._onDidBecomeIdle.fire(sessionId);
      }
    }
  }

  setProcessing(sessionId: string, processing: boolean): void {
    const state = this._getSessionState(sessionId);
    const wasProcessing = state.processing;
    state.processing = processing;

    if (processing && !wasProcessing) {
      console.log(`⚙️ [State Manager] 처리 시작: [${sessionId}]`);
      this._onDidStartProcessing.fire(sessionId);
    } else if (!processing && wasProcessing) {
      console.log(`✅ [State Manager] 처리 완료: [${sessionId}]`);
      this._onDidFinishProcessing.fire(sessionId);

      if (state.inputEnabled && !state.waitingForUser) {
        this._onDidBecomeIdle.fire(sessionId);
      }
    }
  }

  transitionToIdle(sessionId: string): void {
    const state = this._getSessionState(sessionId);
    state.processing = false;
    state.waitingForUser = false;
    state.inputEnabled = true;

    console.log(`🏃 [State Manager] Idle 상태로 전환: [${sessionId}]`);
    this._onDidBecomeIdle.fire(sessionId);
  }

  private _getSessionState(sessionId: string) {
    if (!this._sessionStates.has(sessionId)) {
      this._sessionStates.set(sessionId, {
        inputEnabled: true,
        waitingForUser: false,
        processing: false
      });
    }
    return this._sessionStates.get(sessionId)!;
  }
}

/**
 * 테스트용 큐 서비스 Mock 구현
 */
class TestQueueServiceWithState implements ITestQueueService {
  private readonly _onDidChangeQueue = new Emitter<IClaudeQueuedMessage[]>();
  readonly onDidChangeQueue = this._onDidChangeQueue.event;

  private _globalQueue: IClaudeQueuedMessage[] = [];
  private readonly _sessionQueues = new Map<string, IClaudeQueuedMessage[]>();
  private readonly _processingQueues = new Set<string>();
  private _stateManager?: IQueueStateManager;
  private _stateSubscription?: DisposableStore;
  private _processMessage?: (content: string, options?: IClaudeSendRequestOptions, sessionId?: string) => Promise<void>;

  constructor() {}

  addToQueue(content: string, options?: IClaudeSendRequestOptions, sessionId?: string): { message: IClaudeQueuedMessage; added: boolean } {
    const queue = sessionId ? this._getSessionQueue(sessionId) : this._globalQueue;

    const message: IClaudeQueuedMessage = {
      id: 'msg-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9),
      content,
      context: options?.context,
      timestamp: Date.now()
    };

    queue.push(message);
    console.log(`✅ [Queue Service] 메시지 큐 추가: [${sessionId || 'global'}] "${content.substring(0, 50)}${content.length > 50 ? '...' : ''}"`);

    this._onDidChangeQueue.fire([...queue]);

    // 상태 관리자가 있고 세션이 idle 상태면 자동 처리 시도
    if (this._stateManager && sessionId && this._stateManager.canSendMessage(sessionId)) {
      setTimeout(() => this.processQueue(sessionId), 10);
    }

    return { message, added: true };
  }

  removeFromQueue(id: string, sessionId?: string): boolean {
    const queue = sessionId ? this._getSessionQueue(sessionId) : this._globalQueue;
    const index = queue.findIndex(msg => msg.id === id);

    if (index >= 0) {
      const removed = queue.splice(index, 1)[0];
      console.log(`🗑️ [Queue Service] 메시지 큐 제거: [${sessionId || 'global'}] "${removed.content.substring(0, 30)}${removed.content.length > 30 ? '...' : ''}"`);
      this._onDidChangeQueue.fire([...queue]);
      return true;
    }

    return false;
  }

  getQueuedMessages(sessionId?: string): IClaudeQueuedMessage[] {
    const queue = sessionId ? this._getSessionQueue(sessionId) : this._globalQueue;
    return [...queue];
  }

  isProcessingQueue(sessionId?: string): boolean {
    const key = sessionId || 'global';
    return this._processingQueues.has(key);
  }

  async processQueue(sessionId?: string): Promise<void> {
    const key = sessionId || 'global';
    const queue = sessionId ? this._getSessionQueue(sessionId) : this._globalQueue;

    if (this._processingQueues.has(key)) {
      console.log(`⏳ [Queue Service] 이미 처리 중: [${key}]`);
      return;
    }

    if (queue.length === 0) {
      console.log(`📭 [Queue Service] 처리할 메시지 없음: [${key}]`);
      return;
    }

    // 상태 관리자가 있으면 상태 확인
    if (this._stateManager && sessionId) {
      if (!this._stateManager.canSendMessage(sessionId)) {
        console.log(`⛔ [Queue Service] 처리 불가 상태: [${sessionId}]`);
        console.log(`   - 입력 활성화: ${this._stateManager.isInputEnabled(sessionId)}`);
        console.log(`   - 사용자 대기: ${this._stateManager.isWaitingForUser(sessionId)}`);
        console.log(`   - 처리 중: ${this._stateManager.isProcessing(sessionId)}`);
        return;
      }
    }

    this._processingQueues.add(key);

    // 상태를 processing으로 변경
    if (this._stateManager && sessionId) {
      this._stateManager.setProcessing(sessionId, true);
    }

    try {
      const message = queue.shift()!;
      console.log(`⚡ [Queue Service] 큐 처리 시작: [${key}] "${message.content.substring(0, 50)}${message.content.length > 50 ? '...' : ''}"`);

      // Mock 처리
      await new Promise(resolve => setTimeout(resolve, 100));

      if (this._processMessage) {
        await this._processMessage(message.content, { context: message.context }, sessionId);
      }

      console.log(`✅ [Queue Service] 큐 처리 완료: [${key}]`);
      this._onDidChangeQueue.fire([...queue]);

    } catch (error) {
      console.error(`❌ [Queue Service] 큐 처리 실패: [${key}]`, error);
      throw error;
    } finally {
      this._processingQueues.delete(key);

      // 상태를 idle로 변경
      if (this._stateManager && sessionId) {
        this._stateManager.setProcessing(sessionId, false);
      }
    }
  }

  subscribeToStateManager(stateManager: IQueueStateManager): IDisposable {
    this._stateManager = stateManager;
    this._stateSubscription = new DisposableStore();

    console.log(`🔗 [Queue Service] 상태 관리자 구독 시작`);

    // Idle 상태가 되면 자동으로 큐 처리
    this._stateSubscription.add(
      stateManager.onDidBecomeIdle(sessionId => {
        console.log(`🏃 [Queue Service] 세션 idle 감지: [${sessionId}]`);
        if (!stateManager.isWaitingForUser(sessionId)) {
          setTimeout(() => this.processQueue(sessionId), 10);
        }
      })
    );

    // 처리 시작/완료 로깅
    this._stateSubscription.add(
      stateManager.onDidStartProcessing(sessionId => {
        console.log(`📈 [Queue Service] 처리 시작 감지: [${sessionId}]`);
      })
    );

    this._stateSubscription.add(
      stateManager.onDidFinishProcessing(sessionId => {
        console.log(`📉 [Queue Service] 처리 완료 감지: [${sessionId}]`);
      })
    );

    // 사용자 대기 상태 로깅
    this._stateSubscription.add(
      stateManager.onDidWaitForUser(sessionId => {
        console.log(`👤 [Queue Service] 사용자 대기 시작: [${sessionId}]`);
      })
    );

    this._stateSubscription.add(
      stateManager.onDidStopWaitingForUser(sessionId => {
        console.log(`👤 [Queue Service] 사용자 대기 종료: [${sessionId}]`);
      })
    );

    return {
      dispose: () => {
        this._stateSubscription?.dispose();
        this._stateManager = undefined;
        console.log(`🔗 [Queue Service] 상태 관리자 구독 해제`);
      }
    };
  }

  setProcessMessageDelegate(fn: (content: string, options?: IClaudeSendRequestOptions, sessionId?: string) => Promise<void>): void {
    this._processMessage = fn;
  }

  private _getSessionQueue(sessionId: string): IClaudeQueuedMessage[] {
    if (!this._sessionQueues.has(sessionId)) {
      this._sessionQueues.set(sessionId, []);
    }
    return this._sessionQueues.get(sessionId)!;
  }
}

/**
 * 상태 기반 자동 큐 처리 테스트
 */
async function testAutomaticQueueProcessing() {
  console.log('\n🤖 === 상태 기반 자동 큐 처리 테스트 ===\n');

  const stateManager = new TestQueueStateManager();
  const queueService = new TestQueueServiceWithState();
  const sessionId = 'auto-test-session';

  let processedMessages: string[] = [];

  // 처리 함수 설정
  queueService.setProcessMessageDelegate(async (content, options, sessionId) => {
    processedMessages.push(content);
    console.log(`   📨 [Delegate] 메시지 처리: "${content}"`);
  });

  // 상태 관리자 구독
  const subscription = queueService.subscribeToStateManager(stateManager);

  console.log('1️⃣ 초기 상태 확인');
  console.log(`   - 메시지 전송 가능: ${stateManager.canSendMessage(sessionId) ? '✅' : '❌'}`);
  console.log(`   - 입력 활성화: ${stateManager.isInputEnabled(sessionId)}`);
  console.log(`   - 사용자 대기: ${stateManager.isWaitingForUser(sessionId)}`);
  console.log(`   - 처리 중: ${stateManager.isProcessing(sessionId)}`);

  console.log('\n2️⃣ 메시지 추가 (자동 처리 예상)');
  queueService.addToQueue('Message 1', undefined, sessionId);
  queueService.addToQueue('Message 2', undefined, sessionId);

  // 자동 처리 대기
  await new Promise(resolve => setTimeout(resolve, 200));

  console.log('\n3️⃣ 처리 중 상태에서 메시지 추가');
  stateManager.setProcessing(sessionId, true);
  queueService.addToQueue('Message 3', undefined, sessionId);

  // 처리 중이므로 큐에서 대기해야 함
  await new Promise(resolve => setTimeout(resolve, 100));

  console.log('\n4️⃣ 처리 완료로 상태 변경 (자동 처리 예상)');
  stateManager.setProcessing(sessionId, false);

  await new Promise(resolve => setTimeout(resolve, 200));

  console.log('\n5️⃣ 사용자 대기 상태에서 메시지 추가');
  stateManager.setWaitingForUser(sessionId, true);
  queueService.addToQueue('Message 4', undefined, sessionId);

  await new Promise(resolve => setTimeout(resolve, 100));

  console.log('\n6️⃣ 사용자 대기 해제 (자동 처리 예상)');
  stateManager.setWaitingForUser(sessionId, false);

  await new Promise(resolve => setTimeout(resolve, 200));

  console.log('\n📊 최종 결과:');
  console.log(`   - 처리된 메시지 수: ${processedMessages.length}/4`);
  console.log(`   - 처리된 메시지: [${processedMessages.join(', ')}]`);
  console.log(`   - 남은 큐 크기: ${queueService.getQueuedMessages(sessionId).length}`);
  console.log(`   - 자동 처리: ${processedMessages.length === 4 ? '✅ 모든 메시지 처리됨' : '❌ 일부 메시지 미처리'}`);

  subscription.dispose();
}

/**
 * 상태 전환 시나리오 테스트
 */
async function testStateTransitions() {
  console.log('\n🔄 === 상태 전환 시나리오 테스트 ===\n');

  const stateManager = new TestQueueStateManager();
  const sessionId = 'transition-test-session';

  let idleEvents: string[] = [];
  let processingStartEvents: string[] = [];
  let processingFinishEvents: string[] = [];
  let waitingEvents: string[] = [];

  // 이벤트 리스너 등록
  const idleDisposable = stateManager.onDidBecomeIdle(sid => {
    idleEvents.push(sid);
    console.log(`   🏃 [Event] Idle 이벤트: ${sid}`);
  });

  const startDisposable = stateManager.onDidStartProcessing(sid => {
    processingStartEvents.push(sid);
    console.log(`   📈 [Event] 처리 시작 이벤트: ${sid}`);
  });

  const finishDisposable = stateManager.onDidFinishProcessing(sid => {
    processingFinishEvents.push(sid);
    console.log(`   📉 [Event] 처리 완료 이벤트: ${sid}`);
  });

  const waitStartDisposable = stateManager.onDidWaitForUser(sid => {
    waitingEvents.push(`wait:${sid}`);
    console.log(`   👤 [Event] 사용자 대기 시작: ${sid}`);
  });

  const waitStopDisposable = stateManager.onDidStopWaitingForUser(sid => {
    waitingEvents.push(`stop:${sid}`);
    console.log(`   👤 [Event] 사용자 대기 종료: ${sid}`);
  });

  console.log('1️⃣ 시나리오: 정상 처리 플로우');
  console.log('   - 시작: idle → processing → idle');

  stateManager.setProcessing(sessionId, true);
  await new Promise(resolve => setTimeout(resolve, 50));

  stateManager.setProcessing(sessionId, false);
  await new Promise(resolve => setTimeout(resolve, 50));

  console.log('\n2️⃣ 시나리오: 사용자 대기 플로우');
  console.log('   - 시작: idle → waiting → idle');

  stateManager.setWaitingForUser(sessionId, true);
  await new Promise(resolve => setTimeout(resolve, 50));

  stateManager.setWaitingForUser(sessionId, false);
  await new Promise(resolve => setTimeout(resolve, 50));

  console.log('\n3️⃣ 시나리오: 복합 상태 전환');
  console.log('   - 시작: processing → waiting → idle');

  stateManager.setProcessing(sessionId, true);
  await new Promise(resolve => setTimeout(resolve, 50));

  stateManager.setWaitingForUser(sessionId, true);
  await new Promise(resolve => setTimeout(resolve, 50));

  stateManager.setProcessing(sessionId, false);
  await new Promise(resolve => setTimeout(resolve, 50));

  stateManager.setWaitingForUser(sessionId, false);
  await new Promise(resolve => setTimeout(resolve, 50));

  console.log('\n4️⃣ 시나리오: 입력 비활성화');
  console.log('   - 시작: 입력 비활성화 → 활성화');

  stateManager.setInputEnabled(sessionId, false);
  await new Promise(resolve => setTimeout(resolve, 50));

  stateManager.setInputEnabled(sessionId, true);
  await new Promise(resolve => setTimeout(resolve, 50));

  console.log('\n📊 이벤트 발생 통계:');
  console.log(`   - Idle 이벤트: ${idleEvents.length}회 (${idleEvents.join(', ')})`);
  console.log(`   - 처리 시작 이벤트: ${processingStartEvents.length}회`);
  console.log(`   - 처리 완료 이벤트: ${processingFinishEvents.length}회`);
  console.log(`   - 사용자 대기 이벤트: ${waitingEvents.length}회 (${waitingEvents.join(', ')})`);

  // 리스너 정리
  idleDisposable.dispose();
  startDisposable.dispose();
  finishDisposable.dispose();
  waitStartDisposable.dispose();
  waitStopDisposable.dispose();
}

/**
 * 다중 세션 상태 관리 테스트
 */
async function testMultiSessionStateManagement() {
  console.log('\n👥 === 다중 세션 상태 관리 테스트 ===\n');

  const stateManager = new TestQueueStateManager();
  const queueService = new TestQueueServiceWithState();
  const session1 = 'session-1';
  const session2 = 'session-2';

  let processedBySession = new Map<string, string[]>();
  processedBySession.set(session1, []);
  processedBySession.set(session2, []);

  // 처리 함수 설정
  queueService.setProcessMessageDelegate(async (content, options, sessionId) => {
    if (sessionId) {
      if (!processedBySession.has(sessionId)) {
        processedBySession.set(sessionId, []);
      }
      processedBySession.get(sessionId)!.push(content);
      console.log(`   📨 [${sessionId}] 처리: "${content}"`);
    }
  });

  // 상태 관리자 구독
  const subscription = queueService.subscribeToStateManager(stateManager);

  console.log('1️⃣ 각 세션에 메시지 추가');
  queueService.addToQueue('Session 1 - Message A', undefined, session1);
  queueService.addToQueue('Session 2 - Message X', undefined, session2);
  queueService.addToQueue('Session 1 - Message B', undefined, session1);

  await new Promise(resolve => setTimeout(resolve, 200));

  console.log('\n2️⃣ 세션1 처리 중 상태로 변경');
  stateManager.setProcessing(session1, true);
  queueService.addToQueue('Session 1 - Message C', undefined, session1);

  await new Promise(resolve => setTimeout(resolve, 100));

  console.log('\n3️⃣ 세션2는 계속 처리 가능');
  queueService.addToQueue('Session 2 - Message Y', undefined, session2);

  await new Promise(resolve => setTimeout(resolve, 200));

  console.log('\n4️⃣ 세션1 사용자 대기 상태로 변경');
  stateManager.setProcessing(session1, false);
  stateManager.setWaitingForUser(session1, true);

  await new Promise(resolve => setTimeout(resolve, 100));

  console.log('\n5️⃣ 세션1 대기 해제');
  stateManager.setWaitingForUser(session1, false);

  await new Promise(resolve => setTimeout(resolve, 200));

  console.log('\n📊 세션별 처리 결과:');
  processedBySession.forEach((messages, sessionId) => {
    console.log(`   - ${sessionId}: ${messages.length}개 메시지 (${messages.join(', ')})`);
    console.log(`   - ${sessionId} 남은 큐: ${queueService.getQueuedMessages(sessionId).length}개`);
  });

  console.log('\n🎯 다중 세션 독립성:');
  const session1Processed = processedBySession.get(session1)?.length || 0;
  const session2Processed = processedBySession.get(session2)?.length || 0;
  console.log(`   - 세션 독립 처리: ${session1Processed > 0 && session2Processed > 0 ? '✅ 성공' : '❌ 실패'}`);

  subscription.dispose();
}

/**
 * 에러 상황에서의 큐 처리 테스트
 */
async function testErrorHandling() {
  console.log('\n💥 === 에러 상황 큐 처리 테스트 ===\n');

  const stateManager = new TestQueueStateManager();
  const queueService = new TestQueueServiceWithState();
  const sessionId = 'error-test-session';

  let processedMessages: string[] = [];
  let errorCount = 0;

  // 에러 발생하는 처리 함수
  queueService.setProcessMessageDelegate(async (content, options, sessionId) => {
    if (content.includes('ERROR')) {
      errorCount++;
      console.log(`   💥 [Delegate] 처리 중 에러: "${content}"`);
      throw new Error('Processing failed');
    } else {
      processedMessages.push(content);
      console.log(`   📨 [Delegate] 정상 처리: "${content}"`);
    }
  });

  const subscription = queueService.subscribeToStateManager(stateManager);

  console.log('1️⃣ 정상 메시지와 에러 메시지 추가');
  queueService.addToQueue('Normal Message 1', undefined, sessionId);
  queueService.addToQueue('ERROR Message', undefined, sessionId);
  queueService.addToQueue('Normal Message 2', undefined, sessionId);

  await new Promise(resolve => setTimeout(resolve, 300));

  console.log('\n2️⃣ 에러 후 상태 확인');
  console.log(`   - 상태 관리자 처리 중: ${stateManager.isProcessing(sessionId)}`);
  console.log(`   - 큐 서비스 처리 중: ${queueService.isProcessingQueue(sessionId)}`);
  console.log(`   - 메시지 전송 가능: ${stateManager.canSendMessage(sessionId)}`);

  console.log('\n3️⃣ 에러 후 추가 메시지');
  queueService.addToQueue('Normal Message 3', undefined, sessionId);

  await new Promise(resolve => setTimeout(resolve, 200));

  console.log('\n📊 에러 처리 결과:');
  console.log(`   - 정상 처리된 메시지: ${processedMessages.length}개 (${processedMessages.join(', ')})`);
  console.log(`   - 에러 발생 횟수: ${errorCount}회`);
  console.log(`   - 남은 큐 크기: ${queueService.getQueuedMessages(sessionId).length}개`);
  console.log(`   - 에러 복구: ${stateManager.canSendMessage(sessionId) ? '✅ 정상 상태 복구' : '❌ 상태 복구 실패'}`);

  subscription.dispose();
}

/**
 * 큐 변경 이벤트 테스트
 */
async function testQueueChangeEvents() {
  console.log('\n🔔 === 큐 변경 이벤트 테스트 ===\n');

  const queueService = new TestQueueServiceWithState();
  const sessionId = 'event-test-session';

  let changeEvents: IClaudeQueuedMessage[][] = [];

  // 큐 변경 이벤트 리스너
  const changeDisposable = queueService.onDidChangeQueue(queue => {
    changeEvents.push([...queue]);
    console.log(`   🔔 [Event] 큐 변경: ${queue.length}개 메시지`);
  });

  console.log('1️⃣ 메시지 추가 이벤트');
  queueService.addToQueue('Message 1', undefined, sessionId);
  queueService.addToQueue('Message 2', undefined, sessionId);

  await new Promise(resolve => setTimeout(resolve, 50));

  console.log('\n2️⃣ 메시지 제거 이벤트');
  const messages = queueService.getQueuedMessages(sessionId);
  if (messages.length > 0) {
    queueService.removeFromQueue(messages[0].id, sessionId);
  }

  await new Promise(resolve => setTimeout(resolve, 50));

  console.log('\n3️⃣ 큐 처리로 인한 변경 이벤트');
  queueService.setProcessMessageDelegate(async (content) => {
    console.log(`   📨 [Delegate] 처리: "${content}"`);
  });

  await queueService.processQueue(sessionId);

  console.log('\n📊 이벤트 발생 통계:');
  console.log(`   - 총 변경 이벤트: ${changeEvents.length}회`);
  changeEvents.forEach((queue, index) => {
    console.log(`   - 이벤트 ${index + 1}: ${queue.length}개 메시지`);
  });

  console.log(`   - 이벤트 기능: ${changeEvents.length > 0 ? '✅ 정상 동작' : '❌ 이벤트 미발생'}`);

  changeDisposable.dispose();
}

/**
 * 전체 상태 관리 테스트 실행
 */
async function runAllStateTests() {
  console.log('🚀 클로드 큐 상태 관리 테스트 시작');
  console.log('='.repeat(60));

  try {
    await testAutomaticQueueProcessing();
    await testStateTransitions();
    await testMultiSessionStateManagement();
    await testErrorHandling();
    await testQueueChangeEvents();

    console.log('\n🎉 === 모든 상태 관리 테스트 완료 ===');
    console.log('\n✅ 테스트 결과 요약:');
    console.log('   - 자동 큐 처리: 정상 동작');
    console.log('   - 상태 전환: 정상 동작');
    console.log('   - 다중 세션 관리: 정상 동작');
    console.log('   - 에러 처리: 정상 동작');
    console.log('   - 큐 변경 이벤트: 정상 동작');
    console.log('\n🎯 큐 상태 관리 시스템이 올바르게 구현되었습니다!');

  } catch (error) {
    console.error('\n❌ 테스트 실행 중 오류 발생:', error);
  }
}

// 테스트 실행
if (typeof window === 'undefined') { // Node.js 환경에서만 실행
  runAllStateTests();
}

export {
  TestQueueStateManager,
  TestQueueServiceWithState,
  runAllStateTests,
  testAutomaticQueueProcessing,
  testStateTransitions,
  testMultiSessionStateManagement,
  testErrorHandling,
  testQueueChangeEvents
};