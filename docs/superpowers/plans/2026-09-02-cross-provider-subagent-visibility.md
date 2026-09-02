# Cross-Provider Subagent Visibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show direct Claude and Codex child agents in the existing status footer for runs launched in a foreground TTY.

**Architecture:** One immutable launch capability controls whether stable provider hooks are injected. Claude's owned settings overlay and Codex session config overrides call the same packaged hook executable, which appends bounded provider-neutral JSONL records consumed by a best-effort tracker and the existing footer.

**Tech Stack:** Node.js 22, TypeScript/CommonJS, Claude Code settings overlays, Codex inline hook configuration, JSONL, Mocha, Docker isolation fixtures.

**Spec:** `docs/superpowers/specs/2026-09-02-upstream-v6.46-reconciliation-design.md`

## Global Constraints

- Obey the program plan's serial task admission/handoff contract; no worker may
  infer cwd or predecessor state from a prior worker's shell.

- Branch from the exact user-accepted reconciled checkpoint R, not from fork PR 31 or another feature branch.
- Enable tracking only for a run launched with a supported foreground TTY footer.
- Never enable for detached, daemon-only, silent, worker, any resume, later
  attach, or `logs -f` paths.
- Track direct children only; telemetry never changes provider, retry, session, task, output, or terminal results.
- Use documented `SubagentStart`/`SubagentStop`; do not parse transcripts or restore the Codex JSON collaboration observer.
- Use terse spawn titles only when safely correlated to the returned child ID; otherwise show provider agent type.
- Do not mutate user settings, suppress other hook layers, or pass `--dangerously-bypass-hook-trust`.
- No live provider run is authorized by this plan.

---

### Task 1: Compute the immutable foreground capability

**Files:**

- Create: `src/subagent-telemetry-capability.ts`
- Modify: `cli/index.js`
- Modify: `src/legacy-lib/start-cluster-run-options.ts`
- Modify: `src/orchestrator.js`
- Modify: `task-lib/runner.js`
- Test: `tests/unit/subagent-telemetry-capability.test.js`
- Modify: `tests/unit/detached-startup-contract.test.js`

**Interfaces:**

- Produces `resolveSubagentTelemetryCapability(input): Readonly<SubagentTelemetryCapability>`.
- Persists one frozen capability in start options before provider construction.
- Keeps per-provider hook support separate from the run-level foreground
  capability so an unsupported provider cannot disable supported parents.

- [ ] **Step 1: Add the launch-mode matrix test**

```js
const cases = [
  [{ stdoutIsTTY: true, foreground: true, footerEnabled: true }, true, 'foreground_tty'],
  [{ stdoutIsTTY: false, foreground: true, footerEnabled: true }, false, 'non_tty'],
  [{ stdoutIsTTY: true, detached: true }, false, 'detached'],
  [{ stdoutIsTTY: true, daemon: true }, false, 'daemon'],
  [{ stdoutIsTTY: true, silent: true }, false, 'silent'],
  [{ stdoutIsTTY: true, worker: true }, false, 'worker'],
  [{ stdoutIsTTY: true, resume: true }, false, 'resume'],
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
  | 'resume'
  | 'non_tty';

export interface SubagentTelemetryCapability {
  readonly enabled: boolean;
  readonly reason: SubagentTelemetryReason;
}
```

Resolve disabling modes before TTY at the CLI boundary that owns stdout and the
footer option. Freeze the result and pass it through current start boundaries
without reading `process.stdout.isTTY` again in the orchestrator or a provider
child.

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
git add src/subagent-telemetry-capability.ts src/subagent-telemetry-capability.js cli/index.js src/legacy-lib/start-cluster-run-options.ts src/orchestrator.js task-lib/runner.js lib task-lib tests/unit/subagent-telemetry-capability.test.js tests/unit/detached-startup-contract.test.js
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
- Produces `createSubagentEventPaths(runRoot, parentAgentId)`,
  `prepareSubagentTelemetryResources(options)`,
  `appendSubagentEvent(path, event)`, and
  `SubagentTracker.poll()`.

- [ ] **Step 1: Add literal hook fixtures**

Cover Claude and Codex `SubagentStart`, `SubagentStop`, `PostToolUse Agent`, and
`PostToolUse spawn_agent` JSON. Include malformed JSON, oversized stdin,
unknown event, traversal-shaped parent/invocation ID, long scalar, symlink
replacement, wrong owner/mode, partial line, duplicate start/stop,
stop-before-start, concurrent writers/lock contention/partial write, file-cap
overflow, and `start -> stop -> start`.

- [ ] **Step 2: Define and test the normalized record**

```ts
export interface SubagentLifecycleEvent {
  readonly version: 1;
  readonly event: 'start' | 'stop';
  readonly provider: 'claude' | 'codex';
  readonly parentAgentId: string;
  readonly parentInvocationId: string;
  readonly providerSessionId?: string;
  readonly providerTurnId?: string;
  readonly providerToolUseId?: string;
  readonly childAgentId: string;
  readonly agentType: string;
  readonly title?: string;
  readonly occurredAt: string;
}
```

Define a separate bounded `RootSessionBinding` control record keyed by provider,
parent, invocation/task ID, and root provider session ID. Both record variants
share version, full ISO timestamp, size limits, and the same parent file; control
records never render as rows.

Define a bounded Claude-only `ClaudeSpawnLink` control record with provider,
parent/invocation, session ID, caller agent ID or a fixed root sentinel, spawned
child ID, and tool-use ID. Lifecycle events remain buffered and non-renderable
until an exact same-session root-caller link proves the child is direct. A
non-root caller proves a descendant and is ignored; missing/conflicting links
fail closed.

Assert maximum stdin `64 KiB`, record `8 KiB`, event file `4 MiB`, active
children `64` per parent, title `120` characters, and type/ID `128` characters.

- [ ] **Step 3: Run and verify missing modules/bin**

```bash
npm run build:legacy-runtime
node tests/run-tests.js tests/unit/subagent-events.test.js tests/subagent-tracker.test.js tests/unit/subagent-hook.test.js
```

Expected: FAIL.

- [ ] **Step 4: Implement private paths and append**

Create a run-owned directory with `0700` and files with `0600`. Serialize each
file through a private `wx` lock with a bounded fail-open acquisition timeout.
Open append/create without following symlinks where supported, then `fstat` the
opened descriptor for owner, mode, and regular-file identity. Hold the lock for
the cap check and complete bounded write; reject partial writes. The hook reads
provider/parent/output from `ZEROSHOT_SUBAGENT_PROVIDER`,
`ZEROSHOT_PARENT_AGENT_ID`, `ZEROSHOT_PARENT_INVOCATION_ID`, and
`ZEROSHOT_SUBAGENT_EVENTS_FILE`; it never reads transcript paths.

The executable exits `0` for invalid/unavailable telemetry so it cannot affect
the provider. It writes nothing to stdout or stderr in normal operation.

- [ ] **Step 5: Implement complete-record tracking**

Maintain exactly one event file and lock per parent; invocation identity lives
only in records. Advance the byte offset only through the final newline. Key state by provider,
parent, invocation, and child. Upsert a repeated `start` so a later safely
correlated title enriches the existing child. Ignore unknown stops.
`finishInvocation(parentId, invocationId)` closes residual children but permits
a later provider task; `finishParent(parentId)` seals every invocation only at
final agent stop. Consumer-observable corruption or cap exhaustion disables the
parent and closes its rows. A silent fail-open lock/write failure cannot be
observed by the tracker; its truthful bound is eventual closure at the durable
`TASK_COMPLETED`/`TASK_FAILED` boundary or final parent stop. Test both paths.
This keeps total files bounded by parent count and total retained bytes bounded
by configured parents times the per-file cap.

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

### Task 3: Inject Claude hooks and prove direct-child ancestry

**Files:**

- Modify: `src/worktree-claude-config.ts`
- Modify: `src/agent-cli-provider/adapters/claude.ts`
- Modify: `cli/index.js`
- Modify: `src/orchestrator.js`
- Modify: `src/isolation-manager.js`
- Modify: `src/agent/agent-lifecycle.js`
- Modify: `src/agent/agent-task-executor.js`
- Modify: `src/claude-task-runner.js`
- Modify: `task-lib/runner.js`
- Modify: `task-lib/watcher.js`
- Modify: `task-lib/attachable-watcher.js`
- Test: `tests/unit/claude-hook-config-isolation.test.js`
- Test: `tests/unit/isolated-mode-output-capture.test.js`
- Test: `tests/integration/isolation-manager.test.js`

**Interfaces:**

- Extends `prepareClaudeSettingsOverlay` with optional owned `subagentTelemetry` paths/env.
- Injects the validated absolute host handler or constant absolute container
  handler for `SubagentStart`, `SubagentStop`, and `PostToolUse` matcher
  `^Agent$` only when capability is enabled.
- Creates the run telemetry root and Docker bind mapping before
  `_initializeIsolation`; provider runners receive only resolved paths/env.
- The foreground CLI owns one idempotent resource handle across startup,
  streaming, shutdown, and startup failure. Isolation code only consumes it.

- [ ] **Step 1: Add overlay merge and disabled-mode tests**

Assert enabled overlays contain all three hooks, preserve unrelated settings
and safety hooks, and never write the user's source file. For every disabled
reason, assert no telemetry hook, directory, file, mount, or env is created.
Inject each telemetry-only preparation/mount failure and assert one warning,
owned rollback, no hook/env/mount, and unchanged cluster/provider outcome.

- [ ] **Step 2: Add Claude title-correlation fixtures**

Current Claude Code permits nested subagents. Its `Agent` PostToolUse hook runs
in the caller context: `agent_id` is absent for the root and present for a
nested caller, while a successful tool response supplies the spawned child ID.
Append `ClaudeSpawnLink` only when exactly one bounded child ID is present.
Render a lifecycle event only after exact same-session ID linkage to the root
sentinel; links from a child caller are descendants and remain hidden. Do not
infer FIFO order or inspect transcripts. Cover root child, child/grandchild,
lifecycle-before-link, link-before-lifecycle, concurrent children,
stop-before-link, and malformed/conflicting IDs. The same proven root link may
add bounded `tool_input.description` as title; title absence never affects
identity.

Pin literal fixtures from the current official hook-specific Agent response:
both `completed` and default `async_launched` responses contain `agentId`.
This hook schema, not the generic Agent SDK result type, is authoritative for
the linker. If the probed/supported CLI response lacks the documented field or
it does not equal the lifecycle `agent_id`, classify that parent
`unsupported_parent_linkage`, emit one bounded warning, and render no Claude
rows. Never fall back to ordering inference.

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
  "command": "<validated-absolute-handler>",
  "timeout": 3
}
```

Do not copy arbitrary user hook shapes into a new global file. The existing
overlay already contains the run's effective safe settings and is passed with
Claude's `--settings`; extend that owned object and its cleanup list.

- [ ] **Step 5: Allocate before isolation, then thread launch values**

At the foreground CLI boundary before `startClusterFrom*`, call best-effort
`prepareSubagentTelemetryResources`. It returns either a validated idempotent
handle or a closed disabled reason. On EACCES, ENOSPC, missing/invalid handler,
or mapping error, remove partial owned resources, warn once, and start normally
without telemetry. Wrap startup, foreground streaming, and shutdown in one
`try/finally` that always releases the handle; transfer no cleanup ownership.

For enabled Claude only, pass the handle's mapping through one isolation
augmentation helper used by the main container and
`createValidatorIsolation` fallback:
mount only the telemetry root writable and the exact current standalone hook
read-only at a constant absolute container path. If Docker rejects only the
telemetry mounts, remove the partial container and retry once without telemetry;
unrelated Docker failures remain fatal. Containers cannot receive mounts later.

`task-lib/runner.js` is the sole task-ID authority for both providers. Outer
callers pass only frozen run/parent telemetry metadata. Immediately after
`generateId()`, the runner validates that descriptor, creates the Claude
overlay, and adds provider/parent/generated-task-ID/file values to the final
`CommandSpec.env`; do not create another ID. Both watcher variants assert the
same persisted ID. Use a validated absolute host handler normally and the
constant mounted path in Docker. Preserve cross-UID checks.

- [ ] **Step 6: Build and run Claude/isolation tests**

```bash
npm run build:agent-cli-provider
npm run build:legacy-runtime
node tests/run-tests.js tests/unit/claude-hook-config-isolation.test.js tests/unit/isolated-mode-output-capture.test.js tests/integration/isolation-manager.test.js tests/unit/docker-config-contract.test.js
npm run typecheck
npm run lint
```

Expected: PASS. Docker-unavailable integration is recorded as a skip.
For Claude, the hermetic suite must still exercise validator platform-mismatch
fallback and assert both telemetry mounts on that secondary container. For
Codex, assert the Docker exclusion: no telemetry override, env, or mount.

- [ ] **Step 7: Commit Claude production**

```bash
git add src/worktree-claude-config.ts src/worktree-claude-config.js src/agent-cli-provider/adapters/claude.ts cli/index.js src/orchestrator.js src/isolation-manager.js src/agent/agent-lifecycle.js src/agent/agent-task-executor.js src/claude-task-runner.js task-lib/runner.js task-lib/watcher.js task-lib/attachable-watcher.js tests/unit/claude-hook-config-isolation.test.js tests/unit/isolated-mode-output-capture.test.js tests/integration/isolation-manager.test.js
git commit -m "feat: track Claude subagents through run overlays"
```

### Task 4: Inject Codex hooks without bypassing trust

**Files:**

- Create: `src/worktree-codex-config.ts`
- Modify: `src/agent-cli-provider/types.ts`
- Modify: `src/agent-cli-provider/adapters/codex.ts`
- Modify: `src/agent-cli-provider/single-agent-runtime.ts`
- Modify: `cli/index.js`
- Modify: `src/agent/agent-task-executor.js`
- Modify: `task-lib/runner.js`
- Modify: `task-lib/watcher.js`
- Modify: `task-lib/attachable-watcher.js`
- Modify: `task-lib/provider-session-capture.js`
- Test: `tests/unit/codex-hook-config-isolation.test.js`
- Create: `tests/unit/codex-hook-trust-command.test.js`
- Modify: `tests/agent-cli-provider/parity.test.js`
- Modify: `tests/agent-cli-provider/executable-contract-option-validation.test.js`

**Interfaces:**

- Produces `buildCodexSubagentHookOverrides({ handlerCommand }): readonly
string[]` and optional adapter field `configOverrides: readonly string[]`.
- Injects inline session hook config alongside all other active layers; never uses `--ignore-user-config` or `--dangerously-bypass-hook-trust` for telemetry.
- Produces separate tested facts: generic Codex CLI compatibility and private
  `CodexHookCapabilityEvidence` (`config_compatible`, `disabled_by_user`,
  `disabled_by_policy`, `config_rejected`, `handler_unavailable`, or `unknown`).
  `config_compatible` does not assert that the user has trusted the definition.

- [ ] **Step 1: Pin literal official config fixtures in tests**

Assert the stable host overrides encode the validated absolute installed
handler path. These fixtures are host-only; the Codex Docker fixture asserts
absence of overrides, handler paths, env, and mounts. The following uses a
placeholder for the validated host value:

```toml
hooks.SubagentStart=[{hooks=[{type="command",command="<absolute-handler>",timeout=3}]}]
hooks.SubagentStop=[{hooks=[{type="command",command="<absolute-handler>",timeout=3}]}]
hooks.PostToolUse=[{matcher="^spawn_agent$",hooks=[{type="command",command="<absolute-handler>",timeout=3}]}]
```

Assert the adapter emits each as `--config`, preserves existing config
overrides, and omits all telemetry overrides when hooks are unsupported or the
launch capability is false.

- [ ] **Step 2: Add trust and layer regressions**

Assert telemetry construction never emits `--dangerously-bypass-hook-trust`,
`--ignore-user-config`, `allow_managed_hooks_only`, or `features.hooks=true`.
Existing user/system/project/plugin hooks remain active. A CLI reporting hooks
disabled/unsupported yields one warning and no tracking, not a task failure.
Add a user-invoked `zeroshot telemetry trust-codex-hooks` bootstrap test. It
uses the exact production builder and host handler identity, verifies the
packaged executable, and opens an interactive Codex TUI with no prompt so the
user can review through `/hooks`. Zeroshot records no trust result and refusal
remains no telemetry. Definition changes require review again.

Register that command in `cli/index.js`. `runCodexHookTrustBootstrap()` requires
an interactive TTY, calls the exact production override builder, verifies the
packaged handler, and spawns Codex with inherited stdio, no prompt, and no trust
bypass. It writes no user config or trust result. Hermetic command tests pin
argv and cover non-TTY, missing handler/CLI, cancellation, and bounded exit
diagnostics without changing any Zeroshot run state.

- [ ] **Step 3: Add title-correlation fixtures**

Use provider-valid `task_name: "review_release_guard"`. Pin a literal response
from the minimum supported/probed CLI. Enrich child `agent-42` only if that
response exposes exactly that ID or a same-session/same-turn/tool-use
correlation proves it; display the deterministic bounded title `review release
guard`. Never read assignment `message`/prompt text. Missing IDs, malformed,
failed, nested, concurrent, or multi-ID responses fall back to `agent_type`.

- [ ] **Step 4: Run tests and verify missing adapter support**

```bash
npm run build:agent-cli-provider
npm run build:legacy-runtime
node tests/run-tests.js tests/unit/codex-hook-config-isolation.test.js tests/unit/codex-hook-trust-command.test.js tests/agent-cli-provider/parity.test.js tests/agent-cli-provider/executable-contract-option-validation.test.js tests/unit/isolated-mode-output-capture.test.js
```

Expected: FAIL.

- [ ] **Step 5: Add capability detection and stable session overrides**

Keep the existing `detectCliFeatures(helpText, versionText)` compatibility API
unchanged. Add a separate bounded no-model `CodexHookCapabilityEvidence` probe
and closed propagation schema at the actual runtime owner in
`single-agent-runtime.ts`; pin minimum-version, `features list`, strict-config,
and `doctor --json` fixtures only for facts those outputs document. Unknown,
disabled, policy-blocked, rejected, or missing-bin states omit telemetry
overrides and produce at most one bounded warning without changing task
execution. Official tooling exposes no machine-readable exact-definition trust
status: never infer `untrusted` or `trusted`. A config-compatible launch supplies
the stable definition and Codex's normal trust layer may run or skip it.

Codex-in-Docker telemetry is outside this MVP: the plan has no proven mapping
for exact-definition trust state inside the container. Omit Codex telemetry
overrides and mounts there, report one bounded unavailable reason, and retain
Docker no-telemetry tests. Claude Docker telemetry remains supported.

Add only stable hook definitions; pass per-run path, provider, parent,
invocation ID through process env so the trusted hook definition does not
change each run. Record bounded `session_id`, `turn_id`, and tool-use ID from
official hook input. Capture the root Codex session from the adapter's existing
`thread.started` handling. In both watcher variants, a separate optional
best-effort `onSessionObserved` callback appends a `RootSessionBinding` control
record to the parent event file keyed by parent/task ID only after authoritative
task-row persistence succeeds. Catch observer errors separately so they never
set `persistenceError` or alter task completion. The tracker defers a bounded number
of rows until that binding arrives, and accepts a direct child only
when its parent session equals that root. Include session/turn in correlation
and deduplication. Add root child, nested grandchild, resumed/multi-turn, reused
ID, conflicting/missing/late binding, both watcher variants, observer failure,
late event, and provider-config-startup-failure fixtures.

Thread the owned handler identity and generated override array through the
actual task CLI boundary: `agent-task-executor` -> task env/options ->
`task-lib/runner.js` -> `buildProviderOptions` -> Codex adapter. Validate the
closed fields and assert the final watcher `CommandSpec.args`; adapter-only
tests are insufficient.

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
git add src/worktree-codex-config.ts src/worktree-codex-config.js src/agent-cli-provider/types.ts src/agent-cli-provider/adapters/codex.ts src/agent-cli-provider/single-agent-runtime.ts src/agent/agent-task-executor.js cli/index.js task-lib/runner.js task-lib/watcher.js task-lib/attachable-watcher.js task-lib/provider-session-capture.js tests/unit/codex-hook-config-isolation.test.js tests/unit/codex-hook-trust-command.test.js tests/agent-cli-provider/parity.test.js tests/agent-cli-provider/executable-contract-option-validation.test.js
git commit -m "feat: track Codex subagents through trusted hooks"
```

### Task 5: Render direct child rows in the existing footer

**Files:**

- Modify: `src/status-footer.js`
- Modify: `cli/index.js`
- Modify: `tests/unit/status-footer.test.js`
- Create: `tests/unit/cli-subagent-telemetry.test.js`

**Interfaces:**

- Adds `StatusFooter.updateSubagent(event)` and `StatusFooter.finishParentSubagents(parentAgentId)`.
- Child rows do not enter process metrics maps and count against the existing maximum footer rows.
- The foreground CLI owns tracker polling, footer updates, final drain, and
  cleanup; the orchestrator exposes no footer reference and never renders.

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

- [ ] **Step 2: Add foreground CLI lifecycle tests**

Assert one tracker starts only for an enabled run, polls while the footer is
active, closes the invocation whose durable `taskId` appears on each
`TASK_COMPLETED`/`TASK_FAILED`, seals a parent
only on final STOPPED, and cannot change a run's success/failure when read,
parse, or cleanup throws. Pin final order: stop new provider launches, await
parent task shutdown, poll complete records once, close invocations/parents,
stop the footer, then remove only the owned telemetry root. Prove attach and
`logs -f` cannot construct a tracker.
Cover two sequential invocations, provider retry reuse of one task ID, startup
failure, late records from task A after task B starts, and internal tasks that
cannot publish a matching lifecycle boundary (telemetry disabled for them).

- [ ] **Step 3: Run tests and verify missing footer support**

```bash
node tests/run-tests.js tests/unit/status-footer.test.js tests/unit/cli-subagent-telemetry.test.js
```

Expected: FAIL.

- [ ] **Step 4: Integrate subordinate rows**

Keep parent rows and current render lock/terminal degradation. Prefix child
labels with an indented branch marker, display bounded title or agent type,
and use start time for elapsed state. Do not add PID/CPU/RAM/network sampling
for children.

- [ ] **Step 5: Run footer and lifecycle tests**

```bash
node tests/run-tests.js tests/unit/status-footer.test.js tests/unit/cli-subagent-telemetry.test.js tests/unit/watcher-crash-handling.test.js
npm run typecheck
npm run lint
```

Expected: PASS.

- [ ] **Step 6: Commit footer integration**

```bash
git add src/status-footer.js cli/index.js tests/unit/status-footer.test.js tests/unit/cli-subagent-telemetry.test.js
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

Document foreground-at-launch activation, capability-gated Claude and host
Codex support, direct
children only, title fallback, normal provider hook trust, no transcript
parsing, and absence from detach/attach/logs/worker modes. Do not claim live
provider verification.

- [ ] **Step 2: Run the telemetry acceptance suite**

```bash
npm run build:agent-cli-provider
npm run build:legacy-runtime
npm run build:task-lib
node tests/run-tests.js tests/unit/subagent-telemetry-capability.test.js tests/unit/subagent-events.test.js tests/subagent-tracker.test.js tests/unit/subagent-hook.test.js tests/unit/claude-hook-config-isolation.test.js tests/unit/codex-hook-config-isolation.test.js tests/unit/codex-hook-trust-command.test.js tests/unit/isolated-mode-output-capture.test.js tests/unit/status-footer.test.js tests/unit/cli-subagent-telemetry.test.js tests/context-replay-policy.test.js
npm run check:agent-cli-provider:ci
npm run typecheck
npm run lint
npm test
npm pack --dry-run
```

Install the produced tarball into a fresh temporary prefix. Assert the npm bin
shim, Node shebang/executable mode, and a bounded no-op hook invocation all
work. Expected: PASS without launching Claude or Codex. Tar membership alone is
not acceptance.

- [ ] **Step 3: Run Docker proof when available**

```bash
npm run test:slow -- --grep "subagent telemetry"
```

Split proof by provider. For an enabled Claude container, Docker arguments
contain the writable telemetry-root and read-only current-package hook mounts;
invoking the mounted bin appends an event visible to the host even with an older
cached image. For Codex-in-Docker, assert no telemetry override, env, root mount,
or handler mount, exactly one unavailable reason, and otherwise normal startup.
Cleanup removes only the owned run directory. Record unavailable Docker as a
skip and never report a generic Docker telemetry pass.

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
