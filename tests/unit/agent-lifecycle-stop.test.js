const assert = require('assert');
const { stop } = require('../../src/agent/agent-lifecycle');

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

  it('keeps full-cluster stop best-effort when task termination fails', async function () {
    const agent = createAgent({
      _killTask: () => Promise.reject(new Error('container already gone')),
    });

    await stop(agent, { shutdownTimeoutMs: 20 });

    assert.strictEqual(agent.running, false);
    assert.strictEqual(agent.state, 'stopped');
  });
});
