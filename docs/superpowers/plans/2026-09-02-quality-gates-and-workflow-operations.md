# Quality Gates and Workflow Operations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore cheap approved repository preflight checks and deterministic workflow synthesis without restoring template-controlled shell execution.

**Architecture:** A versioned per-repository approval store feeds a bounded preflight runner before provider startup. Separately, a closed in-process registry exposes exactly three typed workflow operations whose topic routing and terminal behavior are owned by code rather than templates.

**Tech Stack:** Node.js 22, strict TypeScript, CommonJS generated builds, child process execution at one owned preflight boundary, Mocha, JSON workflow validation.

**Spec:** `docs/superpowers/specs/2026-09-02-upstream-v6.46-reconciliation-design.md`

## Global Constraints

- Preflight runs before any model/provider call and is distinct from command proofs and `requiredQualityGates`.
- New or changed deterministic commands require one-time interactive confirmation.
- Non-interactive missing gates require `--allow-missing-quality-gate`; `--skip-quality-gate` remains the broad preflight compatibility bypass.
- Neither flag may remove or weaken a protected handoff gate.
- No template may specify a command, executable, args, cwd, env, stdin, or arbitrary success/failure topic.
- Maintained TypeScript sources are authoritative; generate JavaScript using upstream build scripts.
- No live provider run is authorized.

---

### Task 1: Build the versioned approval store and deterministic discovery

**Files:**

- Create: `src/legacy-lib/preflight-quality-gate-types.ts`
- Create: `src/legacy-lib/preflight-quality-gate-store.ts`
- Create: `src/legacy-lib/preflight-quality-gate-discovery.ts`
- Test: `tests/unit/preflight-quality-gate-store.test.js`
- Create: `tests/quality-detection.test.js`

**Interfaces:**

- Produces: `ApprovedPreflightGateV1`, `PreflightGateSuggestion`, `loadApprovedPreflightGate(repositoryRoot)`, `saveApprovedPreflightGate(record)`, and `discoverPreflightGate(repositoryRoot)`.
- State path: `~/.zeroshot/projects/<sha256(realpath-root)[0..12]>.json`, overridable by `ZEROSHOT_PROJECTS_DIR` in tests.

- [ ] **Step 1: Define the exact types in a failing consumer test**

```ts
export interface ApprovedPreflightGateV1 {
  readonly version: 1;
  readonly repositoryPath: string;
  readonly command: string;
  readonly fingerprint: string;
  readonly discovery: 'deterministic' | 'manual';
  readonly approvedAt: string;
}

export interface PreflightGateSuggestion {
  readonly command: string;
  readonly ecosystems: readonly string[];
  readonly fingerprint: string;
}
```

Tests must prove canonical realpath hashing, version/path rejection, malformed
JSON rejection, `0600` file mode on POSIX, atomic save, and full ISO timestamp
round-trip.

- [ ] **Step 2: Run the store test and verify missing modules**

```bash
npm run build:legacy-lib
node tests/run-tests.js tests/unit/preflight-quality-gate-store.test.js
```

Expected: FAIL because the new exports do not exist.

- [ ] **Step 3: Implement fail-closed load and atomic save**

```ts
function isApprovedV1(value: unknown, repositoryPath: string): value is ApprovedPreflightGateV1 {
  if (!isRecord(value) || value.version !== 1) return false;
  return (
    value.repositoryPath === repositoryPath &&
    typeof value.command === 'string' &&
    value.command.trim().length > 0 &&
    /^[a-f0-9]{64}$/.test(String(value.fingerprint)) &&
    (value.discovery === 'deterministic' || value.discovery === 'manual') &&
    typeof value.approvedAt === 'string' &&
    Number.isFinite(Date.parse(value.approvedAt))
  );
}
```

Write a private sibling temp file with `flag: 'wx'`, mode `0o600`, then rename.
Never return a partial record or overwrite state following a failed write.

- [ ] **Step 4: Port bounded deterministic discovery**

Port the ecosystem decisions from fork prior art `lib/quality-detection.js`, but
make discovery pure. Fingerprint the exact command and bytes of only the known
inputs consulted (`package.json`, lockfile markers, `pyproject.toml`,
`Cargo.toml`, and the other explicit ecosystem files). Use:

```ts
const fingerprint = createHash('sha256')
  .update(JSON.stringify({ version: 1, command, inputs }))
  .digest('hex');
```

Reject symlinks or paths that resolve outside `repositoryRoot`; bound every
read. Do not invoke a model or execute a discovered command.

- [ ] **Step 5: Run discovery and store tests**

```bash
npm run build:legacy-lib
node tests/run-tests.js tests/unit/preflight-quality-gate-store.test.js tests/quality-detection.test.js
npm run typecheck:legacy-lib
npm run lint
```

Expected: PASS across Node, Python, Rust, multi-ecosystem, unknown, changed
input, malformed-state, and symlink-containment fixtures.

- [ ] **Step 6: Commit discovery and state**

```bash
git add src/legacy-lib/preflight-quality-gate-types.ts src/legacy-lib/preflight-quality-gate-store.ts src/legacy-lib/preflight-quality-gate-discovery.ts lib/preflight-quality-gate-types.js lib/preflight-quality-gate-types.d.ts lib/preflight-quality-gate-store.js lib/preflight-quality-gate-store.d.ts lib/preflight-quality-gate-discovery.js lib/preflight-quality-gate-discovery.d.ts tests/unit/preflight-quality-gate-store.test.js tests/quality-detection.test.js
git commit -m "feat: discover and cache approved preflight gates"
```

Stage generated `lib/` files only after `npm run build:legacy-lib` produced
them; do not edit them manually.

### Task 2: Implement confirmation and bounded execution

**Files:**

- Create: `src/legacy-lib/preflight-quality-gate-runner.ts`
- Test: `tests/preflight-quality-gate-runner.test.js`

**Interfaces:**

- Consumes: canonical root, cached record, deterministic suggestion, flags, TTY/prompt dependency, abort signal.
- Produces: `runPreflightQualityGate(options): Promise<PreflightGateReceipt>`.

- [ ] **Step 1: Define the receipt and state-machine tests**

```ts
export type PreflightGateStatus =
  | 'passed'
  | 'failed'
  | 'timed_out'
  | 'cancelled'
  | 'launch_error'
  | 'skipped'
  | 'missing_allowed';

export interface PreflightGateReceipt {
  readonly version: 1;
  readonly repositoryPath: string;
  readonly fingerprint?: string;
  readonly status: PreflightGateStatus;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly exitCode?: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly truncated: boolean;
}
```

Tests cover cached match, changed cache with accept/refuse, no suggestion,
non-TTY missing with and without the narrow flag, broad skip, timeout,
cancellation, launch error, nonzero exit, output truncation, and redaction.

- [ ] **Step 2: Run and verify the missing runner**

```bash
npm run build:legacy-lib
node tests/run-tests.js tests/preflight-quality-gate-runner.test.js
```

Expected: FAIL because `runPreflightQualityGate` is absent.

- [ ] **Step 3: Implement the decision state machine**

Use this order exactly:

```ts
if (options.skipQualityGate) return skippedReceipt(options.repositoryRoot);
const cached = loadApprovedPreflightGate(options.repositoryRoot);
const suggestion = discoverPreflightGate(options.repositoryRoot);
if (cached?.discovery === 'manual') {
  return executeApprovedGate(cached, options);
}
if (cached && suggestion && cached.fingerprint === suggestion.fingerprint) {
  return executeApprovedGate(cached, options);
}
if (!options.interactive) {
  if (options.allowMissingQualityGate) return missingAllowedReceipt(options.repositoryRoot);
  throw new PreflightGateApprovalError('No current approved preflight quality gate');
}
const approved = await options.confirm(formatApprovalPrompt(suggestion));
if (!approved) throw new PreflightGateApprovalError('Preflight quality gate was not approved');
```

When the deterministic suggestion is absent, the interactive confirmation must
say that no gate will be cached or run. Do not invent `true`, `echo`, or another
placeholder command.

- [ ] **Step 4: Implement contained execution**

Use `spawn(command, { shell: true, cwd: repositoryPath, env, stdio })` only
after approval. Enforce `DEFAULT_TIMEOUT_MS = 15 * 60 * 1000` and
`MAX_CAPTURE_BYTES = 1024 * 1024` per stream. Kill the owned process group on
timeout/cancellation using the repository's existing process cleanup helper.
Receipt diagnostics redact environment values whose names match
`TOKEN|SECRET|PASSWORD|KEY|CREDENTIAL|AUTH`.

- [ ] **Step 5: Run focused tests**

```bash
npm run build:legacy-lib
node tests/run-tests.js tests/preflight-quality-gate-runner.test.js tests/unit/command-spec-cleanup-safety.test.js
npm run typecheck:legacy-lib
npm run lint
```

Expected: PASS; no fixture process remains alive.

- [ ] **Step 6: Commit the runner**

```bash
git add src/legacy-lib/preflight-quality-gate-runner.ts lib/preflight-quality-gate-runner.js lib/preflight-quality-gate-runner.d.ts tests/preflight-quality-gate-runner.test.js
git commit -m "feat: run approved preflight quality gates"
```

### Task 3: Thread preflight through every launch mode before providers

**Files:**

- Modify: `cli/index.js`
- Modify: `src/legacy-lib/start-cluster-run-options.ts`
- Modify: `src/legacy-lib/start-cluster-config.ts`
- Modify: `src/legacy-lib/start-cluster.ts`
- Modify: `src/orchestrator.js`
- Modify: `task-lib/runner.js`
- Test: `tests/unit/cli-run-preflight.test.js`
- Test: `tests/unit/start-cluster-config.test.js`
- Test: `tests/unit/detached-startup-contract.test.js`
- Test: `tests/unit/cli-resume-loads-clusters.test.js`
- Test: `tests/integration/orchestrator-flow.test.js`

**Interfaces:**

- Produces CLI booleans `skipQualityGate` and `allowMissingQualityGate`, plus a persisted `preflightQualityGateReceipt`.
- Extends `prepareClusterConfig(config, settings, providerOverride, paramOverrides = {})` and passes overrides to `TemplateResolver.resolveTemplate`.

- [ ] **Step 1: Add flag and ordering regressions**

```js
const calls = [];
await runClusterPreflight({
  input,
  options: { allowMissingQualityGate: true },
  dependencies: {
    requirePreflight: async () => calls.push('system'),
    runPreflightQualityGate: async () => {
      calls.push('quality');
      return receipt;
    },
    startProvider: async () => calls.push('provider'),
  },
});
assert.deepStrictEqual(calls, ['system', 'quality']);
```

Add detached tests proving the parent persists the receipt and the daemon does
not rediscover or prompt. Add resume tests proving the absolute repository path
and receipt survive. Add a protected handoff regression where both flags are
true and `requiredQualityGates` is unchanged.

- [ ] **Step 2: Run focused tests and verify failures**

```bash
npm run build:legacy-lib
npm run build:task-lib
node tests/run-tests.js tests/unit/cli-run-preflight.test.js tests/unit/start-cluster-config.test.js tests/unit/detached-startup-contract.test.js tests/unit/cli-resume-loads-clusters.test.js tests/integration/orchestrator-flow.test.js
```

Expected: FAIL on absent flags, receipt, or parameter override threading.

- [ ] **Step 3: Add CLI options and execute once**

```js
.option('--skip-quality-gate', 'Skip the optional repository preflight quality gate')
.option(
  '--allow-missing-quality-gate',
  'In non-interactive runs, continue only when no current approved preflight gate exists'
)
```

Resolve the original repository root and run the quality preflight after
upstream system/provider-auth preflight but before simulation, isolation,
daemon spawn, orchestrator start, or provider construction. Persist the frozen
receipt in serialized run options.

- [ ] **Step 4: Add typed option/config propagation**

Extend `RunOptions` with both booleans and the receipt. Change:

```ts
function resolveParameterizedConfigFile(
  config: ClusterConfig,
  paramOverrides: Record<string, unknown> = {}
): ClusterConfig {
  if (!config?.params || Object.keys(config.params).length === 0) return config;
  return resolver.resolveTemplate(config, paramOverrides);
}
```

Use pack parameter overrides only for the optional pack pre-validation phase;
never rewrite `options.requiredQualityGates`.

- [ ] **Step 5: Run launch-path tests and builds**

```bash
npm run build:legacy-lib
npm run build:task-lib
npm run build:cli-runtime
node tests/run-tests.js tests/unit/cli-run-preflight.test.js tests/unit/start-cluster-config.test.js tests/unit/detached-startup-contract.test.js tests/unit/cli-resume-loads-clusters.test.js tests/integration/orchestrator-flow.test.js tests/integration/trigger-evaluation.test.js
npm run typecheck
npm run lint
```

Expected: PASS and no provider dependency called by the preflight unit tests.

- [ ] **Step 6: Commit launch propagation**

```bash
git add cli/index.js src/legacy-lib/start-cluster-run-options.ts src/legacy-lib/start-cluster-config.ts src/legacy-lib/start-cluster.ts src/orchestrator.js task-lib/runner.js lib task-lib tests/unit/cli-run-preflight.test.js tests/unit/start-cluster-config.test.js tests/unit/detached-startup-contract.test.js tests/unit/cli-resume-loads-clusters.test.js tests/integration/orchestrator-flow.test.js
git commit -m "feat: enforce preflight before provider launch"
```

Review staged generated output and exclude unrelated build churn before commit.

### Task 4: Add the closed workflow-operation contract and registry

**Files:**

- Create: `src/workflow-operations/types.ts`
- Create: `src/workflow-operations/registry.ts`
- Create: `src/workflow-operations/execute.ts`
- Modify: `src/config-validator.js`
- Modify: `src/agent/agent-hook-executor.js`
- Test: `tests/unit/workflow-operation-registry.test.js`
- Modify: `tests/config-validator.test.js`

**Interfaces:**

- Produces: `WorkflowOperationId`, `WorkflowOperationContext`, `WorkflowOperationResult`, `getWorkflowOperation(id)`, and `executeWorkflowOperation(id, context)`.
- Adds trigger `{ action: 'execute_workflow_operation', operation: WorkflowOperationId }` with no routing/command fields.

- [ ] **Step 1: Write closed-enum validation tests**

```js
const valid = { action: 'execute_workflow_operation', operation: 'review.synthesize' };
assert.doesNotThrow(() => validateTrigger(valid));
for (const invalid of [
  { ...valid, operation: 'shell.run' },
  { ...valid, command: 'npm test' },
  { ...valid, cwd: '/tmp' },
  { ...valid, onSuccess: { topic: 'ARBITRARY' } },
]) {
  assert.throws(() => validateTrigger(invalid), /workflow operation|unknown field/i);
}
```

- [ ] **Step 2: Add registry and failure-boundary tests**

Test all three IDs, frozen registry behavior, unknown IDs, abort propagation,
bounded redacted failures, owned output topics, and `terminal` preservation.

- [ ] **Step 3: Run tests and verify the action is unknown**

```bash
npm run build:legacy-runtime
node tests/run-tests.js tests/unit/workflow-operation-registry.test.js tests/config-validator.test.js tests/unit/hook-logic-executor.test.js
```

Expected: FAIL because the action and registry do not exist.

- [ ] **Step 4: Define exact types and frozen registry**

```ts
export type WorkflowOperationId =
  | 'review.synthesize'
  | 'document.build_revision_context'
  | 'document.assemble';

export interface WorkflowMessage {
  readonly id: string;
  readonly sequence: string;
  readonly topic: string;
  readonly sender: string;
  readonly cluster_id: string;
  readonly timestamp: number;
  readonly content?: { readonly text?: string; readonly data?: Record<string, unknown> };
}

export interface WorkflowLedgerReader {
  query(criteria: {
    readonly cluster_id: string;
    readonly topic?: string;
    readonly sender?: string;
    readonly order?: 'ASC' | 'DESC';
  }): readonly WorkflowMessage[];
  findLast(criteria: {
    readonly cluster_id: string;
    readonly topic?: string;
    readonly sender?: string;
  }): WorkflowMessage | null;
}

export interface WorkflowOperationContext {
  readonly clusterId: string;
  readonly agentId: string;
  readonly triggeringMessage: WorkflowMessage;
  readonly ledger: WorkflowLedgerReader;
  readonly signal: AbortSignal;
  readonly now: () => Date;
}

export interface WorkflowOperationResult {
  readonly topic: string;
  readonly content: { readonly text: string; readonly data: Record<string, unknown> };
  readonly terminal: boolean;
}

export const WORKFLOW_OPERATION_IDS = Object.freeze([
  'review.synthesize',
  'document.build_revision_context',
  'document.assemble',
] as const);
```

The executor receives the orchestrator-owned ledger instance and message bus;
it does not open a database from an environment variable. Convert exceptions
to the operation's fixed failure topic and return control to the common
terminal lifecycle.

- [ ] **Step 5: Wire the trigger action**

In `agent-hook-executor.js`, call only:

```js
await executeWorkflowOperation(trigger.operation, {
  clusterId: agent.cluster_id,
  agentId: agent.id,
  triggeringMessage: message,
  ledger: agent.ledger,
  signal: agent.abortSignal,
  now: () => new Date(),
});
```

Publish the returned fixed topic/content through the existing message bus.
When `terminal` is true, enter the idempotent terminalization boundary from the
foundation plan.

- [ ] **Step 6: Build and run contract tests**

```bash
npm run build:legacy-runtime
node tests/run-tests.js tests/unit/workflow-operation-registry.test.js tests/config-validator.test.js tests/unit/hook-logic-executor.test.js tests/integration/trigger-evaluation.test.js
npm run typecheck:legacy-runtime
npm run lint
```

Expected: PASS.

- [ ] **Step 7: Commit the closed boundary**

```bash
git add src/workflow-operations src/config-validator.js src/agent/agent-hook-executor.js tests/unit/workflow-operation-registry.test.js tests/config-validator.test.js
git commit -m "feat: add closed workflow operation boundary"
```

Include generated adjacent `.js` files only when produced by
`npm run build:legacy-runtime`.

### Task 5: Implement truthful review synthesis

**Files:**

- Create: `src/workflow-operations/review-synthesis.ts`
- Test: `tests/review-synthesis-operation.test.js`

**Interfaces:**

- Registers: `review.synthesize`.
- Produces topic `REVIEW_ARTIFACT_READY` on success, `REVIEW_SYNTHESIS_FAILED` on bounded failure; success is terminal.

- [ ] **Step 1: Add literal synthesis fixtures and failing tests**

Fixtures must cover zero findings, confirmed only, withdrawn, severity change,
contested at cap, retry-duplicated validator messages, malformed candidate, and
out-of-order delivery. Assert:

```js
assert.strictEqual(result.topic, 'REVIEW_ARTIFACT_READY');
assert.strictEqual(result.terminal, true);
assert.match(result.content.text, /## Contested Findings/);
assert.strictEqual(result.content.data.overallAssessment, 'NOT_READY');
assert.deepStrictEqual(result.content.data.statistics, {
  confirmed: 1,
  contested: 1,
  withdrawn: 1,
});
```

- [ ] **Step 2: Run and verify the operation is missing**

```bash
npm run build:legacy-runtime
node tests/run-tests.js tests/review-synthesis-operation.test.js
```

Expected: FAIL on missing implementation/registration.

- [ ] **Step 3: Implement deterministic classification and Markdown**

Sort findings by stable finding ID and validators by agent ID. Preserve all
validator reasons and severity adjustments. Set `READY` only when no confirmed
blocking or contested finding remains; any contested finding forces
`NOT_READY`. Render fixed headings for Confirmed, Contested, Withdrawn,
Validator Notes, Severity Adjustments, and Statistics.

- [ ] **Step 4: Run synthesis and lifecycle tests**

```bash
npm run build:legacy-runtime
node tests/run-tests.js tests/review-synthesis-operation.test.js tests/unit/bounded-synthesis-lifecycle.test.js tests/unit/ledger-sequence-cursor.test.js
npm run typecheck:legacy-runtime
npm run lint
```

Expected: PASS and stable byte-for-byte Markdown on repeated input.

- [ ] **Step 5: Commit review synthesis**

```bash
git add src/workflow-operations/review-synthesis.ts src/workflow-operations/review-synthesis.js src/workflow-operations/registry.ts src/workflow-operations/registry.js tests/review-synthesis-operation.test.js
git commit -m "feat: synthesize truthful review artifacts"
```

### Task 6: Implement document reconstruction, revision context, and assembly

**Files:**

- Create: `src/workflow-operations/document-reconstruction.ts`
- Create: `src/workflow-operations/document-revision-context.ts`
- Create: `src/workflow-operations/document-assembly.ts`
- Test: `tests/doc-reconstruction.test.js`
- Test: `tests/document-workflow-operations.test.js`

**Interfaces:**

- Registers: `document.build_revision_context` and `document.assemble`.
- Produces: `REVISION_CONTEXT`, `DOCUMENT_ARTIFACT_READY`, and fixed failure topics.

- [ ] **Step 1: Port reconstruction behavior into failing pure tests**

Assert the first message must contain `.document`; later `.delta` values apply
removed sections, replacements, revisions, additions, and `insertAfter` in a
stable order. Reject duplicate IDs, unknown revision targets, invalid depth,
and an absent base document instead of silently dropping data.

- [ ] **Step 2: Add revision and cap artifact tests**

```js
assert.strictEqual(revision.topic, 'REVISION_CONTEXT');
assert.deepStrictEqual(revision.content.data.revisionsNeeded[0], {
  id: 'A2',
  heading: 'Safety',
  content: 'current',
  verdict: 'REJECT',
  suggestions: ['ADD_EVIDENCE'],
  reason: 'missing source',
});

assert.strictEqual(artifact.content.data.terminationReason, 'MAX_ITERATIONS');
assert.match(artifact.content.text, /## Unresolved Sections/);
assert.match(artifact.content.text, /missing source/);
```

Also test unanimous approval yields `ALL_APPROVED`, notes survive, retry
duplicates are deduplicated, and only the latest validator round controls
unresolved status.

- [ ] **Step 3: Run tests and verify missing implementations**

```bash
npm run build:legacy-runtime
node tests/run-tests.js tests/doc-reconstruction.test.js tests/document-workflow-operations.test.js
```

Expected: FAIL.

- [ ] **Step 4: Implement pure reconstruction and owned operations**

Move the useful pure behavior from prior-art
`scripts/lib/doc-reconstruction.js`, but accept typed ledger messages directly.
Use `context.now().toISOString()` for metadata. `document.assemble` returns
Markdown in memory; it never writes a file.

- [ ] **Step 5: Build and run document tests**

```bash
npm run build:legacy-runtime
node tests/run-tests.js tests/doc-reconstruction.test.js tests/document-workflow-operations.test.js tests/unit/bounded-synthesis-lifecycle.test.js
npm run typecheck:legacy-runtime
npm run lint
```

Expected: PASS.

- [ ] **Step 6: Commit document operations**

```bash
git add src/workflow-operations/document-reconstruction.ts src/workflow-operations/document-reconstruction.js src/workflow-operations/document-revision-context.ts src/workflow-operations/document-revision-context.js src/workflow-operations/document-assembly.ts src/workflow-operations/document-assembly.js src/workflow-operations/registry.ts src/workflow-operations/registry.js tests/doc-reconstruction.test.js tests/document-workflow-operations.test.js
git commit -m "feat: add typed document workflow operations"
```

### Task 7: Remove generic command execution and verify checkpoint B3

**Files:**

- Delete if present: `scripts/quality-gate-runner.js`
- Delete if present: `scripts/write-review-report.js`
- Delete if present: `scripts/build-revision-context.js`
- Delete if present: `scripts/assemble-doc.js`
- Delete if present: `scripts/lib/doc-reconstruction.js`
- Replace: `tests/execute-system-command-trigger.test.js` with a negative contract test or delete after equivalent coverage exists
- Modify: `scripts/validate-templates.js`
- Create: `tests/unit/no-generic-command-action.test.js`

**Interfaces:**

- Consumes: all earlier tasks.
- Produces: production tree with no generic action or shell protocol.

- [ ] **Step 1: Add a source/template absence test**

```js
for (const root of ['src', 'cli', 'task-lib', 'cluster-templates']) {
  for (const file of walk(root)) {
    assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /execute_system_command/);
  }
}
for (const forbidden of ['command', 'cwd', 'env', 'contentFromOutput']) {
  assert.throws(() =>
    validateTrigger({
      action: 'execute_workflow_operation',
      operation: 'review.synthesize',
      [forbidden]: 'x',
    })
  );
}
```

- [ ] **Step 2: Remove prior-art runtime scripts and action branches**

Delete only files superseded by Tasks 1-6. Remove validator/executor support for
`execute_system_command`, subprocess output routing, and template command env.
Keep unrelated safe process helpers and upstream command-proof behavior.

- [ ] **Step 3: Run the focused boundary suite**

```bash
npm run build:legacy-lib
npm run build:legacy-runtime
npm run build:task-lib
npm run build:cli-runtime
node tests/run-tests.js tests/unit/no-generic-command-action.test.js tests/preflight-quality-gate-runner.test.js tests/unit/workflow-operation-registry.test.js tests/review-synthesis-operation.test.js tests/document-workflow-operations.test.js tests/integration/trigger-evaluation.test.js tests/integration/orchestrator-flow.test.js
npm run validate:templates
npm run typecheck
npm run lint
```

Expected: PASS.

- [ ] **Step 4: Perform the literal production scan**

```bash
rg -n "execute_system_command|quality-gate-runner|contentFromOutput" src cli task-lib cluster-templates scripts
```

Expected: no matches. Documentation is outside this scan.

- [ ] **Step 5: Commit checkpoint B3**

```bash
git add -A src cli task-lib cluster-templates scripts tests lib
git commit -m "refactor: replace command triggers with owned operations"
git status --short
```

Expected: clean worktree. Review `git diff --cached --stat` before committing so
generated output or unrelated files are not staged accidentally.
