# Specialized Workflow Packs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore the code-review, documentation-review, and document-drafting packs as opt-in v6.46 products with bounded truthful artifacts and deterministic atomic output.

**Architecture:** Each pack family is reauthored against upstream template schemas and the closed workflow-operation registry, then accepted independently. A shared artifact declaration and writer implement `--output`; shared fixed batching limits specialist fan-out without modifying provider context settings.

**Tech Stack:** JSON parameterized templates, Node.js 22, TypeScript/CommonJS, Mocha, upstream template resolver and simulation framework.

**Spec:** `docs/superpowers/specs/2026-09-02-upstream-v6.46-reconciliation-design.md`

## Global Constraints

- Upstream generic workflows remain the default; every restored pack is opt-in.
- The only typed workflow operations are `review.synthesize`, `document.build_revision_context`, and `document.assemble`.
- Every pack emits exactly one Markdown artifact and exactly one terminal event.
- Contested review findings at cap force `NOT_READY`; document cap emits a conspicuous `MAX_ITERATIONS` draft.
- Keep a conservative fixed batch limit; do not inject `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE` and do not implement adaptive concurrency.
- `--output` is accepted only for a fully resolved config declaring one Markdown artifact and is distinct from `--result-file`.
- No live provider run is authorized.

---

### Task 1: Add the shared artifact and pack-parameter contract

**Files:**

- Create: `src/workflow-artifacts.ts`
- Modify: `src/template-resolver.js`
- Modify: `src/config-validator.js`
- Modify: `src/template-validation/simulate-random-topology.ts`
- Test: `tests/unit/workflow-artifact-contract.test.js`
- Modify: `tests/template-resolver-typed-values.test.js`
- Modify: `tests/unit/simulate-random-topology.test.js`

**Interfaces:**

- Produces config declaration `artifacts: [{ id: string, mediaType: 'text/markdown', sourceTopic: string }]`.
- Produces params `max_iterations: integer >= 1`, `batch_limit: integer >= 1`, `preflight_quality_gate: boolean`.
- Produces `resolveSingleMarkdownArtifact(config): WorkflowArtifactDeclaration | null`.

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
```

Require exactly one declaration only when the caller requests output; generic
templates without `artifacts` remain valid. Deep simulation must prove the
declared source topic has one reachable producer and reaches one terminal path.

- [ ] **Step 4: Run the shared contract suite**

```bash
npm run build:legacy-runtime
node tests/run-tests.js tests/unit/workflow-artifact-contract.test.js tests/template-resolver-typed-values.test.js tests/unit/simulate-random-topology.test.js tests/unit/template-validation-deep.test.js
npm run typecheck:legacy-runtime
npm run lint
```

Expected: PASS.

- [ ] **Step 5: Commit shared pack contracts**

```bash
git add src/workflow-artifacts.ts src/workflow-artifacts.js src/template-resolver.js src/config-validator.js src/template-validation/simulate-random-topology.ts src/template-validation/simulate-random-topology.js tests/unit/workflow-artifact-contract.test.js tests/template-resolver-typed-values.test.js tests/unit/simulate-random-topology.test.js
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
no more than two can launch in one batch, all candidate/validation topics are
consumed, and the synthesizer trigger is exactly:

```json
{
  "topic": "REVIEW_SYNTHESIS_REQUESTED",
  "action": "execute_workflow_operation",
  "operation": "review.synthesize"
}
```

Assert no trigger has `command`, `cwd`, `env`, `onSuccess`, or
`contentFromOutput`.

- [ ] **Step 2: Add terminal scenario tests**

Use token-free fixtures for: zero findings, all confirmed non-blocking,
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
behavioral evidence. Define explicit candidate and validator schemas, stable
finding IDs, fixed batching, bounded analyst rounds, and one synthesis request.
Declare:

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
telemetry for correctness.

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
parameters resolve as typed integers.

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

Use the prior fork family for specialist intent only. Follow current upstream
provider names, model-level floors, context strategies, schema rules, and
terminal lifecycle. Use only the closed `review.synthesize` operation.

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

- Produces `DRAFT_READY`, `VALIDATION_RESULT`, `REVISION_CONTEXT`, and `DOCUMENT_ARTIFACT_READY`.
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

Reject a missing base, full-document later iteration, duplicate section IDs,
unknown replacement anchors, or unbounded revision parameters.

- [ ] **Step 2: Add operation routing and terminal tests**

Assert non-unanimous validation below cap triggers only
`document.build_revision_context`; unanimous approval or the cap triggers only
`document.assemble`. Cover all-approved, approve-with-notes, revise, reject,
missing section, retry duplicate, max cap, assembly error, and cancellation.

- [ ] **Step 3: Run tests and verify absence**

```bash
node tests/run-tests.js tests/doc-draft-workflow.test.js tests/doc-draft-workflow-terminal.test.js tests/doc-reconstruction.test.js tests/document-workflow-operations.test.js
```

Expected: FAIL on missing family.

- [ ] **Step 4: Reauthor the base and specialists**

Use Facet, Lens, and Prism as the fixed perspectives. Define explicit document,
delta, section-review, and validation schemas. Declare artifact ID
`document-draft`, media type `text/markdown`, and source topic
`DOCUMENT_ARTIFACT_READY`. Keep batching fixed and require terse assignment
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
- Modify: `src/legacy-lib/start-cluster.ts`
- Modify: `src/orchestrator.js`
- Modify: `task-lib/runner.js`
- Create: `tests/unit/workflow-artifact-output.test.js`
- Create: `tests/unit/cli-output-file.test.js`
- Modify: `tests/unit/detached-startup-contract.test.js`
- Modify: `tests/unit/cli-resume-loads-clusters.test.js`
- Modify: `tests/integration/orchestrator-worktree.test.js`
- Modify: `tests/unit/docker-config-contract.test.js`

**Interfaces:**

- Produces `resolveArtifactOutputPath(input, invocationCwd): string` and `commitMarkdownArtifact({ destination, markdown }): Promise<void>`.
- Persists `artifactOutputPath` as an absolute run option; consumes the configured artifact's source topic.

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
NUL, and incompatible configs before provider startup. Assert `--result-file`
remains a separate foreground benchmark option.

- [ ] **Step 2: Add atomicity tests**

Pre-create a destination with `old`. Simulate successful rename and each of:
operation failure, cancellation, invalid artifact, multiple artifacts,
temporary write failure, and rename failure. Assert success replaces with exact
Markdown; every failure leaves `old` unchanged and no owned temp remains.

- [ ] **Step 3: Add launch-mode persistence tests**

Assert the absolute destination resolved from original invocation cwd survives
foreground, detached daemon serialization, resume, worktree cwd change, and
Docker host/container path translation. Only the host-side owner commits the
final file.

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
exact UTF-8 Markdown, sync/close, rename, and clean only that owned temp on
failure. Subscribe once to the declared source topic and commit only after the
successful terminal result is accepted by the exactly-once boundary.

- [ ] **Step 6: Add CLI and persisted run option**

```js
.option('-o, --output <file>', 'Atomically write the workflow Markdown artifact')
```

Resolve after the fully parameterized config is loaded but before daemon or
isolation cwd changes. Print `Artifact written: <absolute path>` only after
successful rename. Do not write on failure terminal topics.

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
git add src/workflow-artifact-output.ts src/workflow-artifact-output.js cli/index.js src/legacy-lib/start-cluster-run-options.ts src/legacy-lib/start-cluster.ts src/orchestrator.js task-lib/runner.js lib task-lib tests/unit/workflow-artifact-output.test.js tests/unit/cli-output-file.test.js tests/unit/detached-startup-contract.test.js tests/unit/cli-resume-loads-clusters.test.js tests/integration/orchestrator-worktree.test.js tests/unit/docker-config-contract.test.js
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
- Produces: at most `batch_limit` simultaneous specialists; preserves a user-supplied autocompact environment value without creating one.

- [ ] **Step 1: Add batching and environment regressions**

```js
const launches = simulateSpecialistLaunches({ specialists: 7, batchLimit: 2 });
assert.ok(Math.max(...launches.map((entry) => entry.concurrent)) <= 2);

const env = buildProviderEnv({ CLAUDE_AUTOCOMPACT_PCT_OVERRIDE: '73' });
assert.strictEqual(env.CLAUDE_AUTOCOMPACT_PCT_OVERRIDE, '73');
assert.strictEqual(Object.hasOwn(buildProviderEnv({}), 'CLAUDE_AUTOCOMPACT_PCT_OVERRIDE'), false);
```

- [ ] **Step 2: Run tests and observe current behavior**

Run: `node tests/run-tests.js tests/unit/specialist-batching.test.js tests/unit/no-autocompact-injection.test.js`

Expected: batching fails until templates enforce it; the environment test may
already pass upstream and then remains a regression-only commit.

- [ ] **Step 3: Implement only fixed batching**

Use the resolved positive integer to chunk specialist assignments. Do not read
machine thread count, memory, provider quota, or adaptive settings. Remove only
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
