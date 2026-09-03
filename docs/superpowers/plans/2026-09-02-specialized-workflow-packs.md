# Specialized Workflow Packs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore the code-review, documentation-review, and document-drafting packs as opt-in v6.46 products with bounded truthful artifacts and deterministic atomic output.

**Architecture:** Each pack family is reauthored against upstream template schemas and the closed workflow-operation registry, then accepted independently. A shared artifact declaration and writer implement `--output`; fixed prompt-level batching instructions preserve the fork's bounded working style without claiming a runtime semaphore over provider-native subagents.

**Tech Stack:** JSON parameterized templates, Node.js 22, TypeScript/CommonJS, Mocha, upstream template resolver and simulation framework.

**Spec:** `docs/superpowers/specs/2026-09-02-upstream-v6.46-reconciliation-design.md`

## Global Constraints

- Obey the program plan's serial task admission/handoff contract; no worker may
  infer cwd or predecessor state from a prior worker's shell.

- Upstream generic workflows remain the default; every restored pack is opt-in.
- The only typed workflow operations are `review.synthesize`, `document.build_revision_context`, and `document.assemble`.
- Every pack emits exactly one Markdown artifact and exactly one terminal event.
- Contested review findings at cap force `NOT_READY`; document cap emits a conspicuous `MAX_ITERATIONS` draft.
- Keep a conservative fixed batch instruction; test its resolved prompt and do
  not claim hard runtime enforcement. Do not inject
  `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE` or implement adaptive concurrency.
- `--output` requires one Markdown artifact: direct configs validate fully at
  launch, while conductors validate the entry contract at launch and seal the
  selected binding after `load_config`. It is distinct from `--result-file`.
- `--output` provides process-crash-recoverable atomic replacement for the
  caller-selected path; power-loss durability is explicitly excluded in Task 5. It
  is not a sandbox against a concurrently malicious same-UID process replacing
  ancestor directories. Do not add `lstat`/`realpath` checks that merely narrow
  but cannot close that race. A stronger threat model requires a separate
  descriptor-relative/OS-specific design.
- No live provider run is authorized.

---

### Task 1: Add the shared artifact and pack-parameter contract

**Files:**

- Create: `src/workflow-artifacts.ts`
- Modify: `src/template-resolver.js`
- Modify: `src/config-validator.js`
- Modify: `src/orchestrator.js`
- Modify: `src/agent/pr-verification.js`
- Modify: `src/agents/git-pusher-template.js`
- Modify: `src/template-validation/simulate-random-topology.ts`
- Test: `tests/unit/workflow-artifact-contract.test.js`
- Create: `tests/unit/workflow-handoff.test.js`
- Create: `tests/unit/artifact-handoff-pusher.test.js`
- Modify: `tests/template-resolver-typed-values.test.js`
- Modify: `tests/unit/simulate-random-topology.test.js`

**Interfaces:**

- Produces config declaration `artifacts: [{ id: string, mediaType: 'text/markdown', sourceTopic: string }]`.
- Produces params `max_iterations: integer >= 1`, `batch_limit: integer >= 1`, `preflight_quality_gate: boolean`.
- Produces `resolveSingleMarkdownArtifact(config): WorkflowArtifactDeclaration | null`.
- Produces `validateArtifactEntryContract(entryConfig):
ValidatedArtifactEntryContract` for conductor phase one. It checks only one
  Markdown root declaration and compatibility with the entry's declared family;
  it neither requires a selected final operation nor creates a sealed binding.
- Produces `validateArtifactWorkflowConfig(resolvedConfig, registry):
ValidatedArtifactBinding` for full binding before product-provider startup.
  Direct packs call it before any provider; conductors call it on the selected
  resolved config after `load_config` and before loaded agents. It requires exactly one
  reachable final operation for the sealed family, declaration `sourceTopic ===
descriptor.successTopic`, policy `after_artifact_commit`, and no competing
  producer. The immutable binding carries artifact declaration, final operation
  ID, descriptor revision, and success topic into `WorkflowRuntime` and the
  writer; simulation models the registry-to-topic producer edge.
- Produces immutable host-owned `WorkflowInstanceDescriptor` with workflow ID,
  family, resolved-config revision, resolved `maxIterations`, and sorted
  expected analyst/validator IDs. The sealed value, not reconstructed config or
  a default, controls every reducer branch after resume.
- Direct packs atomically create it in `sealed` state during initial resolution.
  A conductor entry creates an `unfinalized` descriptor containing only run
  identity, family, and the root artifact contract; after `load_config`
  validates the selected resolved config, the host seals it exactly once with
  descriptor revision, resolved-config digest, and sorted analyst/validator IDs
  before adding loaded agents or replaying input. Persist both descriptor states
  in ledger `workflow_state`; cluster JSON may carry only a derived summary and
  is never authoritative.
  A second/different seal or later topology mutation fails closed, and no
  workflow operation may run while the descriptor is unfinalized.
- Every conductor success and error/fallback transform recovers the original,
  non-republished `ISSUE_OPENED` row for its workflow instance from the ledger,
  requires nonempty issue text, and aborts before `load_config` or republication
  when it is unavailable. A fallback may select a conservative tier, but may
  never manufacture or republish an empty brief.
- Produces `installWorkflowRuntime(sealedDescriptor, dependencies)`. Direct
  packs seal and install it before product agents start. Conductors may run only
  the bootstrap while unfinalized; `_opLoadConfig` seals and installs the
  runtime before loaded agents or republished input. The runtime registers its
  durable catch-up subscription before any product trigger can fire. Generic
  configs never install this opt-in service or terminal coordinator.
- Produces `hydrateWorkflowRuntimeFromState()`, called immediately after ledger
  and message-bus creation and before rebuilding/subscribing/starting agents or
  replaying outbox rows. It rehydrates descriptor, terminal/progress state,
  artifact binding/path/cursor, and handoff from the one ledger authority; a
  mismatching cluster-JSON summary fails closed rather than overwriting it.
- Every selectable conductor and fixed-tier entry config declares the same
  immutable artifact contract as its dynamically loaded base. Dynamic loading
  validates equality; it must not silently discard or replace the entry
  contract.
- For conductor `--output`, the CLI first captures and persists the absolute
  invocation-relative path after `validateArtifactEntryContract` and before
  detach. After `load_config`, `_opLoadConfig` calls
  `validateArtifactWorkflowConfig` for the selected final operation and equal
  artifact contract, then seals the binding before adding loaded product agents
  or replaying the original issue. Only the bootstrap conductor may run between
  these phases.

- [ ] **Step 1: Add failing declaration validation tests**

```js
assert.deepStrictEqual(
  resolveSingleMarkdownArtifact({
    artifacts: [{ id: 'review', mediaType: 'text/markdown', sourceTopic: 'REVIEW_ARTIFACT_READY' }],
  }),
  {
    id: 'review',
    mediaType: 'text/markdown',
    sourceTopic: 'REVIEW_ARTIFACT_READY',
  }
);
for (const artifacts of [[], [{ mediaType: 'text/plain' }], [{}, {}]]) {
  assert.throws(
    () => validateOutputCompatibleConfig({ artifacts }),
    /exactly one Markdown artifact/i
  );
}
```

Add template-param tests rejecting zero, floats, strings, and unknown fields.
Add an entrypoint matrix for every conductor and fixed tier covering direct
`--config`, `config list/show`, dynamic `load_config`, packaging, and `--output`.
Use one canonical `preflight_quality_gate` name; retain `quality_gate` only as a
deprecated alias with deterministic conflict rejection.
Add wrong-family source-topic, absent/multiple final operation, competing
producer, and wrong terminal-policy failures across direct/conductor entrypoints
and randomized topology.

- [ ] **Step 2: Run tests and verify missing contract**

```bash
npm run build:legacy-runtime
node tests/run-tests.js tests/unit/workflow-artifact-contract.test.js tests/template-resolver-typed-values.test.js tests/unit/simulate-random-topology.test.js
```

Expected: FAIL because artifact declarations are not recognized.

- [ ] **Step 3: Implement exact declaration validation**

```ts
export interface WorkflowArtifactDeclaration {
  readonly id: string;
  readonly mediaType: 'text/markdown';
  readonly sourceTopic: 'REVIEW_ARTIFACT_READY' | 'DOCUMENT_ARTIFACT_READY';
}

export type WorkflowInstanceDescriptor =
  | {
      readonly state: 'unfinalized';
      readonly id: string;
      readonly family: 'code-review' | 'documentation-review' | 'document-draft';
      readonly artifact: WorkflowArtifactDeclaration;
    }
  | {
      readonly state: 'sealed';
      readonly id: string;
      readonly family: 'code-review' | 'documentation-review' | 'document-draft';
      readonly artifact: WorkflowArtifactDeclaration;
      readonly descriptorRevision: string;
      readonly configRevision: string;
      readonly maxIterations: number;
      readonly expectedAnalystIds: readonly string[];
      readonly expectedValidatorIds: readonly string[];
    };
```

Require exactly one declaration only when the caller requests output; generic
templates without `artifacts` remain valid. Deep simulation must prove the
declared source topic has one reachable producer and reaches one terminal path.
At runtime `_opLoadConfig` compares any loaded declaration with the immutable
root declaration before adding agents; mismatch fails before the loaded agents
can run, then seals the descriptor in the same admission transition. It does not
replace run-level artifact state.

Classify the root as an artifact workflow before upstream applies initial
`--pr`/completion configuration. Gate generic completion-agent construction at
both initial start and dynamic load. Persist a host-owned one-shot handoff
descriptor. Suppress both initial and dynamic generic pusher injection. When
`--pr` or `--ship` is requested, install one initially idle protected pusher
subscribed to host-owned `ARTIFACT_HANDOFF_READY` before that event can be
inserted. After artifact acceptance/commit, atomically enter durable
`HANDOFF_PENDING` with handoff key, mode, artifact receipt, validation cursor,
and deterministic ready-message ID; do not terminalize. The ready predicate
reads that stored handoff and bounded ledger evidence, never a fresh
`VALIDATION_RESULT`/`IMPLEMENTATION_READY`.

The terminal coordinator remains the sole publisher. In `HANDOFF_PENDING`, only
the authorized pusher's verified PR/merge result may call `completeHandoff`;
route artifact-workflow success/failure in `pr-verification.js` through that
facade rather than direct terminal publication. Early `stop_cluster`/validation
success requests cannot terminalize. Test fixed/conductor `--pr` and `--ship`,
pre-accept races, pusher failure/cancel, duplicate release, and resume between
acceptance, pusher subscription, ready insertion, and verification. Generic
configs keep upstream behavior unchanged.

Implement a distinct `generateArtifactHandoffPusher(binding)` path in
`src/agents/git-pusher-template.js`. Its sole trigger is
`ARTIFACT_HANDOFF_READY`; it carries and validates the provenance-bound handoff
key/artifact receipt, and has no `publishAfter: CLUSTER_COMPLETE` or raw terminal
action. `pr-verification.js` may only call
`terminalCoordinator.completeHandoff(handoffKey, verifiedReceipt)` or the
coordinator failure path. Preserve and regression-test the ordinary upstream
generator behavior for generic configs.

- [ ] **Step 4: Run the shared contract suite**

```bash
npm run build:legacy-runtime
node tests/run-tests.js tests/unit/workflow-artifact-contract.test.js tests/unit/workflow-handoff.test.js tests/unit/artifact-handoff-pusher.test.js tests/template-resolver-typed-values.test.js tests/unit/simulate-random-topology.test.js tests/unit/template-validation-deep.test.js
npm run typecheck:legacy-runtime
npm run lint
```

Expected: PASS.

- [ ] **Step 5: Commit shared pack contracts**

```bash
git add src/workflow-artifacts.ts src/workflow-artifacts.js src/template-resolver.js src/config-validator.js src/orchestrator.js src/agent/pr-verification.js src/agents/git-pusher-template.js src/template-validation/simulate-random-topology.ts src/template-validation/simulate-random-topology.js tests/unit/workflow-artifact-contract.test.js tests/unit/workflow-handoff.test.js tests/unit/artifact-handoff-pusher.test.js tests/template-resolver-typed-values.test.js tests/unit/simulate-random-topology.test.js
git commit -m "feat: define workflow artifact and pack contracts"
```

### Task 2: Restore the code-review family

**Files:**

- Create: `cluster-templates/base-templates/code-review-workflow.json`
- Create: `cluster-templates/code-review-bell.json`
- Create: `cluster-templates/code-review-book.json`
- Create: `cluster-templates/code-review-candle.json`
- Create: `cluster-templates/code-review-conductor.json`
- Create: `tests/code-review-workflow-params.test.js`
- Create: `tests/code-review-workflow-terminal.test.js`
- Create: `tests/quality-gate-code-review.test.js`

**Interfaces:**

- Produces artifact topic `REVIEW_ARTIFACT_READY` and fixed operation `review.synthesize`.
- Specialist outputs use stable `findingId`; validator outputs classify `confirmed`, `contested`, or `withdrawn` and may adjust severity.

- [ ] **Step 1: Write resolution and topology tests first**

Resolve the base with `{ max_iterations: 3, batch_limit: 2,
preflight_quality_gate: true }`. Assert Bell/Book/Candle analysts are present,
the resolved prompt instructs the orchestrating LLM to issue at most two
specialist assignments per batch, all candidate, analyst-complete, and
validation topics are consumed by the host round coordinator, and the sealed
descriptor stores `maxIterations: 3`. Assert every finding requires the whole
sealed validator set, with no model-authored per-finding assignment. The single
synthesizer invokes the operation only from the coordinator-owned terminal
ready topic using exactly:

```json
{
  "topic": "REVIEW_ROUND_READY",
  "action": "execute_workflow_operation",
  "operation": "review.synthesize"
}
```

Assert no trigger has `command`, `cwd`, `env`, `onSuccess`, or
`contentFromOutput`.

Each expected analyst emits a schema-checked round-complete envelope, including
an empty finding set. The provider-free `ReviewRoundCoordinator` from the
operations plan consumes progress serially, waits for the sealed analyst and
validator sets, first freezes the analyst candidate set, and closes zero
findings without validator work. For nonempty findings it persists an absolute
participant deadline plus terminal `completed`/`failed`/`timed_out` states,
freezes the snapshot, and compare-and-set claims one round-scoped transition.
Failure or expiry converts missing participation into a contested host-owned
outcome rather than an unbounded wait. Rounds are one-based. Contested work
below the sealed cap emits `REVIEW_REFINEMENT_READY` exactly once;
`WorkflowRuntime` consumes it by atomically creating round `n + 1` and its
sealed-set assignments, keyed by the consumed row so replay cannot dispatch
twice. A resolved result or the cap emits `REVIEW_ROUND_READY` exactly once. The
synthesizer is the only consumer allowed to invoke `review.synthesize`; it has
no `pending` path and uses the claimed execution key. Duplicate/late progress
messages reuse the stored disposition, so only one invocation can emit the
artifact.

- [ ] **Step 2: Add terminal scenario tests**

Use token-free fixtures for: zero findings from every expected analyst, all confirmed non-blocking,
blocking confirmed, contested at iteration 3, withdrawn, validator retry, one
analyst failure, synthesis failure, and simultaneous cap/cancellation. Assert
one terminal topic and the exact `READY`/`NOT_READY` classification.

- [ ] **Step 3: Run tests and verify templates are absent**

```bash
node tests/run-tests.js tests/code-review-workflow-params.test.js tests/code-review-workflow-terminal.test.js tests/quality-gate-code-review.test.js
```

Expected: FAIL on missing templates.

- [ ] **Step 4: Reauthor the base against v6.46**

Use fork `cluster-templates/base-templates/code-review-workflow.json` only as
behavioral evidence. Consume the shared versioned review envelope verbatim and
define only the code-review payload variant. Include review/round IDs, finding
revision, validator identity, causation/idempotency keys, and snapshot sequence.
Host publishing code stamps workflow-instance identity and the authoritative
validator set; any model-emitted copy is checked only as a redundant assertion.
Use stable finding IDs, fixed prompt batching,
bounded analyst rounds, and one serialized synthesis transition. Declare the
same immutable artifact object in the base, Bell, Book, Candle, and conductor
entry configs:

```json
"artifacts": [
  {
    "id": "code-review",
    "mediaType": "text/markdown",
    "sourceTopic": "REVIEW_ARTIFACT_READY"
  }
]
```

When `preflight_quality_gate` is false, omit only the pack's optional
post-implementation pre-validation trigger. Do not alter protected handoff
gate configuration.

- [ ] **Step 5: Reauthor specialists and conductor**

Bell, Book, and Candle retain distinct review concerns and the conductor routes
explicitly to them. Require each assignment to include a terse `description`
or `task_name` in its prompt contract for later telemetry, without depending on
telemetry for correctness. In both success and error/fallback transforms,
select the original non-republished `ISSUE_OPENED` row for this workflow,
require nonempty issue text, and abort rather than calling `load_config` or
republishing an empty brief. Test conductor failure with present and absent
original issue text.

- [ ] **Step 6: Validate and simulate the family**

```bash
node tests/run-tests.js tests/code-review-workflow-params.test.js tests/code-review-workflow-terminal.test.js tests/quality-gate-code-review.test.js tests/unit/template-simulation.test.js tests/unit/template-validation-deep.test.js
npm run validate:templates
```

Expected: PASS for default and parameter-edge configurations with no
unreachable required topic.

- [ ] **Step 7: Commit the code-review family**

```bash
git add cluster-templates/base-templates/code-review-workflow.json cluster-templates/code-review-bell.json cluster-templates/code-review-book.json cluster-templates/code-review-candle.json cluster-templates/code-review-conductor.json tests/code-review-workflow-params.test.js tests/code-review-workflow-terminal.test.js tests/quality-gate-code-review.test.js
git commit -m "feat: restore bounded code review workflows"
```

### Task 3: Restore the documentation-review family

**Files:**

- Create: `cluster-templates/base-templates/docs-review-workflow.json`
- Create: `cluster-templates/docs-review-trace.json`
- Create: `cluster-templates/docs-review-vector.json`
- Create: `cluster-templates/docs-review-axiom.json`
- Create: `cluster-templates/docs-review-conductor.json`
- Create: `tests/docs-review-workflow-params.test.js`
- Create: `tests/docs-review-workflow-terminal.test.js`

**Interfaces:**

- Produces artifact topic `REVIEW_ARTIFACT_READY` through `review.synthesize`.
- Uses documentation-specific finding schema while preserving the shared confirmed/contested/withdrawn result model.

- [ ] **Step 1: Write family-specific failing tests**

Assert Trace, Vector, and Axiom are distinct reachable specialists; their
schemas include location/evidence/remediation fields suited to documents; the
family declares artifact ID `documentation-review`; and fixed batch/max
parameters resolve as typed integers. The base, Trace, Vector, Axiom, and
conductor entry configs must carry the same immutable artifact declaration.

- [ ] **Step 2: Add bounded result scenarios**

Cover zero findings, confirmed issue, contested issue at cap, withdrawn issue,
severity adjustment, validator failure/retry, synthesis failure, and random
message order. Assert contested always means `NOT_READY` and there is exactly
one terminal event.

- [ ] **Step 3: Run tests and verify absence**

```bash
node tests/run-tests.js tests/docs-review-workflow-params.test.js tests/docs-review-workflow-terminal.test.js
```

Expected: FAIL.

- [ ] **Step 4: Reauthor the family**

Use the prior fork family for specialist intent only. Consume the same shared
review envelope and aggregation table while defining a distinct documentation
payload variant. Follow current upstream provider names, model-level floors,
context strategies, schema rules, and terminal lifecycle. Use only the closed
`review.synthesize` operation and the same serialized coordinator protocol.

- [ ] **Step 5: Validate and simulate**

```bash
node tests/run-tests.js tests/docs-review-workflow-params.test.js tests/docs-review-workflow-terminal.test.js tests/unit/template-simulation.test.js tests/unit/template-validation-deep.test.js
npm run validate:templates
```

Expected: PASS with no required-topic dead ends.

- [ ] **Step 6: Commit the documentation-review family**

```bash
git add cluster-templates/base-templates/docs-review-workflow.json cluster-templates/docs-review-trace.json cluster-templates/docs-review-vector.json cluster-templates/docs-review-axiom.json cluster-templates/docs-review-conductor.json tests/docs-review-workflow-params.test.js tests/docs-review-workflow-terminal.test.js
git commit -m "feat: restore bounded documentation review workflows"
```

### Task 4: Restore the document-drafting family

**Files:**

- Create: `cluster-templates/base-templates/doc-draft-workflow.json`
- Create: `cluster-templates/doc-facet.json`
- Create: `cluster-templates/doc-lens.json`
- Create: `cluster-templates/doc-prism.json`
- Create: `cluster-templates/doc-draft-conductor.json`
- Create: `tests/doc-draft-workflow.test.js`
- Create: `tests/doc-draft-workflow-terminal.test.js`

**Interfaces:**

- Produces `DRAFT_READY`, `VALIDATION_RESULT`, host-owned
  `DOCUMENT_REVISION_READY`/`DOCUMENT_ASSEMBLY_READY`, `REVISION_CONTEXT`, and
  `DOCUMENT_ARTIFACT_READY`.
- Uses operations `document.build_revision_context` and `document.assemble`.

- [ ] **Step 1: Write base/delta schema tests**

Iteration one must satisfy:

```js
assert.ok(message.data.document);
assert.strictEqual(message.data.delta, undefined);
```

Later iterations must satisfy:

```js
assert.strictEqual(message.data.document, undefined);
assert.ok(message.data.delta);
assert.ok(Array.isArray(message.data.delta.revisedSections));
```

Require every message to carry `documentId`, `revision`, exact `baseRevision`,
`validationRound`, `causationMessageId`, `idempotencyKey`, and
`throughSequence`. Reject a missing base, full-document later iteration,
duplicate section IDs, unknown replacement anchors, a delta not targeting the
current revision, stale/future validation rounds, duplicate idempotency keys,
or unbounded revision parameters.

Assert templates cannot invoke either document operation from raw
`VALIDATION_RESULT`. The installed `WorkflowRuntime` deterministically waits for
the sealed validator quorum and routes only its durable ready topics:
`DOCUMENT_REVISION_READY -> document.build_revision_context` below cap when
revision is required, and `DOCUMENT_ASSEMBLY_READY -> document.assemble` for
unanimous approval or cap. Runtime claim validation rejects model-spoofed ready
topics.

- [ ] **Step 2: Add operation routing and terminal tests**

Assert non-unanimous validation below cap triggers only
`document.build_revision_context`; unanimous approval or the cap triggers only
`document.assemble`. Cover all-approved, approve-with-notes, revise, reject,
missing section, retry duplicate, max cap, assembly error, and cancellation.
Pin expected validators, `APPROVE_WITH_NOTES`, missing/failed-validator
behavior, and resume replay in the routing truth table.

- [ ] **Step 3: Run tests and verify absence**

```bash
node tests/run-tests.js tests/doc-draft-workflow.test.js tests/doc-draft-workflow-terminal.test.js tests/doc-reconstruction.test.js tests/document-workflow-operations.test.js
```

Expected: FAIL on missing family.

- [ ] **Step 4: Reauthor the base and specialists**

Use Facet, Lens, and Prism as the fixed perspectives. Define explicit document,
delta, section-review, and validation schemas. Declare artifact ID
`document-draft`, media type `text/markdown`, and source topic
`DOCUMENT_ARTIFACT_READY` on the base, Facet, Lens, Prism, and conductor entry
configs. Keep batching fixed and require terse assignment
titles without relying on telemetry.

- [ ] **Step 5: Prove truthful cap rendering**

```bash
node tests/run-tests.js tests/doc-draft-workflow.test.js tests/doc-draft-workflow-terminal.test.js tests/doc-reconstruction.test.js tests/document-workflow-operations.test.js tests/unit/bounded-synthesis-lifecycle.test.js
npm run validate:templates
```

Expected: PASS; capped Markdown contains `MAX_ITERATIONS`, `Unresolved
Sections`, every remaining validator verdict/reason, and one terminal result.

- [ ] **Step 6: Commit the drafting family**

```bash
git add cluster-templates/base-templates/doc-draft-workflow.json cluster-templates/doc-facet.json cluster-templates/doc-lens.json cluster-templates/doc-prism.json cluster-templates/doc-draft-conductor.json tests/doc-draft-workflow.test.js tests/doc-draft-workflow-terminal.test.js
git commit -m "feat: restore bounded document drafting workflows"
```

### Task 5: Implement the scoped atomic `--output` contract

**Files:**

- Create: `src/workflow-artifact-output.ts`
- Modify: `cli/index.js`
- Modify: `src/legacy-lib/start-cluster-run-options.ts`
- Modify: `src/legacy-lib/clusters-registry.ts`
- Modify: `src/legacy-lib/start-cluster.ts`
- Modify: `src/orchestrator.js`
- Create: `tests/unit/workflow-artifact-output.test.js`
- Create: `tests/unit/cli-output-file.test.js`
- Modify: `tests/unit/detached-startup-contract.test.js`
- Modify: `tests/unit/cli-resume-loads-clusters.test.js`
- Modify: `tests/integration/orchestrator-worktree.test.js`
- Modify: `tests/unit/docker-config-contract.test.js`

**Interfaces:**

- Produces `resolveArtifactOutputPath(input, invocationCwd): string` and an
  idempotent host-side `commitMarkdownArtifact({ destination, markdown,
checksum, artifactSequence, commitClaim, signal })`. The terminal coordinator,
  not the caller, issues and fences `commitClaim` and owns the abort signal.
- Persists `artifactOutputPath`, artifact binding, phase, and cursor in ledger
  `workflow_state` within the same state/message transaction; cluster state may
  expose only a derived diagnostic summary.
- Consumes the configured artifact's source topic through a replayable
  READY/COMMITTED protocol.

- [ ] **Step 1: Add path resolution tests**

```js
assert.strictEqual(resolveArtifactOutputPath('reports/review', '/repo'), '/repo/reports/review.md');
assert.strictEqual(
  resolveArtifactOutputPath('reports/review.markdown', '/repo'),
  '/repo/reports/review.markdown'
);
assert.strictEqual(resolveArtifactOutputPath('/tmp/review', '/repo'), '/tmp/review.md');
```

Use platform-aware path fixtures on Windows. Reject empty paths, directories,
NUL, and incompatible direct/root configs before provider startup. For conductors, assert
phase one uses `validateArtifactEntryContract` and persists the absolute pending
path before detach without asserting a final operation; phase two uses
`validateArtifactWorkflowConfig` to validate the selected resolved final
operation and seals the binding before loaded product-provider startup. Assert
each validator rejects inputs belonging to the other phase. Assert
`--result-file` remains a separate foreground benchmark option.

- [ ] **Step 2: Add atomicity tests**

Pre-create a destination with `old`. Simulate successful rename and each of:
operation failure, cancellation, invalid artifact, multiple artifacts,
temporary write failure, and rename failure. Assert success replaces with exact
Markdown; every pre-rename failure leaves `old` unchanged and no owned temp
remains. Treat a post-rename receipt failure as a crash-recovery case below,
not as a rollback claim.
Race cancellation immediately before and during commit: the coordinator either
terminalizes before granting the commit claim, or records abort and waits for
the claim holder. The writer checks abort while holding the serialized claim
immediately before rename; assert no rename occurs after a terminal row.

- [ ] **Step 3: Add launch-mode persistence tests**

Assert the absolute destination resolved from original invocation cwd survives
foreground, detached daemon serialization, resume, worktree cwd change, and
Docker execution without being translated or sent to provider task runners.
Only the host-side orchestrator owner commits the final file. Add dynamic-load
tests proving no generic completion agent can terminalize an artifact workflow.

Add crash-window/resume cases: before temp write, after rename but before the
commit receipt, after the receipt but before terminal publication, and during
shutdown. Replaying the same READY checksum is idempotent; a mismatched checksum
for the same artifact sequence fails closed. Before rename, persist COMMITTING
with epoch/token, temp identity, artifact checksum, and the destination's
preimage checksum or absence. On recovery, an artifact-checksum destination is
completed by recording COMMITTED; a preimage match retries; any other content
is preserved and fails closed as an ambiguous external edit.
Add resume immediately after descriptor sealing, artifact READY, and
`HANDOFF_PENDING`; assert runtime hydration completes before any agent rebuild
or outbox delivery and uses the same path/binding/cursor.

- [ ] **Step 4: Run tests and verify missing behavior**

```bash
npm run build:legacy-lib
npm run build:legacy-runtime
npm run build:task-lib
node tests/run-tests.js tests/unit/workflow-artifact-output.test.js tests/unit/cli-output-file.test.js tests/unit/detached-startup-contract.test.js tests/unit/cli-resume-loads-clusters.test.js tests/integration/orchestrator-worktree.test.js tests/unit/docker-config-contract.test.js
```

Expected: FAIL.

- [ ] **Step 5: Implement path resolution and private atomic replacement**

```ts
export function resolveArtifactOutputPath(input: string, invocationCwd: string): string {
  const resolved = path.resolve(invocationCwd, input);
  return path.extname(resolved) ? resolved : `${resolved}.md`;
}
```

For commit, create parents, open a sibling temp with `wx`/`0o600`, write the
exact UTF-8 Markdown, and sync/close. Under the terminal coordinator's fenced
commit claim, persist COMMITTING with the destination preimage, check the shared
abort signal immediately before rename, rename, and clean only that owned temp
on pre-rename failure. Cancellation cannot publish terminal state while this
claim is held; after rename the owner records COMMITTED before releasing it.
The configured `*_ARTIFACT_READY` operation event is nonterminal and
contains Markdown, checksum, artifact identity, and durable sequence. The
awaited host owner first durably calls the cluster coordinator's
`markArtifactReady`. Without `--output`, it validates exactly one declared
artifact and persists `ARTIFACT_ACCEPTED`.
With `--output`, it commits the file, persists `ARTIFACT_COMMITTED`, then asks
the coordinator to advance. With no delivery request, the accepted/committed
transition asks it to succeed. With `--pr`/`--ship`, it instead atomically calls
`enterHandoffPending` and relies on the already-subscribed protected pusher;
artifact ownership never publishes success in that mode. Commit failure asks
the same coordinator for the sole failure terminal. Resume rehydrates phase and
scans through the stored cursor. READY without COMMITTING restarts commit;
COMMITTING uses the destination/preimage checksum rules above; COMMITTED
advances without rewriting. Cover both branches and every crash window.

Scope tests and public claims to atomic replacement and process-crash recovery.
Do not claim cross-filesystem power-loss durability: this MVP does not sync the
containing directory after rename. Portable directory sync and its
platform/filesystem matrix are an explicit follow-up, not a prerequisite for
the reconciliation program.

- [ ] **Step 6: Add CLI and persisted run option**

```js
.option('-o, --output <file>', 'Atomically write the workflow Markdown artifact')
```

For a direct pack, resolve and validate after parameter resolution and before
daemon/provider/isolation startup. For a conductor, resolve the path and
validate its root declaration before daemon/isolation startup, then validate
and seal the selected loaded config before loaded product agents start. Print
`Artifact written: <absolute path>` only after COMMITTED. Do not write on
failure terminal topics.

- [ ] **Step 7: Run output tests and broader lifecycle coverage**

```bash
npm run build:legacy-lib
npm run build:legacy-runtime
npm run build:task-lib
npm run build:cli-runtime
node tests/run-tests.js tests/unit/workflow-artifact-output.test.js tests/unit/cli-output-file.test.js tests/unit/detached-startup-contract.test.js tests/unit/cli-resume-loads-clusters.test.js tests/integration/orchestrator-worktree.test.js tests/unit/docker-config-contract.test.js tests/unit/bounded-synthesis-lifecycle.test.js
npm run typecheck
npm run lint
```

Expected: PASS.

- [ ] **Step 8: Commit deterministic output**

```bash
git add src/workflow-artifact-output.ts src/workflow-artifact-output.js cli/index.js src/legacy-lib/start-cluster-run-options.ts src/legacy-lib/clusters-registry.ts src/legacy-lib/start-cluster.ts src/orchestrator.js lib tests/unit/workflow-artifact-output.test.js tests/unit/cli-output-file.test.js tests/unit/detached-startup-contract.test.js tests/unit/cli-resume-loads-clusters.test.js tests/integration/orchestrator-worktree.test.js tests/unit/docker-config-contract.test.js
git commit -m "feat: add atomic workflow artifact output"
```

Review generated changes before committing.

### Task 6: Enforce fixed batching and retire autocompact injection

**Files:**

- Modify: three base workflow templates created above
- Modify: `src/agent/agent-task-executor.js` only if it injects `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE`
- Create: `tests/unit/specialist-batching.test.js`
- Create: `tests/unit/no-autocompact-injection.test.js`

**Interfaces:**

- Consumes: resolved `batch_limit`.
- Produces: explicit resolved instructions to issue at most `batch_limit`
  provider-native specialist assignments, wait for that batch, merge results,
  then issue the next batch. This is an LLM process contract, not a hard runtime
  concurrency guarantee. Preserves a user-supplied autocompact environment
  value without creating one.

- [ ] **Step 1: Add batching and environment regressions**

```js
const prompt = resolvePackPrompt({ specialists: 7, batchLimit: 2 });
assert.match(prompt, /at most 2/i);
assert.match(prompt, /wait.*merge.*next batch/is);

const env = buildProviderEnv({ CLAUDE_AUTOCOMPACT_PCT_OVERRIDE: '73' });
assert.strictEqual(env.CLAUDE_AUTOCOMPACT_PCT_OVERRIDE, '73');
assert.strictEqual(Object.hasOwn(buildProviderEnv({}), 'CLAUDE_AUTOCOMPACT_PCT_OVERRIDE'), false);
```

- [ ] **Step 2: Run tests and observe current behavior**

Run: `node tests/run-tests.js tests/unit/specialist-batching.test.js tests/unit/no-autocompact-injection.test.js`

Expected: batching instruction fails until templates render it; the environment test may
already pass upstream and then remains a regression-only commit.

- [ ] **Step 3: Implement only fixed batching**

Render the resolved positive integer into one concise, explicit batching
instruction. Do not add a disconnected scheduler simulation or claim that
Zeroshot intercepts provider-native child launches. Do not read machine thread
count, memory, provider quota, or adaptive settings. Remove only
fork-originated automatic autocompact assignment if present; leave explicitly
inherited user values untouched.

- [ ] **Step 4: Run all pack and environment tests**

```bash
node tests/run-tests.js tests/unit/specialist-batching.test.js tests/unit/no-autocompact-injection.test.js tests/code-review-workflow-params.test.js tests/docs-review-workflow-params.test.js tests/doc-draft-workflow.test.js tests/unit/isolated-mode-output-capture.test.js
npm run validate:templates
npm run typecheck
npm run lint
```

Expected: PASS.

- [ ] **Step 5: Commit resource policy**

```bash
git add cluster-templates/base-templates/code-review-workflow.json cluster-templates/base-templates/docs-review-workflow.json cluster-templates/base-templates/doc-draft-workflow.json src/agent/agent-task-executor.js tests/unit/specialist-batching.test.js tests/unit/no-autocompact-injection.test.js
git commit -m "feat: bound specialist workflow batching"
```

Omit `src/agent/agent-task-executor.js` when upstream already has no injection.

### Task 7: Verify reconciled checkpoint R

**Files:**

- Create: `docs/reconciliation/v6.46-workflow-evidence.md`

**Interfaces:**

- Consumes: all reconciliation commits through Tasks 1-6 and the prior child plans.
- Produces: complete no-live-provider evidence for user review.

- [ ] **Step 1: Run pack-specific acceptance**

```bash
node tests/run-tests.js tests/code-review-workflow-params.test.js tests/code-review-workflow-terminal.test.js tests/docs-review-workflow-params.test.js tests/docs-review-workflow-terminal.test.js tests/doc-draft-workflow.test.js tests/doc-draft-workflow-terminal.test.js tests/unit/workflow-artifact-output.test.js tests/unit/cli-output-file.test.js tests/unit/specialist-batching.test.js tests/unit/no-autocompact-injection.test.js
npm run validate:templates
```

Expected: PASS.

- [ ] **Step 2: Run the complete spec verification ladder**

```bash
npm ci
npm run protocol:check
npm run build:agent-cli-provider
npm run build:target
npm run build:legacy-lib
npm run build:legacy-runtime
npm run build:task-lib
npm run build:cli-runtime
npm run typecheck
npm run lint
npm run check:agent-cli-provider:ci
npm test
npm run test:e2e
npm run test:slow
npm run test:target
npm run test:hosted-target
npm run test:cluster-client
npm run test:cluster-package
npm run rust:check
npm run rust:distribution:check
cargo run -p zeroshot-rust --example generate_cli_docs -- --check
python3.12 -m venv sdks/python/.venv
(
  cd sdks/python
  .venv/bin/python -m pip install --disable-pip-version-check -e '.[dev]'
  .venv/bin/python -m ruff check src tests examples
  .venv/bin/python -m ruff format --check src tests examples
  .venv/bin/python -m mypy src examples
  .venv/bin/pydoclint src/zeroshot
  .venv/bin/python -m pytest
  .venv/bin/python -m mkdocs build --strict
  .venv/bin/python -m compileall -q examples
  ZEROSHOT_PYTHON_VERSION=0.1.0.post1 \
  ZEROSHOT_PYTHON_WHEEL_PLATFORM=manylinux_2_17_x86_64 \
  ZEROSHOT_RUST_BINARY=/bin/true \
    .venv/bin/python -m build --wheel
  .venv/bin/python -m twine check dist/*.whl
  .venv/bin/python -c "import zipfile; from pathlib import Path; wheels=list(Path('dist').glob('zeroshot_rust-0.1.0.post1-py3-none-manylinux_2_17_x86_64.whl')); assert len(wheels)==1, wheels; z=zipfile.ZipFile(wheels[0]); assert any(n.endswith('/zeroshot/_bin/zeroshot-rust') for n in z.namelist())"
)
npm run audit:production
npm run release:preflight
npm pack --dry-run
```

Expected: PASS or an explicitly recorded environmental skip. Do not run live
provider smoke.

- [ ] **Step 3: Record evidence and structural counts**

Record every status in `docs/reconciliation/v6.46-workflow-evidence.md`, then
run:

```bash
git merge-base --is-ancestor 1bc71f6881da82de9f28dc5c78107a9151ed24c0 HEAD
git merge-base --is-ancestor e73727662df53bbaf8aad8ba9e489d2c76a79499 HEAD
git rev-list --left-right --count HEAD...upstream/main
rg -n "execute_system_command|CLAUDE_AUTOCOMPACT_PCT_OVERRIDE\s*=" src cli task-lib cluster-templates scripts
```

Expected: ancestry checks pass, right-hand count is `0`, and the scan has no
generic action or automatic injection match.

- [ ] **Step 4: Commit the checkpoint and stop**

```bash
git add docs/reconciliation/v6.46-workflow-evidence.md
git commit -m "docs: record reconciled workflow verification"
git status --short
```

Expected: clean worktree. Present the branch and exact commit for user review;
do not merge to internal `main` yet.
