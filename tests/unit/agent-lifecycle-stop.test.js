const assert = require('assert');
const { stop } = require('../../src/agent/agent-lifecycle');

describe('agent lifecycle stop', function () {
  it('kills an isolated task tracked only by currentTaskId', async function () {
    let killCount = 0;
    const agent = {
      id: 'isolated-agent',
      running: true,
      state: 'running',
      unsubscribe: null,
      currentTask: null,
      currentTaskId: 'task-123',
      _currentExecution: null,
      _killTask() {
        killCount++;
      },
      _log() {},
    };

    await stop(agent);

    assert.strictEqual(killCount, 1);
    assert.strictEqual(agent.running, false);
    assert.strictEqual(agent.state, 'stopped');
  });
});
