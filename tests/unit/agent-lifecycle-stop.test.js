const assert = require('assert');
const AgentWrapper = require('../../src/agent-wrapper');
const { start, stop, executeTask } = require('../../src/agent/agent-lifecycle');

describe('agent lifecycle stop', function () {
  function createAgent(overrides = {}) {
    return {
      id: 'isolated-agent',
      running: true,
      state: 'running',
      unsubscribe: null,
      currentTask: null,
      currentTaskId: 'task-123',
      _currentExecution: null,
      _killTask() {},
      _log() {},
      ...overrides,
    };
  }

  it('kills an isolated task tracked only by currentTaskId', async function () {
    let killCount = 0;
    const agent = createAgent({
      _killTask() {
        killCount++;
      },
    });

    await stop(agent);

    assert.strictEqual(killCount, 1);
    assert.strictEqual(agent.running, false);
    assert.strictEqual(agent.state, 'stopped');
  });

  it('bounds task termination and execution within one shutdown timeout', async function () {
    const agent = createAgent({
      _killTask: () => new Promise(() => {}),
      _currentExecution: new Promise(() => {}),
    });

    const outcome = await Promise.race([
      stop(agent, { shutdownTimeoutMs: 20 }).then(() => 'stopped'),
      new Promise((resolve) => setTimeout(() => resolve('test-timeout'), 100)),
    ]);

    assert.strictEqual(outcome, 'stopped');
  });

  it('fails closed when strict task termination fails', async function () {
    let killAttempts = 0;
    const agent = createAgent({
      _killTask: () => {
        killAttempts++;
        if (killAttempts === 1) return Promise.reject(new Error('container kill failed'));
        agent.currentTaskId = null;
        return Promise.resolve();
      },
    });

    await assert.rejects(
      () => stop(agent, { requireTaskTermination: true, shutdownTimeoutMs: 20 }),
      /container kill failed/
    );

    await stop(agent, { requireTaskTermination: true, shutdownTimeoutMs: 20 });
    assert.strictEqual(killAttempts, 2);
  });

  it('keeps strict stop retry-visible while an untracked execution is still running', async function () {
    const execution = new Promise(() => {});
    const agent = createAgent({ currentTaskId: null, _currentExecution: execution });

    await assert.rejects(
      () => stop(agent, { requireTaskTermination: true, shutdownTimeoutMs: 20 }),
      /Timed out terminating task/
    );
    assert.strictEqual(agent._currentExecution, execution);

    await assert.rejects(
      () => stop(agent, { requireTaskTermination: true, shutdownTimeoutMs: 20 }),
      /Timed out terminating task/
    );
  });

  it('keeps full-cluster stop best-effort when task termination fails', async function () {
    const agent = createAgent({
      _killTask: () => Promise.reject(new Error('container already gone')),
    });

    await stop(agent, { shutdownTimeoutMs: 20 });

    assert.strictEqual(agent.running, false);
    assert.strictEqual(agent.state, 'stopped');
  });

  it('does not start a replacement while an earlier execution is still pending', () => {
    const agent = createAgent({
      running: false,
      state: 'stopped',
      currentTaskId: null,
      _currentExecution: new Promise(() => {}),
      messageBus: { subscribe: () => () => {} },
      cluster: { id: 'cluster-1' },
      config: {},
      _publishLifecycle() {},
    });

    assert.throws(() => start(agent), /execution is still pending/);
  });

  it('tracks resume executions until they settle', async () => {
    let release;
    const pending = new Promise((resolve) => {
      release = resolve;
    });
    const agent = {
      id: 'resume-agent',
      running: true,
      state: 'idle',
      cluster: { id: 'cluster-1' },
      _log() {},
      _executeTask: () => pending,
      _currentExecution: null,
    };

    const resumePromise = AgentWrapper.prototype.resume.call(agent, 'continue');
    await Promise.resolve();
    assert.strictEqual(agent._currentExecution, pending);

    release();
    await resumePromise;
    assert.strictEqual(agent._currentExecution, null);
  });

  it('does not spawn after stop begins during pre-task setup', async () => {
    let spawnCalls = 0;
    const agent = createAgent({
      id: 'pre-spawn-agent',
      currentTaskId: null,
      state: 'idle',
      role: 'implementation',
      iteration: 0,
      maxIterations: 5,
      config: { maxRetries: 1 },
      cluster: { id: 'cluster-1', createdAt: Date.now(), failureInfo: null },
      messageBus: { publish() {} },
      _publish() {},
      _publishLifecycle() {},
      _buildContext: () => 'context',
      _resolveModelSpec: () => ({ model: null }),
      _selectModel: () => null,
      _spawnClaudeTask: () => {
        spawnCalls++;
        return Promise.resolve({ success: true, output: '', result: {} });
      },
    });
    const trigger = {
      cluster_id: 'cluster-1',
      topic: 'ISSUE_OPENED',
      sender: 'tester',
      content: { text: 'work' },
    };

    const execution = executeTask(agent, trigger);
    agent._currentExecution = execution;
    await stop(agent, { requireTaskTermination: true, shutdownTimeoutMs: 100 });
    await execution;

    assert.strictEqual(spawnCalls, 0);
  });
});
