const assert = require('assert');

const AgentWrapper = require('../../src/agent-wrapper');
const MessageBus = require('../../src/message-bus');
const Ledger = require('../../src/ledger');
const MockTaskRunner = require('../helpers/mock-task-runner');

describe('Retry does not increment iteration counter', function () {
  let ledger, messageBus, mockRunner, cluster, trigger;

  beforeEach(function () {
    ledger = new Ledger(':memory:');
    messageBus = new MessageBus(ledger);
    mockRunner = new MockTaskRunner();

    cluster = {
      id: 'retry-iter-test',
      createdAt: Date.now() - 5000,
      agents: [],
    };

    trigger = {
      cluster_id: 'retry-iter-test',
      topic: 'ISSUE_OPENED',
      sender: 'tester',
      content: { text: 'Do something' },
    };
  });

  function createWorker(overrides = {}) {
    const config = {
      id: 'worker',
      role: 'implementation',
      modelLevel: 'level2',
      timeout: 0,
      maxIterations: 5,
      maxRetries: 3,
      triggers: [{ topic: 'ISSUE_OPENED', action: 'execute_task' }],
      contextStrategy: {
        sources: [{ topic: 'ISSUE_OPENED', since: 'cluster_start', limit: 1 }],
      },
      ...overrides,
    };

    const worker = new AgentWrapper(config, messageBus, cluster, {
      testMode: true,
      taskRunner: mockRunner,
    });
    cluster.agents.push(worker);
    return worker;
  }

  it('increments iteration once on successful first task', async function () {
    const worker = createWorker();
    mockRunner.when('worker').returns({ ok: true });
    worker.start();

    await worker._executeTask(trigger);

    assert.strictEqual(worker.iteration, 1);
    mockRunner.assertCalled('worker', 1);

    await worker.stop();
  });

  it('does not double-increment iteration when first attempt fails and retry succeeds', async function () {
    const worker = createWorker();
    mockRunner.when('worker').failsOnCall(1, 'network').thenReturns({ ok: true });
    worker.start();

    await worker._executeTask(trigger);

    assert.strictEqual(worker.iteration, 1, 'iteration should be 1 after retry, not 2');
    mockRunner.assertCalled('worker', 2);

    await worker.stop();
  });

  it('reports a normal final failure when retry cleanup cannot terminate the task', async function () {
    const worker = createWorker();
    mockRunner.when('worker').failsOnCall(1, 'provider failed').thenReturns({ ok: true });
    worker._killTask = () => Promise.reject(new Error('termination failed'));
    worker.start();

    await worker._executeTask(trigger);

    mockRunner.assertCalled('worker', 1);
    assert.match(cluster.failureInfo.error, /termination failed/);
    assert.strictEqual(worker.state, 'error');
    const [clusterFailure] = messageBus.query({
      cluster_id: cluster.id,
      topic: 'CLUSTER_FAILED',
    });
    assert.strictEqual(clusterFailure.content.data.reason, 'task_termination_failed');

    await worker.stop();
  });

  it('increments iteration to 2 after two successful trigger fires', async function () {
    const worker = createWorker();
    mockRunner.when('worker').returns({ ok: true });
    worker.start();

    await worker._executeTask(trigger);
    assert.strictEqual(worker.iteration, 1);

    await worker._executeTask(trigger);
    assert.strictEqual(worker.iteration, 2);

    mockRunner.assertCalled('worker', 2);

    await worker.stop();
  });

  it('counts correctly when first trigger retries and second trigger is clean', async function () {
    const worker = createWorker();

    // First trigger: fail call 1, succeed call 2
    mockRunner.when('worker').failsOnCall(1, 'timeout').thenReturns({ ok: true });
    worker.start();

    await worker._executeTask(trigger);
    assert.strictEqual(worker.iteration, 1, 'first trigger fire = iteration 1 despite retry');

    // Reconfigure for clean success on subsequent calls
    mockRunner.when('worker').returns({ ok: true });

    await worker._executeTask(trigger);
    assert.strictEqual(worker.iteration, 2, 'second trigger fire = iteration 2');

    await worker.stop();
  });

  it('maxIterations blocks third trigger without incrementing', async function () {
    const worker = createWorker({ maxIterations: 2 });
    mockRunner.when('worker').returns({ ok: true });
    worker.start();

    await worker._executeTask(trigger);
    assert.strictEqual(worker.iteration, 1);

    await worker._executeTask(trigger);
    assert.strictEqual(worker.iteration, 2);

    // Third trigger should be blocked by maxIterations
    await worker._executeTask(trigger);
    assert.strictEqual(
      worker.iteration,
      2,
      'iteration should stay at 2 when blocked by maxIterations'
    );
    mockRunner.assertCalled('worker', 2);

    await worker.stop();
  });
});
