const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  getSubagentEventsDir,
  getSubagentEventsFile,
  prepareSharedSubagentEventsFile,
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

  it('creates private event directories and files', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'subagent-events-'));
    const eventsDir = path.join(root, 'private-events');
    const filePath = path.join(eventsDir, 'parent.jsonl');

    try {
      appendSubagentEvent(filePath, { event: 'start', agent_id: 'child-1', ts: 123 });

      assert.strictEqual(fs.statSync(eventsDir).mode & 0o777, 0o700);
      assert.strictEqual(fs.statSync(filePath).mode & 0o777, 0o600);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('prepares a write-only cross-UID event file for an isolated container', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'subagent-events-shared-'));
    const filePath = path.join(root, 'shared-events', 'parent.jsonl');

    try {
      assert.strictEqual(prepareSharedSubagentEventsFile(filePath), true);
      assert.strictEqual(fs.statSync(path.dirname(filePath)).mode & 0o777, 0o711);
      assert.strictEqual(fs.statSync(filePath).mode & 0o777, 0o622);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('preserves cross-UID directory traversal when a host observer appends nearby', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'subagent-events-mixed-'));
    const sharedFile = path.join(root, 'mixed-events', 'claude.jsonl');
    const hostFile = path.join(root, 'mixed-events', 'codex.jsonl');

    try {
      assert.strictEqual(prepareSharedSubagentEventsFile(sharedFile), true);
      appendSubagentEvent(hostFile, { event: 'start', agent_id: 'codex-child', ts: 1 });

      assert.strictEqual(fs.statSync(path.dirname(sharedFile)).mode & 0o777, 0o711);
      assert.strictEqual(fs.statSync(sharedFile).mode & 0o777, 0o622);
      assert.strictEqual(fs.statSync(hostFile).mode & 0o777, 0o600);
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
