/**
 * Tests for the subagent tracking hook installer + the producer/consumer contract.
 *
 * Two independent things can silently break here, both without any error:
 *   1. The hook is never registered in the user's Claude config, so no events
 *      are ever produced and StatusFooter renders an empty tree.
 *   2. The hook is registered but emits a JSONL shape SubagentTracker cannot
 *      read, so events are produced and silently dropped.
 *
 * Both are asserted at their observable boundary: the on-disk settings.json,
 * and the active-subagent list a real SubagentTracker derives from real hook
 * output.
 */

const { describe, it, beforeEach, afterEach } = require('mocha');
const { expect } = require('chai');
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const {
  ensureSubagentTrackingHook,
  ensureAskUserQuestionHook,
  ensureDangerousGitHook,
} = require('../../src/agent/agent-task-executor');
const { SubagentTracker } = require('../../src/subagent-tracker');

// Resolve the real directory, not the `hooks` symlink - same path the installer uses.
const HOOK_SCRIPT = path.join(__dirname, '..', '..', 'cluster-hooks', 'track-subagents.py');

function readSettings(claudeDir) {
  return JSON.parse(fs.readFileSync(path.join(claudeDir, 'settings.json'), 'utf8'));
}

function commandsFor(settings, event) {
  const entries = settings.hooks?.[event];
  if (!Array.isArray(entries)) return [];
  return entries.flatMap((entry) => {
    const hooks = entry?.hooks;
    return Array.isArray(hooks) ? hooks.map((h) => h?.command) : [];
  });
}

describe('ensureSubagentTrackingHook', function () {
  let claudeDir;

  beforeEach(() => {
    // A fresh dir per test: the installer memoises per-directory for the
    // lifetime of the process, so reusing one would no-op every test but the first.
    claudeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zs-hook-test-'));
  });

  afterEach(() => {
    fs.rmSync(claudeDir, { recursive: true, force: true });
  });

  it('installs the hook script and registers both lifecycle events', () => {
    ensureSubagentTrackingHook(claudeDir);

    const installed = path.join(claudeDir, 'hooks', 'track-subagents.py');
    expect(fs.existsSync(installed)).to.equal(true);
    expect(fs.readFileSync(installed, 'utf8')).to.equal(fs.readFileSync(HOOK_SCRIPT, 'utf8'));

    const settings = readSettings(claudeDir);
    // Tracking needs both ends: start alone leaves subagents active forever,
    // stop alone never shows them at all.
    expect(commandsFor(settings, 'SubagentStart')).to.deep.equal([installed]);
    expect(commandsFor(settings, 'SubagentStop')).to.deep.equal([installed]);
  });

  it('does not duplicate a registration that already exists', () => {
    fs.mkdirSync(path.join(claudeDir, 'hooks'), { recursive: true });
    const existing = path.join(claudeDir, 'hooks', 'track-subagents.py');
    const entry = { hooks: [{ type: 'command', command: existing }] };
    fs.writeFileSync(
      path.join(claudeDir, 'settings.json'),
      JSON.stringify({ hooks: { SubagentStart: [entry], SubagentStop: [entry] } })
    );

    ensureSubagentTrackingHook(claudeDir);

    const settings = readSettings(claudeDir);
    expect(commandsFor(settings, 'SubagentStart')).to.have.lengthOf(1);
    expect(commandsFor(settings, 'SubagentStop')).to.have.lengthOf(1);
  });

  it('preserves unrelated settings and unrelated hooks', () => {
    const otherHook = { matcher: 'Bash', hooks: [{ type: 'command', command: '/somewhere/x.py' }] };
    fs.writeFileSync(
      path.join(claudeDir, 'settings.json'),
      JSON.stringify({ model: 'sonnet', hooks: { PreToolUse: [otherHook] } })
    );

    ensureSubagentTrackingHook(claudeDir);

    const settings = readSettings(claudeDir);
    expect(settings.model).to.equal('sonnet');
    expect(settings.hooks.PreToolUse).to.deep.equal([otherHook]);
    expect(commandsFor(settings, 'SubagentStart')).to.have.lengthOf(1);
  });

  it('recovers from an unparseable settings.json instead of throwing', () => {
    fs.writeFileSync(path.join(claudeDir, 'settings.json'), '{ not json');

    expect(() => ensureSubagentTrackingHook(claudeDir)).to.not.throw();
    expect(commandsFor(readSettings(claudeDir), 'SubagentStop')).to.have.lengthOf(1);
  });

  // A hand-edited settings.json can hold any shape. Installing hooks is a
  // side errand of spawning an agent - it must never be what kills the run.
  const malformed = {
    'hooks is a string': { hooks: 'nope' },
    'event value is not an array': { hooks: { SubagentStart: {} } },
    'entries are null': { hooks: { SubagentStart: [null], SubagentStop: [null] } },
    'entry.hooks is not an array': { hooks: { SubagentStart: [{ hooks: 'nope' }] } },
    'hook entry has no command': { hooks: { SubagentStop: [{ hooks: [{ type: 'command' }] }] } },
  };

  for (const [name, settings] of Object.entries(malformed)) {
    it(`survives malformed settings.json where ${name}`, () => {
      fs.writeFileSync(path.join(claudeDir, 'settings.json'), JSON.stringify(settings));

      expect(() => ensureSubagentTrackingHook(claudeDir)).to.not.throw();

      // Pre-existing junk entries are left alone; exactly one registration is added.
      const written = readSettings(claudeDir);
      const registrations = (event) =>
        commandsFor(written, event).filter((c) => c && c.endsWith('track-subagents.py'));
      expect(registrations('SubagentStart')).to.have.lengthOf(1);
      expect(registrations('SubagentStop')).to.have.lengthOf(1);
    });
  }
});

describe('ensureAskUserQuestionHook / ensureDangerousGitHook', function () {
  let claudeDir;

  beforeEach(() => {
    claudeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zs-hook-test-'));
  });

  afterEach(() => {
    fs.rmSync(claudeDir, { recursive: true, force: true });
  });

  it('registers the AskUserQuestion blocker without throwing on malformed settings', () => {
    fs.writeFileSync(
      path.join(claudeDir, 'settings.json'),
      JSON.stringify({ hooks: { PreToolUse: [null, { hooks: 'nope' }] } })
    );

    expect(() => ensureAskUserQuestionHook(claudeDir)).to.not.throw();

    const commands = commandsFor(readSettings(claudeDir), 'PreToolUse');
    expect(commands.some((c) => c && c.endsWith('block-ask-user-question.py'))).to.equal(true);
  });

  it('registers the dangerous-git blocker without throwing on malformed settings', () => {
    fs.writeFileSync(path.join(claudeDir, 'settings.json'), JSON.stringify({ hooks: 'nope' }));

    expect(() => ensureDangerousGitHook(claudeDir)).to.not.throw();

    const commands = commandsFor(readSettings(claudeDir), 'PreToolUse');
    expect(commands.some((c) => c && c.endsWith('block-dangerous-git.py'))).to.equal(true);
  });

  const malformedTopLevelSettings = [null, [], 'text'];
  const installers = [
    {
      name: 'AskUserQuestion blocker',
      install: ensureAskUserQuestionHook,
      event: 'PreToolUse',
      script: 'block-ask-user-question.py',
    },
    {
      name: 'dangerous-git blocker',
      install: ensureDangerousGitHook,
      event: 'PreToolUse',
      script: 'block-dangerous-git.py',
    },
    {
      name: 'subagent tracker',
      install: ensureSubagentTrackingHook,
      event: 'SubagentStart',
      script: 'track-subagents.py',
    },
  ];

  for (const { name, install, event, script } of installers) {
    for (const malformedSettings of malformedTopLevelSettings) {
      it(`${name} replaces top-level ${JSON.stringify(malformedSettings)} settings`, () => {
        fs.writeFileSync(path.join(claudeDir, 'settings.json'), JSON.stringify(malformedSettings));

        expect(() => install(claudeDir)).to.not.throw();

        const written = readSettings(claudeDir);
        expect(written).to.be.an('object').and.not.an('array');
        expect(commandsFor(written, event)).to.deep.equal([path.join(claudeDir, 'hooks', script)]);
      });
    }
  }
});

describe('track-subagents.py -> SubagentTracker contract', function () {
  const python = spawnSync('python3', ['--version']).status === 0 ? 'python3' : null;

  let clusterId;
  let eventsDir;
  let eventsFile;
  const parentAgentId = 'worker-1';

  beforeEach(() => {
    clusterId = `zs-contract-${process.pid}-${Math.random().toString(36).slice(2)}`;
    eventsDir = path.join(os.tmpdir(), 'zeroshot-subagents', clusterId);
    eventsFile = path.join(eventsDir, `${parentAgentId}.jsonl`);
  });

  afterEach(() => {
    fs.rmSync(eventsDir, { recursive: true, force: true });
  });

  function runHook(payload, env = {}) {
    return spawnSync(python, [HOOK_SCRIPT], {
      input: JSON.stringify(payload),
      encoding: 'utf8',
      env: {
        ...process.env,
        ZEROSHOT_TRACK_SUBAGENTS: '1',
        ZEROSHOT_SUBAGENT_EVENTS_FILE: eventsFile,
        ...env,
      },
    });
  }

  it('produces events a real SubagentTracker turns into active subagents', function () {
    if (!python) return this.skip();

    runHook({ hook_event_name: 'SubagentStart', agent_id: 'sub-a', agent_type: 'Explore' });
    runHook({ hook_event_name: 'SubagentStart', agent_id: 'sub-b', agent_type: 'Plan' });

    const tracker = new SubagentTracker(clusterId);
    tracker.poll();

    const active = tracker.getActiveSubagents(parentAgentId);
    expect(active.map((s) => s.id)).to.deep.equal(['sub-a', 'sub-b']);
    // No transcript path, so the hook falls back to agent_type for a label.
    expect(active.map((s) => s.description)).to.deep.equal(['Explore', 'Plan']);
    expect(active.every((s) => typeof s.startedAt === 'number')).to.equal(true);

    runHook({ hook_event_name: 'SubagentStop', agent_id: 'sub-a', agent_type: 'Explore' });
    tracker.poll();

    expect(tracker.getActiveSubagents(parentAgentId).map((s) => s.id)).to.deep.equal(['sub-b']);
  });

  it('writes nothing unless ZEROSHOT_TRACK_SUBAGENTS is set', function () {
    if (!python) return this.skip();

    runHook(
      { hook_event_name: 'SubagentStart', agent_id: 'sub-a', agent_type: 'Explore' },
      { ZEROSHOT_TRACK_SUBAGENTS: '0' }
    );

    expect(fs.existsSync(eventsFile)).to.equal(false);
  });
});
