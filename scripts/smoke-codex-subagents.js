#!/usr/bin/env node

/**
 * Opt-in smoke test for Codex collaboration telemetry.
 *
 * This script deliberately does not run a provider unless the caller opts in:
 *   CODEX_SUBAGENT_SMOKE=1 node scripts/smoke-codex-subagents.js
 */

const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { getSubagentEventsFile } = require('../src/subagent-events');
const { createCodexSubagentObserver } = require('../src/codex-subagent-observer');

const ACTIVATION_ENV = 'CODEX_SUBAGENT_SMOKE';
const DEFAULT_SMOKE_TIMEOUT_MS = 2 * 60 * 1000;
const DEFAULT_KILL_GRACE_MS = 1000;
const smokePrompt = [
  'This is a safe collaboration telemetry smoke test.',
  'If Codex collaboration tools are available, use spawn_agent exactly once to ask a subagent to reply "ack", then close it after its response.',
  'If collaboration tools are unavailable, answer exactly: collaboration unavailable.',
  'Do not modify files, run shell commands, invoke network tools, or request permissions.',
].join(' ');

function installedCodexVersion() {
  const result = spawnSync('codex', ['--version'], { encoding: 'utf8' });
  if (result.error || result.status !== 0) {
    const detail = result.error?.message || result.stderr.trim() || `exit ${result.status}`;
    throw new Error(`Codex version unavailable: ${detail}`);
  }
  return result.stdout.trim();
}

function runCodexSmoke({
  eventsFile: _eventsFile,
  onLine,
  timeoutMs = DEFAULT_SMOKE_TIMEOUT_MS,
  killGraceMs = DEFAULT_KILL_GRACE_MS,
  spawnProcess = spawn,
}) {
  return new Promise((resolve, reject) => {
    const child = spawnProcess('codex', ['exec', '--json', '--sandbox', 'read-only', smokePrompt], {
      cwd: process.cwd(),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdoutBuffer = '';
    let stderr = '';
    let settled = false;
    let timedOut = false;
    let timeout = null;
    let killTimer = null;
    let detachTimer = null;

    const clearTimers = () => {
      clearTimeout(timeout);
      if (killTimer) clearTimeout(killTimer);
      if (detachTimer) clearTimeout(detachTimer);
    };

    const resolveTimeout = ({ detach = false } = {}) => {
      if (settled) return;
      settled = true;
      clearTimers();
      if (detach) {
        child.stdout?.destroy?.();
        child.stderr?.destroy?.();
        child.unref?.();
      }
      resolve({
        code: 124,
        stderr: `Codex smoke command timed out after ${timeoutMs}ms`,
        timedOut: true,
      });
    };

    timeout = setTimeout(() => {
      if (settled) return;
      timedOut = true;
      try {
        child.kill('SIGTERM');
      } catch {
        resolveTimeout({ detach: true });
        return;
      }
      killTimer = setTimeout(() => {
        if (settled) return;
        try {
          child.kill('SIGKILL');
        } catch {
          resolveTimeout({ detach: true });
          return;
        }
        detachTimer = setTimeout(() => resolveTimeout({ detach: true }), killGraceMs);
      }, killGraceMs);
    }, timeoutMs);

    child.stdout.on('data', (data) => {
      const lines = (stdoutBuffer + data.toString()).split('\n');
      stdoutBuffer = lines.pop() || '';
      for (const line of lines) onLine(line);
    });
    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });
    child.on('error', (error) => {
      if (settled) return;
      if (timedOut) {
        resolveTimeout();
        return;
      }
      settled = true;
      clearTimers();
      reject(error);
    });
    child.on('close', (code) => {
      if (settled) return;
      if (timedOut) {
        resolveTimeout();
        return;
      }
      settled = true;
      clearTimers();
      if (stdoutBuffer) onLine(stdoutBuffer);
      resolve({ code, stderr: stderr.trim() });
    });
  });
}

function countRecords(eventsFile) {
  try {
    return fs
      .readFileSync(eventsFile, 'utf8')
      .split('\n')
      .filter((line) => line.trim()).length;
  } catch {
    return 0;
  }
}

async function runSmoke({
  env = process.env,
  log = console.log,
  reportError = console.error,
  getVersion = installedCodexVersion,
  runProvider = runCodexSmoke,
  timeoutMs = DEFAULT_SMOKE_TIMEOUT_MS,
  spawnProcess = spawn,
} = {}) {
  if (env[ACTIVATION_ENV] !== '1') {
    log(
      `Codex subagent smoke test is opt-in. Set ${ACTIVATION_ENV}=1 to run the provider invocation.`
    );
    log('Provider invocation was not run.');
    return 0;
  }

  const version = getVersion();
  log(`Codex version: ${version}`);

  const clusterId = `codex-smoke-${process.pid}-${Date.now()}`;
  const eventsFile = getSubagentEventsFile(clusterId, 'codex-smoke-parent');
  const observer = createCodexSubagentObserver({ eventsFile });

  try {
    const result = await runProvider({
      eventsFile,
      onLine: observer.observeLine,
      timeoutMs,
      spawnProcess,
    });
    observer.finishParent();
    const records = countRecords(eventsFile);
    if (records === 0) {
      log(
        'Collaboration telemetry: unavailable (zero records; some Codex releases omit successful collaboration events).'
      );
    } else {
      log(`Collaboration telemetry: observed (${records} lifecycle record(s)).`);
    }

    if (result.code !== 0) {
      reportError(
        `Codex smoke command exited with ${result.code}${result.stderr ? `: ${result.stderr}` : ''}`
      );
      return result.code || 1;
    }
    return 0;
  } finally {
    observer.finishParent();
    fs.rmSync(eventsFile, { force: true });
    fs.rmSync(path.dirname(eventsFile), { recursive: true, force: true });
  }
}

if (require.main === module) {
  runSmoke().then(
    (code) => {
      process.exitCode = code;
    },
    (error) => {
      console.error(error.message);
      process.exitCode = 1;
    }
  );
}

module.exports = { runCodexSmoke, runSmoke };
