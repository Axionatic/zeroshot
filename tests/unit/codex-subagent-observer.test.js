const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { createCodexSubagentObserver } = require('../../src/codex-subagent-observer');

function readEvents(eventsFile) {
  if (!fs.existsSync(eventsFile)) return [];
  return fs
    .readFileSync(eventsFile, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

describe('Codex subagent observer', () => {
  let tempDir;
  let eventsFile;
  let nextTimestamp;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zs-codex-observer-'));
    eventsFile = path.join(tempDir, 'parent.jsonl');
    nextTimestamp = 1000;
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  function createObserver(overrides = {}) {
    return createCodexSubagentObserver({
      parentAgentId: 'worker-1',
      eventsFile,
      now: () => nextTimestamp++,
      ...overrides,
    });
  }

  it('accepts only completed root-thread spawns and records every receiver', () => {
    const observer = createObserver();

    observer.observeLine(
      '{"type":"item.completed","item":{"type":"collab_tool_call","tool":"spawn_agent","status":"completed","sender_thread_id":"root","receiver_thread_ids":["too-early"],"prompt":"ignored"}}'
    );
    observer.observeLine(
      '{"type":"item.completed","item":{"type":"collab_tool_call","tool":"spawn_agent","status":"completed","sender_thread_id":null,"receiver_thread_ids":["null-root"],"prompt":"ignored"}}'
    );
    observer.observeLine('{"type":"thread.started","thread_id":"root"}');
    observer.observeLine('{"type":"thread.started","thread_id":"replacement"}');
    observer.observeLine(
      '{"type":"item.completed","item":{"type":"collab_tool_call","tool":"spawn_agent","status":"failed","sender_thread_id":"root","receiver_thread_ids":["failed-child"],"prompt":"ignored"}}'
    );
    observer.observeLine(
      '{"type":"item.completed","item":{"type":"collab_tool_call","tool":"spawn_agent","status":"completed","sender_thread_id":"nested","receiver_thread_ids":["nested-child"],"prompt":"ignored"}}'
    );
    observer.observeLine(
      '{"type":"item.completed","item":{"type":"collab_tool_call","tool":"spawn_agent","status":"completed","sender_thread_id":"root","receiver_thread_ids":["child-a","child-b",null,7],"prompt":"Review the lifecycle"}}'
    );

    assert.deepStrictEqual(readEvents(eventsFile), [
      {
        event: 'start',
        agent_id: 'child-a',
        description: 'Review the lifecycle',
        ts: 1000,
      },
      {
        event: 'start',
        agent_id: 'child-b',
        description: 'Review the lifecycle',
        ts: 1001,
      },
    ]);
  });

  it('ignores malformed records and duplicate spawn replay without throwing', () => {
    const observer = createObserver();

    assert.doesNotThrow(() => observer.observeLine('{not-json'));
    assert.doesNotThrow(() => observer.observeLine(null));
    assert.doesNotThrow(() => observer.observeLine('{"type":"thread.started"}'));
    observer.observeLine('{"type":"thread.started","thread_id":"root"}');
    const spawn =
      '{"type":"item.completed","item":{"type":"collab_tool_call","tool":"spawn_agent","status":"completed","sender_thread_id":"root","receiver_thread_ids":["child-a"],"prompt":"Implement"}}';
    observer.observeLine(spawn);
    observer.observeLine(spawn);

    assert.deepStrictEqual(readEvents(eventsFile), [
      { event: 'start', agent_id: 'child-a', description: 'Implement', ts: 1000 },
    ]);
  });

  it('records a bounded single-line display label without terminal control bytes', () => {
    const observer = createObserver();
    const prompt = `Review line one\nline two \u001b]0;owned\u0007 ${'x'.repeat(200)}`;
    observer.observeLine('{"type":"thread.started","thread_id":"root"}');
    observer.observeLine(
      JSON.stringify({
        type: 'item.completed',
        item: {
          type: 'collab_tool_call',
          tool: 'spawn_agent',
          status: 'completed',
          sender_thread_id: 'root',
          receiver_thread_ids: ['safe-child'],
          prompt,
        },
      })
    );

    const [event] = readEvents(eventsFile);
    assert.strictEqual(event.description.includes('\n'), false);
    assert.strictEqual(
      Array.from(event.description).some((character) => {
        const codePoint = character.codePointAt(0);
        return codePoint <= 31 || (codePoint >= 127 && codePoint <= 159);
      }),
      false
    );
    assert.ok(event.description.length <= 80);
  });

  it('stops only accepted children whose defensive agents_states are terminal', () => {
    const observer = createObserver();
    observer.observeLine('{"type":"thread.started","thread_id":"root"}');
    observer.observeLine(
      '{"type":"item.completed","item":{"type":"collab_tool_call","tool":"spawn_agent","status":"completed","sender_thread_id":"root","receiver_thread_ids":["completed-child","errored-child","interrupted-child","shutdown-child","missing-child","running-child"],"prompt":"Parallel work"}}'
    );
    observer.observeLine(
      '{"type":"item.completed","item":{"type":"collab_tool_call","tool":"wait","status":"completed","agents_states":{"completed-child":{"status":"completed"},"errored-child":"errored","interrupted-child":{"state":"interrupted"},"shutdown-child":{"status":"shutdown"},"missing-child":"not_found","running-child":{"status":"running"},"unknown-child":{"status":"completed"}}}}'
    );

    const events = readEvents(eventsFile);
    assert.deepStrictEqual(
      events.filter((event) => event.event === 'stop').map((event) => event.agent_id),
      ['completed-child', 'errored-child', 'interrupted-child', 'shutdown-child', 'missing-child']
    );
    assert.strictEqual(
      events.some((event) => event.agent_id === 'unknown-child'),
      false
    );
    assert.strictEqual(
      events.some((event) => event.event === 'stop' && event.agent_id === 'running-child'),
      false
    );
  });

  it('applies terminal state included in the same completed spawn record', () => {
    const observer = createObserver();
    observer.observeLine('{"type":"thread.started","thread_id":"root"}');
    observer.observeLine(
      '{"type":"item.completed","agents_states":{"fast-child":{"status":"completed"}},"item":{"type":"collab_tool_call","tool":"spawn_agent","status":"completed","sender_thread_id":"root","receiver_thread_ids":["fast-child"],"prompt":"Fast work"}}'
    );

    assert.deepStrictEqual(readEvents(eventsFile), [
      { event: 'start', agent_id: 'fast-child', description: 'Fast work', ts: 1000 },
      { event: 'stop', agent_id: 'fast-child', ts: 1001 },
    ]);
  });

  it('requires successful close_agent and stops only known receiver IDs', () => {
    const observer = createObserver();
    observer.observeLine('{"type":"thread.started","thread_id":"root"}');
    observer.observeLine(
      '{"type":"item.completed","item":{"type":"collab_tool_call","tool":"spawn_agent","status":"completed","sender_thread_id":"root","receiver_thread_ids":["child-a","child-b"],"prompt":"Work"}}'
    );
    observer.observeLine(
      '{"type":"item.completed","item":{"type":"collab_tool_call","tool":"close_agent","status":"failed","receiver_thread_ids":["child-a"]}}'
    );
    observer.observeLine(
      '{"type":"item.completed","item":{"type":"collab_tool_call","tool":"close_agent","status":"completed","receiver_thread_ids":["unknown","child-a"]}}'
    );

    const stops = readEvents(eventsFile).filter((event) => event.event === 'stop');
    assert.deepStrictEqual(stops, [{ event: 'stop', agent_id: 'child-a', ts: 1002 }]);
  });

  it('finalizes before idempotent cleanup and rejects every later replay', () => {
    const observer = createObserver();
    observer.observeLine('{"type":"thread.started","thread_id":"root"}');
    observer.observeLine(
      '{"type":"item.completed","item":{"type":"collab_tool_call","tool":"spawn_agent","status":"completed","sender_thread_id":"root","receiver_thread_ids":["child-a","child-b"],"prompt":"Work"}}'
    );

    assert.doesNotThrow(() => observer.finishParent());
    assert.doesNotThrow(() => observer.finishParent());
    observer.observeLine(
      '{"type":"item.completed","item":{"type":"collab_tool_call","tool":"spawn_agent","status":"completed","sender_thread_id":"root","receiver_thread_ids":["late-child"],"prompt":"Late"}}'
    );
    observer.observeLine(
      '{"type":"item.completed","item":{"type":"collab_tool_call","tool":"spawn_agent","status":"completed","sender_thread_id":"root","receiver_thread_ids":["child-a"],"prompt":"Replay"}}'
    );

    assert.deepStrictEqual(readEvents(eventsFile), [
      { event: 'start', agent_id: 'child-a', description: 'Work', ts: 1000 },
      { event: 'start', agent_id: 'child-b', description: 'Work', ts: 1001 },
      { event: 'stop', agent_id: 'child-a', ts: 1002 },
      { event: 'stop', agent_id: 'child-b', ts: 1003 },
    ]);
  });

  it('keeps telemetry failures non-throwing', () => {
    const parentFile = path.join(tempDir, 'not-a-directory');
    fs.writeFileSync(parentFile, 'blocked');
    const observer = createObserver({
      eventsFile: path.join(parentFile, 'events.jsonl'),
      now: () => {
        throw new Error('clock unavailable');
      },
    });

    assert.doesNotThrow(() => observer.observeLine('{"type":"thread.started","thread_id":"root"}'));
    assert.doesNotThrow(() =>
      observer.observeLine(
        '{"type":"item.completed","item":{"type":"collab_tool_call","tool":"spawn_agent","status":"completed","sender_thread_id":"root","receiver_thread_ids":["child-a"],"prompt":"Work"}}'
      )
    );
    assert.doesNotThrow(() => observer.finishParent());
  });
});
