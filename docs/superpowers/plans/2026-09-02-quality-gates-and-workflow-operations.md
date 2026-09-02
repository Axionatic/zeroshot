# Quality Gates and Workflow Operations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore cheap approved repository preflight checks and deterministic workflow synthesis without restoring template-controlled shell execution.

**Architecture:** A versioned per-repository approval store feeds a bounded preflight runner before provider startup. Separately, a closed in-process registry exposes exactly three typed workflow operations whose topic routing and terminal behavior are owned by code rather than templates.

**Tech Stack:** Node.js 22, strict TypeScript, CommonJS generated builds, child process execution at one owned preflight boundary, Mocha, JSON workflow validation.

**Spec:** `docs/superpowers/specs/2026-09-02-upstream-v6.46-reconciliation-design.md`

## Global Constraints

- Obey the program plan's serial task admission/handoff contract; no worker may
  infer cwd or predecessor state from a prior worker's shell.

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
  readonly discovery: 'deterministic';
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
    value.discovery === 'deterministic' &&
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
  | 'missing_confirmed'
  | 'missing_allowed';

export interface PreflightGateReceipt {
  readonly version: 1;
  readonly repositoryPath: string;
  readonly fingerprint?: string;
  readonly status: PreflightGateStatus;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly exitCode?: number;
  readonly diagnosticsPath?: string;
  readonly diagnosticsDigest?: string;
  readonly truncated: boolean;
}
```

Tests cover cached exact command/fingerprint match, command/fingerprint
mismatch, changed cache with accept/refuse/save/reload, second-run zero prompts,
cached command with no current suggestion (it still runs), no-cache/no
suggestion, non-TTY missing with and without the narrow flag, changed
non-TTY suggestion even with the narrow flag, broad skip, timeout,
cancellation, descendant cleanup, launch error, nonzero exit, output
truncation, compact-receipt byte bound, and child-environment exclusion.

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
if (
  cached &&
  suggestion &&
  cached.command === suggestion.command &&
  cached.fingerprint === suggestion.fingerprint
) {
  return executeApprovedGate(cached, options);
}
if (cached && !suggestion) {
  return executeApprovedGate(cached, options);
}
if (suggestion) {
  if (!options.interactive) {
    throw new PreflightGateApprovalError('Current preflight quality gate requires approval');
  }
  const approved = await options.confirm(formatApprovalPrompt(suggestion));
  if (!approved) throw new PreflightGateApprovalError('Preflight quality gate was not approved');
  saveApprovedPreflightGate(recordFromSuggestion(options.repositoryRoot, suggestion));
  const reloaded = loadApprovedPreflightGate(options.repositoryRoot);
  assertCurrentApprovedRecord(reloaded, suggestion);
  return executeApprovedGate(reloaded, options);
}
if (!options.interactive) {
  if (options.allowMissingQualityGate) return missingAllowedReceipt(options.repositoryRoot);
  throw new PreflightGateApprovalError('No approved preflight quality gate');
}
const approvedMissing = await options.confirm(formatNoGatePrompt());
if (!approvedMissing)
  throw new PreflightGateApprovalError('Missing preflight quality gate was not accepted');
return missingConfirmedReceipt(options.repositoryRoot);
```

When the deterministic suggestion is absent, the interactive confirmation must
say that no gate will be cached or run. Do not invent `true`, `echo`, or another
placeholder command.

- [ ] **Step 4: Implement contained execution**

Use `spawn(command, { shell: true, cwd: repositoryPath, env, stdio, detached })`
only after approval. Build `env` from an explicit platform/toolchain allowlist;
exclude names matching `TOKEN|SECRET|PASSWORD|KEY|CREDENTIAL|AUTH` before spawn,
not merely from logs. On POSIX set `detached: true` and call the existing
termination helper with process-group ownership (`processGroupId === pid`); on
Windows use its process-tree strategy. Enforce `DEFAULT_TIMEOUT_MS = 15 * 60 *
1000`, bounded TERM/KILL waits, and `MAX_CAPTURE_BYTES = 1024 * 1024` per
stream. Persist captured diagnostics in one private owned file and return only
its path/digest/truncation metadata in the compact receipt.

- [ ] **Step 5: Run focused tests**

```bash
npm run build:legacy-lib
node tests/run-tests.js tests/preflight-quality-gate-runner.test.js tests/unit/command-spec-cleanup-safety.test.js
npm run typecheck:legacy-lib
npm run lint
```

Expected: PASS; no child or grandchild fixture remains alive and the child sees
only the allowlisted environment.

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
- Modify: `lib/cluster-worker/engine-adapter.js`
- Modify: the trusted cluster-worker request/profile contract used by that adapter
- Test: `tests/unit/cli-run-preflight.test.js`
- Test: `tests/unit/start-cluster-config.test.js`
- Test: `tests/unit/detached-startup-contract.test.js`
- Test: `tests/unit/cli-resume-loads-clusters.test.js`
- Test: `tests/integration/orchestrator-flow.test.js`
- Test: trusted cluster-worker engine-adapter/contract tests

**Interfaces:**

- Produces CLI booleans `skipQualityGate` and `allowMissingQualityGate`, a
  compact host-owned preflight receipt/reference, and one typed
  `computePackParamOverrides(options, receipt)` mapping consumed by every
  initial and dynamic template-resolution path.
- Establishes an `Orchestrator.start` ordering invariant: every normal product
  start receives an internally issued receipt or resolves an owned persisted
  receipt reference for the original canonical repository. This prevents
  accidental/internal bypass; it is not an authentication boundary against
  arbitrary code already able to invoke exported internals.

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

Add detached tests proving the parent persists the compact receipt in private
run state, passes only its run-bound reference, and the daemon does
not rediscover or prompt. Add resume tests proving the absolute repository path
and compact receipt/reference survive without captured output in
`ZEROSHOT_RUN_OPTIONS`. Add trusted-worker tests for a valid receipt and for
missing, plain caller-constructed, stale-root, unknown-version, and failed
receipts before any provider construction. The public worker request cannot set
either bypass flag or supply a receipt. Add a protected handoff regression where both flags are
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
compact receipt in private host-owned run state and serialize only a run-bound
reference. The CLI issues the foreground/detached receipt. The trusted
cluster-worker engine adapter leaves the public `LegacyShipRequest` unchanged,
derives policy from its registry-owned trusted profile, runs preflight locally,
and issues an in-process receipt before `Orchestrator.start`. The orchestrator
accepts only the module-private issued form or a receipt loaded by the owned
run-state resolver before isolation/provider work.

- [ ] **Step 4: Add typed private option/config propagation**

Extend `RunOptions` and a module-private trusted-worker adapter context with both
booleans and the compact receipt. Registry-owned trusted profile policy feeds
that context. Do not add any field to public `LegacyShipRequest`, its strict
schema, or its RPC start frame. Define one mapping before any config is resolved:

```ts
function computePackParamOverrides(options, receipt) {
  return {
    preflight_quality_gate: !options.skipQualityGate && receipt.status === 'passed',
  };
}
```

Filter this system-owned override against the selected template's declared
parameter schema; generic templates receive no extra key. Normalize the legacy
alias before strict unknown-user-parameter validation and reject alias
conflicts. Thread the filtered object through foreground `loadClusterConfig`, direct start
helpers, trusted worker preparation, detached serialization, resume, and
dynamic `_opLoadConfig`. It overrides the optional pack parameter only and
never mutates `requiredQualityGates`. Then change:

```ts
function resolveParameterizedConfigFile(
  config: ClusterConfig,
  paramOverrides: Record<string, unknown> = {}
): ClusterConfig {
  if (!config?.params || Object.keys(config.params).length === 0) return config;
  return resolver.resolveTemplate(config, paramOverrides);
}
```

For backward compatibility, keep `quality_gate` as a deprecated alias only
when that template declares it; reject simultaneous old/new names with a
deterministic migration error. Test every upstream generic parameterized
template unchanged plus both direct and conductor-driven pack loads.

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
git add cli/index.js src/legacy-lib/start-cluster-run-options.ts src/legacy-lib/start-cluster-config.ts src/legacy-lib/start-cluster.ts src/orchestrator.js lib/cluster-worker tests/unit/cli-run-preflight.test.js tests/unit/start-cluster-config.test.js tests/unit/detached-startup-contract.test.js tests/unit/cli-resume-loads-clusters.test.js tests/integration/orchestrator-flow.test.js
git commit -m "feat: enforce preflight before provider launch"
```

Review staged generated output and exclude unrelated build churn before commit.

### Task 4: Add the closed workflow-operation contract and registry

**Files:**

- Create: `src/workflow-operations/types.ts`
- Create: `src/workflow-operations/review-events.ts`
- Create: `src/workflow-operations/registry.ts`
- Create: `src/workflow-operations/execute.ts`
- Create: `src/workflow-operations/workflow-runtime.ts`
- Modify: `src/config-validator.js`
- Modify: `src/ledger.js`
- Modify: `src/message-bus.js`
- Modify: `src/agent-wrapper.js`
- Modify: `src/agent/agent-lifecycle.js`
- Modify: `tsconfig.legacy-runtime.json`
- Modify: `tsconfig.legacy-runtime.build.json`
- Test: `tests/unit/workflow-operation-registry.test.js`
- Test: `tests/integration/trigger-evaluation.test.js`
- Modify: `tests/config-validator.test.js`

**Interfaces:**

- Produces: `WorkflowOperationId`, frozen `WorkflowOperationDescriptor`, a
  versioned shared review envelope, a frozen registry factory, a cluster-owned
  `WorkflowRuntime`, and one
  end-to-end `executeWorkflowOperation(id, context, publication)` boundary that
  returns a durable `OperationDisposition`.
- Adds trigger `{ action: 'execute_workflow_operation', operation: WorkflowOperationId }` with no routing/command fields.

- [ ] **Step 1: Write closed-enum validation tests**

```js
const valid = {
  topic: 'REVIEW_ROUND_READY',
  action: 'execute_workflow_operation',
  operation: 'review.synthesize',
};
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

Test the closed three-ID vocabulary, frozen registry-factory behavior with
fixture subsets, unknown/unregistered runtime IDs, action/topic
cross-validation, snapshot-bounded queries, output validation, abort
propagation, bounded redacted failures, and descriptor-owned output/terminal
semantics. Task 4 does not install placeholder production descriptors. Task 5
adds `review.synthesize`; Task 6 adds the two document descriptors. Each task
tests only descriptors implemented by that checkpoint, and Task 6 proves the
final registry contains all three.

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
  readonly workflowInstance: {
    readonly state: 'sealed';
    readonly id: string;
    readonly family: 'code-review' | 'documentation-review' | 'document-draft';
    readonly descriptorRevision: string;
    readonly configRevision: string;
    readonly expectedAnalystIds: readonly string[];
    readonly expectedValidatorIds: readonly string[];
    readonly artifact: {
      readonly id: string;
      readonly mediaType: 'text/markdown';
      readonly sourceTopic: 'REVIEW_ARTIFACT_READY' | 'DOCUMENT_ARTIFACT_READY';
    };
  };
  readonly ledger: WorkflowLedgerReader;
  readonly signal: AbortSignal;
  readonly now: () => Date;
}

export type WorkflowOperationResult = {
  readonly state: 'ready';
  readonly content: { readonly text: string; readonly data: Record<string, unknown> };
};

export interface WorkflowOperationDescriptor {
  readonly allowedInputTopics: readonly string[];
  readonly successTopic: string;
  readonly failureTopic: string;
  readonly terminalOnSuccess: 'never' | 'immediate' | 'after_artifact_commit';
  readonly terminalOnFailure: boolean;
  readonly validateOutput: (value: unknown) => WorkflowOperationResult;
  readonly execute: (context: WorkflowOperationContext) => Promise<WorkflowOperationResult>;
}

export interface ArtifactReadyPayload {
  readonly artifactId: string;
  readonly markdown: string;
  readonly checksum: string;
  readonly sourceSequence: string;
  readonly executionKey: string;
}

export const WORKFLOW_OPERATION_IDS = Object.freeze([
  'review.synthesize',
  'document.build_revision_context',
  'document.assemble',
] as const);
```

The executor receives a read-only facade over `agent.messageBus.ledger`; it does
not open a database from an environment variable. The facade automatically
adds `throughId: triggeringMessage.sequence` to every query and sorts by durable
sequence. The descriptor, not the template or implementation result, selects
success/failure topics and terminal behavior. Convert exceptions to the fixed
failure topic and return control to the common terminal lifecycle.
Operations run only from deterministic host-owned readiness events and therefore
return `ready` or fail. Quorum waiting is not an operation result; the review
round coordinator owns it before synthesis begins.

Final-operation output validation derives `ArtifactReadyPayload` from the
installed immutable artifact binding. It computes/validates checksum and stamps
source sequence/execution key; artifact identity is never accepted from model
output. The host writer accepts only a payload matching that binding and the
descriptor-owned success topic.

In `review-events.ts`, define a versioned common envelope carrying family,
review ID, round, finding ID/candidate revision where applicable, validator ID,
causation ID, idempotency key, and `throughSequence`. Keep code-review and
documentation-review payloads distinct discriminated variants. This file is
the contract consumed verbatim by Task 5 and the workflow-pack child plan.
The envelope's expected-validator field is only a redundant assertion. The
executor derives a sorted immutable validator set and configuration revision
from the resolved host-owned workflow instance; any model-authored mismatch is
rejected before aggregation.

The host supplies a semantic execution key. For review synthesis it is exactly
`(workflowInstanceId, configRevision, reviewId, round, operationId)`; trigger
message ID, winning `throughSequence`, causation ID, and input digest are stored
as conflict evidence, never as output identity. Document operations use their
descriptor-defined document/revision semantic key. Derive the execution message
ID from that stable key.

Add `Ledger.appendIfAbsent` and `MessageBus.publishIfAbsent`. The atomic result
is `inserted`, `reused` only when semantic input identity and output digest
match, or `conflict`; generic and topic subscribers fire only for `inserted`.
`executeWorkflowOperation` owns execution, validation, this publication call,
and returns the resulting disposition. Replay callers receive `reused` without
another ordinary event. The explicit `WorkflowRuntime` startup/resume catch-up
may re-deliver a persisted pending outbox row; consumers deduplicate by its
execution/message key. Snapshot-bounded reads remain operation inputs only.

`WorkflowRuntime` is a provider-free cluster service over the sealed descriptor,
registry, ledger state transaction, message bus, and family reducer. It exposes
`claimReadyOperation(operationId, readyMessage)` and rejects a ready topic unless
sender, deterministic ID, semantic key, digest, and frozen cursor match a
durable host claim. It rehydrates unfinished claims and re-drives durable ready
messages after agents subscribe on start/resume. This task implements and tests
that generic shell with fixture reducers; Tasks 5 and 6 supply the real review
and document reducers, and the workflow-pack Task 1 owns orchestrator attachment.

- [ ] **Step 5: Wire the actual trigger dispatcher**

Add `execute_workflow_operation` to `executeTriggerAction` in
`src/agent/agent-lifecycle.js`, not to the onStart/onComplete hook executor.
Resolve the frozen descriptor first and require
`workflowRuntime.claimReadyOperation(...)` to return the durable execution
claim. For final artifact operations (`review.synthesize` and
`document.assemble`), call `terminalCoordinator.begin` before operation code.
For nonterminal `document.build_revision_context`, do not enter or mutate the
terminal state machine; use the runtime claim's bounded per-operation deadline
and the ordinary cluster cancellation signal. Then call only:

```js
const terminalClaim =
  descriptor.terminalOnSuccess === 'after_artifact_commit'
    ? await agent.cluster.terminalCoordinator.begin(
        claimedExecution.executionKey,
        claimedExecution.reason
      )
    : null;
const disposition = await executeWorkflowOperation(
  trigger.operation,
  {
    clusterId: agent.cluster.id,
    agentId: agent.id,
    triggeringMessage: message,
    workflowInstance: agent.cluster.workflowInstance,
    ledger: createSnapshotLedgerReader(agent.messageBus.ledger, message.sequence),
    signal: terminalClaim?.signal ?? claimedExecution.signal,
    now: () => new Date(message.timestamp),
  },
  {
    executionKey: claimedExecution.executionKey,
    publishIfAbsent: agent.messageBus.publishIfAbsent.bind(agent.messageBus),
  }
);
```

Do not separately call the void `agent._publish`. Descriptor-owned routing and
subscriber emission live inside the publication boundary above. A readiness
result of `waiting` returns idle before execution. Only a claimed final-artifact
operation calls `begin`; its deadline covers a hanging operation. A claimed
nonterminal operation records completion/failure in its workflow-state key and
returns to ordinary workflow progress without terminalization. Report final
success/failure/cancellation through the shared coordinator. Add an integration
test that delivers a real topic through
`AgentWrapper.handleMessage`, observes the operation event, and proves
cancellation/late results cannot double-terminalize. Also prove duplicate
delivery emits once to both generic and topic subscribers, and a never-settling
operation reaches one deadline failure.

For a final operation, require `terminalClaim.executionKey ===
claimedExecution.executionKey` and execute only `claimed`/valid `reused`
dispositions; `terminal` returns without work. Deadline/cancellation must abort
the exact signal passed above. A late result after abort cannot publish an
artifact or mutate terminal state.

Add `src/workflow-operations/**/*.ts` to both legacy-runtime tsconfig include
sets and assert a clean build emits loadable adjacent JavaScript.

- [ ] **Step 6: Build and run contract tests**

```bash
npm run build:legacy-runtime
node tests/run-tests.js tests/unit/workflow-operation-registry.test.js tests/config-validator.test.js tests/integration/trigger-evaluation.test.js
npm run typecheck:legacy-runtime
npm run lint
```

Expected: PASS.

- [ ] **Step 7: Commit the closed boundary**

```bash
git add src/workflow-operations src/config-validator.js src/ledger.js src/message-bus.js src/agent-wrapper.js src/agent/agent-lifecycle.js tsconfig.legacy-runtime.json tsconfig.legacy-runtime.build.json tests/unit/workflow-operation-registry.test.js tests/config-validator.test.js tests/integration/trigger-evaluation.test.js
git commit -m "feat: add closed workflow operation boundary"
```

Include generated adjacent `.js` files only when produced by
`npm run build:legacy-runtime`.

### Task 5: Implement truthful review synthesis

**Files:**

- Create: `src/workflow-operations/review-round-coordinator.ts`
- Create: `src/workflow-operations/review-synthesis.ts`
- Create: `tests/unit/review-round-coordinator.test.js`
- Test: `tests/review-synthesis-operation.test.js`

**Interfaces:**

- Registers: `review.synthesize`.
- Produces topic `REVIEW_ARTIFACT_READY` on success and
  `REVIEW_SYNTHESIS_FAILED` on bounded failure. Success uses descriptor policy
  `after_artifact_commit`; the artifact owner, not the operation executor,
  terminalizes after accepting the artifact (and after file commit when
  `--output` is present).
- Consumes only the versioned envelopes from `review-events.ts`, bounded through
  the synthesis request's `throughSequence`.
- Produces a provider-free persisted `ReviewRoundCoordinator`. Each expected
  analyst must emit a schema-checked round-complete envelope even for zero
  findings. The coordinator waits for the sealed descriptor's analyst set and
  any validators required by their findings, freezes one `throughSequence`, and
  compare-and-set claims the round-scoped execution key. It then emits exactly
  one host-owned `REVIEW_ROUND_READY`; model messages cannot assert readiness.

Register this reducer with `WorkflowRuntime`. It consumes only validated durable
progress messages, and uses `transitionWorkflowState` to CAS the round claim and
insert the deterministic `REVIEW_ROUND_READY` row in one transaction. Runtime
catch-up re-drives a committed ready row whose live delivery or operation claim
was interrupted; the dispatcher still requires the matching durable claim.

- [ ] **Step 1: Add literal synthesis fixtures and failing tests**

Before fixtures, pin the complete aggregation table: expected validator IDs;
one latest valid verdict per `(reviewId, round, findingId, candidateRevision,
validatorId)` by durable sequence; stale/future rounds rejected; duplicate
idempotency keys ignored; missing/failed validators make the finding contested;
only the originating analyst may withdraw; any contest forces `NOT_READY`; and
zero findings produces an explicit ready artifact without validators.

Fixtures must cover every table row, severity conflicts, zero findings,
confirmed only, withdrawn, contested at cap, retry-duplicated validator
messages, malformed candidate, late prior-round input, a higher-sequence row
after the request snapshot, and out-of-order delivery. Assert:

```js
assert.strictEqual(result.state, 'ready');
assert.match(result.content.text, /## Contested Findings/);
assert.strictEqual(result.content.data.overallAssessment, 'NOT_READY');
assert.deepStrictEqual(result.content.data.statistics, {
  confirmed: 1,
  contested: 1,
  withdrawn: 1,
});
```

Separately assert the frozen descriptor owns success topic
`REVIEW_ARTIFACT_READY` and policy `after_artifact_commit`, and prove through the
dispatcher integration that no success terminal precedes artifact acceptance.

Add coordinator fixtures for all-zero and mixed analyst results, missing analyst
completion, duplicate/late completions, concurrent final validator messages,
resume before/after claim, and a new review round. Prove all triggers for one
completed round reuse the same execution disposition and never create a second
artifact.

- [ ] **Step 2: Run and verify the operation is missing**

```bash
npm run build:legacy-runtime
node tests/run-tests.js tests/unit/review-round-coordinator.test.js tests/review-synthesis-operation.test.js
```

Expected: FAIL on missing implementation/registration.

- [ ] **Step 3: Implement deterministic classification and Markdown**

Validate the shared envelopes, apply the pinned table, and sort findings by
stable finding ID and validators by agent ID. Preserve all validator reasons and
severity adjustments. Set `READY` only when no confirmed blocking or contested
finding remains. Render fixed headings for Confirmed, Contested, Withdrawn,
Validator Notes, Severity Adjustments, and Statistics.

- [ ] **Step 4: Run synthesis and lifecycle tests**

```bash
npm run build:legacy-runtime
node tests/run-tests.js tests/unit/review-round-coordinator.test.js tests/review-synthesis-operation.test.js tests/unit/bounded-synthesis-lifecycle.test.js tests/unit/ledger-sequence-cursor.test.js
npm run typecheck:legacy-runtime
npm run lint
```

Expected: PASS and stable byte-for-byte Markdown on repeated input.

- [ ] **Step 5: Commit review synthesis**

```bash
git add src/workflow-operations/review-round-coordinator.ts src/workflow-operations/review-round-coordinator.js src/workflow-operations/review-synthesis.ts src/workflow-operations/review-synthesis.js src/workflow-operations/registry.ts src/workflow-operations/registry.js tests/unit/review-round-coordinator.test.js tests/review-synthesis-operation.test.js
git commit -m "feat: synthesize truthful review artifacts"
```

### Task 6: Implement document reconstruction, revision context, and assembly

**Files:**

- Create: `src/workflow-operations/document-reconstruction.ts`
- Create: `src/workflow-operations/document-round-coordinator.ts`
- Create: `src/workflow-operations/document-revision-context.ts`
- Create: `src/workflow-operations/document-assembly.ts`
- Test: `tests/doc-reconstruction.test.js`
- Test: `tests/document-workflow-operations.test.js`

**Interfaces:**

- Registers: `document.build_revision_context` and `document.assemble`.
- Produces: `REVISION_CONTEXT`, `DOCUMENT_ARTIFACT_READY`, and fixed failure topics.
- Consumes a closed document envelope with immutable `documentId`, monotonically
  increasing `revision`, exact `baseRevision`, `validationRound`,
  `causationMessageId`, `idempotencyKey`, and `throughSequence`.
- Registers a deterministic document reducer with `WorkflowRuntime`. From the
  sealed validator set and snapshot-bounded current revision it emits only
  `DOCUMENT_REVISION_READY` below cap when revisions are needed, or
  `DOCUMENT_ASSEMBLY_READY` on unanimous approval or at cap. Each ready topic,
  semantic operation key, revision/round cursor, and state transition is
  inserted atomically through `transitionWorkflowState`; model messages cannot
  choose the branch or claim readiness.

- [ ] **Step 1: Port reconstruction behavior into failing pure tests**

Assert the first message must contain `.document`; later `.delta` values apply
removed sections, replacements, revisions, additions, and `insertAfter` in a
stable order. Reject duplicate IDs, unknown revision targets, invalid depth,
an absent base document, a delta whose base is not the current revision,
stale/future validation rounds, and duplicate idempotency keys instead of
silently dropping or reapplying data.

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

Pin expected validator IDs and the treatment of `APPROVE_WITH_NOTES`, missing or
failed validators, and conflicting retries. Also test unanimous approval yields
`ALL_APPROVED`, notes survive, retry duplicates are deduplicated, and only the
snapshot-bounded validator round tied to the current document revision controls
unresolved status. Replay each operation twice and after resume to prove the
same idempotency key produces byte-identical output without another transition.
Add reducer tests for partial quorum, conflicting retries, unanimous approval,
revision below cap, cap assembly, duplicate/late validation, and resume before
and after each ready-message delivery. Prove revision context never enters
terminal synthesis and final assembly does.

- [ ] **Step 3: Run tests and verify missing implementations**

```bash
npm run build:legacy-runtime
node tests/run-tests.js tests/doc-reconstruction.test.js tests/document-workflow-operations.test.js
```

Expected: FAIL.

- [ ] **Step 4: Implement pure reconstruction and owned operations**

Move the useful pure behavior from prior-art
`scripts/lib/doc-reconstruction.js`, but accept typed ledger messages directly.
Use `context.now().toISOString()` for metadata, where the dispatcher derives
`now` from the durable triggering-message timestamp so replay after wall-clock
advance remains byte-identical. `document.assemble` returns
Markdown in memory; it never writes a file.

- [ ] **Step 5: Build and run document tests**

Assert the composed production registry is now frozen and contains exactly all
three `WORKFLOW_OPERATION_IDS`; no earlier task installs an executable stub.

```bash
npm run build:legacy-runtime
node tests/run-tests.js tests/doc-reconstruction.test.js tests/document-workflow-operations.test.js tests/unit/bounded-synthesis-lifecycle.test.js
npm run typecheck:legacy-runtime
npm run lint
```

Expected: PASS.

- [ ] **Step 6: Commit document operations**

```bash
git add src/workflow-operations/document-reconstruction.ts src/workflow-operations/document-reconstruction.js src/workflow-operations/document-round-coordinator.ts src/workflow-operations/document-round-coordinator.js src/workflow-operations/document-revision-context.ts src/workflow-operations/document-revision-context.js src/workflow-operations/document-assembly.ts src/workflow-operations/document-assembly.js src/workflow-operations/registry.ts src/workflow-operations/registry.js tests/doc-reconstruction.test.js tests/document-workflow-operations.test.js
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
