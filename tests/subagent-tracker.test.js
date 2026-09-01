const fs = require('fs');
const path = require('path');
const os = require('os');
const assert = require('assert');

const { SubagentTracker } = require('../src/subagent-tracker');

const TEST_CLUSTER_ID = 'test-cluster-' + Date.now();
const BASE_DIR = path.join(os.tmpdir(), 'zeroshot-subagents', TEST_CLUSTER_ID);

function writeEvents(agentId, events) {
  const filePath = path.join(BASE_DIR, `${agentId}.jsonl`);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const lines = events.map((e) => JSON.stringify(e)).join('\n') + '\n';
  fs.appendFileSync(filePath, lines);
}

afterEach(() => {
  try {
    fs.rmSync(BASE_DIR, { recursive: true, force: true });
  } catch {
    // ignore
  }
});

describe('SubagentTracker', () => {
  it('reads start events and returns active subagents', () => {
    const tracker = new SubagentTracker(TEST_CLUSTER_ID);

    writeEvents('analyst', [
      { event: 'start', agent_id: 'sub-1', description: 'Requirements Analyst review', ts: 1000 },
      { event: 'start', agent_id: 'sub-2', description: 'Logic Flow Tracer review', ts: 2000 },
    ]);

    tracker.poll();
    const active = tracker.getActiveSubagents('analyst');

    assert.strictEqual(active.length, 2);
    assert.strictEqual(active[0].id, 'sub-1');
    assert.strictEqual(active[0].description, 'Requirements Analyst review');
    assert.strictEqual(active[1].id, 'sub-2');
    assert.strictEqual(active[1].description, 'Logic Flow Tracer review');
  });

  it('normalizes and bounds labels at the shared consumer boundary', () => {
    const tracker = new SubagentTracker(TEST_CLUSTER_ID);
    const unsafe = `review\u001b]0;owned\u0007\nnext ${'x'.repeat(200)}`;
    writeEvents('analyst', [{ event: 'start', agent_id: 'sub-1', description: unsafe, ts: 1000 }]);

    tracker.poll();
    const [active] = tracker.getActiveSubagents('analyst');

    assert.strictEqual(active.description.includes('\n'), false);
    assert.strictEqual(
      Array.from(active.description).some((character) => {
        const codePoint = character.codePointAt(0);
        return codePoint <= 31 || (codePoint >= 127 && codePoint <= 159);
      }),
      false
    );
    assert.ok(active.description.length <= 80);
  });

  it('caps active children retained for one parent', () => {
    const tracker = new SubagentTracker(TEST_CLUSTER_ID);
    writeEvents(
      'analyst',
      Array.from({ length: 200 }, (_, index) => ({
        event: 'start',
        agent_id: `sub-${index}`,
        description: `Subagent ${index}`,
        ts: index,
      }))
    );

    tracker.poll();

    assert.ok(tracker.getActiveSubagents('analyst').length <= 100);
  });

  it('returns only active subagents (started, not stopped)', () => {
    const tracker = new SubagentTracker(TEST_CLUSTER_ID);

    writeEvents('analyst', [
      { event: 'start', agent_id: 'sub-1', description: 'Requirements Analyst', ts: 1000 },
      { event: 'start', agent_id: 'sub-2', description: 'Logic Flow Tracer', ts: 2000 },
      { event: 'stop', agent_id: 'sub-1', ts: 3000 },
    ]);

    tracker.poll();
    const active = tracker.getActiveSubagents('analyst');

    assert.strictEqual(active.length, 1);
    assert.strictEqual(active[0].id, 'sub-2');
  });

  it('handles missing directory gracefully', () => {
    const tracker = new SubagentTracker('nonexistent-cluster-xyz');

    // Should not throw
    tracker.poll();
    const active = tracker.getActiveSubagents('analyst');
    assert.deepStrictEqual(active, []);
  });

  it('handles malformed JSONL lines', () => {
    const tracker = new SubagentTracker(TEST_CLUSTER_ID);

    const filePath = path.join(BASE_DIR, 'analyst.jsonl');
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(
      filePath,
      '{"event":"start","agent_id":"sub-1","description":"Good","ts":1000}\n' +
        'NOT VALID JSON\n' +
        '{"event":"start","agent_id":"sub-2","description":"Also good","ts":2000}\n'
    );

    tracker.poll();
    const active = tracker.getActiveSubagents('analyst');

    // Should have parsed the valid lines, skipped the bad one
    assert.strictEqual(active.length, 2);
    assert.strictEqual(active[0].id, 'sub-1');
    assert.strictEqual(active[1].id, 'sub-2');
  });

  it('ignores invalid event records before creating parent state', () => {
    const tracker = new SubagentTracker(TEST_CLUSTER_ID);
    const filePath = path.join(BASE_DIR, 'analyst.jsonl');
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const invalidRecords = [
      null,
      [],
      {},
      { event: 'launch', agent_id: 'sub-1', ts: 1000 },
      { event: 'start', agent_id: '', ts: 1000 },
      { event: 'start', agent_id: '   ', ts: 1000 },
      { event: 'start', agent_id: 'sub-1', ts: '1000' },
      { event: 'start', agent_id: 'sub-1', ts: null },
      { event: 'start', agent_id: 'sub-1', description: null, ts: 1000 },
      { event: 'start', agent_id: 'sub-1', agent_type: 7, ts: 1000 },
    ];
    fs.writeFileSync(
      filePath,
      `${invalidRecords.map((record) => JSON.stringify(record)).join('\n')}\n` +
        '{"event":"start","agent_id":"sub-infinite","ts":1e309}\n'
    );

    assert.doesNotThrow(() => tracker.poll());
    assert.strictEqual(tracker.active.size, 0);
    assert.deepStrictEqual(tracker.getActiveSubagents('analyst'), []);
  });

  it('offset tracking works on re-poll (no duplicate events)', () => {
    const tracker = new SubagentTracker(TEST_CLUSTER_ID);

    writeEvents('analyst', [{ event: 'start', agent_id: 'sub-1', description: 'First', ts: 1000 }]);

    tracker.poll();
    assert.strictEqual(tracker.getActiveSubagents('analyst').length, 1);

    // Append more events
    writeEvents('analyst', [
      { event: 'start', agent_id: 'sub-2', description: 'Second', ts: 2000 },
    ]);

    tracker.poll();
    const active = tracker.getActiveSubagents('analyst');

    // Should have both, not a duplicate of sub-1
    assert.strictEqual(active.length, 2);
    assert.strictEqual(active[0].id, 'sub-1');
    assert.strictEqual(active[1].id, 'sub-2');
  });

  it('retains a split record until its final newline arrives', () => {
    const tracker = new SubagentTracker(TEST_CLUSTER_ID);
    const filePath = path.join(BASE_DIR, 'analyst.jsonl');
    fs.mkdirSync(BASE_DIR, { recursive: true });
    const event = JSON.stringify({
      event: 'start',
      agent_id: 'sub-1',
      description: 'Split',
      ts: 1000,
    });
    fs.writeFileSync(filePath, event.slice(0, -3));

    tracker.poll();
    assert.deepStrictEqual(tracker.getActiveSubagents('analyst'), []);

    fs.appendFileSync(filePath, `${event.slice(-3)}\n`);
    tracker.poll();
    assert.deepStrictEqual(
      tracker.getActiveSubagents('analyst').map((s) => s.id),
      ['sub-1']
    );
  });

  it('drops an oversized newline-free record without rereading it forever', () => {
    const tracker = new SubagentTracker(TEST_CLUSTER_ID);
    const filePath = path.join(BASE_DIR, 'analyst.jsonl');
    fs.mkdirSync(BASE_DIR, { recursive: true });
    fs.writeFileSync(filePath, '');
    fs.truncateSync(filePath, 2 * 1024 * 1024);

    tracker.poll();
    tracker.poll();
    assert.strictEqual(tracker.offsets.get(filePath), fs.statSync(filePath).size);

    fs.appendFileSync(
      filePath,
      `\n${JSON.stringify({ event: 'start', agent_id: 'sub-1', ts: 1000 })}\n`
    );
    tracker.poll();
    assert.deepStrictEqual(
      tracker.getActiveSubagents('analyst').map((subagent) => subagent.id),
      ['sub-1']
    );
  });

  it('deduplicates duplicate starts for an active parent-child pair', () => {
    const tracker = new SubagentTracker(TEST_CLUSTER_ID);

    writeEvents('analyst', [
      { event: 'start', agent_id: 'sub-1', description: 'First', ts: 1000 },
      { event: 'start', agent_id: 'sub-1', description: 'Duplicate', ts: 2000 },
    ]);

    tracker.poll();
    assert.strictEqual(tracker.getActiveSubagents('analyst').length, 1);
    assert.strictEqual(tracker.getActiveSubagents('analyst')[0].description, 'First');
  });

  it('supports a child stopping and starting again', () => {
    const tracker = new SubagentTracker(TEST_CLUSTER_ID);

    writeEvents('analyst', [
      { event: 'start', agent_id: 'sub-1', description: 'First', ts: 1000 },
      { event: 'stop', agent_id: 'sub-1', ts: 2000 },
      { event: 'start', agent_id: 'sub-1', description: 'Second', ts: 3000 },
    ]);

    tracker.poll();
    assert.deepStrictEqual(tracker.getActiveSubagents('analyst'), [
      { id: 'sub-1', description: 'Second', startedAt: 3000 },
    ]);
  });

  it('cleanup() removes directory', () => {
    const tracker = new SubagentTracker(TEST_CLUSTER_ID);

    writeEvents('analyst', [{ event: 'start', agent_id: 'sub-1', description: 'Test', ts: 1000 }]);

    assert.ok(fs.existsSync(BASE_DIR));

    tracker.cleanup();

    assert.ok(!fs.existsSync(BASE_DIR));
  });

  it('tracks subagents per parent agent independently', () => {
    const tracker = new SubagentTracker(TEST_CLUSTER_ID);

    writeEvents('analyst', [
      { event: 'start', agent_id: 'sub-1', description: 'Analyst sub', ts: 1000 },
    ]);
    writeEvents('validator', [
      { event: 'start', agent_id: 'sub-2', description: 'Validator sub', ts: 1000 },
    ]);

    tracker.poll();

    assert.strictEqual(tracker.getActiveSubagents('analyst').length, 1);
    assert.strictEqual(tracker.getActiveSubagents('analyst')[0].description, 'Analyst sub');
    assert.strictEqual(tracker.getActiveSubagents('validator').length, 1);
    assert.strictEqual(tracker.getActiveSubagents('validator')[0].description, 'Validator sub');
  });

  it('returns empty array for agent with no subagents', () => {
    const tracker = new SubagentTracker(TEST_CLUSTER_ID);
    tracker.poll();
    assert.deepStrictEqual(tracker.getActiveSubagents('unknown-agent'), []);
  });
});
