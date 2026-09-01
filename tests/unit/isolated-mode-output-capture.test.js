/**
 * Regression test for isolated mode output capture bug
 *
 * BUG: Isolated mode was reading from `zeroshot task run` command's stdout (help text)
 *      instead of the task's actual log file (JSON output)
 *
 * This test:
 * 1. Spawns a conductor in isolated mode
 * 2. Verifies the agent output comes from the LOG FILE (JSON)
 * 3. Verifies it does NOT contain the spawn command's help text
 */

const assert = require('assert');
const { EventEmitter } = require('events');
const Orchestrator = require('../../src/orchestrator');
const IsolationManager = require('../../src/isolation-manager');
const {
  followClaudeTaskLogsIsolated,
  killTask,
  spawnClaudeTaskIsolated,
} = require('../../src/agent/agent-task-executor');
const { getSubagentEventsDir, getSubagentEventsFile } = require('../../src/subagent-events');
const path = require('path');
const fs = require('fs');
const os = require('os');

// This test requires Docker and full isolation mode support
// Skip in CI - isolation mode tests require more than just Docker being available
const isCI = process.env.CI === 'true' || process.env.CI === '1';
const hasDocker = !isCI && IsolationManager.isDockerAvailable();
const hasImage = hasDocker && IsolationManager.imageExists('zeroshot-cluster-base');
const claudeConfigDir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
const hasClaudeCredentials = fs.existsSync(path.join(claudeConfigDir, '.credentials.json'));

const shouldRun = hasDocker && !isCI && hasImage && hasClaudeCredentials;
const codexLifecycleClusterId = `zs-isolated-codex-${process.pid}-${Math.random().toString(36).slice(2)}`;
const codexLifecycleAgentId = 'isolated-codex';

function createTailProbe() {
  const process = new EventEmitter();
  process.stdout = new EventEmitter();
  process.stderr = new EventEmitter();
  const probe = { killCount: 0 };
  process.kill = () => {
    probe.killCount++;
  };
  return { process, probe };
}

function createObserverProbe() {
  const sequence = [];
  let finishCount = 0;
  return {
    observer: {
      observeLine(line) {
        sequence.push(line);
      },
      finishParent() {
        finishCount++;
        sequence.push('finish');
      },
    },
    sequence,
    get finishCount() {
      return finishCount;
    },
  };
}

function createCodexAgent(manager, overrides = {}) {
  const publishedLines = [];
  const agent = {
    id: codexLifecycleAgentId,
    role: 'worker',
    iteration: 1,
    timeout: 0,
    config: { outputFormat: 'stream-json' },
    cluster: { id: codexLifecycleClusterId },
    isolation: { manager, clusterId: codexLifecycleClusterId },
    messageBus: {
      publish(message) {
        publishedLines.push(message.content.data.line);
      },
    },
    _resolveProvider: () => 'codex',
    _parseResultOutput: () => Promise.resolve({ ok: true }),
    _log: () => {},
    ...overrides,
  };
  return { agent, publishedLines };
}

function observerOptions(probe, overrides = {}) {
  return {
    observerFactory: () => probe.observer,
    statusIntervalMs: 5,
    maxStatusFailures: 2,
    ...overrides,
  };
}

describe('isolated Claude subagent tracking handoff', () => {
  const clusterId = `zs-isolated-exec-${process.pid}-${Math.random().toString(36).slice(2)}`;
  const agentId = 'isolated-claude';
  const eventsDir = getSubagentEventsDir(clusterId);
  const eventsFile = getSubagentEventsFile(clusterId, agentId);

  afterEach(() => {
    fs.rmSync(eventsDir, { recursive: true, force: true });
  });

  it('creates the event file and passes tracking environment before isolated Claude starts', async () => {
    let receivedEnv;
    const manager = {
      spawnInContainer(receivedClusterId, _command, { env }) {
        assert.strictEqual(receivedClusterId, clusterId);
        assert.strictEqual(fs.existsSync(eventsFile), true);
        assert.strictEqual(fs.statSync(eventsDir).mode & 0o777, 0o711);
        assert.strictEqual(fs.statSync(eventsFile).mode & 0o777, 0o622);
        receivedEnv = env;
        throw new Error('stop after inspecting spawn handoff');
      },
    };
    const agent = {
      id: agentId,
      role: 'worker',
      config: { outputFormat: 'text' },
      isolation: { manager, clusterId },
      _resolveProvider: () => 'claude',
      _resolveModelSpec: () => ({ model: null }),
      _selectModel: () => null,
      _log: () => {},
    };

    await assert.rejects(
      () => spawnClaudeTaskIsolated(agent, 'test context'),
      /stop after inspecting spawn handoff/
    );

    assert.strictEqual(receivedEnv.ZEROSHOT_TRACK_SUBAGENTS, '1');
    assert.strictEqual(receivedEnv.ZEROSHOT_SUBAGENT_EVENTS_FILE, eventsFile);
  });

  it('keeps a Codex-default cluster event bind available for a Claude agent override', async () => {
    const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zs-isolated-config-'));
    const manager = new IsolationManager();
    let dockerArgs;
    manager._getRunningContainerId = () => null;
    manager._removeContainerByName = () => {};
    manager._prepareIsolatedWorkspace = (_clusterId, workDir) => workDir;
    manager._createClusterConfigDir = () => configDir;
    manager._getDockerGid = () => '999';
    manager._applyCredentialMounts = () => [];
    manager._warnMissingProviderCredentials = () => {};
    manager._spawnContainer = (_clusterId, args) => {
      dockerArgs = args;
      return 'container-id';
    };
    manager._watchContainerExit = () => {};

    try {
      await manager.createContainer(clusterId, { workDir: '/workspace-source', provider: 'codex' });
      assert.ok(dockerArgs.includes(`${eventsDir}:${eventsDir}`));
      assert.strictEqual(fs.statSync(eventsDir).mode & 0o777, 0o711);

      manager.spawnInContainer = (_receivedClusterId, _command, { env }) => {
        assert.strictEqual(fs.existsSync(eventsFile), true);
        assert.strictEqual(env.ZEROSHOT_SUBAGENT_EVENTS_FILE, eventsFile);
        throw new Error('stop after Codex-default handoff inspection');
      };
      const agent = {
        id: agentId,
        role: 'worker',
        config: { outputFormat: 'text' },
        isolation: { manager, clusterId },
        _resolveProvider: () => 'claude',
        _resolveModelSpec: () => ({ model: null }),
        _selectModel: () => null,
        _log: () => {},
      };

      await assert.rejects(
        () => spawnClaudeTaskIsolated(agent, 'test context'),
        /stop after Codex-default handoff inspection/
      );
    } finally {
      fs.rmSync(configDir, { recursive: true, force: true });
    }
  });
});

describe('isolated Codex subagent observer lifecycle', function () {
  this.timeout(5000);

  const clusterId = codexLifecycleClusterId;
  const agentId = codexLifecycleAgentId;
  const eventsDir = getSubagentEventsDir(clusterId);
  const eventsFile = getSubagentEventsFile(clusterId, agentId);

  afterEach(() => {
    fs.rmSync(eventsDir, { recursive: true, force: true });
  });

  it('drains the final stream-json records before finalizing active children', async () => {
    const tailProcess = new EventEmitter();
    tailProcess.stdout = new EventEmitter();
    tailProcess.stderr = new EventEmitter();
    tailProcess.kill = () => {};
    const finalOutput = [
      '{"type":"thread.started","thread_id":"root"}',
      '{"type":"item.completed","item":{"type":"collab_tool_call","tool":"spawn_agent","status":"completed","sender_thread_id":"root","receiver_thread_ids":["child-final"],"prompt":"Final drain"}}',
      '{"type":"item.completed","item":{"type":"agent_message","text":"{\\"ok\\":true}"}}',
      '',
    ].join('\n');
    const manager = {
      spawnInContainer: () => tailProcess,
      execInContainer(_receivedClusterId, command) {
        const shell = command[2];
        if (shell.includes('get-log-path')) {
          return Promise.resolve({ code: 0, stdout: '/tmp/task.jsonl\n', stderr: '' });
        }
        if (shell.includes('zeroshot status')) {
          return Promise.resolve({ code: 0, stdout: 'Status: completed\n', stderr: '' });
        }
        if (shell.includes('cat "')) {
          return Promise.resolve({ code: 0, stdout: finalOutput, stderr: '' });
        }
        return Promise.reject(new Error(`unexpected command: ${shell}`));
      },
    };
    const agent = {
      id: agentId,
      role: 'worker',
      iteration: 1,
      timeout: 0,
      config: { outputFormat: 'stream-json' },
      cluster: { id: clusterId },
      isolation: { manager, clusterId },
      messageBus: { publish: () => {} },
      _resolveProvider: () => 'codex',
      _parseResultOutput: () => Promise.resolve({ ok: true }),
      _log: () => {},
    };

    const result = await followClaudeTaskLogsIsolated(agent, 'task-1');

    assert.strictEqual(result.success, true);
    const events = fs
      .readFileSync(eventsFile, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    assert.deepStrictEqual(
      events.map(({ event, agent_id }) => ({ event, agent_id })),
      [
        { event: 'start', agent_id: 'child-final' },
        { event: 'stop', agent_id: 'child-final' },
      ]
    );
  });

  it('finalizes telemetry and rejects when isolated result parsing fails', async () => {
    const tailProcess = new EventEmitter();
    tailProcess.stdout = new EventEmitter();
    tailProcess.stderr = new EventEmitter();
    tailProcess.kill = () => {};
    const finalOutput = [
      '{"type":"thread.started","thread_id":"root"}',
      '{"type":"item.completed","item":{"type":"collab_tool_call","tool":"spawn_agent","status":"completed","sender_thread_id":"root","receiver_thread_ids":["parse-child"],"prompt":"Parse failure"}}',
      '{"type":"item.completed","item":{"type":"agent_message","text":"not-json"}}',
      '',
    ].join('\n');
    const manager = {
      spawnInContainer: () => tailProcess,
      execInContainer(_receivedClusterId, command) {
        const shell = command[2];
        if (shell.includes('get-log-path')) {
          return Promise.resolve({ code: 0, stdout: '/tmp/task.jsonl\n', stderr: '' });
        }
        if (shell.includes('zeroshot status')) {
          return Promise.resolve({ code: 0, stdout: 'Status: completed\n', stderr: '' });
        }
        if (shell.includes('cat "')) {
          return Promise.resolve({ code: 0, stdout: finalOutput, stderr: '' });
        }
        return Promise.reject(new Error(`unexpected command: ${shell}`));
      },
    };
    let signalParseCalled;
    const parseCalled = new Promise((resolve) => {
      signalParseCalled = resolve;
    });
    const agent = {
      id: agentId,
      role: 'worker',
      iteration: 1,
      timeout: 0,
      config: { outputFormat: 'stream-json' },
      cluster: { id: clusterId },
      isolation: { manager, clusterId },
      messageBus: { publish: () => {} },
      _resolveProvider: () => 'codex',
      _parseResultOutput: () => {
        signalParseCalled();
        return Promise.reject(new Error('invalid Codex result'));
      },
      _log: () => {},
    };

    const taskPromise = followClaudeTaskLogsIsolated(agent, 'task-parse-error', {
      statusIntervalMs: 5,
    });
    await parseCalled;
    const outcome = await Promise.race([
      taskPromise.then(
        () => 'resolved',
        (error) => `rejected: ${error.message}`
      ),
      new Promise((resolve) => setTimeout(() => resolve('pending'), 20)),
    ]);

    assert.strictEqual(outcome, 'rejected: invalid Codex result');

    const events = fs
      .readFileSync(eventsFile, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    assert.deepStrictEqual(
      events.map(({ event, agent_id }) => ({ event, agent_id })),
      [
        { event: 'start', agent_id: 'parse-child' },
        { event: 'stop', agent_id: 'parse-child' },
      ]
    );
  });
});

describe('isolated Codex setup settlement', function () {
  this.timeout(5000);

  afterEach(() => {
    fs.rmSync(getSubagentEventsDir(codexLifecycleClusterId), { recursive: true, force: true });
  });

  it('finalizes once when get-log-path throws synchronously', async () => {
    const probe = createObserverProbe();
    const manager = {
      execInContainer() {
        throw new Error('sync get-log-path failure');
      },
    };
    const { agent } = createCodexAgent(manager);

    await assert.rejects(
      () => followClaudeTaskLogsIsolated(agent, 'task-sync-log-path', observerOptions(probe)),
      /sync get-log-path failure/
    );

    assert.strictEqual(probe.finishCount, 1);
    assert.deepStrictEqual(probe.sequence, ['finish']);
    assert.strictEqual(agent.currentTask, null);
  });

  it('finalizes once when get-log-path rejects asynchronously', async () => {
    const probe = createObserverProbe();
    const manager = {
      execInContainer: () => Promise.reject(new Error('async get-log-path failure')),
    };
    const { agent } = createCodexAgent(manager);

    await assert.rejects(
      () => followClaudeTaskLogsIsolated(agent, 'task-async-log-path', observerOptions(probe)),
      /async get-log-path failure/
    );

    assert.strictEqual(probe.finishCount, 1);
    assert.deepStrictEqual(probe.sequence, ['finish']);
    assert.strictEqual(agent.currentTask, null);
  });

  it('finalizes once for a non-zero get-log-path result', async () => {
    const probe = createObserverProbe();
    const manager = {
      execInContainer: () => Promise.resolve({ code: 9, stdout: '', stderr: 'log lookup failed' }),
    };
    const { agent } = createCodexAgent(manager);

    await assert.rejects(
      () => followClaudeTaskLogsIsolated(agent, 'task-nonzero-log-path', observerOptions(probe)),
      /log lookup failed/
    );

    assert.strictEqual(probe.finishCount, 1);
    assert.deepStrictEqual(probe.sequence, ['finish']);
    assert.strictEqual(agent.currentTask, null);
  });

  it('finalizes once for an empty get-log-path result', async () => {
    const probe = createObserverProbe();
    const manager = {
      execInContainer: () => Promise.resolve({ code: 0, stdout: ' \n', stderr: '' }),
    };
    const { agent } = createCodexAgent(manager);

    await assert.rejects(
      () => followClaudeTaskLogsIsolated(agent, 'task-empty-log-path', observerOptions(probe)),
      /Empty log path/
    );

    assert.strictEqual(probe.finishCount, 1);
    assert.deepStrictEqual(probe.sequence, ['finish']);
    assert.strictEqual(agent.currentTask, null);
  });

  it('enforces the agent timeout while log lookup is pending', async () => {
    const probe = createObserverProbe();
    let lookupStarted = false;
    const manager = {
      execInContainer: () => {
        lookupStarted = true;
        return new Promise(() => {});
      },
    };
    const { agent } = createCodexAgent(manager, { timeout: 20 });

    const resultPromise = followClaudeTaskLogsIsolated(
      agent,
      'task-pending-log-path',
      observerOptions(probe)
    );
    await Promise.resolve();
    await Promise.resolve();
    assert.strictEqual(lookupStarted, true);
    const hasCustomKill = typeof agent.currentTask?.kill === 'function';
    const outcome = await Promise.race([
      resultPromise.then(
        () => 'resolved',
        (error) => `rejected: ${error.message}`
      ),
      new Promise((resolve) => setTimeout(() => resolve('pending'), 40)),
    ]);

    assert.strictEqual(hasCustomKill, true);
    assert.strictEqual(
      outcome,
      'rejected: Task task-pending-log-path timeout after 20ms (isolated mode)'
    );
    assert.strictEqual(probe.finishCount, 1);
  });
});

describe('isolated Codex terminal settlement', function () {
  this.timeout(5000);

  afterEach(() => {
    fs.rmSync(getSubagentEventsDir(codexLifecycleClusterId), { recursive: true, force: true });
  });

  it('strips watcher epoch timestamps from live isolated telemetry', async () => {
    const probe = createObserverProbe();
    const tail = createTailProbe();
    const rootRecord = '{"type":"thread.started","thread_id":"root"}';
    const spawnRecord =
      '{"type":"item.completed","item":{"type":"collab_tool_call","tool":"spawn_agent","status":"completed","sender_thread_id":"root","receiver_thread_ids":["unseen-child"],"prompt":"Unseen drain"}}';
    const timestamp = 1700000000000;
    const finalOutput = `[${timestamp}]${rootRecord}\n[${timestamp + 1}]${spawnRecord}\n`;
    const manager = {
      spawnInContainer: () => tail.process,
      execInContainer(_receivedClusterId, command) {
        const shell = command[2];
        if (shell.includes('get-log-path')) {
          return Promise.resolve({ code: 0, stdout: '/tmp/task.jsonl\n', stderr: '' });
        }
        if (shell.includes('zeroshot status')) {
          return Promise.resolve({ code: 0, stdout: 'Status: running\n', stderr: '' });
        }
        return Promise.resolve({ code: 0, stdout: finalOutput, stderr: '' });
      },
    };
    const { agent, publishedLines } = createCodexAgent(manager, { timeout: 30 });
    const taskPromise = followClaudeTaskLogsIsolated(
      agent,
      'task-unseen-drain',
      observerOptions(probe)
    );
    await new Promise((resolve) => setTimeout(resolve, 5));
    tail.process.stdout.emit('data', Buffer.from(finalOutput));

    await assert.rejects(() => taskPromise, /timeout after 30ms/);

    assert.deepStrictEqual(probe.sequence, [rootRecord, spawnRecord, 'finish']);
    assert.deepStrictEqual(publishedLines, [rootRecord, spawnRecord]);
  });

  it('preserves live telemetry when a tail chunk splits a UTF-8 character', async () => {
    const probe = createObserverProbe();
    const tail = createTailProbe();
    const rootRecord = '{"type":"thread.started","thread_id":"root"}';
    const unicodeRecord =
      '{"type":"item.completed","item":{"type":"agent_message","text":"split 😀"}}';
    const spawnRecord =
      '{"type":"item.completed","item":{"type":"collab_tool_call","tool":"spawn_agent","status":"completed","sender_thread_id":"root","receiver_thread_ids":["utf8-child"],"prompt":"Unseen after UTF-8"}}';
    const finalOutput = `${rootRecord}\n${unicodeRecord}\n${spawnRecord}\n`;
    const manager = {
      spawnInContainer: () => tail.process,
      execInContainer(_receivedClusterId, command) {
        const shell = command[2];
        if (shell.includes('get-log-path')) {
          return Promise.resolve({ code: 0, stdout: '/tmp/task.jsonl\n', stderr: '' });
        }
        if (shell.includes('zeroshot status')) {
          return Promise.resolve({ code: 0, stdout: 'Status: running\n', stderr: '' });
        }
        return Promise.resolve({ code: 0, stdout: finalOutput, stderr: '' });
      },
    };
    const { agent } = createCodexAgent(manager, { timeout: 30 });
    const taskPromise = followClaudeTaskLogsIsolated(
      agent,
      'task-split-utf8',
      observerOptions(probe)
    );
    await new Promise((resolve) => setTimeout(resolve, 5));

    const observedPrefix = Buffer.from(`${rootRecord}\n${unicodeRecord}\n`);
    const emojiStart = observedPrefix.indexOf(Buffer.from('😀'));
    tail.process.stdout.emit('data', observedPrefix.subarray(0, emojiStart + 2));
    tail.process.stdout.emit('data', observedPrefix.subarray(emojiStart + 2));

    await assert.rejects(() => taskPromise, /timeout after 30ms/);
    assert.ok(probe.sequence.includes(unicodeRecord), 'live decoding should preserve the record');
  });

  it('does not wait for a telemetry-only final read before rejecting a timeout', async () => {
    const probe = createObserverProbe();
    const tail = createTailProbe();
    let finalReadCalls = 0;
    const manager = {
      spawnInContainer: () => tail.process,
      execInContainer(_receivedClusterId, command) {
        const shell = command[2];
        if (shell.includes('get-log-path')) {
          return Promise.resolve({ code: 0, stdout: '/tmp/task.jsonl\n', stderr: '' });
        }
        if (shell.includes('zeroshot status')) {
          return Promise.resolve({ code: 0, stdout: 'Status: running\n', stderr: '' });
        }
        finalReadCalls++;
        return new Promise(() => {});
      },
    };
    const { agent } = createCodexAgent(manager, { timeout: 20 });
    const outcome = await Promise.race([
      followClaudeTaskLogsIsolated(agent, 'task-hung-telemetry', observerOptions(probe)).then(
        () => 'resolved',
        (error) => error.message
      ),
      new Promise((resolve) => setTimeout(() => resolve('still pending'), 100)),
    ]);

    assert.match(outcome, /timeout after 20ms/);
    assert.strictEqual(tail.probe.killCount, 1);
    assert.strictEqual(finalReadCalls, 0);
  });

  it('finalizes the observer without a container read on the existing isolated timeout', async () => {
    const probe = createObserverProbe();
    const tail = createTailProbe();
    const finalOutput = [
      '{"type":"thread.started","thread_id":"root"}',
      '{"type":"item.completed","item":{"type":"collab_tool_call","tool":"spawn_agent","status":"completed","sender_thread_id":"root","receiver_thread_ids":["timeout-child"],"prompt":"Timeout drain"}}',
      '',
    ].join('\n');
    let finalReadCalls = 0;
    const manager = {
      spawnInContainer: () => tail.process,
      execInContainer(_receivedClusterId, command) {
        const shell = command[2];
        if (shell.includes('get-log-path')) {
          return Promise.resolve({ code: 0, stdout: '/tmp/task.jsonl\n', stderr: '' });
        }
        if (shell.includes('zeroshot status')) {
          return Promise.resolve({ code: 0, stdout: 'Status: running\n', stderr: '' });
        }
        finalReadCalls++;
        return Promise.resolve({ code: 0, stdout: finalOutput, stderr: '' });
      },
    };
    const { agent, publishedLines } = createCodexAgent(manager, { timeout: 20 });

    await assert.rejects(
      () => followClaudeTaskLogsIsolated(agent, 'task-timeout', observerOptions(probe)),
      /timeout after 20ms/
    );

    assert.strictEqual(probe.finishCount, 1);
    assert.deepStrictEqual(probe.sequence, ['finish']);
    assert.strictEqual(finalReadCalls, 0);
    assert.deepStrictEqual(publishedLines, []);
    assert.strictEqual(tail.probe.killCount, 1);
    assert.strictEqual(agent.currentTask, null);
  });

  it('rejects after consecutive isolated status transport failures', async () => {
    const probe = createObserverProbe();
    const tail = createTailProbe();
    const finalOutput = [
      '{"type":"thread.started","thread_id":"root"}',
      '{"type":"item.completed","item":{"type":"collab_tool_call","tool":"spawn_agent","status":"completed","sender_thread_id":"root","receiver_thread_ids":["retry-child"],"prompt":"Retry drain"}}',
      '',
    ].join('\n');
    let statusCalls = 0;
    const manager = {
      spawnInContainer: () => tail.process,
      execInContainer(_receivedClusterId, command) {
        const shell = command[2];
        if (shell.includes('get-log-path')) {
          return Promise.resolve({ code: 0, stdout: '/tmp/task.jsonl\n', stderr: '' });
        }
        if (shell.includes('zeroshot status')) {
          statusCalls++;
          return Promise.reject(new Error('isolated status unavailable'));
        }
        return Promise.resolve({ code: 0, stdout: finalOutput, stderr: '' });
      },
    };
    const { agent, publishedLines } = createCodexAgent(manager);

    const outcome = await Promise.race([
      followClaudeTaskLogsIsolated(agent, 'task-status-exhaustion', observerOptions(probe)).then(
        () => 'resolved',
        (error) => `rejected: ${error.message}`
      ),
      new Promise((resolve) => setTimeout(() => resolve('pending'), 50)),
    ]);

    assert.strictEqual(
      outcome,
      'rejected: Isolated status check failed 2 consecutive times for task task-status-exhaustion: isolated status unavailable'
    );
    assert.strictEqual(statusCalls, 2);
    assert.strictEqual(probe.finishCount, 1);
    assert.deepStrictEqual(probe.sequence, ['finish']);
    assert.deepStrictEqual(publishedLines, []);
    assert.strictEqual(tail.probe.killCount, 1);
    assert.strictEqual(agent.currentTask, null);
  });

  it('treats resolved non-zero status commands as transport failures', async () => {
    const probe = createObserverProbe();
    const tail = createTailProbe();
    let statusCalls = 0;
    const manager = {
      spawnInContainer: () => tail.process,
      execInContainer(_receivedClusterId, command) {
        const shell = command[2];
        if (shell.includes('get-log-path')) {
          return Promise.resolve({ code: 0, stdout: '/tmp/task.jsonl\n', stderr: '' });
        }
        if (shell.includes('zeroshot status')) {
          assert.strictEqual(shell.includes('|| echo'), false);
          statusCalls++;
          return Promise.resolve({ code: 125, stdout: '', stderr: 'container missing' });
        }
        return Promise.resolve({ code: 0, stdout: '', stderr: '' });
      },
    };
    const { agent } = createCodexAgent(manager);

    await assert.rejects(
      () => followClaudeTaskLogsIsolated(agent, 'task-status-nonzero', observerOptions(probe)),
      /container missing/
    );

    assert.strictEqual(statusCalls, 2);
    assert.strictEqual(agent.currentTask, null);
  });

  it('serializes isolated status checks', async () => {
    const probe = createObserverProbe();
    const tail = createTailProbe();
    let inFlight = 0;
    let maxInFlight = 0;
    const manager = {
      spawnInContainer: () => tail.process,
      execInContainer(_receivedClusterId, command) {
        const shell = command[2];
        if (shell.includes('get-log-path')) {
          return Promise.resolve({ code: 0, stdout: '/tmp/task.jsonl\n', stderr: '' });
        }
        if (shell.includes('zeroshot status')) {
          inFlight++;
          maxInFlight = Math.max(maxInFlight, inFlight);
          return new Promise((resolve) => {
            setTimeout(() => {
              inFlight--;
              resolve({ code: 0, stdout: 'Status: running\n', stderr: '' });
            }, 20);
          });
        }
        return Promise.resolve({ code: 0, stdout: '', stderr: '' });
      },
    };
    const { agent } = createCodexAgent(manager);
    const taskPromise = followClaudeTaskLogsIsolated(
      agent,
      'task-serialized-status',
      observerOptions(probe)
    );

    await new Promise((resolve) => setTimeout(resolve, 45));
    await agent.currentTask.kill('test complete');
    await taskPromise;

    assert.strictEqual(maxInFlight, 1);
  });

  it('bounds each serialized status command by the polling interval', async () => {
    const probe = createObserverProbe();
    const tail = createTailProbe();
    let receivedTimeout;
    const manager = {
      spawnInContainer: () => tail.process,
      execInContainer(_receivedClusterId, command, options = {}) {
        const shell = command[2];
        if (shell.includes('get-log-path')) {
          return Promise.resolve({ code: 0, stdout: '/tmp/task.jsonl\n', stderr: '' });
        }
        if (shell.includes('zeroshot status')) {
          receivedTimeout = options.timeout;
          return Promise.resolve({ code: 0, stdout: 'Status: running\n', stderr: '' });
        }
        return Promise.resolve({ code: 0, stdout: '', stderr: '' });
      },
    };
    const { agent } = createCodexAgent(manager);
    const taskPromise = followClaudeTaskLogsIsolated(
      agent,
      'task-status-timeout',
      observerOptions(probe, { statusIntervalMs: 20 })
    );

    await new Promise((resolve) => setTimeout(resolve, 30));
    await agent.currentTask.kill('test complete');
    await taskPromise;

    assert.strictEqual(receivedTimeout, 20);
  });

  it('keeps terminal final-drain work within the configured timeout', async () => {
    const probe = createObserverProbe();
    const tail = createTailProbe();
    let drainTimeout;
    const manager = {
      spawnInContainer: () => tail.process,
      execInContainer(_receivedClusterId, command, options = {}) {
        const shell = command[2];
        if (shell.includes('get-log-path')) {
          return Promise.resolve({ code: 0, stdout: '/tmp/task.jsonl\n', stderr: '' });
        }
        if (shell.includes('zeroshot status')) {
          return Promise.resolve({ code: 0, stdout: 'Status: completed\n', stderr: '' });
        }
        drainTimeout = options.timeout;
        return new Promise(() => {});
      },
    };
    const { agent } = createCodexAgent(manager, { timeout: 300 });
    const outcome = await Promise.race([
      followClaudeTaskLogsIsolated(agent, 'task-hung-final-drain', observerOptions(probe)).then(
        () => 'resolved',
        (error) => error.message
      ),
      new Promise((resolve) => setTimeout(() => resolve('pending'), 500)),
    ]);

    assert.match(outcome, /timeout after 300ms/);
    assert.ok(drainTimeout > 0 && drainTimeout <= 300);
    assert.strictEqual(agent.currentTask, null);
  });

  it('kills and settles an isolated task while leaving its container available', async () => {
    const probe = createObserverProbe();
    const tail = createTailProbe();
    const finalOutput = [
      '{"type":"thread.started","thread_id":"root"}',
      '{"type":"item.completed","item":{"type":"collab_tool_call","tool":"spawn_agent","status":"completed","sender_thread_id":"root","receiver_thread_ids":["kill-child"],"prompt":"Kill drain"}}',
      '',
    ].join('\n');
    let terminal = false;
    const killCommands = [];
    const manager = {
      spawnInContainer: () => tail.process,
      execInContainer(_receivedClusterId, command) {
        if (command[0] === 'zeroshot' && command[1] === 'kill') {
          killCommands.push(command);
          return Promise.resolve({ code: 0, stdout: 'killed\n', stderr: '' });
        }
        const shell = command[2];
        if (shell.includes('get-log-path')) {
          return Promise.resolve({ code: 0, stdout: '/tmp/task.jsonl\n', stderr: '' });
        }
        if (shell.includes('zeroshot status')) {
          return Promise.resolve({
            code: 0,
            stdout: terminal ? 'Status: completed\n' : 'Status: running\n',
            stderr: '',
          });
        }
        return Promise.resolve({ code: 0, stdout: finalOutput, stderr: '' });
      },
    };
    const { agent, publishedLines } = createCodexAgent(manager);
    agent.currentTaskId = 'task-kill-cleanup';
    let settled = false;
    const taskPromise = followClaudeTaskLogsIsolated(
      agent,
      'task-kill-cleanup',
      observerOptions(probe)
    );
    taskPromise.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      }
    );
    await new Promise((resolve) => setTimeout(resolve, 10));

    await killTask(agent);
    const snapshot = {
      settled,
      sequence: [...probe.sequence],
      publishedLines: [...publishedLines],
      tailKills: tail.probe.killCount,
    };

    terminal = true;
    const result = await taskPromise;

    assert.strictEqual(snapshot.settled, true);
    assert.deepStrictEqual(snapshot.sequence, ['finish']);
    assert.deepStrictEqual(snapshot.publishedLines, []);
    assert.strictEqual(snapshot.tailKills, 1);
    assert.deepStrictEqual(killCommands, [['zeroshot', 'kill', 'task-kill-cleanup']]);
    assert.strictEqual(result.success, false);
  });

  it('retains the isolated task ID and reports a failed container kill', async () => {
    const messages = [];
    const agent = {
      currentTask: null,
      currentTaskId: 'task-still-running',
      isolation: {
        clusterId: codexLifecycleClusterId,
        manager: {
          execInContainer: () =>
            Promise.resolve({ code: 1, stdout: '', stderr: 'permission denied' }),
        },
      },
      _log: (message) => messages.push(message),
    };

    await assert.rejects(() => killTask(agent), /permission denied/);

    assert.strictEqual(agent.currentTaskId, 'task-still-running');
    assert.match(messages.join('\n'), /Could not kill isolated task/);
  });
});

(shouldRun ? describe : describe.skip)('Isolated Mode Output Capture', () => {
  let orchestrator;
  const storageDir = path.join(__dirname, '.test-storage');

  beforeEach(() => {
    // Clean up storage dir
    if (fs.existsSync(storageDir)) {
      fs.rmSync(storageDir, { recursive: true, force: true });
    }

    orchestrator = new Orchestrator({
      quiet: true,
      skipLoad: true,
      storageDir,
    });
  });

  afterEach(async () => {
    // Kill all clusters
    await orchestrator.killAll();

    // Clean up storage
    if (fs.existsSync(storageDir)) {
      fs.rmSync(storageDir, { recursive: true, force: true });
    }
  });

  it('should read agent output from log file, not spawn stdout', async () => {
    // Use a simple conductor config with JSON output
    const config = {
      agents: [
        {
          id: 'test-conductor',
          role: 'conductor',
          modelLevel: 'level1',
          outputFormat: 'json',
          jsonSchema: {
            type: 'object',
            properties: {
              complexity: {
                type: 'string',
                enum: ['TRIVIAL', 'SIMPLE', 'STANDARD', 'CRITICAL'],
              },
              reasoning: { type: 'string' },
            },
            required: ['complexity', 'reasoning'],
          },
          prompt:
            'Classify this task: {{ISSUE_OPENED.content.text}}. Return JSON with complexity and reasoning.',
          triggers: [
            {
              topic: 'ISSUE_OPENED',
              action: 'execute_task',
            },
          ],
          hooks: {
            onComplete: {
              action: 'publish_message',
              config: {
                topic: 'CLASSIFICATION_DONE',
                content: {
                  text: 'Classification complete',
                  data: { result: '{{result}}' },
                },
              },
            },
          },
        },
      ],
    };

    // Start cluster with isolation
    const cluster = await orchestrator.start(
      config,
      { text: 'Add a login button' },
      { isolation: true }
    );

    // Wait for agent to complete (timeout after 2 minutes)
    const timeout = 120000;
    const start = Date.now();
    let completed = false;

    while (Date.now() - start < timeout) {
      const messages = cluster.messageBus.query({
        cluster_id: cluster.id,
        topic: 'CLASSIFICATION_DONE',
      });

      if (messages.length > 0) {
        completed = true;
        break;
      }

      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    assert.strictEqual(completed, true, 'Agent should have completed');

    // Get all agent output messages
    const outputMessages = cluster.messageBus.query({
      cluster_id: cluster.id,
      topic: 'AGENT_OUTPUT',
    });

    // CRITICAL: Should NOT contain help text from spawn stdout
    // The bug was that isolated mode captured "zeroshot kill xxx # Stop task"
    const hasHelpText = outputMessages.some((m) => {
      const text = m.content?.text || m.content?.data?.line || '';
      return text.includes('zeroshot kill') || text.includes('# Stop task');
    });

    assert.strictEqual(
      hasHelpText,
      false,
      'Agent output should NOT contain help text from spawn stdout'
    );

    // CRITICAL: Should contain actual JSON output from the task's log file
    let hasValidJson = false;
    let parsedOutput = null;

    for (const msg of outputMessages) {
      const text = msg.content?.text || msg.content?.data?.line || '';
      if (!text.trim().startsWith('{')) continue;

      try {
        const parsed = JSON.parse(text);
        if (parsed.complexity && parsed.reasoning) {
          hasValidJson = true;
          parsedOutput = parsed;
          break;
        }
      } catch {
        // Not valid JSON, continue
      }
    }

    assert.strictEqual(hasValidJson, true, 'Agent output should contain valid JSON from log file');
    assert.ok(parsedOutput, 'Should have parsed JSON output');
    assert.ok(
      ['TRIVIAL', 'SIMPLE', 'STANDARD', 'CRITICAL'].includes(parsedOutput.complexity),
      `Expected valid complexity, got: ${parsedOutput.complexity}`
    );
    assert.strictEqual(typeof parsedOutput.reasoning, 'string');
    assert.ok(parsedOutput.reasoning.length > 0, 'Reasoning should not be empty');
  }).timeout(150000); // 2.5 minute timeout for full test
});
