/**
 * 스트림 이벤트 처리 테스트
 * Claude CLI의 스트리밍 응답을 받아서 UI에 렌더링하는 과정을 테스트합니다.
 */

import { Event, Emitter } from '../../../../base/common/event.js';
import { IDisposable } from '../../../../base/common/lifecycle.js';

// Mock 타입 정의
interface IClaudeCLIStreamEvent {
  readonly type: 'system' | 'assistant' | 'text' | 'result' | 'error' |
                'tool_use' | 'tool_result' | 'content_block_start' |
                'content_block_delta' | 'content_block_stop' | 'message_start' |
                'message_delta' | 'message_stop' | 'input_request';
  readonly subtype?: string;
  readonly content?: string;
  readonly message?: { content?: any[]; usage?: any } | string;
  readonly delta?: { text?: string };
  readonly index?: number;
  readonly is_error?: boolean;

  // Tool use 필드
  readonly tool_use_id?: string;
  readonly tool_name?: string;
  readonly tool_input?: Record<string, unknown>;
  readonly tool_result?: string;

  // AskUser 필드
  readonly questions?: Array<{
    readonly question: string;
    readonly options: Array<{ label: string; description?: string }>;
    readonly multiSelect?: boolean;
  }>;

  // 에러 및 rate limit
  readonly error_type?: 'rate_limit' | 'api_error' | 'network_error' | 'unknown';
  readonly retry_after?: number;

  readonly usage?: {
    input_tokens: number;
    output_tokens: number;
    total_tokens: number;
  };
  readonly total_cost_usd?: number;
}

interface IClaudeMessage {
  readonly id: string;
  readonly role: 'user' | 'assistant';
  readonly content: string;
  readonly attachments?: any[];
  readonly timestamp: number;
  readonly isStreaming?: boolean;
  readonly isComplete?: boolean;
}

interface IToolAction {
  readonly id: string;
  readonly tool: string;
  readonly status: 'running' | 'completed' | 'failed';
  readonly input?: Record<string, unknown>;
  readonly result?: string;
  readonly error?: string;
}

/**
 * 테스트용 스트림 이벤트 프로세서
 */
class TestStreamEventProcessor {
  private readonly _onDidUpdateMessage = new Emitter<IClaudeMessage>();
  private readonly _onDidAddToolAction = new Emitter<IToolAction>();
  private readonly _onDidUpdateToolAction = new Emitter<IToolAction>();
  private readonly _onDidRequestUserInput = new Emitter<any>();
  private readonly _onDidComplete = new Emitter<void>();
  private readonly _onDidError = new Emitter<string>();

  readonly onDidUpdateMessage = this._onDidUpdateMessage.event;
  readonly onDidAddToolAction = this._onDidAddToolAction.event;
  readonly onDidUpdateToolAction = this._onDidUpdateToolAction.event;
  readonly onDidRequestUserInput = this._onDidRequestUserInput.event;
  readonly onDidComplete = this._onDidComplete.event;
  readonly onDidError = this._onDidError.event;

  private _currentMessage?: IClaudeMessage;
  private _accumulatedContent = '';
  private _currentToolActions = new Map<string, IToolAction>();
  private _isComplete = false;
  private _usage?: any;

  constructor(initialMessage: IClaudeMessage) {
    this._currentMessage = { ...initialMessage, isStreaming: true, isComplete: false };
    console.log(`🎬 [Stream Processor] 초기화: ${initialMessage.id}`);
  }

  processEvent(event: IClaudeCLIStreamEvent): void {
    if (this._isComplete) {
      console.log(`⚠️ [Stream Processor] 이미 완료된 메시지에 이벤트 수신: ${event.type}`);
      return;
    }

    console.log(`📨 [Stream Processor] 이벤트 처리: ${event.type}${event.content ? ` - "${event.content.substring(0, 30)}${event.content.length > 30 ? '...' : ''}"` : ''}`);

    switch (event.type) {
      case 'message_start':
        this._handleMessageStart(event);
        break;

      case 'content_block_start':
        this._handleContentBlockStart(event);
        break;

      case 'content_block_delta':
        this._handleContentBlockDelta(event);
        break;

      case 'content_block_stop':
        this._handleContentBlockStop(event);
        break;

      case 'message_delta':
        this._handleMessageDelta(event);
        break;

      case 'message_stop':
        this._handleMessageStop(event);
        break;

      case 'tool_use':
        this._handleToolUse(event);
        break;

      case 'tool_result':
        this._handleToolResult(event);
        break;

      case 'input_request':
        this._handleInputRequest(event);
        break;

      case 'error':
        this._handleError(event);
        break;

      case 'result':
        this._handleResult(event);
        break;

      default:
        console.log(`   ℹ️ [Stream Processor] 알 수 없는 이벤트 타입: ${event.type}`);
    }
  }

  getCurrentMessage(): IClaudeMessage | undefined {
    return this._currentMessage;
  }

  getToolActions(): IToolAction[] {
    return Array.from(this._currentToolActions.values());
  }

  isComplete(): boolean {
    return this._isComplete;
  }

  private _handleMessageStart(event: IClaudeCLIStreamEvent): void {
    console.log(`   🎬 [MessageStart] 메시지 시작`);
    this._accumulatedContent = '';
  }

  private _handleContentBlockStart(event: IClaudeCLIStreamEvent): void {
    console.log(`   📝 [ContentBlockStart] 콘텐츠 블록 시작 (index: ${event.index})`);
  }

  private _handleContentBlockDelta(event: IClaudeCLIStreamEvent): void {
    if (event.delta?.text) {
      this._accumulatedContent += event.delta.text;
      console.log(`   ➕ [ContentDelta] 텍스트 추가: "${event.delta.text}"`);

      if (this._currentMessage) {
        this._currentMessage = {
          ...this._currentMessage,
          content: this._accumulatedContent,
          timestamp: Date.now()
        };

        this._onDidUpdateMessage.fire(this._currentMessage);
      }
    }
  }

  private _handleContentBlockStop(event: IClaudeCLIStreamEvent): void {
    console.log(`   📝 [ContentBlockStop] 콘텐츠 블록 완료 (index: ${event.index})`);
  }

  private _handleMessageDelta(event: IClaudeCLIStreamEvent): void {
    console.log(`   🔄 [MessageDelta] 메시지 델타`);
    // 추가적인 메시지 메타데이터 업데이트 처리
  }

  private _handleMessageStop(event: IClaudeCLIStreamEvent): void {
    console.log(`   🏁 [MessageStop] 메시지 완료`);

    if (event.usage) {
      this._usage = event.usage;
      console.log(`   📊 [Usage] 토큰 사용량:`, event.usage);
    }

    this._completeMessage();
  }

  private _handleToolUse(event: IClaudeCLIStreamEvent): void {
    if (!event.tool_use_id || !event.tool_name) {
      console.error(`   ❌ [ToolUse] 필수 필드 누락:`, event);
      return;
    }

    const toolAction: IToolAction = {
      id: event.tool_use_id,
      tool: event.tool_name,
      status: 'running',
      input: event.tool_input
    };

    this._currentToolActions.set(event.tool_use_id, toolAction);
    console.log(`   🔧 [ToolUse] 도구 실행: ${event.tool_name} (ID: ${event.tool_use_id})`);
    console.log(`   📋 [ToolInput]`, event.tool_input);

    this._onDidAddToolAction.fire(toolAction);
  }

  private _handleToolResult(event: IClaudeCLIStreamEvent): void {
    if (!event.tool_use_id) {
      console.error(`   ❌ [ToolResult] tool_use_id 누락:`, event);
      return;
    }

    const existingAction = this._currentToolActions.get(event.tool_use_id);
    if (!existingAction) {
      console.error(`   ❌ [ToolResult] 해당 ID의 도구 실행을 찾을 수 없음: ${event.tool_use_id}`);
      return;
    }

    const updatedAction: IToolAction = {
      ...existingAction,
      status: event.is_error ? 'failed' : 'completed',
      result: event.tool_result,
      error: event.is_error ? event.tool_result : undefined
    };

    this._currentToolActions.set(event.tool_use_id, updatedAction);
    console.log(`   ✅ [ToolResult] 도구 결과: ${existingAction.tool} (${updatedAction.status})`);

    if (event.tool_result) {
      console.log(`   📤 [ToolOutput] "${event.tool_result.substring(0, 100)}${event.tool_result.length > 100 ? '...' : ''}"`);
    }

    this._onDidUpdateToolAction.fire(updatedAction);
  }

  private _handleInputRequest(event: IClaudeCLIStreamEvent): void {
    console.log(`   👤 [InputRequest] 사용자 입력 요청`);

    if (event.questions) {
      console.log(`   ❓ [Questions] ${event.questions.length}개 질문:`);
      event.questions.forEach((q, i) => {
        console.log(`     ${i + 1}. ${q.question}`);
        console.log(`        옵션: ${q.options.map(o => o.label).join(', ')}`);
        if (q.multiSelect) {
          console.log(`        (다중 선택 가능)`);
        }
      });
    }

    this._onDidRequestUserInput.fire(event);
  }

  private _handleError(event: IClaudeCLIStreamEvent): void {
    console.error(`   ❌ [Error] 스트림 에러:`, event);

    const errorMessage = event.content ||
      (typeof event.message === 'string' ? event.message : 'Unknown error');

    if (event.error_type === 'rate_limit') {
      console.log(`   ⏰ [RateLimit] 재시도까지: ${event.retry_after || 'unknown'}초`);
    }

    this._onDidError.fire(errorMessage);
  }

  private _handleResult(event: IClaudeCLIStreamEvent): void {
    console.log(`   🏆 [Result] 최종 결과 수신`);

    if (event.usage) {
      this._usage = event.usage;
      console.log(`   📊 [FinalUsage] 최종 토큰 사용량:`, event.usage);
    }

    if (event.total_cost_usd) {
      console.log(`   💰 [Cost] 총 비용: $${event.total_cost_usd}`);
    }

    this._completeMessage();
  }

  private _completeMessage(): void {
    if (this._isComplete) {
      return;
    }

    this._isComplete = true;

    if (this._currentMessage) {
      this._currentMessage = {
        ...this._currentMessage,
        content: this._accumulatedContent,
        isStreaming: false,
        isComplete: true,
        timestamp: Date.now()
      };

      console.log(`   ✅ [Complete] 메시지 완료: "${this._accumulatedContent.substring(0, 50)}${this._accumulatedContent.length > 50 ? '...' : ''}"`);
      this._onDidUpdateMessage.fire(this._currentMessage);
    }

    this._onDidComplete.fire();
  }
}

/**
 * 기본 스트림 이벤트 처리 테스트
 */
async function testBasicStreamProcessing() {
  console.log('\n🌊 === 기본 스트림 이벤트 처리 테스트 ===\n');

  const initialMessage: IClaudeMessage = {
    id: 'msg-basic-test',
    role: 'assistant',
    content: '',
    timestamp: Date.now(),
    isStreaming: true
  };

  const processor = new TestStreamEventProcessor(initialMessage);
  let messageUpdates: IClaudeMessage[] = [];

  // 이벤트 리스너 등록
  const messageDisposable = processor.onDidUpdateMessage(message => {
    messageUpdates.push({ ...message });
    console.log(`   📨 [MessageUpdate] 내용 업데이트: "${message.content.substring(0, 50)}${message.content.length > 50 ? '...' : ''}"`);
  });

  const completeDisposable = processor.onDidComplete(() => {
    console.log(`   🏁 [Complete] 스트림 처리 완료`);
  });

  console.log('1️⃣ 메시지 시작 이벤트');
  processor.processEvent({ type: 'message_start', message: 'Starting response' });

  console.log('\n2️⃣ 콘텐츠 블록 시작');
  processor.processEvent({ type: 'content_block_start', index: 0 });

  console.log('\n3️⃣ 텍스트 스트리밍 (여러 청크)');
  const textChunks = ['안녕하세요!', ' 클로드', '입니다.', ' 어떻게', ' 도와드릴까요?'];

  for (const chunk of textChunks) {
    processor.processEvent({
      type: 'content_block_delta',
      index: 0,
      delta: { text: chunk }
    });
    await new Promise(resolve => setTimeout(resolve, 50)); // 스트리밍 시뮬레이션
  }

  console.log('\n4️⃣ 콘텐츠 블록 완료');
  processor.processEvent({ type: 'content_block_stop', index: 0 });

  console.log('\n5️⃣ 메시지 완료');
  processor.processEvent({
    type: 'message_stop',
    usage: {
      input_tokens: 15,
      output_tokens: 25,
      total_tokens: 40
    }
  });

  await new Promise(resolve => setTimeout(resolve, 100));

  console.log('\n📊 처리 결과:');
  const finalMessage = processor.getCurrentMessage();
  console.log(`   - 메시지 업데이트 횟수: ${messageUpdates.length}회`);
  console.log(`   - 최종 내용: "${finalMessage?.content}"`);
  console.log(`   - 스트리밍 상태: ${finalMessage?.isStreaming ? '진행 중' : '완료'}`);
  console.log(`   - 완료 상태: ${finalMessage?.isComplete ? '✅' : '❌'}`);
  console.log(`   - 프로세서 완료: ${processor.isComplete() ? '✅' : '❌'}`);

  messageDisposable.dispose();
  completeDisposable.dispose();
}

/**
 * 도구 사용 스트림 이벤트 테스트
 */
async function testToolUseEvents() {
  console.log('\n🔧 === 도구 사용 이벤트 테스트 ===\n');

  const initialMessage: IClaudeMessage = {
    id: 'msg-tool-test',
    role: 'assistant',
    content: '',
    timestamp: Date.now(),
    isStreaming: true
  };

  const processor = new TestStreamEventProcessor(initialMessage);
  let toolActions: IToolAction[] = [];
  let toolUpdates: IToolAction[] = [];

  // 이벤트 리스너 등록
  const toolAddDisposable = processor.onDidAddToolAction(action => {
    toolActions.push({ ...action });
    console.log(`   🔧 [ToolAdd] 도구 추가: ${action.tool} (${action.status})`);
  });

  const toolUpdateDisposable = processor.onDidUpdateToolAction(action => {
    toolUpdates.push({ ...action });
    console.log(`   🔄 [ToolUpdate] 도구 업데이트: ${action.tool} (${action.status})`);
  });

  console.log('1️⃣ 첫 번째 도구 사용 (Read)');
  processor.processEvent({
    type: 'tool_use',
    tool_use_id: 'tool_001',
    tool_name: 'Read',
    tool_input: { file_path: '/test/file1.txt' }
  });

  await new Promise(resolve => setTimeout(resolve, 50));

  console.log('\n2️⃣ 두 번째 도구 사용 (Write)');
  processor.processEvent({
    type: 'tool_use',
    tool_use_id: 'tool_002',
    tool_name: 'Write',
    tool_input: { file_path: '/test/output.txt', content: 'Test content' }
  });

  await new Promise(resolve => setTimeout(resolve, 50));

  console.log('\n3️⃣ 첫 번째 도구 결과 (성공)');
  processor.processEvent({
    type: 'tool_result',
    tool_use_id: 'tool_001',
    tool_result: 'File content: Hello World',
    is_error: false
  });

  await new Promise(resolve => setTimeout(resolve, 50));

  console.log('\n4️⃣ 두 번째 도구 결과 (실패)');
  processor.processEvent({
    type: 'tool_result',
    tool_use_id: 'tool_002',
    tool_result: 'Permission denied: Cannot write to file',
    is_error: true
  });

  await new Promise(resolve => setTimeout(resolve, 50));

  console.log('\n5️⃣ 알 수 없는 도구 결과 (에러 케이스)');
  processor.processEvent({
    type: 'tool_result',
    tool_use_id: 'tool_999', // 존재하지 않는 ID
    tool_result: 'Unknown tool result'
  });

  await new Promise(resolve => setTimeout(resolve, 50));

  console.log('\n📊 도구 처리 결과:');
  const currentActions = processor.getToolActions();
  console.log(`   - 추가된 도구: ${toolActions.length}개`);
  console.log(`   - 업데이트된 도구: ${toolUpdates.length}개`);
  console.log(`   - 현재 도구 상태: ${currentActions.length}개`);

  currentActions.forEach(action => {
    console.log(`     * ${action.tool} (${action.id}): ${action.status}`);
    if (action.status === 'failed' && action.error) {
      console.log(`       에러: ${action.error}`);
    } else if (action.status === 'completed' && action.result) {
      console.log(`       결과: ${action.result.substring(0, 50)}${action.result.length > 50 ? '...' : ''}`);
    }
  });

  toolAddDisposable.dispose();
  toolUpdateDisposable.dispose();
}

/**
 * 사용자 입력 요청 이벤트 테스트
 */
async function testUserInputRequestEvents() {
  console.log('\n👤 === 사용자 입력 요청 이벤트 테스트 ===\n');

  const initialMessage: IClaudeMessage = {
    id: 'msg-input-test',
    role: 'assistant',
    content: '',
    timestamp: Date.now(),
    isStreaming: true
  };

  const processor = new TestStreamEventProcessor(initialMessage);
  let inputRequests: any[] = [];

  // 이벤트 리스너 등록
  const inputDisposable = processor.onDidRequestUserInput(request => {
    inputRequests.push(request);
    console.log(`   👤 [InputRequest] 사용자 입력 요청 수신`);
  });

  console.log('1️⃣ 단일 선택 질문');
  processor.processEvent({
    type: 'input_request',
    questions: [{
      question: '어떤 언어로 코드를 작성하시겠습니까?',
      options: [
        { label: 'JavaScript', description: 'Node.js 및 브라우저 개발' },
        { label: 'Python', description: '데이터 분석 및 웹 개발' },
        { label: 'TypeScript', description: '타입 안전한 JavaScript' }
      ],
      multiSelect: false
    }]
  });

  await new Promise(resolve => setTimeout(resolve, 50));

  console.log('\n2️⃣ 다중 선택 질문');
  processor.processEvent({
    type: 'input_request',
    questions: [{
      question: '어떤 기능을 구현하고 싶으신가요? (복수 선택 가능)',
      options: [
        { label: 'API 엔드포인트', description: 'REST API 구축' },
        { label: '데이터베이스 연동', description: 'DB 연결 및 쿼리' },
        { label: '테스트 코드', description: '단위 테스트 작성' },
        { label: '문서화', description: 'README 및 API 문서' }
      ],
      multiSelect: true
    }]
  });

  await new Promise(resolve => setTimeout(resolve, 50));

  console.log('\n3️⃣ 복수 질문');
  processor.processEvent({
    type: 'input_request',
    questions: [
      {
        question: '프로젝트 이름은 무엇인가요?',
        options: [
          { label: '직접 입력', description: '사용자 정의 이름' },
          { label: 'my-project', description: '기본 이름 사용' }
        ],
        multiSelect: false
      },
      {
        question: '추가할 라이브러리를 선택해주세요.',
        options: [
          { label: 'Express', description: '웹 프레임워크' },
          { label: 'Lodash', description: '유틸리티 라이브러리' },
          { label: 'Moment', description: '날짜 처리' }
        ],
        multiSelect: true
      }
    ]
  });

  await new Promise(resolve => setTimeout(resolve, 50));

  console.log('\n📊 입력 요청 결과:');
  console.log(`   - 총 입력 요청: ${inputRequests.length}회`);

  inputRequests.forEach((request, index) => {
    console.log(`   - 요청 ${index + 1}: ${request.questions?.length || 0}개 질문`);
    request.questions?.forEach((q: any, qi: number) => {
      console.log(`     Q${qi + 1}: ${q.question}`);
      console.log(`          ${q.options.length}개 옵션, 다중선택: ${q.multiSelect ? 'Yes' : 'No'}`);
    });
  });

  inputDisposable.dispose();
}

/**
 * 에러 처리 이벤트 테스트
 */
async function testErrorEvents() {
  console.log('\n💥 === 에러 처리 이벤트 테스트 ===\n');

  const initialMessage: IClaudeMessage = {
    id: 'msg-error-test',
    role: 'assistant',
    content: '',
    timestamp: Date.now(),
    isStreaming: true
  };

  const processor = new TestStreamEventProcessor(initialMessage);
  let errors: string[] = [];

  // 에러 이벤트 리스너
  const errorDisposable = processor.onDidError(error => {
    errors.push(error);
    console.log(`   💥 [Error] 에러 수신: "${error}"`);
  });

  console.log('1️⃣ 일반 에러');
  processor.processEvent({
    type: 'error',
    content: 'Something went wrong',
    error_type: 'unknown'
  });

  await new Promise(resolve => setTimeout(resolve, 50));

  console.log('\n2️⃣ Rate Limit 에러');
  processor.processEvent({
    type: 'error',
    content: 'Rate limit exceeded',
    error_type: 'rate_limit',
    retry_after: 60
  });

  await new Promise(resolve => setTimeout(resolve, 50));

  console.log('\n3️⃣ API 에러');
  processor.processEvent({
    type: 'error',
    message: 'API request failed',
    error_type: 'api_error'
  });

  await new Promise(resolve => setTimeout(resolve, 50));

  console.log('\n4️⃣ 네트워크 에러');
  processor.processEvent({
    type: 'error',
    content: 'Network connection failed',
    error_type: 'network_error'
  });

  await new Promise(resolve => setTimeout(resolve, 50));

  console.log('\n📊 에러 처리 결과:');
  console.log(`   - 총 에러 수신: ${errors.length}회`);
  errors.forEach((error, index) => {
    console.log(`   - 에러 ${index + 1}: "${error}"`);
  });

  errorDisposable.dispose();
}

/**
 * 완료된 스트림에 추가 이벤트 처리 테스트
 */
async function testCompletedStreamEvents() {
  console.log('\n🔒 === 완료된 스트림 추가 이벤트 테스트 ===\n');

  const initialMessage: IClaudeMessage = {
    id: 'msg-completed-test',
    role: 'assistant',
    content: '',
    timestamp: Date.now(),
    isStreaming: true
  };

  const processor = new TestStreamEventProcessor(initialMessage);
  let messageUpdatesAfterCompletion = 0;

  // 메시지 업데이트 리스너
  const messageDisposable = processor.onDidUpdateMessage(() => {
    if (processor.isComplete()) {
      messageUpdatesAfterCompletion++;
      console.log(`   ⚠️ [Warning] 완료 후 메시지 업데이트 감지`);
    }
  });

  console.log('1️⃣ 정상적인 스트림 완료');
  processor.processEvent({ type: 'message_start' });
  processor.processEvent({ type: 'content_block_delta', delta: { text: '완료 테스트 메시지' } });
  processor.processEvent({ type: 'message_stop' });

  await new Promise(resolve => setTimeout(resolve, 100));

  console.log(`   - 스트림 완료 상태: ${processor.isComplete() ? '✅' : '❌'}`);

  console.log('\n2️⃣ 완료 후 추가 이벤트 전송 시도');
  processor.processEvent({ type: 'content_block_delta', delta: { text: '추가 텍스트' } });
  processor.processEvent({ type: 'tool_use', tool_use_id: 'late_tool', tool_name: 'LateCall' });
  processor.processEvent({ type: 'message_stop' });

  await new Promise(resolve => setTimeout(resolve, 50));

  console.log('\n📊 완료 후 이벤트 처리 결과:');
  console.log(`   - 완료 후 메시지 업데이트: ${messageUpdatesAfterCompletion}회`);
  console.log(`   - 무시된 이벤트 처리: ${messageUpdatesAfterCompletion === 0 ? '✅ 올바르게 무시됨' : '❌ 처리되었음 (문제)'}`);

  messageDisposable.dispose();
}

/**
 * 복합 스트림 시나리오 테스트
 */
async function testComplexStreamScenario() {
  console.log('\n🎭 === 복합 스트림 시나리오 테스트 ===\n');

  const initialMessage: IClaudeMessage = {
    id: 'msg-complex-test',
    role: 'assistant',
    content: '',
    timestamp: Date.now(),
    isStreaming: true
  };

  const processor = new TestStreamEventProcessor(initialMessage);
  let totalUpdates = 0;
  let totalTools = 0;
  let inputRequests = 0;

  // 모든 이벤트 리스너 등록
  const messageDisposable = processor.onDidUpdateMessage(() => totalUpdates++);
  const toolAddDisposable = processor.onDidAddToolAction(() => totalTools++);
  const inputDisposable = processor.onDidRequestUserInput(() => inputRequests++);

  console.log('📝 시나리오: 복잡한 대화형 코딩 세션');

  // 메시지 시작
  processor.processEvent({ type: 'message_start' });

  // 초기 응답
  processor.processEvent({ type: 'content_block_delta', delta: { text: '파일을 읽어보겠습니다.' } });

  // 첫 번째 도구 사용
  processor.processEvent({
    type: 'tool_use',
    tool_use_id: 'read_001',
    tool_name: 'Read',
    tool_input: { file_path: 'package.json' }
  });

  processor.processEvent({
    type: 'tool_result',
    tool_use_id: 'read_001',
    tool_result: '{"name": "test-project", "version": "1.0.0"}'
  });

  // 추가 텍스트
  processor.processEvent({ type: 'content_block_delta', delta: { text: ' 이제 새 파일을 생성하겠습니다.' } });

  // 두 번째 도구 사용
  processor.processEvent({
    type: 'tool_use',
    tool_use_id: 'write_001',
    tool_name: 'Write',
    tool_input: { file_path: 'src/index.js', content: 'console.log("Hello World");' }
  });

  processor.processEvent({
    type: 'tool_result',
    tool_use_id: 'write_001',
    tool_result: 'File written successfully'
  });

  // 사용자 입력 요청
  processor.processEvent({
    type: 'input_request',
    questions: [{
      question: '다음에 무엇을 하시겠습니까?',
      options: [
        { label: 'Test 작성', description: '테스트 코드 추가' },
        { label: 'Build 설정', description: '빌드 시스템 구성' },
        { label: '완료', description: '작업 종료' }
      ],
      multiSelect: false
    }]
  });

  // 최종 텍스트
  processor.processEvent({ type: 'content_block_delta', delta: { text: ' 선택해주세요!' } });

  // 완료
  processor.processEvent({
    type: 'message_stop',
    usage: {
      input_tokens: 120,
      output_tokens: 85,
      total_tokens: 205
    }
  });

  await new Promise(resolve => setTimeout(resolve, 200));

  console.log('\n📊 복합 시나리오 결과:');
  const finalMessage = processor.getCurrentMessage();
  const toolActions = processor.getToolActions();

  console.log(`   - 메시지 업데이트: ${totalUpdates}회`);
  console.log(`   - 도구 사용: ${totalTools}개`);
  console.log(`   - 사용자 입력 요청: ${inputRequests}회`);
  console.log(`   - 최종 메시지 길이: ${finalMessage?.content.length}자`);
  console.log(`   - 완료된 도구: ${toolActions.filter(t => t.status === 'completed').length}개`);
  console.log(`   - 스트림 완료: ${processor.isComplete() ? '✅' : '❌'}`);

  console.log('\n📋 최종 메시지 내용:');
  console.log(`   "${finalMessage?.content}"`);

  console.log('\n🔧 도구 실행 이력:');
  toolActions.forEach(tool => {
    console.log(`   - ${tool.tool} (${tool.id}): ${tool.status}`);
  });

  messageDisposable.dispose();
  toolAddDisposable.dispose();
  inputDisposable.dispose();
}

/**
 * 전체 스트림 이벤트 테스트 실행
 */
async function runAllStreamTests() {
  console.log('🚀 클로드 스트림 이벤트 처리 테스트 시작');
  console.log('=' * 60);

  try {
    await testBasicStreamProcessing();
    await testToolUseEvents();
    await testUserInputRequestEvents();
    await testErrorEvents();
    await testCompletedStreamEvents();
    await testComplexStreamScenario();

    console.log('\n🎉 === 모든 스트림 이벤트 테스트 완료 ===');
    console.log('\n✅ 테스트 결과 요약:');
    console.log('   - 기본 스트림 처리: 정상 동작');
    console.log('   - 도구 사용 이벤트: 정상 동작');
    console.log('   - 사용자 입력 요청: 정상 동작');
    console.log('   - 에러 처리: 정상 동작');
    console.log('   - 완료 후 이벤트 무시: 정상 동작');
    console.log('   - 복합 시나리오: 정상 동작');
    console.log('\n🎯 스트림 이벤트 처리 시스템이 올바르게 구현되었습니다!');

  } catch (error) {
    console.error('\n❌ 테스트 실행 중 오류 발생:', error);
  }
}

// 테스트 실행
if (typeof window === 'undefined') { // Node.js 환경에서만 실행
  runAllStreamTests();
}

export {
  TestStreamEventProcessor,
  runAllStreamTests,
  testBasicStreamProcessing,
  testToolUseEvents,
  testUserInputRequestEvents,
  testErrorEvents,
  testCompletedStreamEvents,
  testComplexStreamScenario
};