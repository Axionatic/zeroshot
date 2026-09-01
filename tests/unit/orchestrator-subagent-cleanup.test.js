const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const Orchestrator = require('../../src/orchestrator');

describe('orchestrator subagent event path safety', () => {
  let storageDir;
  let victimDir;
  let orchestrator;

  beforeEach(() => {
    storageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zs-orchestrator-storage-'));
    victimDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zs-orchestrator-victim-'));
    fs.writeFileSync(path.join(victimDir, 'keep.txt'), 'keep');
    orchestrator = new Orchestrator({ quiet: true, skipLoad: true, storageDir });
  });

  afterEach(() => {
    orchestrator.close();
    fs.rmSync(storageDir, { recursive: true, force: true });
    fs.rmSync(victimDir, { recursive: true, force: true });
  });

  it('rejects traversal-bearing requested cluster IDs', () => {
    const unsafeId = `../${path.basename(victimDir)}`;
    assert.throws(() => orchestrator._resolveStartClusterId(unsafeId), /safe path component/);
  });

  it('never recursively removes an unsafe cleanup target', () => {
    const unsafeId = `../${path.basename(victimDir)}`;
    assert.throws(() => orchestrator._cleanupSubagentEvents(unsafeId), /safe path component/);
    assert.strictEqual(fs.existsSync(path.join(victimDir, 'keep.txt')), true);
  });
});
