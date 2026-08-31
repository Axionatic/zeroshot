const assert = require('assert');

const { handleStatusCompletion } = require('../../src/agent/agent-task-executor');

function makeAgent(id = 'test-agent') {
  return {
    id,
    role: 'worker',
    quiet: false,
    config: { cwd: '/tmp' },
    processPid: 1234,
    worktree: null,
    isolation: null,
    _log() {},
    _parseResultOutput: () => Promise.resolve({ ok: true }),
  };
}

function makeState(output = '') {
  return {
    output,
    resolved: false,
    logFilePath: null,
    pollInterval: null,
    statusCheckInterval: null,
  };
}

describe('handleStatusCompletion stale + empty output guard', () => {
  it('returns false (keep polling) when stale with empty output', () => {
    const result = handleStatusCompletion({
      agent: makeAgent(),
      taskId: 'task-1',
      providerName: 'claude',
      state: makeState(''),
      stdout: 'Status: stale',
      pollLogFile: () => {},
      resolve: () => assert.fail('should not resolve'),
    });

    assert.strictEqual(result, false, 'should return false to continue polling');
  });

  it('returns false (keep polling) when stale with null output', () => {
    const state = makeState('');
    state.output = null;

    const result = handleStatusCompletion({
      agent: makeAgent(),
      taskId: 'task-1',
      providerName: 'claude',
      state,
      stdout: 'Status: stale',
      pollLogFile: () => {},
      resolve: () => assert.fail('should not resolve'),
    });

    assert.strictEqual(result, false);
  });

  it('returns true and finalizes exactly once before resolving stale output', async () => {
    const sequence = [];
    let resolveResult;
    const settled = new Promise((resolve) => {
      resolveResult = (value) => {
        sequence.push('resolve');
        resolve(value);
      };
    });
    const result = handleStatusCompletion({
      agent: makeAgent(),
      taskId: 'task-1',
      providerName: 'claude',
      state: makeState('some task output here'),
      stdout: 'Status: stale',
      pollLogFile: () => {},
      resolve: resolveResult,
      finalize: () => sequence.push('finalize'),
    });

    assert.strictEqual(result, true, 'should return true when stale with output');
    await settled;
    assert.deepStrictEqual(sequence, ['finalize', 'resolve']);
  });

  it('returns true and finalizes exactly once before resolving completed output', async () => {
    const sequence = [];
    let resolveResult;
    const settled = new Promise((resolve) => {
      resolveResult = (value) => {
        sequence.push('resolve');
        resolve(value);
      };
    });
    const result = handleStatusCompletion({
      agent: makeAgent(),
      taskId: 'task-1',
      providerName: 'claude',
      state: makeState(''),
      stdout: 'Status: completed',
      pollLogFile: () => {},
      resolve: resolveResult,
      finalize: () => sequence.push('finalize'),
    });

    assert.strictEqual(result, true, 'completed status should always resolve');
    await settled;
    assert.deepStrictEqual(sequence, ['finalize', 'resolve']);
  });

  it('returns true and finalizes exactly once before resolving failed output', async () => {
    const sequence = [];
    let resolveResult;
    const settled = new Promise((resolve) => {
      resolveResult = (value) => {
        sequence.push('resolve');
        resolve(value);
      };
    });
    const result = handleStatusCompletion({
      agent: makeAgent(),
      taskId: 'task-1',
      providerName: 'claude',
      state: makeState(''),
      stdout: 'Status: failed',
      pollLogFile: () => {},
      resolve: resolveResult,
      finalize: () => sequence.push('finalize'),
    });

    assert.strictEqual(result, true, 'failed status should always resolve');
    await settled;
    assert.deepStrictEqual(sequence, ['finalize', 'resolve']);
  });

  it('returns false when status is not terminal', () => {
    const result = handleStatusCompletion({
      agent: makeAgent(),
      taskId: 'task-1',
      providerName: 'claude',
      state: makeState(''),
      stdout: 'Status: running',
      pollLogFile: () => {},
      resolve: () => assert.fail('should not resolve'),
    });

    assert.strictEqual(result, false, 'running status should keep polling');
  });
});
