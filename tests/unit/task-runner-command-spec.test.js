/**
 * Tests that task-lib/runner.js actually executes what the provider's
 * commandSpec describes.
 *
 * spawnTask() resolves a commandSpec, then hands its pieces to a forked
 * watcher through three separate channels: `finalArgs` as argv, `command`/`env`
 * at the top of the watcher config, and the spec itself (minus args) nested
 * inside it. Drop any one of those and nothing throws - the wrong binary runs,
 * or it runs with the wrong flags or a stripped environment, and the only
 * symptom is a provider that misbehaves much later.
 *
 * So rather than inspect the plumbing, these tests put a stub `claude` on PATH
 * and assert on what the process it spawns actually received.
 *
 * Not covered: commandSpec.cleanup and commandSpec.env. The watcher falls back
 * to argv for binary, args and cwd, so those survive a partial drop; cleanup
 * and env have no fallback, but the claude adapter resolves an empty env and
 * nothing populates cleanup in this codebase yet. Upstream v6.16.0 adds cleanup
 * (via attachClaudeOverlayCleanup + a commandCleanup field on the task record).
 * Whoever resolves that merge conflict in spawnTask should extend these tests
 * to assert the overlay temp directory is recorded and removed.
 *
 * These tests await the stub's invocation, not the watcher's exit - the watcher
 * is detached with stdio ignored, so nothing it does afterwards can fail the
 * suite. Deliberate: waiting on a detached process would trade the whole point
 * of the test for flakiness.
 */

const { describe, it, before, after, beforeEach, afterEach } = require('mocha');
const { expect } = require('chai');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

const POLL_TIMEOUT_MS = 15000;

// task-lib/config.js caches its home directory at import time, and under
// `mocha --parallel` a worker may run several files in one process. Setting
// this at module scope - before any import of the store - keeps the redirect
// independent of which test file loads first.
const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zs-runner-home-'));
process.env.ZEROSHOT_HOME = homeDir;

let spawnTask;
let getTask;
let addTask;
let killTaskCommand;
let isProcessRunning;
let binDir;
let recordFile;
let originalPath;

function readInvocations() {
  if (!fs.existsSync(recordFile)) return [];
  return fs
    .readFileSync(recordFile, 'utf8')
    .split('\n')
    .filter((line) => line.trim())
    .flatMap((line) => {
      try {
        return [JSON.parse(line)];
      } catch {
        return []; // Partially written line - it will be complete on the next poll.
      }
    });
}

/**
 * Wait for an invocation matching `predicate`. The watcher probes the binary
 * before the real run, so more than one invocation is expected.
 */
async function waitForInvocation(predicate) {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  let seen = [];
  while (Date.now() < deadline) {
    seen = readInvocations();
    const match = seen.find(predicate);
    if (match) return match;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(
    `No matching stub invocation within ${POLL_TIMEOUT_MS}ms. Saw: ${JSON.stringify(seen)}`
  );
}

describe('spawnTask provider commandSpec execution', function () {
  this.timeout(POLL_TIMEOUT_MS + 5000);

  before(async () => {
    ({ spawnTask, isProcessRunning } = await import('../../task-lib/runner.js'));
    ({ getTask, addTask } = await import('../../task-lib/store.js'));
    ({ killTaskCommand } = await import('../../task-lib/commands/kill.js'));
  });

  beforeEach(() => {
    binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zs-runner-bin-'));
    recordFile = path.join(binDir, 'invocation.json');

    // Stub provider: records how it was invoked, then exits cleanly.
    const stub = path.join(binDir, 'claude');
    fs.writeFileSync(
      stub,
      [
        '#!/usr/bin/env node',
        "const fs = require('fs');",
        `fs.appendFileSync(${JSON.stringify(recordFile)}, JSON.stringify({`,
        '  args: process.argv.slice(2),',
        '  cwd: process.cwd(),',
        `}) + '\\n');`,
      ].join('\n')
    );
    fs.chmodSync(stub, 0o755);

    // Isolating PATH also guarantees a real provider CLI can never be reached
    // if the stub fails to resolve.
    originalPath = process.env.PATH;
    process.env.PATH = `${binDir}${path.delimiter}${path.dirname(process.execPath)}`;
  });

  afterEach(() => {
    process.env.PATH = originalPath;
    fs.rmSync(binDir, { recursive: true, force: true });
  });

  after(() => {
    fs.rmSync(homeDir, { recursive: true, force: true });
  });

  it('runs the provider binary with the commandSpec args, in the requested cwd', async () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'zs-runner-cwd-'));
    try {
      const task = spawnTask('hello there', {
        provider: 'claude',
        cwd,
        // Forces the non-PTY watcher; the attachable one needs a real terminal.
        attachable: false,
      });

      // These flags come from the resolved commandSpec, nowhere else. If the
      // spec stops reaching the watcher, argv arrives empty or truncated.
      const record = await waitForInvocation((inv) => inv.args.includes('--print'));

      expect(record.args).to.include('--output-format');
      expect(record.args).to.include('stream-json');
      expect(record.args).to.include('hello there');
      expect(record.cwd).to.equal(fs.realpathSync(cwd));

      expect(task.provider).to.equal('claude');
      expect(task.cwd).to.equal(cwd);
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('persists the task under the id the provider was actually launched for', async () => {
    const task = spawnTask('persisted prompt', { provider: 'claude', attachable: false });
    await waitForInvocation((inv) => inv.args.includes('persisted prompt'));

    const stored = getTask(task.id);
    expect(stored).to.not.equal(null);
    expect(stored.id).to.equal(task.id);
    expect(stored.fullPrompt).to.equal('persisted prompt');
    expect(stored.provider).to.equal('claude');
  });

  it('waits for the provider process to exit before reporting a task killed', async () => {
    const child = spawn(
      process.execPath,
      [
        '-e',
        "process.on('SIGTERM', () => setTimeout(() => process.exit(0), 200)); setInterval(() => {}, 1000);",
      ],
      { stdio: 'ignore' }
    );
    const taskId = `kill-wait-${process.pid}-${Date.now()}`;

    try {
      await new Promise((resolve) => setTimeout(resolve, 50));
      addTask({ id: taskId, status: 'running', pid: child.pid });

      await killTaskCommand(taskId);

      expect(isProcessRunning(child.pid)).to.equal(false);
      expect(getTask(taskId).status).to.equal('killed');
    } finally {
      if (isProcessRunning(child.pid)) child.kill('SIGKILL');
    }
  });

  it('escalates to SIGKILL when the provider ignores SIGTERM', async function () {
    this.timeout(7000);
    const child = spawn(
      process.execPath,
      ['-e', "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);"],
      { stdio: 'ignore' }
    );
    const taskId = `kill-escalate-${process.pid}-${Date.now()}`;

    try {
      await new Promise((resolve) => setTimeout(resolve, 50));
      addTask({ id: taskId, status: 'running', pid: child.pid });

      await killTaskCommand(taskId, { termTimeoutMs: 50, killTimeoutMs: 1000 });

      expect(isProcessRunning(child.pid)).to.equal(false);
      expect(getTask(taskId).status).to.equal('killed');
    } finally {
      if (isProcessRunning(child.pid)) child.kill('SIGKILL');
    }
  });
});
