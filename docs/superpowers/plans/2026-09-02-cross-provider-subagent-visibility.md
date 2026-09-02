# Cross-Provider Subagent Visibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show direct Claude and Codex child agents in the existing status footer for runs launched in a foreground TTY.

**Architecture:** One immutable launch capability controls whether stable provider hooks are injected. Claude's owned settings overlay and Codex session config overrides call the same packaged hook executable, which appends bounded provider-neutral JSONL records consumed by a best-effort tracker and the existing footer.

**Tech Stack:** Node.js 22, TypeScript/CommonJS, Claude Code settings overlays, Codex inline hook configuration, JSONL, Mocha, Docker isolation fixtures.

**Spec:** `docs/superpowers/specs/2026-09-02-upstream-v6.46-reconciliation-design.md`

## Global Constraints

- Branch from the exact user-accepted reconciled checkpoint R, not from fork PR 31 or another feature branch.
- Enable tracking only for a run launched with a supported foreground TTY footer.
- Never enable for detached, daemon-only, silent, worker, later attach, or `logs -f` paths.
- Track direct children only; telemetry never changes provider, retry, session, task, output, or terminal results.
- Use documented `SubagentStart`/`SubagentStop`; do not parse transcripts or restore the Codex JSON collaboration observer.
- Use terse spawn titles only when safely correlated to the returned child ID; otherwise show provider agent type.
- Do not mutate user settings, suppress other hook layers, or pass `--dangerously-bypass-hook-trust`.
- No live provider run is authorized by this plan.

---

### Task 1: Compute the immutable foreground capability

**Files:**

- Create: `src/subagent-telemetry-capability.ts`
- Modify: `src/legacy-lib/start-cluster-run-options.ts`
- Modify: `src/orchestrator.js`
- Modify: `task-lib/runner.js`
- Test: `tests/unit/subagent-telemetry-capability.test.js`
- Modify: `tests/unit/detached-startup-contract.test.js`

**Interfaces:**

- Produces `resolveSubagentTelemetryCapability(input): Readonly<SubagentTelemetryCapability>`.
- Persists one frozen capability in start options before provider construction.

- [ ] **Step 1: Add the launch-mode matrix test**

```js
const cases = [
  [{ stdoutIsTTY: true, foreground: true, footerEnabled: true }, true, 'foreground_tty'],
  [{ stdoutIsTTY: false, foreground: true, footerEnabled: true }, false, 'non_tty'],
  [{ stdoutIsTTY: true, detached: true }, false, 'detached'],
  [{ stdoutIsTTY: true, daemon: true }, false, 'daemon'],
  [{ stdoutIsTTY: true, silent: true }, false, 'silent'],
  [{ stdoutIsTTY: true, worker: true }, false, 'worker'],
];
for (const [input, enabled, reason] of cases) {
  assert.deepStrictEqual(resolveSubagentTelemetryCapability(input), { enabled, reason });
}
```

Add tests proving later attach/log follow cannot turn a false capability true.

- [ ] **Step 2: Run and verify the module is absent**

```bash
npm run build:legacy-runtime
node tests/run-tests.js tests/unit/subagent-telemetry-capability.test.js tests/unit/detached-startup-contract.test.js
```

Expected: FAIL.

- [ ] **Step 3: Implement the closed reason type and precedence**

```ts
export type SubagentTelemetryReason =
  | 'foreground_tty'
  | 'detached'
  | 'daemon'
  | 'silent'
  | 'worker'
  | 'non_tty'
  | 'unsupported_provider';

export interface SubagentTelemetryCapability {
  readonly enabled: boolean;
  readonly reason: SubagentTelemetryReason;
}
```

Resolve disabling modes before TTY. Freeze the result and pass it through
current start/trusted-start boundaries without reading `process.stdout.isTTY`
again in a provider child.

- [ ] **Step 4: Build and run launch tests**

```bash
npm run build:legacy-lib
npm run build:legacy-runtime
npm run build:task-lib
node tests/run-tests.js tests/unit/subagent-telemetry-capability.test.js tests/unit/detached-startup-contract.test.js tests/unit/cli-resume-loads-clusters.test.js tests/unit/status-footer.test.js
npm run typecheck
npm run lint
```

Expected: PASS.

- [ ] **Step 5: Commit launch capability**

```bash
git add src/subagent-telemetry-capability.ts src/subagent-telemetry-capability.js src/legacy-lib/start-cluster-run-options.ts src/orchestrator.js task-lib/runner.js lib task-lib tests/unit/subagent-telemetry-capability.test.js tests/unit/detached-startup-contract.test.js
git commit -m "feat: gate subagent telemetry at foreground launch"
```

### Task 2: Add the bounded event writer and reliable tracker

**Files:**

- Create: `src/subagent-events.ts`
- Create: `src/subagent-tracker.ts`
- Create: `bin/zeroshot-subagent-hook.js`
- Modify: `package.json`
- Test: `tests/unit/subagent-events.test.js`
- Test: `tests/subagent-tracker.test.js`
- Test: `tests/unit/subagent-hook.test.js`

**Interfaces:**

- Adds package bin `zeroshot-subagent-hook` -> `./bin/zeroshot-subagent-hook.js`.
- Produces `createSubagentEventPaths(runRoot, parentAgentId)`, `appendSubagentEvent(path, event)`, and `SubagentTracker.poll()`.

- [ ] **Step 1: Add literal hook fixtures**

Cover Claude and Codex `SubagentStart`, `SubagentStop`, `PostToolUse Agent`, and
`PostToolUse spawn_agent` JSON. Include malformed JSON, oversized stdin,
unknown event, traversal-shaped parent ID, long scalar, symlink output, wrong
owner/mode, partial line, duplicate start/stop, stop-before-start, and
`start -> stop -> start`.

- [ ] **Step 2: Define and test the normalized record**

```ts
export interface SubagentLifecycleEvent {
  readonly version: 1;
  readonly event: 'start' | 'stop';
  readonly provider: 'claude' | 'codex';
  readonly parentAgentId: string;
  readonly childAgentId: string;
  readonly agentType: string;
  readonly title?: string;
  readonly occurredAt: string;
}
```

Assert maximum stdin `64 KiB`, record `8 KiB`, event file `4 MiB`, active
children `64` per parent, title `120` characters, and type/ID `128` characters.

- [ ] **Step 3: Run and verify missing modules/bin**

```bash
npm run build:legacy-runtime
node tests/run-tests.js tests/unit/subagent-events.test.js tests/subagent-tracker.test.js tests/unit/subagent-hook.test.js
```

Expected: FAIL.

- [ ] **Step 4: Implement private paths and append**

Create a run-owned directory with `0700` and files with `0600`. Canonicalize
and verify every path remains beneath the owned root and is a regular file.
Append one JSON object plus newline with one bounded write. The hook reads
provider/parent/output from `ZEROSHOT_SUBAGENT_PROVIDER`,
`ZEROSHOT_PARENT_AGENT_ID`, and `ZEROSHOT_SUBAGENT_EVENTS_FILE`; it never reads
transcript paths.

The executable exits `0` for invalid/unavailable telemetry so it cannot affect
the provider. It writes nothing to stdout or stderr in normal operation.

- [ ] **Step 5: Implement complete-record tracking**

Advance the byte offset only through the final newline. Upsert a repeated
`start` so a later safely correlated title enriches the existing child. Ignore
unknown stops. `finishParent(parentId)` marks active direct children stopped in
memory and rejects later events for that parent.

- [ ] **Step 6: Build and run event tests**

```bash
npm run build:legacy-runtime
node tests/run-tests.js tests/unit/subagent-events.test.js tests/subagent-tracker.test.js tests/unit/subagent-hook.test.js
npm run typecheck:legacy-runtime
npm run lint
npm pack --dry-run
```

Expected: PASS and the tarball contains `bin/zeroshot-subagent-hook.js`.

- [ ] **Step 7: Commit sink, hook, and tracker**

```bash
git add src/subagent-events.ts src/subagent-events.js src/subagent-tracker.ts src/subagent-tracker.js bin/zeroshot-subagent-hook.js package.json package-lock.json npm-shrinkwrap.json tests/unit/subagent-events.test.js tests/subagent-tracker.test.js tests/unit/subagent-hook.test.js
git commit -m "feat: add bounded subagent lifecycle sink"
```

### Task 3: Inject Claude hooks through the owned overlay

**Files:**

- Modify: `src/worktree-claude-config.ts`
- Modify: `src/agent-cli-provider/adapters/claude.ts`
- Modify: `src/agent/agent-task-executor.js`
- Modify: `src/claude-task-runner.js`
- Test: `tests/unit/claude-hook-config-isolation.test.js`
- Test: `tests/unit/isolated-mode-output-capture.test.js`
- Test: `tests/integration/isolation-manager.test.js`

**Interfaces:**

- Extends `prepareClaudeSettingsOverlay` with optional owned `subagentTelemetry` paths/env.
- Injects stable command `zeroshot-subagent-hook` for `SubagentStart`, `SubagentStop`, and `PostToolUse` matcher `^Agent$` only when capability is enabled.

- [ ] **Step 1: Add overlay merge and disabled-mode tests**

Assert enabled overlays contain all three hooks, preserve unrelated settings
and safety hooks, and never write the user's source file. For every disabled
reason, assert no telemetry hook, directory, file, mount, or env is created.

- [ ] **Step 2: Add Claude title-correlation fixtures**

The `Agent` PostToolUse fixture includes `tool_input.description` and a tool
response containing one child ID. Assert the hook appends a second `start`
record with that title. For zero/multiple child IDs or concurrent ambiguity,
assert no title record is emitted and tracker retains `agent_type`.

- [ ] **Step 3: Run tests and verify missing injection**

```bash
npm run build:agent-cli-provider
npm run build:legacy-runtime
node tests/run-tests.js tests/unit/claude-hook-config-isolation.test.js tests/unit/isolated-mode-output-capture.test.js tests/integration/isolation-manager.test.js
```

Expected: FAIL.

- [ ] **Step 4: Merge only Zeroshot-owned hook groups**

Use exact stable handlers:

```json
{
  "type": "command",
  "command": "zeroshot-subagent-hook",
  "timeout": 3
}
```

Do not copy arbitrary user hook shapes into a new global file. The existing
overlay already contains the run's effective safe settings and is passed with
Claude's `--settings`; extend that owned object and its cleanup list.

- [ ] **Step 5: Thread env/mounts to normal and isolated execution**

Pass the three `ZEROSHOT_*` values only for enabled parent launches. In Docker,
create the host event file first and mount only the owned run telemetry
directory writable at the corresponding container path. Preserve upstream
cleanup ownership and cross-UID checks.

- [ ] **Step 6: Build and run Claude/isolation tests**

```bash
npm run build:agent-cli-provider
npm run build:legacy-runtime
node tests/run-tests.js tests/unit/claude-hook-config-isolation.test.js tests/unit/isolated-mode-output-capture.test.js tests/integration/isolation-manager.test.js tests/unit/docker-config-contract.test.js
npm run typecheck
npm run lint
```

Expected: PASS. Docker-unavailable integration is recorded as a skip.

- [ ] **Step 7: Commit Claude production**

```bash
git add src/worktree-claude-config.ts src/worktree-claude-config.js src/agent-cli-provider/adapters/claude.ts src/agent/agent-task-executor.js src/claude-task-runner.js tests/unit/claude-hook-config-isolation.test.js tests/unit/isolated-mode-output-capture.test.js tests/integration/isolation-manager.test.js
git commit -m "feat: track Claude subagents through run overlays"
```

### Task 4: Inject Codex hooks without bypassing trust

**Files:**

- Create: `src/worktree-codex-config.ts`
- Modify: `src/agent-cli-provider/types.ts`
- Modify: `src/agent-cli-provider/adapters/codex.ts`
- Modify: `src/agent/agent-task-executor.js`
- Test: `tests/unit/codex-hook-config-isolation.test.js`
- Modify: `tests/agent-cli-provider/parity.test.js`
- Modify: `tests/agent-cli-provider/executable-contract-option-validation.test.js`

**Interfaces:**

- Produces `buildCodexSubagentHookOverrides(): readonly string[]` and optional adapter field `configOverrides: readonly string[]`.
- Injects inline session hook config alongside all other active layers; never uses `--ignore-user-config` or `--dangerously-bypass-hook-trust` for telemetry.

- [ ] **Step 1: Pin literal official config fixtures in tests**

Assert the stable overrides encode:

```toml
hooks.SubagentStart=[{hooks=[{type="command",command="zeroshot-subagent-hook",timeout=3}]}]
hooks.SubagentStop=[{hooks=[{type="command",command="zeroshot-subagent-hook",timeout=3}]}]
hooks.PostToolUse=[{matcher="^spawn_agent$",hooks=[{type="command",command="zeroshot-subagent-hook",timeout=3}]}]
```

Assert the adapter emits each as `--config`, preserves existing config
overrides, and omits all telemetry overrides when hooks are unsupported or the
launch capability is false.

- [ ] **Step 2: Add trust and layer regressions**

Assert telemetry construction never emits `--dangerously-bypass-hook-trust`,
`--ignore-user-config`, `allow_managed_hooks_only`, or `features.hooks=true`.
Existing user/system/project/plugin hooks remain active. A CLI reporting hooks
disabled/unsupported yields one warning and no tracking, not a task failure.

- [ ] **Step 3: Add title-correlation fixtures**

Use a literal Codex `PostToolUse` for `spawn_agent` whose `tool_input.task_name`
is `review release guard` and whose `tool_response` identifies child
`agent-42`. Assert a title-enriched start record for `agent-42`. Malformed,
failed, nested, or multi-ID responses fall back to `agent_type`.

- [ ] **Step 4: Run tests and verify missing adapter support**

```bash
npm run build:agent-cli-provider
npm run build:legacy-runtime
node tests/run-tests.js tests/unit/codex-hook-config-isolation.test.js tests/agent-cli-provider/parity.test.js tests/agent-cli-provider/executable-contract-option-validation.test.js tests/unit/isolated-mode-output-capture.test.js
```

Expected: FAIL.

- [ ] **Step 5: Add capability detection and stable session overrides**

Extend Codex CLI feature detection to prove both lifecycle hooks and config
overrides are available. Add only stable hook definitions; pass per-run path,
provider, and parent ID through process env so the trusted hook hash does not
change each run. Let Codex's normal review/trust flow decide whether the hook
runs. A skipped untrusted hook simply means no child rows.

- [ ] **Step 6: Build and run Codex contract tests**

```bash
npm run check:agent-cli-provider:ci
npm run build:legacy-runtime
node tests/run-tests.js tests/unit/codex-hook-config-isolation.test.js tests/unit/isolated-mode-output-capture.test.js tests/context-replay-policy.test.js
npm run typecheck
npm run lint
```

Expected: PASS and no JSON collaboration-stream observer module exists.

- [ ] **Step 7: Commit Codex production**

```bash
git add src/worktree-codex-config.ts src/worktree-codex-config.js src/agent-cli-provider/types.ts src/agent-cli-provider/adapters/codex.ts src/agent/agent-task-executor.js tests/unit/codex-hook-config-isolation.test.js tests/agent-cli-provider/parity.test.js tests/agent-cli-provider/executable-contract-option-validation.test.js
git commit -m "feat: track Codex subagents through trusted hooks"
```

### Task 5: Render direct child rows in the existing footer

**Files:**

- Modify: `src/status-footer.js`
- Modify: `src/orchestrator.js`
- Modify: `tests/unit/status-footer.test.js`
- Create: `tests/unit/orchestrator-subagent-telemetry.test.js`

**Interfaces:**

- Adds `StatusFooter.updateSubagent(event)` and `StatusFooter.finishParentSubagents(parentAgentId)`.
- Child rows do not enter process metrics maps and count against the existing maximum footer rows.

- [ ] **Step 1: Add rendering and state tests**

```js
footer.updateSubagent({
  event: 'start',
  provider: 'codex',
  parentAgentId: 'analyst',
  childAgentId: 'agent-42',
  agentType: 'worker',
  title: 'review release guard',
});
const rows = footer.buildAgentRows(footer.executingEntries(), 100).map(stripAnsi);
assert.ok(rows.some((row) => row.includes('review release guard')));
assert.strictEqual(footer.interpolatedMetrics.has('agent-42'), false);
```

Test stop, restart, parent finish, duplicate/late event, long title truncation,
row cap, narrow terminal, and same child ID under different parents/providers.

- [ ] **Step 2: Add orchestrator lifecycle tests**

Assert one tracker starts only for an enabled run, polls while the footer is
active, finishes parents before deleting owned files, and cannot change a run's
success/failure when read, parse, or cleanup throws.

- [ ] **Step 3: Run tests and verify missing footer support**

```bash
node tests/run-tests.js tests/unit/status-footer.test.js tests/unit/orchestrator-subagent-telemetry.test.js
```

Expected: FAIL.

- [ ] **Step 4: Integrate subordinate rows**

Keep parent rows and current render lock/terminal degradation. Prefix child
labels with an indented branch marker, display bounded title or agent type,
and use start time for elapsed state. Do not add PID/CPU/RAM/network sampling
for children.

- [ ] **Step 5: Run footer and lifecycle tests**

```bash
node tests/run-tests.js tests/unit/status-footer.test.js tests/unit/orchestrator-subagent-telemetry.test.js tests/unit/orchestrator-subagent-cleanup.test.js tests/unit/watcher-crash-handling.test.js
npm run typecheck
npm run lint
```

Expected: PASS.

- [ ] **Step 6: Commit footer integration**

```bash
git add src/status-footer.js src/orchestrator.js tests/unit/status-footer.test.js tests/unit/orchestrator-subagent-telemetry.test.js
git commit -m "feat: render direct subagents in status footer"
```

### Task 6: Verify packaging, disabled modes, and provider contracts

**Files:**

- Create: `docs/reconciliation/subagent-visibility-evidence.md`
- Modify: `README.md`

**Interfaces:**

- Consumes: Tasks 1-5.
- Produces: hermetic acceptance evidence and user-facing limitations.

- [ ] **Step 1: Document the exact behavior**

Document foreground-at-launch activation, Claude and Codex support, direct
children only, title fallback, normal provider hook trust, no transcript
parsing, and absence from detach/attach/logs/worker modes. Do not claim live
provider verification.

- [ ] **Step 2: Run the telemetry acceptance suite**

```bash
npm run build:agent-cli-provider
npm run build:legacy-runtime
npm run build:task-lib
node tests/run-tests.js tests/unit/subagent-telemetry-capability.test.js tests/unit/subagent-events.test.js tests/subagent-tracker.test.js tests/unit/subagent-hook.test.js tests/unit/claude-hook-config-isolation.test.js tests/unit/codex-hook-config-isolation.test.js tests/unit/isolated-mode-output-capture.test.js tests/unit/status-footer.test.js tests/unit/orchestrator-subagent-telemetry.test.js tests/context-replay-policy.test.js
npm run check:agent-cli-provider:ci
npm run typecheck
npm run lint
npm test
npm pack --dry-run
```

Expected: PASS without launching Claude or Codex. Confirm the tarball includes
the hook bin and required overlay modules.

- [ ] **Step 3: Run Docker proof when available**

```bash
npm run test:slow -- --grep "subagent telemetry"
```

Expected: container append is visible to the host and cleanup removes only the
owned run directory. Record unavailable Docker as a skip.

- [ ] **Step 4: Record exact evidence**

In `docs/reconciliation/subagent-visibility-evidence.md`, record branch/commit,
official documentation URLs checked on the execution date, installed Codex and
Claude CLI versions if locally queryable without login, each command status,
Docker skip/pass, and the statement `No live provider smoke performed`.

- [ ] **Step 5: Scan forbidden mechanisms**

```bash
rg -n "transcript_path|agent_transcript_path|codex-subagent-observer|dangerously-bypass-hook-trust|ZEROSHOT_TRACK_SUBAGENTS" src bin cluster-hooks cli task-lib
```

Expected: no transcript reads, no old observer, no trust bypass, and no legacy
always-on environment switch. Literal ignored field names may occur only in
fixture validation tests.

- [ ] **Step 6: Commit evidence and docs**

```bash
git add README.md docs/reconciliation/subagent-visibility-evidence.md
git commit -m "docs: record subagent visibility contracts"
git status --short
```

Expected: clean feature branch. Present it for review; do not merge or run a
live provider without separate approval.
