/**
 * 클로드 메시지큐 시스템 통합 테스트 러너
 * 모든 테스트 모듈을 실행하고 결과를 종합합니다.
 */

import { runAllTests as runQueueTests } from './messageQueue.test.js';
import { runAllIPCTests as runIPCTests } from './ipcChannel.test.js';
import { runAllStateTests as runStateTests } from './queueStateManager.test.js';
import { runAllStreamTests as runStreamTests } from './streamEventProcessor.test.js';

interface TestSuite {
  name: string;
  description: string;
  runner: () => Promise<void>;
  category: 'core' | 'communication' | 'integration';
}

interface TestResult {
  suite: string;
  success: boolean;
  duration: number;
  error?: string;
}

/**
 * 테스트 실행기
 */
class ClaudeTestRunner {
  private readonly testSuites: TestSuite[] = [
    {
      name: '메시지큐 서비스',
      description: '메시지 큐의 기본 CRUD 및 용량 제한, 다중 세션 처리',
      runner: runQueueTests,
      category: 'core'
    },
    {
      name: 'IPC 채널 통신',
      description: 'Main/Renderer 프로세스 간 IPC 통신 및 이벤트 스트리밍',
      runner: runIPCTests,
      category: 'communication'
    },
    {
      name: '큐 상태 관리',
      description: '상태 기반 자동 큐 처리 및 세션별 상태 전환',
      runner: runStateTests,
      category: 'integration'
    },
    {
      name: '스트림 이벤트 처리',
      description: 'Claude CLI 스트리밍 응답의 실시간 UI 렌더링',
      runner: runStreamTests,
      category: 'integration'
    }
  ];

  private results: TestResult[] = [];

  async runAllTests(): Promise<void> {
    console.log('🚀 클로드 메시지큐 시스템 전체 테스트 시작');
    console.log('=' * 80);
    console.log('📅 실행 시간:', new Date().toLocaleString());
    console.log('🧪 총 테스트 스위트:', this.testSuites.length);
    console.log('');

    this.results = [];
    let successCount = 0;

    for (const suite of this.testSuites) {
      await this.runTestSuite(suite);
      if (this.results[this.results.length - 1]?.success) {
        successCount++;
      }
    }

    this.printSummary(successCount);
  }

  async runTestsByCategory(category: 'core' | 'communication' | 'integration'): Promise<void> {
    const categoryTests = this.testSuites.filter(suite => suite.category === category);

    console.log(`🧪 ${this.getCategoryName(category)} 테스트 시작`);
    console.log('=' * 60);
    console.log('📅 실행 시간:', new Date().toLocaleString());
    console.log('🧪 테스트 스위트:', categoryTests.length);
    console.log('');

    this.results = [];
    let successCount = 0;

    for (const suite of categoryTests) {
      await this.runTestSuite(suite);
      if (this.results[this.results.length - 1]?.success) {
        successCount++;
      }
    }

    this.printSummary(successCount, category);
  }

  async runSingleTest(suiteName: string): Promise<void> {
    const suite = this.testSuites.find(s => s.name === suiteName);
    if (!suite) {
      console.error(`❌ 테스트 스위트를 찾을 수 없습니다: "${suiteName}"`);
      console.log('📋 사용 가능한 테스트 스위트:');
      this.testSuites.forEach(s => {
        console.log(`   - ${s.name}`);
      });
      return;
    }

    console.log(`🧪 단일 테스트 실행: ${suite.name}`);
    console.log('=' * 60);
    console.log('📅 실행 시간:', new Date().toLocaleString());
    console.log('');

    this.results = [];
    await this.runTestSuite(suite);

    const result = this.results[0];
    if (result) {
      console.log(`\n🎯 테스트 결과: ${result.success ? '✅ 성공' : '❌ 실패'}`);
      console.log(`⏱️ 실행 시간: ${result.duration.toFixed(2)}초`);

      if (result.error) {
        console.log(`💥 에러: ${result.error}`);
      }
    }
  }

  private async runTestSuite(suite: TestSuite): Promise<void> {
    console.log(`\n🧪 [${suite.category.toUpperCase()}] ${suite.name}`);
    console.log(`📝 ${suite.description}`);
    console.log('─' * 60);

    const startTime = Date.now();
    let success = false;
    let error: string | undefined;

    try {
      // 콘솔 로그 캡처 시작
      const originalConsole = this.captureConsoleOutput();

      await suite.runner();

      // 콘솔 로그 캡처 종료
      this.restoreConsoleOutput(originalConsole);

      success = true;
      console.log(`✅ ${suite.name}: 성공`);

    } catch (err) {
      success = false;
      error = err instanceof Error ? err.message : String(err);
      console.error(`❌ ${suite.name}: 실패`);
      console.error(`💥 에러: ${error}`);
    }

    const duration = (Date.now() - startTime) / 1000;
    console.log(`⏱️ 실행 시간: ${duration.toFixed(2)}초`);

    this.results.push({
      suite: suite.name,
      success,
      duration,
      error
    });
  }

  private printSummary(successCount: number, category?: string): void {
    const total = this.results.length;
    const failureCount = total - successCount;
    const totalDuration = this.results.reduce((sum, result) => sum + result.duration, 0);

    console.log('\n' + '=' * 80);
    console.log('📊 테스트 실행 결과 요약');
    if (category) {
      console.log(`📂 카테고리: ${this.getCategoryName(category)}`);
    }
    console.log('─' * 80);

    // 전체 통계
    console.log(`\n📈 전체 통계:`);
    console.log(`   ✅ 성공: ${successCount}/${total} (${((successCount / total) * 100).toFixed(1)}%)`);
    console.log(`   ❌ 실패: ${failureCount}/${total} (${((failureCount / total) * 100).toFixed(1)}%)`);
    console.log(`   ⏱️ 총 실행 시간: ${totalDuration.toFixed(2)}초`);

    // 개별 결과
    console.log(`\n📋 개별 테스트 결과:`);
    this.results.forEach(result => {
      const icon = result.success ? '✅' : '❌';
      const status = result.success ? '성공' : '실패';
      console.log(`   ${icon} ${result.suite}: ${status} (${result.duration.toFixed(2)}s)`);

      if (result.error) {
        console.log(`      💥 ${result.error}`);
      }
    });

    // 실패한 테스트 상세
    const failedTests = this.results.filter(r => !r.success);
    if (failedTests.length > 0) {
      console.log(`\n🚨 실패한 테스트 상세:`);
      failedTests.forEach(result => {
        console.log(`   📍 ${result.suite}:`);
        console.log(`      - 실행 시간: ${result.duration.toFixed(2)}초`);
        if (result.error) {
          console.log(`      - 에러: ${result.error}`);
        }
      });
    }

    // 카테고리별 성과
    if (!category) {
      console.log(`\n📊 카테고리별 성과:`);
      const categories = ['core', 'communication', 'integration'] as const;

      categories.forEach(cat => {
        const categoryResults = this.results.filter((_, index) =>
          this.testSuites[index]?.category === cat
        );

        if (categoryResults.length > 0) {
          const categorySuccess = categoryResults.filter(r => r.success).length;
          const categoryTotal = categoryResults.length;
          const categoryPercent = ((categorySuccess / categoryTotal) * 100).toFixed(1);

          console.log(`   📂 ${this.getCategoryName(cat)}: ${categorySuccess}/${categoryTotal} (${categoryPercent}%)`);
        }
      });
    }

    // 최종 판정
    console.log('\n' + '=' * 80);
    if (successCount === total) {
      console.log('🎉 모든 테스트 통과! 클로드 메시지큐 시스템이 올바르게 구현되었습니다.');
      console.log('🚀 시스템이 프로덕션 환경에서 사용할 준비가 되었습니다.');
    } else {
      console.log(`⚠️  ${failureCount}개 테스트 실패. 문제를 해결한 후 다시 테스트해주세요.`);
      console.log('🔧 실패한 테스트를 개별적으로 실행하여 문제를 진단할 수 있습니다.');
    }
    console.log('=' * 80);
  }

  private getCategoryName(category: string): string {
    switch (category) {
      case 'core': return '핵심 기능';
      case 'communication': return '통신 계층';
      case 'integration': return '통합 기능';
      default: return category;
    }
  }

  private captureConsoleOutput() {
    // 실제로는 테스트 출력을 캡처하여 정리된 결과만 표시할 수 있지만
    // 지금은 모든 로그를 그대로 표시
    return {
      log: console.log,
      error: console.error,
      warn: console.warn,
      info: console.info
    };
  }

  private restoreConsoleOutput(originalConsole: any) {
    // 원래 console 복원 (실제 구현에서는 필요 시)
  }

  listAvailableTests(): void {
    console.log('📋 사용 가능한 테스트 스위트:');
    console.log('─' * 60);

    const categories = ['core', 'communication', 'integration'] as const;

    categories.forEach(category => {
      const categoryTests = this.testSuites.filter(suite => suite.category === category);

      if (categoryTests.length > 0) {
        console.log(`\n📂 ${this.getCategoryName(category)}:`);

        categoryTests.forEach(suite => {
          console.log(`   🧪 ${suite.name}`);
          console.log(`      📝 ${suite.description}`);
        });
      }
    });

    console.log('\n🚀 실행 방법:');
    console.log('   - 전체 테스트: runAllTests()');
    console.log('   - 카테고리별: runTestsByCategory("core"|"communication"|"integration")');
    console.log('   - 개별 테스트: runSingleTest("테스트 스위트 이름")');
  }
}

/**
 * 테스트 러너 인스턴스
 */
const testRunner = new ClaudeTestRunner();

/**
 * 편의 함수들
 */

/**
 * 모든 테스트 실행
 */
export async function runAllTests(): Promise<void> {
  await testRunner.runAllTests();
}

/**
 * 카테고리별 테스트 실행
 */
export async function runCoreTests(): Promise<void> {
  await testRunner.runTestsByCategory('core');
}

export async function runCommunicationTests(): Promise<void> {
  await testRunner.runTestsByCategory('communication');
}

export async function runIntegrationTests(): Promise<void> {
  await testRunner.runTestsByCategory('integration');
}

/**
 * 개별 테스트 실행
 */
export async function runQueueServiceTests(): Promise<void> {
  await testRunner.runSingleTest('메시지큐 서비스');
}

export async function runIPCChannelTests(): Promise<void> {
  await testRunner.runSingleTest('IPC 채널 통신');
}

export async function runStateManagerTests(): Promise<void> {
  await testRunner.runSingleTest('큐 상태 관리');
}

export async function runStreamProcessorTests(): Promise<void> {
  await testRunner.runSingleTest('스트림 이벤트 처리');
}

/**
 * 사용 가능한 테스트 목록 표시
 */
export function listTests(): void {
  testRunner.listAvailableTests();
}

/**
 * 빠른 스모크 테스트 (핵심 기능만)
 */
export async function runSmokeTests(): Promise<void> {
  console.log('🔥 스모크 테스트 시작 (핵심 기능만)');
  console.log('=' * 50);

  await testRunner.runTestsByCategory('core');
}

/**
 * 성능 테스트 (대용량 데이터)
 */
export async function runPerformanceTests(): Promise<void> {
  console.log('⚡ 성능 테스트 시작');
  console.log('=' * 50);
  console.log('⚠️ 성능 테스트는 아직 구현되지 않았습니다.');
  console.log('📋 향후 구현 예정:');
  console.log('   - 대용량 큐 처리 성능');
  console.log('   - 다중 세션 동시 처리');
  console.log('   - 메모리 사용량 최적화');
  console.log('   - 스트림 이벤트 처리 지연 시간');
}

// Node.js 환경에서 기본 실행
if (typeof window === 'undefined') {
  const args = process.argv.slice(2);
  const command = args[0];

  switch (command) {
    case 'all':
      runAllTests();
      break;
    case 'core':
      runCoreTests();
      break;
    case 'communication':
      runCommunicationTests();
      break;
    case 'integration':
      runIntegrationTests();
      break;
    case 'smoke':
      runSmokeTests();
      break;
    case 'performance':
      runPerformanceTests();
      break;
    case 'list':
      listTests();
      break;
    case 'queue':
      runQueueServiceTests();
      break;
    case 'ipc':
      runIPCChannelTests();
      break;
    case 'state':
      runStateManagerTests();
      break;
    case 'stream':
      runStreamProcessorTests();
      break;
    case undefined:
    case 'help':
      console.log('🧪 클로드 메시지큐 테스트 러너');
      console.log('=' * 40);
      console.log('📋 사용법:');
      console.log('  node testRunner.js <command>');
      console.log('');
      console.log('📂 명령어:');
      console.log('  all           - 모든 테스트 실행');
      console.log('  core          - 핵심 기능 테스트');
      console.log('  communication - 통신 계층 테스트');
      console.log('  integration   - 통합 기능 테스트');
      console.log('  smoke         - 스모크 테스트');
      console.log('  performance   - 성능 테스트');
      console.log('  list          - 테스트 목록');
      console.log('  queue         - 메시지큐 테스트');
      console.log('  ipc           - IPC 채널 테스트');
      console.log('  state         - 상태 관리 테스트');
      console.log('  stream        - 스트림 처리 테스트');
      console.log('  help          - 도움말');
      break;
    default:
      console.error(`❌ 알 수 없는 명령어: ${command}`);
      console.log('💡 사용법: node testRunner.js help');
  }
}

export { ClaudeTestRunner, testRunner };