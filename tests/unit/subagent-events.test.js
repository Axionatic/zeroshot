const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  getSubagentEventsDir,
  getSubagentEventsFile,
  appendSubagentEvent,
} = require('../../src/subagent-events');

describe('subagent event helpers', () => {
  it('builds the literal shared event paths', () => {
    assert.strictEqual(
      getSubagentEventsDir('cluster-1'),
      path.join(os.tmpdir(), 'zeroshot-subagents', 'cluster-1')
    );
    assert.strictEqual(
      getSubagentEventsFile('cluster-1', 'parent-1'),
      path.join(os.tmpdir(), 'zeroshot-subagents', 'cluster-1', 'parent-1.jsonl')
    );
  });

  it('creates parent directories and appends one JSONL event', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'subagent-events-'));
    const filePath = path.join(root, 'nested', 'events.jsonl');
    const event = { event: 'start', agent_id: 'child-1', description: 'Review', ts: 123 };

    try {
      appendSubagentEvent(filePath, event);
      assert.strictEqual(fs.readFileSync(filePath, 'utf8'), `${JSON.stringify(event)}\n`);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('does not throw when an event cannot be serialized', () => {
    const event = {};
    event.self = event;

    assert.doesNotThrow(() => appendSubagentEvent('/tmp/unreachable-events.jsonl', event));
  });

  it('does not throw when the event file cannot be written', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'subagent-events-'));
    const parentFile = path.join(root, 'not-a-directory');
    fs.writeFileSync(parentFile, 'file');

    try {
      assert.doesNotThrow(() =>
        appendSubagentEvent(path.join(parentFile, 'events.jsonl'), { event: 'stop' })
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
