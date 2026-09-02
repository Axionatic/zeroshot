# Prompt JSON Minification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce mechanical prompt size by minifying embedded JSON without changing prompt meaning, wording, values, ordering, or timestamp format.

**Architecture:** One pure serializer marks the prompt-only formatting boundary. Maintained prompt renderers use it for schemas, examples, message data, guidance, and reformatting prompts; CLI display, persistence, settings, and exported artifacts retain their existing formatting.

**Tech Stack:** Node.js 22, strict TypeScript/CommonJS, Mocha snapshot/semantic tests.

**Spec:** `docs/superpowers/specs/2026-09-02-upstream-v6.46-reconciliation-design.md`

## Global Constraints

- Branch from the exact user-accepted reconciled checkpoint R, independently of telemetry.
- Change only JSON whitespace at prompt-assembly boundaries.
- Preserve JSON values, property/array order, surrounding prompt wording, headings, fences, and full ISO-8601 timestamps.
- Do not restore abbreviated timestamps or the fork's calm/terse prompt wording.
- Do not change CLI pretty output, persisted settings/state, logs, receipts, protocol frames, or user-facing exported JSON.
- Never run a live provider for verification.

---

### Task 1: Inventory and freeze prompt JSON boundaries

**Files:**

- Create: `src/agent/prompt-json.ts`
- Create: `tests/unit/prompt-json-boundaries.test.js`
- Modify: `tests/context-injection.test.js`
- Modify: `tests/unit/guidance-queue.test.js`
- Modify: `tests/output-reformatter.test.js`

**Interfaces:**

- Produces `serializePromptJson(value: unknown): string`.
- Establishes the only approved compact serializer for JSON embedded in model prompts.

- [ ] **Step 1: Add the pure serializer test**

```js
const value = { alpha: [1, { beta: true }], text: 'line\n"quoted"' };
const serialized = serializePromptJson(value);
assert.strictEqual(serialized, JSON.stringify(value));
assert.deepStrictEqual(JSON.parse(serialized), value);
assert.doesNotMatch(serialized, /\n\s+"/);
```

Assert unsupported values follow native `JSON.stringify` behavior and circular
input throws; do not add a lossy fallback.

- [ ] **Step 2: Add a literal boundary inventory assertion**

The test reads maintained source files and records exactly these prompt
boundaries:

```js
const PROMPT_BOUNDARIES = [
  'src/agent/agent-context-prompt-sections.ts',
  'src/agent/agent-context-sources.ts',
  'src/agent/guidance-queue.ts',
  'src/agent/output-reformatter.ts',
  'src/agent/agent-task-executor.js',
  'src/claude-task-runner.js',
  'src/sub-cluster-wrapper.js',
];
```

Assert each contains at least one prompt-bound JSON serialization before the
change. This list is a guard against accidentally sweeping every
`JSON.stringify` in the repository.

- [ ] **Step 3: Run and verify the serializer is missing**

```bash
npm run build:legacy-runtime
node tests/run-tests.js tests/unit/prompt-json-boundaries.test.js tests/context-injection.test.js tests/unit/guidance-queue.test.js tests/output-reformatter.test.js
```

Expected: FAIL on missing module/export.

- [ ] **Step 4: Implement the pure boundary**

```ts
export function serializePromptJson(value: unknown): string {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) {
    throw new TypeError('Prompt JSON value is not serializable');
  }
  return serialized;
}
```

- [ ] **Step 5: Build and pass the pure test**

```bash
npm run build:legacy-runtime
node tests/run-tests.js tests/unit/prompt-json-boundaries.test.js
npm run typecheck:legacy-runtime
```

Expected: PASS.

- [ ] **Step 6: Commit the serializer and inventory**

```bash
git add src/agent/prompt-json.ts src/agent/prompt-json.js tests/unit/prompt-json-boundaries.test.js
git commit -m "test: define prompt JSON formatting boundary"
```

### Task 2: Minify context, guidance, and output-format JSON

**Files:**

- Modify: `src/agent/agent-context-prompt-sections.ts`
- Modify: `src/agent/agent-context-sources.ts`
- Modify: `src/agent/guidance-queue.ts`
- Modify: `src/agent/output-reformatter.ts`
- Modify: `tests/context-injection.test.js`
- Modify: `tests/unit/guidance-queue.test.js`
- Modify: `tests/output-reformatter.test.js`
- Create: `tests/unit/prompt-json-semantic-equivalence.test.js`

**Interfaces:**

- Consumes `serializePromptJson`.
- Produces compact prompt blocks for output examples, JSON schemas, message data, queued guidance data, and reformatter schema/raw output.

- [ ] **Step 1: Add semantic-before-whitespace tests**

For every renderer, extract fenced or labelled JSON from the rendered prompt,
parse it, and compare it to the input object before asserting compactness:

```js
const prompt = renderContext(fixture);
const embedded = extractJsonAfter(prompt, 'Schema:');
assert.deepStrictEqual(JSON.parse(embedded), fixture.schema);
assert.strictEqual(embedded, JSON.stringify(fixture.schema));
```

Also assert exact surrounding text captured from checkpoint R is unchanged.

- [ ] **Step 2: Add full ISO timestamp assertions**

```js
assert.match(prompt, /2026-09-02T03:04:05\.678Z/);
assert.doesNotMatch(prompt, /\b09-02 03:04\b/);
```

Use a fixed clock/message timestamp and cover context sources and guidance.

- [ ] **Step 3: Run tests and verify pretty JSON remains**

```bash
npm run build:legacy-runtime
node tests/run-tests.js tests/unit/prompt-json-semantic-equivalence.test.js tests/context-injection.test.js tests/unit/guidance-queue.test.js tests/output-reformatter.test.js
```

Expected: FAIL because current prompt blocks use indentation.

- [ ] **Step 4: Replace only prompt-bound serializers**

Replace calls such as:

```ts
JSON.stringify(config.jsonSchema, null, 2);
```

with:

```ts
serializePromptJson(config.jsonSchema);
```

Do this for output-format example/schema blocks, context-source `Data:`, queued
guidance data, and output reformatter schema/raw output. Leave log/error
serialization in the same files unchanged.

- [ ] **Step 5: Build and run semantic tests**

```bash
npm run build:legacy-runtime
node tests/run-tests.js tests/unit/prompt-json-semantic-equivalence.test.js tests/context-injection.test.js tests/unit/guidance-queue.test.js tests/output-reformatter.test.js tests/context-source-selection.test.js
npm run typecheck:legacy-runtime
npm run lint
```

Expected: PASS.

- [ ] **Step 6: Commit maintained prompt renderers**

```bash
git add src/agent/agent-context-prompt-sections.ts src/agent/agent-context-prompt-sections.js src/agent/agent-context-sources.ts src/agent/agent-context-sources.js src/agent/guidance-queue.ts src/agent/guidance-queue.js src/agent/output-reformatter.ts src/agent/output-reformatter.js tests/context-injection.test.js tests/unit/guidance-queue.test.js tests/output-reformatter.test.js tests/unit/prompt-json-semantic-equivalence.test.js
git commit -m "perf: minify embedded prompt JSON"
```

### Task 3: Minify provider and sub-cluster prompt assembly

**Files:**

- Modify: `src/agent/agent-task-executor.js`
- Modify: `src/claude-task-runner.js`
- Modify: `src/sub-cluster-wrapper.js`
- Modify: `tests/claude-command.test.js`
- Create: `tests/unit/task-runner-command-spec.test.js`
- Modify: `tests/nested-cluster.test.js`
- Modify: `tests/unit/isolated-mode-output-capture.test.js`

**Interfaces:**

- Consumes `serializePromptJson` through generated/current runtime imports.
- Produces compact provider-appended schema prompts and sub-cluster message/config prompt data.

- [ ] **Step 1: Add provider command prompt tests**

Capture the exact final context passed to Claude and another adapter for a
schema fixture. Assert the fenced schema parses to the original, equals native
compact JSON, and all text outside the fence is byte-identical to checkpoint R.

- [ ] **Step 2: Add sub-cluster prompt tests**

For `Data:` blocks and child configuration embedded in a parent prompt, assert
semantic equality, compactness, fixed full ISO timestamps, and unchanged topic,
sender, and section labels.

- [ ] **Step 3: Run tests and verify remaining pretty output**

```bash
npm run build:legacy-runtime
node tests/run-tests.js tests/claude-command.test.js tests/unit/task-runner-command-spec.test.js tests/nested-cluster.test.js tests/unit/isolated-mode-output-capture.test.js
```

Expected: FAIL on indentation assertions.

- [ ] **Step 4: Use the prompt serializer at final assembly points**

Replace only the JSON supplied inside provider prompts. Keep CLI arguments such
as `--json-schema`, environment protocols, logs, debug errors, and cloned
configuration serialization unchanged because they are not prompt formatting.

- [ ] **Step 5: Run provider/sub-cluster tests**

```bash
npm run build:legacy-runtime
node tests/run-tests.js tests/claude-command.test.js tests/unit/task-runner-command-spec.test.js tests/nested-cluster.test.js tests/unit/isolated-mode-output-capture.test.js tests/unit/prompt-json-semantic-equivalence.test.js
npm run typecheck
npm run lint
```

Expected: PASS.

- [ ] **Step 6: Commit final prompt boundaries**

```bash
git add src/agent/agent-task-executor.js src/claude-task-runner.js src/sub-cluster-wrapper.js tests/claude-command.test.js tests/unit/task-runner-command-spec.test.js tests/nested-cluster.test.js tests/unit/isolated-mode-output-capture.test.js
git commit -m "perf: compact provider prompt payloads"
```

### Task 4: Prove the change is mechanical and bounded

**Files:**

- Create: `docs/reconciliation/prompt-json-minification-evidence.md`

**Interfaces:**

- Consumes: Tasks 1-3.
- Produces: semantic diff and verification record for independent review.

- [ ] **Step 1: Scan for remaining pretty JSON only in approved prompt files**

```bash
rg -n "JSON\.stringify\([^\n]+, null, [24]\)" src/agent/agent-context-prompt-sections.ts src/agent/agent-context-sources.ts src/agent/guidance-queue.ts src/agent/output-reformatter.ts src/agent/agent-task-executor.js src/claude-task-runner.js src/sub-cluster-wrapper.js
```

Expected: no prompt-bound matches. Pretty error logging in a listed JavaScript
file may remain only when the surrounding code proves it is not supplied to a
model; add an inline `// non-prompt diagnostic` comment if the distinction is
otherwise ambiguous.

- [ ] **Step 2: Scan for forbidden timestamp and wording changes**

```bash
git diff --word-diff=porcelain reconcile/upstream-v6.46...HEAD -- src/agent src/claude-task-runner.js src/sub-cluster-wrapper.js
rg -n "MM-DD|toLocaleString|CLAUDE_AUTOCOMPACT_PCT_OVERRIDE" src/agent src/claude-task-runner.js src/sub-cluster-wrapper.js
```

Review every non-whitespace word diff. Expected source changes are imports,
serializer calls, and tests only; no prompt prose or timestamp formatter
changes are accepted.

- [ ] **Step 3: Run the feature and full Node suites**

```bash
npm run build:legacy-runtime
node tests/run-tests.js tests/unit/prompt-json-boundaries.test.js tests/unit/prompt-json-semantic-equivalence.test.js tests/context-injection.test.js tests/unit/guidance-queue.test.js tests/output-reformatter.test.js tests/claude-command.test.js tests/unit/task-runner-command-spec.test.js tests/nested-cluster.test.js
npm run typecheck
npm run lint
npm test
```

Expected: PASS without live providers.

- [ ] **Step 4: Record evidence**

In `docs/reconciliation/prompt-json-minification-evidence.md`, record the base
and feature commits, every targeted renderer, semantic-equivalence result,
full-ISO result, command statuses, and explicit exclusions: no wording change,
no timestamp abbreviation, no autocompact change, no live provider run.

- [ ] **Step 5: Commit and stop**

```bash
git add docs/reconciliation/prompt-json-minification-evidence.md
git commit -m "docs: record prompt JSON minification evidence"
git status --short
```

Expected: clean feature branch. Present it independently from telemetry and the
reconciliation branch.
