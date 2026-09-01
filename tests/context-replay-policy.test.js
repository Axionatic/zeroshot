const assert = require('assert');
const AgentWrapper = require('../src/agent-wrapper');
const Ledger = require('../src/ledger');
const MessageBus = require('../src/message-bus');
const {
  RAW_LOG_ONLY_REPLAY_POLICY,
  buildRawLogOnlyMetadata,
  isReplayableMessage,
} = require('../src/agent/context-replay-policy');
const {
  broadcastAgentLine,
  broadcastIsolatedLine,
  createLogFollower,
} = require('../src/agent/agent-task-executor');
const { getSubagentEventsDir, getSubagentEventsFile } = require('../src/subagent-events');
const { createCodexSubagentObserver } = require('../src/codex-subagent-observer');
const fs = require('fs');
const os = require('os');
const path = require('path');

describe('context replay policy', () => {
  it('treats raw provider output as raw-log-only unless explicitly context-safe', () => {
    assert.strictEqual(isReplayableMessage({ topic: 'AGENT_OUTPUT' }), false);
    assert.strictEqual(
      isReplayableMessage({
        topic: 'AGENT_OUTPUT',
        metadata: buildRawLogOnlyMetadata(),
      }),
      false
    );
    assert.strictEqual(
      isReplayableMessage({
        topic: 'AGENT_OUTPUT',
        metadata: { contextSafe: true },
      }),
      true
    );
    assert.strictEqual(
      isReplayableMessage({
        topic: 'VALIDATION_RESULT',
        content: { text: 'compact status' },
      }),
      true
    );
  });

  it('applies the same raw-log-only metadata to normal and isolated provider output', () => {
    const normalMessages = [];
    const agent = {
      id: 'worker',
      role: 'implementation',
      iteration: 2,
      lastOutputTime: 0,
      _publish: (message) => normalMessages.push(message),
    };
    const state = { output: '' };

    broadcastAgentLine({
      agent,
      providerName: 'codex',
      state,
      line: '[1700000000000]{"type":"compiler-artifact"}',
    });

    const isolatedMessages = [];
    broadcastIsolatedLine({
      agent: {
        id: 'isolated-worker',
        iteration: 3,
        cluster: { id: 'cluster-1' },
        messageBus: { publish: (message) => isolatedMessages.push(message) },
        lastOutputTime: 0,
      },
      providerName: 'codex',
      taskId: 'task-1',
      line: '[2026-05-06T12:00:00.000Z] *** Begin Patch',
    });

    assert.deepStrictEqual(normalMessages[0].metadata, {
      contextSafe: false,
      replayPolicy: RAW_LOG_ONLY_REPLAY_POLICY,
    });
    assert.deepStrictEqual(isolatedMessages[0].metadata, {
      contextSafe: false,
      replayPolicy: RAW_LOG_ONLY_REPLAY_POLICY,
    });
  });

  it('observes Codex json and stream-json records before normal and isolated broadcast', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zs-observed-lines-'));
    const normalEventsFile = path.join(tempDir, 'normal.jsonl');
    const isolatedEventsFile = path.join(tempDir, 'isolated.jsonl');
    const eventIds = (filePath) =>
      fs
        .readFileSync(filePath, 'utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line).agent_id);

    try {
      const normalObserver = createCodexSubagentObserver({
        parentAgentId: 'normal-worker',
        eventsFile: normalEventsFile,
        now: () => 1000,
      });
      const normalAgent = {
        id: 'normal-worker',
        role: 'implementation',
        iteration: 1,
        config: { outputFormat: 'json' },
        _publish(message) {
          if (message.content.data.line.includes('spawn_agent')) {
            assert.deepStrictEqual(eventIds(normalEventsFile), ['normal-child']);
          }
        },
      };
      const normalState = { output: '' };
      broadcastAgentLine({
        agent: normalAgent,
        providerName: 'codex',
        state: normalState,
        observer: normalObserver,
        line: '[1700000000000]{"type":"thread.started","thread_id":"root"}',
      });
      broadcastAgentLine({
        agent: normalAgent,
        providerName: 'codex',
        state: normalState,
        observer: normalObserver,
        line: '[1700000000001]{"type":"item.completed","item":{"type":"collab_tool_call","tool":"spawn_agent","status":"completed","sender_thread_id":"root","receiver_thread_ids":["normal-child"],"prompt":"Normal child"}}',
      });

      const isolatedObserver = createCodexSubagentObserver({
        parentAgentId: 'isolated-worker',
        eventsFile: isolatedEventsFile,
        now: () => 2000,
      });
      const isolatedAgent = {
        id: 'isolated-worker',
        iteration: 1,
        config: { outputFormat: 'stream-json' },
        cluster: { id: 'cluster-1' },
        messageBus: {
          publish(message) {
            if (message.content.data.line.includes('spawn_agent')) {
              assert.deepStrictEqual(eventIds(isolatedEventsFile), ['isolated-child']);
            }
          },
        },
      };
      broadcastIsolatedLine({
        agent: isolatedAgent,
        providerName: 'codex',
        taskId: 'task-1',
        observer: isolatedObserver,
        line: '[2026-08-31T12:00:00.000Z] {"type":"thread.started","thread_id":"root"}',
      });
      broadcastIsolatedLine({
        agent: isolatedAgent,
        providerName: 'codex',
        taskId: 'task-1',
        observer: isolatedObserver,
        line: '[2026-08-31T12:00:01.000Z] {"type":"item.completed","item":{"type":"collab_tool_call","tool":"spawn_agent","status":"completed","sender_thread_id":"root","receiver_thread_ids":["isolated-child"],"prompt":"Isolated child"}}',
      });
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

describe('normal Codex subagent observer lifecycle', function () {
  this.timeout(5000);

  const clusterId = `zs-normal-codex-${process.pid}-${Math.random().toString(36).slice(2)}`;
  const agentId = 'normal-codex';
  const eventsDir = getSubagentEventsDir(clusterId);
  const eventsFile = getSubagentEventsFile(clusterId, agentId);
  let tempDir;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(__dirname, '.zs-normal-follow-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    fs.rmSync(eventsDir, { recursive: true, force: true });
  });

  function makeAgent() {
    return {
      id: agentId,
      role: 'worker',
      iteration: 1,
      quiet: true,
      config: { outputFormat: 'json' },
      cluster: { id: clusterId },
      _publish: () => {},
      _log: () => {},
      _parseResultOutput: () => Promise.resolve({ ok: true }),
      _stopLivenessCheck: () => {},
    };
  }

  function writeFinalRecordWithoutNewline(logFile, childId) {
    fs.writeFileSync(
      logFile,
      [
        '{"type":"thread.started","thread_id":"root"}',
        `{"type":"item.completed","item":{"type":"collab_tool_call","tool":"spawn_agent","status":"completed","sender_thread_id":"root","receiver_thread_ids":["${childId}"],"prompt":"Null observer drain"}}`,
      ].join('\n')
    );
  }

  function readLifecycle() {
    return fs
      .readFileSync(eventsFile, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line))
      .map(({ event, agent_id }) => ({ event, agent_id }));
  }

  it('drains the final default-json record before successful settlement', async () => {
    const logFile = path.join(tempDir, 'task.jsonl');
    writeFinalRecordWithoutNewline(logFile, 'success-child');
    const published = [];
    const agent = makeAgent();
    agent._publish = (message) => published.push(message.content.data.line);

    const result = await createLogFollower({
      agent,
      taskId: 'task-success',
      fsModule: fs,
      ctPath: 'unused-test-command',
      providerName: 'codex',
      initialLogFilePath: logFile,
      runStatusCommand: (_command, _args, _options, callback) =>
        callback(null, 'Status: completed\n', ''),
    });

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.output.includes('success-child'), false);
    assert.strictEqual(
      published.some((line) => line.includes('success-child')),
      false
    );
    assert.deepStrictEqual(readLifecycle(), [
      { event: 'start', agent_id: 'success-child' },
      { event: 'stop', agent_id: 'success-child' },
    ]);
  });

  it('drains and finalizes when the follower is killed', async () => {
    const logFile = path.join(tempDir, 'task.jsonl');
    writeFinalRecordWithoutNewline(logFile, 'killed-child');
    const agent = makeAgent();
    const published = [];
    agent._publish = (message) => published.push(message.content.data.line);

    const resultPromise = createLogFollower({
      agent,
      taskId: 'task-killed',
      fsModule: fs,
      ctPath: 'unused-test-command',
      providerName: 'codex',
      initialLogFilePath: logFile,
      runStatusCommand: (_command, _args, _options, callback) =>
        callback(null, 'Status: running\n', ''),
    });
    agent.currentTask.kill('manual kill');
    const result = await resultPromise;

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.error, 'manual kill');
    assert.strictEqual(result.output, '');
    assert.deepStrictEqual(published, []);
    assert.deepStrictEqual(readLifecycle(), [
      { event: 'start', agent_id: 'killed-child' },
      { event: 'stop', agent_id: 'killed-child' },
    ]);
  });

  it('drains and finalizes when status polling is exhausted', async () => {
    const logFile = path.join(tempDir, 'task.jsonl');
    writeFinalRecordWithoutNewline(logFile, 'polling-child');
    const originalConsoleError = console.error;
    let result;
    try {
      console.error = () => {};
      const agent = makeAgent();
      const published = [];
      agent._publish = (message) => published.push(message.content.data.line);
      result = await createLogFollower({
        agent,
        taskId: 'task-polling-error',
        fsModule: fs,
        ctPath: 'unused-test-command',
        providerName: 'codex',
        initialLogFilePath: logFile,
        maxStatusFailures: 1,
        runStatusCommand: (_command, _args, _options, callback) =>
          callback(new Error('status unavailable'), '', 'offline'),
      });
      assert.strictEqual(result.output.includes('polling-child'), false);
      assert.strictEqual(
        published.some((line) => typeof line === 'string' && line.includes('polling-child')),
        false
      );
    } finally {
      console.error = originalConsoleError;
    }

    assert.strictEqual(result.success, false);
    assert.match(result.error, /Status polling failed 1 time/);
    assert.deepStrictEqual(readLifecycle(), [
      { event: 'start', agent_id: 'polling-child' },
      { event: 'stop', agent_id: 'polling-child' },
    ]);
  });
});

describe('normal Codex lifecycle without an observer', function () {
  this.timeout(5000);

  const clusterId = `zs-normal-null-observer-${process.pid}-${Math.random().toString(36).slice(2)}`;
  let tempDir;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(__dirname, '.zs-normal-follow-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    fs.rmSync(getSubagentEventsDir(clusterId), { recursive: true, force: true });
  });

  function makeAgent() {
    return {
      id: 'normal-codex-without-observer',
      role: 'worker',
      iteration: 1,
      quiet: true,
      config: { outputFormat: 'json' },
      cluster: { id: clusterId },
      _publish: () => {},
      _log: () => {},
      _parseResultOutput: () => Promise.resolve({ ok: true }),
      _stopLivenessCheck: () => {},
    };
  }

  function writeFinalRecordWithoutNewline(logFile, childId) {
    fs.writeFileSync(
      logFile,
      [
        '{"type":"thread.started","thread_id":"root"}',
        `{"type":"item.completed","item":{"type":"collab_tool_call","tool":"spawn_agent","status":"completed","sender_thread_id":"root","receiver_thread_ids":["${childId}"],"prompt":"Final normal drain"}}`,
      ].join('\n')
    );
  }

  it('does not change canonical Codex output when observer construction fails', async () => {
    let constructionAttempts = 0;
    const observerFactory = () => {
      constructionAttempts++;
      throw new Error('observer unavailable');
    };

    const completedLog = path.join(tempDir, 'completed.jsonl');
    writeFinalRecordWithoutNewline(completedLog, 'completed-without-observer');
    let parsedOutput = null;
    const completedAgent = makeAgent();
    completedAgent._parseResultOutput = (output) => {
      parsedOutput = output;
      return Promise.resolve({ ok: true });
    };
    const completed = await createLogFollower({
      agent: completedAgent,
      taskId: 'task-completed-without-observer',
      fsModule: fs,
      ctPath: 'unused-test-command',
      providerName: 'codex',
      observerFactory,
      initialLogFilePath: completedLog,
      runStatusCommand: (_command, _args, _options, callback) =>
        callback(null, 'Status: completed\n', ''),
    });

    const exhaustedLog = path.join(tempDir, 'exhausted.jsonl');
    writeFinalRecordWithoutNewline(exhaustedLog, 'exhausted-without-observer');
    const originalConsoleError = console.error;
    let exhausted;
    try {
      console.error = () => {};
      exhausted = await createLogFollower({
        agent: makeAgent(),
        taskId: 'task-exhausted-without-observer',
        fsModule: fs,
        ctPath: 'unused-test-command',
        providerName: 'codex',
        observerFactory,
        initialLogFilePath: exhaustedLog,
        maxStatusFailures: 1,
        runStatusCommand: (_command, _args, _options, callback) =>
          callback(new Error('status unavailable'), '', 'offline'),
      });
    } finally {
      console.error = originalConsoleError;
    }

    const killedLog = path.join(tempDir, 'killed-without-observer.jsonl');
    writeFinalRecordWithoutNewline(killedLog, 'killed-without-observer');
    const killedAgent = makeAgent();
    const killedPromise = createLogFollower({
      agent: killedAgent,
      taskId: 'task-killed-without-observer',
      fsModule: fs,
      ctPath: 'unused-test-command',
      providerName: 'codex',
      observerFactory,
      initialLogFilePath: killedLog,
      runStatusCommand: (_command, _args, _options, callback) =>
        callback(null, 'Status: running\n', ''),
    });
    killedAgent.currentTask.kill('manual kill without observer');
    const killed = await killedPromise;

    assert.strictEqual(completed.success, true);
    assert.doesNotMatch(parsedOutput, /completed-without-observer/);
    assert.doesNotMatch(completed.output, /completed-without-observer/);
    assert.doesNotMatch(exhausted.output, /exhausted-without-observer/);
    assert.strictEqual(killed.error, 'manual kill without observer');
    assert.doesNotMatch(killed.output, /killed-without-observer/);
    assert.strictEqual(constructionAttempts, 3);
  });
});

describe('context replay with persisted messages', () => {
  let tempDir;
  let dbPath;
  let ledger;
  let messageBus;
  const clusterId = 'context-replay-cluster';
  const clusterCreatedAt = 1700000000000;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zeroshot-context-replay-'));
    dbPath = path.join(tempDir, 'ledger.db');
    ledger = new Ledger(dbPath);
    messageBus = new MessageBus(ledger);
  });

  afterEach(() => {
    if (ledger) ledger.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  function createWorker(bus) {
    return new AgentWrapper(
      {
        id: 'worker',
        role: 'implementation',
        modelLevel: 'level2',
        timeout: 0,
        contextStrategy: {
          sources: [{ topic: 'AGENT_OUTPUT', strategy: 'all' }],
        },
      },
      bus,
      {
        id: clusterId,
        createdAt: clusterCreatedAt,
        agents: [],
      },
      {
        testMode: true,
        mockSpawnFn: () => {},
      }
    );
  }

  function publish(message) {
    messageBus.publish({
      cluster_id: clusterId,
      sender: 'worker',
      timestamp: clusterCreatedAt + 10,
      ...message,
    });
  }

  it('keeps raw provider output in the ledger while excluding it from replay after reload', () => {
    publish({
      topic: 'AGENT_OUTPUT',
      content: {
        text: '{"type":"compiler-artifact","aggregated_output":"raw command transcript"}',
        data: {
          line: [
            '{"type":"compiler-artifact"}',
            '*** Begin Patch',
            '"aggregated_output":"raw command transcript"',
          ].join('\n'),
        },
      },
      metadata: buildRawLogOnlyMetadata(),
    });
    publish({
      topic: 'AGENT_OUTPUT',
      content: {
        text: 'compact validation status: fix the reported syntax error',
        data: { contextSafe: true },
      },
      metadata: { contextSafe: true },
    });

    const storedBeforeReload = messageBus.query({
      cluster_id: clusterId,
      topic: 'AGENT_OUTPUT',
    });
    assert(
      storedBeforeReload[0].content.text.includes('compiler-artifact'),
      'raw provider output should remain stored before reload'
    );

    ledger.close();
    ledger = new Ledger(dbPath);
    const reloadedBus = new MessageBus(ledger);
    const storedAfterReload = reloadedBus.query({
      cluster_id: clusterId,
      topic: 'AGENT_OUTPUT',
    });
    assert(
      storedAfterReload[0].content.data.line.includes('*** Begin Patch'),
      'raw provider output should remain stored after reload'
    );

    const context = createWorker(reloadedBus)._buildContext({
      topic: 'ISSUE_OPENED',
      sender: 'system',
      timestamp: clusterCreatedAt + 100,
      content: { text: 'trigger' },
    });

    assert(!context.includes('compiler-artifact'), 'raw compiler artifacts must not replay');
    assert(!context.includes('*** Begin Patch'), 'raw patch bodies must not replay');
    assert(!context.includes('aggregated_output'), 'raw command transcripts must not replay');
    assert(
      context.includes('compact validation status: fix the reported syntax error'),
      'explicit context-safe status should replay'
    );
  });

  it('does not let unmarked raw AGENT_OUTPUT consume latest replay slots', () => {
    publish({
      topic: 'AGENT_OUTPUT',
      timestamp: clusterCreatedAt + 10,
      content: { text: 'safe older status', data: { contextSafe: true } },
      metadata: { contextSafe: true },
    });
    publish({
      topic: 'AGENT_OUTPUT',
      timestamp: clusterCreatedAt + 20,
      content: { text: '{"type":"compiler-artifact"}' },
    });

    const worker = new AgentWrapper(
      {
        id: 'worker',
        role: 'implementation',
        modelLevel: 'level2',
        timeout: 0,
        contextStrategy: {
          sources: [{ topic: 'AGENT_OUTPUT', amount: 1, strategy: 'latest' }],
        },
      },
      messageBus,
      {
        id: clusterId,
        createdAt: clusterCreatedAt,
        agents: [],
      },
      {
        testMode: true,
        mockSpawnFn: () => {},
      }
    );

    const context = worker._buildContext({
      topic: 'ISSUE_OPENED',
      sender: 'system',
      timestamp: clusterCreatedAt + 100,
      content: { text: 'trigger' },
    });

    assert(context.includes('safe older status'), 'latest source should select replayable rows');
    assert(!context.includes('compiler-artifact'), 'unmarked AGENT_OUTPUT defaults raw-log-only');
  });
});
