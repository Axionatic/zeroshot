# Merge Upstream zeroshot v6.2.0 Implementation Plan

> **Superseded on 2026-09-02:** Do not execute this plan. It targets an older
> baseline and mechanical merge strategy. Use
> `docs/superpowers/plans/2026-09-02-upstream-v6.46-reconciliation-program.md`;
> this file remains only as fork prior art.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Merge upstream's breaking v6.2.0 re-architecture into the `@covibes` fork, absorbing its improvements while preserving the fork's distinct behaviors and rejecting the upstream rebrand.

**Architecture:** Land-then-refine, corrected for the _actual_ merge shape (verified by a scratch merge of `upstream/main` into `main`). Most fork-behavior files **auto-merge and keep fork code** — they need survival _assertions_, not re-ports. The real exposure is (a) genuine conflicts whose fork hunks would be lost to a careless resolution, and (b) files that **auto-merge to upstream's rebrand/redirect** and therefore need _active_ intervention precisely because they do **not** conflict. Task 0 resolves every conflict to a green building baseline, deferring only the two genuine conflict-losses that are large enough to warrant their own TDD cycle (context-builder compression, hook VM hardening). Tasks 1–5 refine; Task 6 verifies.

**Tech Stack:** Node.js (CommonJS `src/`), TypeScript (`src/agent-cli-provider/` → compiled to gitignored `lib/agent-cli-provider/`), Mocha test suite (`npm test`), ESLint (flat config, needs `typescript-eslint`), git worktree/PR workflow.

## Global Constraints

- **Package identity stays `@covibes/zeroshot`.** `package.json` **auto-merges to `@the-open-engine/zeroshot`** (it is NOT a conflict) — a worker iterating only conflicts will ship the rebrand. Actively restore `name`/`homepage`/`repository`/`bugs`/`description` to `@covibes`. Strip every redirect that pushes `@covibes` users onto the new package.
- **Do NOT edit `CLAUDE.md`.** It is a real both-modified conflict; resolve it with `--ours` (keep fork). Stale refs post-merge are a flagged follow-up, never an in-plan edit.
- **No live `zeroshot run` / cluster spawn anywhere in this plan** — consumes API credits; project rule forbids it without explicit permission. Verify behavior with unit tests and inert stub checks only.
- **No git commands inside validator/agent prompts.** General-purpose only — no hardcoded paths/languages/providers in templates/prompts.
- **Branch:** all work on `merge/v6.2.0` off `main`. PR to merge (pre-push hook blocks direct `main` push).
- **Drop the Rust TUI** — adopt upstream's deletion. `src/status-footer.js` + `src/subagent-tracker.js` survive (zero TUI dependency).
- **Keep both quality gates.** Rename the fork's to "pre-validation gate" at the **human-facing layer only** (the `quality_gate` param `description` strings + `scripts/quality-gate-runner.js` stdout). Machine identifiers unchanged: `--skip-quality-gate`, `.zeroshot-quality`, `quality_gate` param key, role id `quality-gate`.
- **Skip-tag** for any deferred test: `// TODO(merge/v6.2.0 Task N): re-port` — Task 6 greps for stragglers.
- **Merge-base** = `0edf068`. `upstream/main` == tag `v6.2.0`.

### Verified conflict set (from scratch merge — do not re-derive)

| Kind                                                                  | Files                                                                                                                                                                                                                                 | Default handling                                                                                                                            |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| **Content (UU), take upstream**                                       | `eslint.config.mjs`, `README.md`, `tests/settings-providers.test.js`, `tests/verify-github-pr-hook.test.js`, `task-lib/runner.js`                                                                                                     | `--theirs` (+ identity fix on README)                                                                                                       |
| **Content (UU), keep fork**                                           | `CLAUDE.md`                                                                                                                                                                                                                           | `--ours`                                                                                                                                    |
| **Content (UU), union — graft named fork hunk onto upstream base**    | `lib/start-cluster.js`, `src/agent-wrapper.js`, `src/config-validator.js`, `src/orchestrator.js`, `src/template-validation/index.js`                                                                                                  | hand-union (below) — take upstream as base, graft ONLY the named fork addition; literal "keep both sides" produces redeclare/dup-key errors |
| **Content (UU), take upstream + DEFER re-port**                       | `src/agent/agent-context-builder.js` (→Task 2), `src/agent/agent-hook-executor.js` (→Task 1), `src/agents/git-pusher-template.js` (→Task 4)                                                                                           | `--theirs` now                                                                                                                              |
| **Regenerate**                                                        | `package-lock.json`                                                                                                                                                                                                                   | delete + `npm install`                                                                                                                      |
| **Delete/modify (DU), keep deleted**                                  | `.github/workflows/release.yml`, `.releaserc.json`, `AGENTS.md`, `CHANGELOG.md`, `CONTRIBUTING.md`, `PUBLISHING.md`, `docs/postmortems/2026-01-31-pr-base-detached.md`                                                                | `git rm`                                                                                                                                    |
| **Modify/delete (UD), keep deleted**                                  | `src/providers/anthropic/models.js`                                                                                                                                                                                                   | `git rm`                                                                                                                                    |
| **AUTO-ADDED rebrand apparatus (clean-add, NOT a conflict) — DELETE** | `legacy/covibes-zeroshot-bridge/`, `.github/workflows/publish-covibes-bridge.yml`, `tests/legacy-covibes-bridge.test.js`, `tests/unit/release-hygiene.test.js`                                                                        | `git rm` (Step 2b)                                                                                                                          |
| **AUTO-MERGE to rebrand/redirect — ACTIVE FIX**                       | `package.json`, `cli/index.js`, `cli/lib/update-checker.js`, `tests/update-checker.test.js`, `scripts/setup-merge-queue.sh`                                                                                                           | strip legacy-distro/identity (below)                                                                                                        |
| **AUTO-MERGE, fork behavior survives — ASSERT only**                  | `src/providers/base-provider.js`, `src/agent/agent-task-executor.js`, `cluster-templates/base-templates/{full-workflow,worker-validator}.json`, `src/agent/agent-lifecycle.js`, `src/template-resolver.js`, `tests/max-model.test.js` | grep-assert in Task 0 Step 11                                                                                                               |

---

### Task 0: Merge to green building baseline

Resolve every conflict and defuse the auto-merge rebrand/redirect landmines so `npm ci && npm run build:agent-cli-provider && npm run lint && npm test` pass. Defer only context-builder compression (Task 2) and hook VM hardening (Task 1) via `--theirs` + one skip-tag.

**Files:** see the Verified conflict set table above.

**Interfaces:**

- Produces: `merge/v6.2.0` with one merge commit; `@covibes` identity intact; agent-cli-provider build wired; suite green (one skip group: `tests/cannot-validate-status.test.js`).

- [ ] **Step 1: Branch and start the merge**

```bash
git switch -c merge/v6.2.0
git merge upstream/main          # expect: Automatic merge failed; fix conflicts
git diff --name-only --diff-filter=U | sort   # sanity: matches the verified set
```

- [ ] **Step 2: Keep-deleted conflicts (DU + UD)**

```bash
git rm .github/workflows/release.yml .releaserc.json AGENTS.md CHANGELOG.md \
  CONTRIBUTING.md PUBLISHING.md docs/postmortems/2026-01-31-pr-base-detached.md \
  src/providers/anthropic/models.js
```

(Note the path is `.github/workflows/release.yml`, NOT a top-level `release.yml`. `models.js` opus-4.6 edit is superseded by `src/agent-cli-provider/adapters/claude.ts`.)

- [ ] **Step 2b: Delete the auto-added rebrand apparatus (clean-adds, no conflict marker)**

The merge silently adds a redirect package that republishes the fork's OWN name (`@covibes/zeroshot` v5.4.1) as a stub depending on `@the-open-engine/zeroshot` — exactly the redirect the Global Constraint forbids. Plus an upstream-only test that reads files Step 2 just deleted (ENOENT → red suite). None of these conflict, so a worker iterating only `--diff-filter=U` never sees them:

```bash
git rm -rf legacy/covibes-zeroshot-bridge \
  .github/workflows/publish-covibes-bridge.yml \
  tests/legacy-covibes-bridge.test.js \
  tests/unit/release-hygiene.test.js
```

(`-f` is required: these are staged as ADDED files, `M`/`A` in the index. `git rm` without `-f` refuses with "the following file has changes staged in the index … use -f to force removal" (exit 1) and removes nothing — leaving the forbidden redirect bridge in place and `release-hygiene.test.js` in the suite. Step 2's keep-deleted DU/UD removals work without `-f`; only this clean-add batch needs it.)
(`release-hygiene.test.js`'s `readText()` has no try/catch and unconditionally reads `.github/workflows/release.yml` + `.releaserc.json`, both removed in Step 2 → it would fail Step 12's green-baseline gate.)

- [ ] **Step 3: Take-upstream content conflicts**

```bash
git checkout --theirs eslint.config.mjs tests/settings-providers.test.js \
  tests/verify-github-pr-hook.test.js task-lib/runner.js \
  src/agent/agent-context-builder.js src/agent/agent-hook-executor.js \
  src/agents/git-pusher-template.js
git add eslint.config.mjs tests/settings-providers.test.js tests/verify-github-pr-hook.test.js \
  task-lib/runner.js src/agent/agent-context-builder.js src/agent/agent-hook-executor.js \
  src/agents/git-pusher-template.js
```

(`runner.js`: upstream form `finalArgs: commandSpec.args`; the fork's `resolveFinalArgs` call is gone upstream, and `MAX_ID_RETRIES` survives outside the markers.)

- [ ] **Step 4: Keep-fork — CLAUDE.md**

```bash
git checkout --ours CLAUDE.md && git add CLAUDE.md
```

- [ ] **Step 5: README.md — take upstream, restore identity**

Resolve `README.md` to upstream's content, then replace `@the-open-engine/zeroshot` install/badge references with `@covibes/zeroshot` and add a one-line fork-lineage note (e.g. "Fork of `the-open-engine/zeroshot`."). Then `git add README.md`. Verify: `git grep -n 'the-open-engine' -- README.md` → only the intentional lineage note.

- [ ] **Step 6: Hand-union the five fork-hunk conflicts**

**Do NOT literally "keep both sides"** — several hunks overlap declarations, so concatenation yields `no-redeclare`/`no-dupe-keys` errors that fail Step 12's lint. For each: **take upstream's side as the base, then graft ONLY the named fork-unique addition.** Remove markers, `git add`:

- `lib/start-cluster.js` — `buildStartOptions` markers ~239/263 share nine keys on both sides (`modelOverride`, `providerOverride`, `noMounts`, `mounts`, `containerHome`, `forceProvider`, `prBase`, `mergeQueue`, `closeIssue`). Take upstream's helper-form keys + `ship`/`requiredQualityGates`, then insert ONLY the fork-unique line — graft conflict line ~246 verbatim: `paramOverrides: mergedOptions.skipQualityGate ? { quality_gate: false } : undefined`. (Keep the `mergedOptions.` qualifier — `buildStartOptions` destructures only `{clusterId, options, settings, providerOverride, modelOverride, forceProvider}`; a bare `skipQualityGate` is `no-undef`/ReferenceError. Literal keep-both = nine duplicate keys.)
- `src/agent-wrapper.js` — `getState()` markers share `modelSpec`: fork `let modelSpec = null` (~583) vs upstream `const modelSpec = this._resolveModelSpec()` (~608). Keep the fork's defensive try/catch around model resolution (issue #162) as the structure, and graft ONLY upstream's new `hasLiveOrTrackedTask` line (~609). Drop the upstream duplicate `const modelSpec` declaration. (Literal keep-both = `modelSpec` redeclared → SyntaxError.)
- `src/config-validator.js` — THREE conflict hunks + an upstream `recordAgentOutputs` auto-merged OUTSIDE the markers (so keep-both yields TWO `function recordAgentOutputs`, ~364 and ~434 → `no-redeclare`, and the later upstream def wins, silently killing the fork's onSuccess registration). Resolution: **delete the fork's duplicate `recordAgentOutputs` (~364); use upstream's (~434) as base and insert the fork's `for (const successTopic of collectOnSuccessTopics(agent)) { ... }` producer-registration loop into it; keep `collectOnSuccessTopics` (def ~325, callers 403/642/1730/1859); union `EXTERNAL_TOPICS`/reserved topics to include BOTH the fork's `QUALITY_GATE_PASSED`/`QUALITY_GATE_FAILED` (~539-540) AND upstream's `CLUSTER_OPERATIONS_VALIDATION_FAILED`.** The whitelist/`config.command`/`execute_system_command` validation and `verify_github_pr`→`verify_pull_request` are ALREADY auto-merged here — not at risk, do not re-add. **Conscious accepted loss:** the fork's `recordAgentOutputs` (~366) guarded `onComplete` producer registration with `agentExecutesTask(agent)` ("onComplete only fires for execute_task, not execute_system_command"); upstream's base registers unconditionally. Using upstream's base drops that guard. This is inert today — every `execute_system_command` agent in the base templates (quality-gate, quality-gate-stopper, completion-detector, revision-preparer) has `onComplete.config.topic = none` and routes via `trigger.config.onSuccess`, so no current template exercises the guard. Accept the loss; do not re-wrap (would re-complicate the union for a path nothing hits).
- `src/orchestrator.js` — graft the fork's paramOverrides threading + `_opLoadConfig` `mergedParams`, paramOverrides-on-resume persistence, max-iterations synthesis-chain deferral (`_maxIterSafetyTimeout` clear), `_cleanupSubagentEvents` onto upstream's base (which already has `PUSH_BLOCKED` repair, `requiredQualityGates`/`commandProofs` threading, preflight GC, and the auto-merged `require('./quality-gates')` + `require('./command-proofs')`). At the two stop()-related hunks: (a) ~1473 — **adopt upstream's** `this.stop(clusterId, { completedSuccessfully: true })` (keep-fork here drops the success signal that drives auto-clean-worktree); (b) ~2220 — **union, not take-upstream**: the HEAD side has BOTH `this._cleanupSubagentEvents(clusterId)` (~2222) AND `cluster.state = 'stopped'`, while upstream's side has ONLY `cluster.state = shouldAutoCleanWorktree ? 'killed' : 'stopped'`. Keep the fork's `this._cleanupSubagentEvents(clusterId)` line AND take upstream's `shouldAutoCleanWorktree ? 'killed' : 'stopped'` state expression. Literally taking the upstream hunk side here silently drops the fork's subagent-temp-file cleanup on the normal stop() path (`git show :3:src/orchestrator.js` has 0 `_cleanupSubagentEvents` hits; no later task re-adds it). Mirror the ~1473 hunk where the fork's `_maxIterSafetyTimeout` clear is likewise retained.
- `src/template-validation/index.js` — Hunk1 (~35/56): keep upstream's expanded `validateTemplateConfig` AND the fork's `substituteTemplateParams` function, but **delete the fork's old 1-line `validateTemplateConfig` signature** (else two declarations → `no-redeclare`). Hunk2 (~228/242): take upstream's side (the fork's old fragment references `filePath`, now out of scope in upstream's restructured `buildResolvedConductorRoutes`); then inject `substituteTemplateParams(config)` into upstream's real call site `validateConfigEntry` (~271). Preserve upstream's top-level `require('./simulate-random-topology')`.

`task-lib/runner.js` is **take-upstream, not a fork-graft** (moved out of this list): the fork's conflict side calls `resolveFinalArgs(...)` which upstream **deleted** (no definition survives the merge → ReferenceError). Take upstream's `finalArgs: commandSpec.args` for both hunks; the fork's `MAX_ID_RETRIES` collision loop (~45-62) is OUTSIDE the markers and survives automatically. (Handled in Step 3's `--theirs` batch.)

After resolving: `git grep -n verify_github_pr -- src` → **zero** (already achieved by `--theirs`/auto-merge; this is a confirmation, not work).

- [ ] **Step 7: Defuse package.json (auto-merged to rebrand)**

`package.json` is NOT conflicted — it silently holds upstream's identity now. Base it on **upstream's** scripts/deps/bin (already TUI-free, has agent-cli-provider wiring + any new runtime deps), then overwrite identity fields with fork values:

```bash
node -e "const u=require('./package.json'); u.name='@covibes/zeroshot'; \
u.homepage='https://github.com/covibes/zeroshot#readme'; \
u.repository={type:'git',url:'git+https://github.com/covibes/zeroshot.git'}; \
u.bugs={url:'https://github.com/covibes/zeroshot/issues'}; \
u.description=(u.description||'')+' (fork of the-open-engine/zeroshot)'; \
if(Array.isArray(u.files)) u.files=u.files.filter(f=>f!=='CHANGELOG.md'); \
require('fs').writeFileSync('package.json', JSON.stringify(u,null,2)+'\n')"
```

(`CHANGELOG.md` is git-rm'd in Step 2; leaving it in `files` triggers an npm pack warning.)
Confirm no TUI script targets remain and none are referenced by `check`/`dev:bootstrap`/`prepublishOnly`/`postinstall`:

```bash
git grep -nE 'tui-backend|install-tui-binary|build:tui|dev:tui' -- package.json   # expect zero
```

Remove any stragglers (and their callers) by hand. Then `git add package.json`.

- [ ] **Step 8: Strip the legacy-distro redirect AND repoint the install target to @covibes**

These auto-merged to upstream's `@covibes → @the-open-engine` redirect; no conflict marker flags them. The redirect is not isolated to the legacy-distro block — `getUpdateTarget()` calls `isLegacyDistro(packageName)` (~177) and `buildInstallArgs` pushes `NEW_PACKAGE_SPEC` (~198), so the _kept_ install path itself installs `@the-open-engine`. Stripping only the legacy block leaves a dangling call and an upstream-targeted installer.

- `cli/lib/update-checker.js`:
  - Repoint the package constants to the fork: `NEW_PACKAGE_NAME` (~18), `NEW_PACKAGE_SPEC` (~20), `REGISTRY_URL` (~29) → `@covibes/zeroshot` / default npm registry. (Or collapse the legacy/new split entirely to a single `@covibes` target.)
  - Remove `isLegacyDistro` + `printLegacyDistroNotice` definitions AND the `isLegacyDistro(packageName)` call in `getUpdateTarget()` (~177) — untangle that branch so update/install resolves to `@covibes`.
  - Keep the install-robustness refactor (`deriveInstallPrefixFromPackageRoot`, `buildInstallArgs`).
- `cli/index.js` — remove the `printLegacyDistroNotice` import (~line 71) and its call site (**~line 5468** — verify by grep, the earlier ~5413 hint is stale).
- `tests/update-checker.test.js` — this asserts `@the-open-engine` in MANY places beyond the legacy block (install/update target tests). Update ALL of them to `@covibes/zeroshot`, and delete the `isLegacyDistro`/`printLegacyDistroNotice` cases that reference removed exports.
- `scripts/setup-merge-queue.sh` — auto-merged clean (no conflict marker) to upstream's `REPO="the-open-engine/zeroshot"` (~line 7); only upstream changed it vs merge-base, so the three-way merge silently adopts the rebrand. This is the fork's own merge-queue tooling. Restore `REPO="covibes/zeroshot"`. `git add scripts/setup-merge-queue.sh`.

```bash
git grep -nE 'isLegacyDistro|printLegacyDistroNotice|the-open-engine' -- cli/ tests/update-checker.test.js
git grep -n 'the-open-engine' -- scripts/setup-merge-queue.sh   # expect zero after restoring REPO
# expect: zero (no redirect remnants AND no upstream-targeted install path)
# functional check: the resolved install target must be @covibes
git grep -nE "NEW_PACKAGE_(NAME|SPEC)|REGISTRY_URL" -- cli/lib/update-checker.js   # all @covibes / default registry
git add cli/lib/update-checker.js cli/index.js tests/update-checker.test.js scripts/setup-merge-queue.sh
```

- [ ] **Step 9: .gitignore — keep both ignore entries**

Ensure `.gitignore` ignores BOTH upstream's `lib/agent-cli-provider/` AND the fork's `.audit-ignore`. Add whichever is missing; `git add .gitignore`.

- [ ] **Step 10: Regenerate the lockfile**

```bash
rm -f package-lock.json
npm install            # rewrites lock to match the @covibes manifest + merged deps
git add package-lock.json
```

- [ ] **Step 11: Skip-tag the one deferred test; assert auto-merged behaviors survived**

Skip-tag (Task 2 re-ports context compression). **TWO `it()` blocks** in `tests/cannot-validate-status.test.js` fail under the upstream `--theirs` render — skip BOTH:

- the header block (~242, asserts `'SKIP — Unverifiable Criteria'`; upstream renders `'Permanently Unverifiable Criteria'`)
- the dedup block (~301, its `/- AC1:/g` matches 0 because upstream renders bolded `- **AC1**:`)

The dedup failure is format-driven (bold vs un-bold) and is **part of the deferred compression** — do NOT "fix" it inside Task 0 (e.g. by un-bolding `agent-context-sections.js`); that would leak Task 2's re-port. Skip both, un-skip both in Task 2.

```bash
# in tests/cannot-validate-status.test.js, on each of the two it() blocks:
#   // TODO(merge/v6.2.0 Task 2): re-port context compression, then un-skip
#   it.skip(...)
```

Assert (no edits — these must already be true post-merge; if any is empty the auto-merge dropped a fork behavior, STOP and union it by hand):

```bash
git grep -c '_warnedLevelUpgrades' -- src/providers/base-provider.js          # >0
git grep -cE 'ZEROSHOT_TRACK_SUBAGENTS|CLAUDE_AUTOCOMPACT_PCT_OVERRIDE' -- src/agent/agent-task-executor.js  # >0
git grep -c 'quality_gate' -- cluster-templates/base-templates/full-workflow.json cluster-templates/base-templates/worker-validator.json  # >0
git grep -c 'execute_system_command' -- src/agent/agent-lifecycle.js          # >0
```

- [ ] **Step 12: Build, lint, test — verify green baseline**

```bash
npm ci
npm run build:agent-cli-provider
npm run lint && npm test
```

Expected: PASS (only the Task-2-tagged skip). A non-skipped failure is a genuine merge defect — fix before committing.

- [ ] **Step 13: Commit the merge**

```bash
git add -A && git commit --no-edit
```

---

### Task 1: Re-port VM-sandbox hook hardening (with a real breakout test)

Upstream runs hook/transform scripts via string interpolation `vm.runInContext('(function(){ ' + script + ' })()', ctx)` (CodeQL-flagged injection seam). The fork compiles the body with `vm.compileFunction(script, [], { parsingContext: ctx })`, so wrapper-breakout payloads are a SyntaxError. Re-port the fork seam; prove it with a payload that the interpolation form executes but `compileFunction` rejects.

**Files:**

- Modify: `src/agent/agent-hook-executor.js` (`runTransformScript` ~line 296, `evaluateHookLogic` vm block ~line 690 in the merged/upstream file)
- Test: `tests/unit/hook-logic-executor.test.js` (add a case)

**Interfaces:**

- Consumes: merged (upstream) `agent-hook-executor.js`; exports `{ executeHook, executeTransform, substituteTemplate, evaluateHookLogic, deepMerge }`.
- Produces: both vm seams use `vm.compileFunction(script, [], { parsingContext: vmContext })` + `vm.runInContext('__fn()', vmContext, { timeout })`.

- [ ] **Step 1: Write the failing test**

Add to `tests/unit/hook-logic-executor.test.js` inside `registerEvaluateHookLogicErrorTests()` (uses the file's existing `mockAgent`/`mockContext`):

```javascript
it('compiles hook logic as a function body so wrapper-breakout payloads cannot inject statements', function () {
  // Tries to close the wrapper IIFE and smuggle a second IIFE whose return value
  // would replace the result. SyntaxError under compileFunction; executes under
  // string-interpolated `(function(){ ... })()` wrapping.
  const breakout = 'return { topic: "SAFE" }; })(); (function() { return { topic: "INJECTED" };';
  assert.throws(
    () =>
      evaluateHookLogic({
        logic: { engine: 'javascript', script: breakout },
        resultData: {},
        agent: mockAgent,
        context: mockContext,
      }),
    /script error/i,
    'breakout payload must be rejected as a syntax error, not executed'
  );
});
```

- [ ] **Step 2: Run it to confirm red**

Run: `npx mocha tests/unit/hook-logic-executor.test.js -g 'wrapper-breakout'`
Expected: FAIL — upstream's interpolation executes the injected IIFE and returns `{topic:"INJECTED"}` (no throw), so `assert.throws` fails.

- [ ] **Step 3: Re-port the compileFunction seam**

In `runTransformScript`, replace the interpolation block with:

```javascript
const vmContext = vm.createContext(sandbox);
try {
  vmContext.__fn = vm.compileFunction(script, [], { parsingContext: vmContext });
  return vm.runInContext('__fn()', vmContext, { timeout: 5000 });
} catch (err) {
  throw new Error(`Transform script error: ${err.message}`);
}
```

In `evaluateHookLogic`'s vm block, the same with `logic.script` and `{ timeout: 1000 }`, throwing `Hook logic script error: ...`. Remove the now-dead `wrappedScript` lines and the `codeql[js/bad-code-sanitization]` suppression comments.

**Convert BOTH seams.** `runTransformScript` (~296) and `evaluateHookLogic` (~690) each use the interpolation wrapper. The breakout test only drives `evaluateHookLogic` (the production transform path runs through async `executeTransform` + result-validation, which is awkward to unit-test directly), so guard the transform seam structurally — see Step 4. (Note: `compileFunction` produces a non-strict function body, vs upstream's `'use strict'` wrapper. This faithfully restores the fork's original behavior — no test depends on strict-mode semantics and globals still resolve to the sandbox — so do not "fix" it back.)

- [ ] **Step 4: Run to confirm green + assert both seams converted**

Run: `npx mocha tests/unit/hook-logic-executor.test.js tests/transform-sandbox-ledger.test.js`
Expected: PASS (new breakout test green; existing sandbox/ledger tests still green).

Structural guard against a partial re-port (the transform seam has no behavioral test):

```bash
git grep -c 'compileFunction' -- src/agent/agent-hook-executor.js   # expect 2 (both seams)
git grep -c 'wrappedScript'   -- src/agent/agent-hook-executor.js   # expect 0 (no interpolation left)
```

- [ ] **Step 5: Commit**

```bash
git add src/agent/agent-hook-executor.js tests/unit/hook-logic-executor.test.js
git commit -m "feat: re-port compileFunction VM-sandbox hardening onto v6.2.0 hook executor"
```

---

### Task 2: Re-port agent-context prompt compression (f9ddd7a)

`agent-context-builder.js` was a real conflict resolved `--theirs` in Task 0, dropping the fork's f9ddd7a compression (terse headers, compact `MM-DD HH:MM` timestamps, un-indented `JSON.stringify`). Re-port it into wherever upstream now renders sections. `guidance-queue.js` and `sub-cluster-wrapper.js` auto-merged with their compression intact — do NOT touch them.

**Files:**

- Modify: the upstream module that renders context sections — confirm in Step 3 (upstream split rendering out of `agent-context-builder.js`; likely `src/agent/agent-context-sections.js` and/or `agent-context-sources.js`)
- Test: `tests/cannot-validate-status.test.js` (un-skip)

**Interfaces:**

- Consumes: merged (upstream) pack/section/source context modules. The rendering f9ddd7a compressed now lives in `src/agent/agent-context-sections.js` and `src/agent/agent-context-sources.js` (upstream split it out of `agent-context-builder.js`).
- Produces: rendered prompt output uses terse headers (no markdown bold/emoji), compact `MM-DD HH:MM` timestamps, and un-indented JSON. **Note:** `tests/cannot-validate-status.test.js` only asserts ~2 of the ~7 compression targets (the `SKIP — Unverifiable Criteria` header and un-bolded `- AC1:` dedup line); the rest are guarded by the Step 4 zero-greps, not the test.

- [ ] **Step 1: Un-skip BOTH anchor blocks**

Remove `.skip` + the tracking comment from BOTH `it()` blocks tagged in Task 0 Step 11 (the header block ~242 and the dedup block ~301) in `tests/cannot-validate-status.test.js`. (Un-skip both or Task 6 Step 1's skip-tag grep flags the survivor.)

- [ ] **Step 2: Run to confirm red**

Run: `npx mocha tests/cannot-validate-status.test.js`
Expected: FAIL — upstream renders verbose `Permanently Unverifiable Criteria` header and bolded `- **AC1**:`.

- [ ] **Step 3: Enumerate all f9ddd7a targets, re-port compression**

```bash
git show f9ddd7a:src/agent/agent-context-builder.js   # fork original — note ALL 7 compressed functions
```

f9ddd7a compressed ~7 section builders (e.g. `buildGitOperationsSection`, autonomous-mode, output-density, JSON-output sections, plus schema/Data JSON serialization and `MM-DD HH:MM` timestamps). In the merged tree these are arrays of indented quoted string literals inside `agent-context-sections.js`/`agent-context-sources.js` (so a `^#{1,3} ` header grep matches nothing — use the f9ddd7a diff as the checklist). Apply to each: terse headers (drop emoji/`**`), `MM-DD HH:MM` timestamps, `JSON.stringify(x)` with no indent.

- [ ] **Step 4: Run to confirm green + assert full coverage**

Run: `npx mocha tests/cannot-validate-status.test.js`
Expected: PASS.

Coverage guard (the test only gates ~2 targets) — expect ZERO after re-port:

```bash
git grep -nE 'toISOString|JSON\.stringify\([^)]*, *null, *2\)|🔴|🚫|⚠️|\*\*' -- \
  src/agent/agent-context-sections.js src/agent/agent-context-sources.js
# any hit = a verbose renderer not yet compressed
```

**Do NOT add a `## ` markdown-header branch.** f9ddd7a _retains_ `## ` section headers (e.g. terse `## AUTONOMOUS MODE`, `## OUTPUT DENSITY`) — it strips emoji/bold/timestamps/JSON-indent, not headers. A `## ` grep can never reach zero and would tempt stripping headers, breaking the section-delimiter lookahead `(?=\n## |$)` that `tests/cannot-validate-status.test.js:645` exercises. The `\*\*` branch above DOES reach zero (f9ddd7a removes markdown bold like `**NEVER**` → terse `FORBIDDEN:`), closing the bold-removal coverage gap.

- [ ] **Step 5: Commit**

```bash
git add src/agent/agent-context-*.js tests/cannot-validate-status.test.js
git commit -m "perf: re-port agent-context prompt compression onto v6.2.0 context modules"
```

---

### Task 3: Rename fork gate → "pre-validation gate" (human-facing only)

The quality-gate agent block has only `id`/`role`/`condition`/`triggers` — **no label/description field to rename**. The actual human-facing strings are the `quality_gate` param `description` fields and the runner's stdout. Machine identifiers stay.

**Files:**

- Modify: `cluster-templates/base-templates/full-workflow.json` (param `description` ~line 51), `cluster-templates/base-templates/worker-validator.json` (~line 36), `cluster-templates/base-templates/code-review-workflow.json` (~line 58), `scripts/quality-gate-runner.js` (stdout log lines), `cli/index.js` (~line 224 first-run confirmation string)

**Interfaces:**

- Consumes: merged templates (quality_gate param present via auto-merge).
- Produces: the `quality_gate` param `description` strings + the runner's stdout label read "pre-validation gate"; `quality_gate` key, role id `quality-gate`, `--skip-quality-gate`, `.zeroshot-quality` all unchanged. **Scope is param descriptions + runner stdout only** — the higher-visibility `## QUALITY GATE FAILURES` prompt headings and the code-review stopper's `Quality gate failed …` stderr are intentionally left (renaming them risks coupling to the `QUALITY_GATE_FAILED` topic id); revisit only if you want full user-facing consistency.

- [ ] **Step 1: Reword the human-facing strings**

The `quality_gate` param `description`s read like `"Run automated quality checks before validation"` (no literal "quality gate" token) and `scripts/quality-gate-runner.js` emits JSON via `console.log` with one human string at ~line 53 (`"No quality gate configured — auto-passed"`). Reword these to name the **pre-validation gate**, e.g. description → `"Run the pre-validation gate (automated quality checks) before validation"`; runner ~line 53 → `"No pre-validation gate configured — auto-passed"`. Also `cli/index.js` ~line 224 prints `✓ Quality gate configured: ${result.command}` to the terminal on the first `zeroshot run` (via `ensureQualityConfig`) — the highest-visibility surface of all; reword to `✓ Pre-validation gate configured: …`. Leave line 225's `--skip-quality-gate` flag reference and the `quality_gate` JSON key / role id alone (machine ids; this string has zero topic coupling, so the prompt-heading/stderr exclusion rationale below does not apply to it).

- [ ] **Step 2: Verify machine identifiers untouched**

```bash
git grep -cE '"quality_gate"|"role": *"quality-gate"' -- cluster-templates/base-templates/   # >0
git grep -c 'skip-quality-gate' -- cli/index.js          # cli/index.js:2 (flag literal lives here only)
git grep -c 'skipQualityGate' -- lib/start-cluster.js    # >0 (start-cluster uses the camelCase var, not the flag)
```

Expected: each >0. (Don't grep `skip-quality-gate` against `start-cluster.js` — it uses `skipQualityGate`/`quality_gate`, and a multi-file `git grep -c` hides zero-match files.)

- [ ] **Step 3: Run the gate suites**

Run: `npx mocha tests/quality-gate.test.js tests/quality-detection.test.js tests/quality-gate-code-review.test.js`
Expected: PASS. If a test asserts on old label text, update it to "pre-validation gate".

- [ ] **Step 4: Commit**

```bash
git add cluster-templates/ scripts/quality-gate-runner.js tests/
git commit -m "docs: rename fork quality gate to 'pre-validation gate' (human-facing strings only)"
```

---

### Task 4: Re-compress + de-escalate git-pusher-template.js (deferred — decision A1)

`git-pusher-template.js` was a real conflict taken `--theirs` (upstream's verbose transport-only prompt + `SHARED_TRIGGER_SCRIPT`). The fork had de-escalated this prompt previously (`--theirs` dropped it), so this is a genuine re-port: re-apply f9ddd7a-style compression to upstream's **new** prompt text AND rewrite ALL-CAPS shouting + alarm emojis (⚠️ 🚨 💡) into plain declarative instructions. Rationale: Anthropic research that emotionally-charged / high-alarm prompt framing is a distinct, non-neutral feature in the model rather than a reliability boost — https://www.anthropic.com/research/emotion-concepts-function and https://transformer-circuits.pub/2026/emotions/index.html.

**This prompt IS tested.** `tests/structuredOutput-mapping.test.js` calls `generateGitPusherAgent('github')` and asserts the prompt `.includes(...)` for THREE de-escalation-sensitive prose strings — `'TRANSPORT-ONLY GIT PUSHER'`, `'Do NOT edit source files'` (~line 138), and `'Do NOT inspect CI logs to debug product code'` (~line 139) — plus `'blocked_reason'` (an unchanged field id). All three prose strings get reworded by Step 2's `Do NOT`→`Do not` / CAPS rule, so all three assertions must be updated in lockstep. That test is the regression anchor (the prior "no test covers prompt text / add a tripwire" claim was wrong).

**Files:**

- Modify: `src/agents/git-pusher-template.js`
- Modify (same commit): `tests/structuredOutput-mapping.test.js` (update the prompt-substring assertions to the reworded text)

**Interfaces:**

- Consumes: merged (upstream) `git-pusher-template.js`.
- Produces: same prompt semantics, compressed and de-escalated (no redundant emphasis/repetition, no ALL-CAPS shouting or alarm emojis); `verify_pull_request` action and `SHARED_TRIGGER_SCRIPT` behavior preserved.

- [ ] **Step 1: Establish a behavior baseline**

```bash
npx mocha tests/structuredOutput-mapping.test.js   # passes pre-change (asserts current CAPS strings)
git grep -c 'verify_pull_request' -- src/agents/git-pusher-template.js   # note the count
```

- [ ] **Step 2: Compress + de-escalate the prompt text**

Edit only human-prose prompt strings: remove redundant emphasis/repetition AND rewrite ALL-CAPS shouting + alarm emojis (⚠️ 🚨 💡, and any 🔴/❌) into plain declarative instructions ("Do not edit source files." not "❌ Do NOT edit source files"). Keep every topic name, hook action, structured-output field (`blocked_reason`), and the `SHARED_TRIGGER_SCRIPT` logic byte-identical — do NOT touch CAPS that are topic/action/field identifiers (`CLUSTER_COMPLETE`, `verify_pull_request`, `blocked_reason`). Do not alter control flow or published topics.

- [ ] **Step 3: Update the assertions + verify**

Update `tests/structuredOutput-mapping.test.js`'s three reworded prompt-substring assertions — `'TRANSPORT-ONLY GIT PUSHER'`, `'Do NOT edit source files'` (~138), `'Do NOT inspect CI logs to debug product code'` (~139) — to the de-escalated text; keep `'blocked_reason'` (an unchanged field id) and leave the negative/schema assertions intact. Then:

```bash
npx mocha tests/structuredOutput-mapping.test.js tests/verify-github-pr-hook.test.js
```

Expected: PASS. And `git grep -c 'verify_pull_request' -- src/agents/git-pusher-template.js` unchanged. De-escalation check: `git grep -coE '⚠|🔴|🚨|❌|💡' -- src/agents/git-pusher-template.js` → 0 (identifier-style CAPS may remain).

- [ ] **Step 4: Commit**

```bash
git add src/agents/git-pusher-template.js tests/structuredOutput-mapping.test.js
git commit -m "perf: re-compress + de-escalate git-pusher template prompt on v6.2.0 base"
```

---

### Task 5: De-escalate shared base templates (deferred — decision B1) — NET-NEW work

**Scope correction (verified):** the fork's `b5e636a` compression on the shared base templates **survived the merge intact** (nothing to re-apply — that part is a no-op), and the fork **never de-escalated** these templates (alarm-emoji counts are identical in fork `main` and the merged tree: full-workflow 45, worker-validator 5, debug-workflow 35, heavy-validation 19). So this task is **net-new de-escalation**, not a re-port: rewrite ALL-CAPS shouting + alarm emojis into plain declarative instructions, preserving semantics. Rationale: Anthropic research that high-alarm/emotional prompt framing is a distinct learned feature, not a reliability lever — https://www.anthropic.com/research/emotion-concepts-function and https://transformer-circuits.pub/2026/emotions/index.html.

**Files:**

- Modify: `cluster-templates/base-templates/full-workflow.json`, `worker-validator.json`, `debug-workflow.json`, `heavy-validation.json`, `quick-validation.json`

**Interfaces:**

- Consumes: merged shared templates (compression already intact).
- Produces: de-escalated prompt/description strings (plain declarative tone, no alarm emojis); all template keys/params/topics unchanged.

- [ ] **Step 1: Inventory the emphasis to remove**

Count **occurrences**, not lines — these system prompts are single giant JSON-string lines packing many emojis each, so `git grep -c` (lines) reports ~6× fewer than exist:

```bash
for f in full-workflow worker-validator debug-workflow heavy-validation quick-validation; do
  echo "$f: $(grep -oE '⚠️|🔴|🚨|❌|💡|🚫' cluster-templates/base-templates/$f.json | wc -l)"
done   # expect non-trivial counts (full-workflow 45, worker-validator 5, debug-workflow 35, heavy-validation 19, quick-validation 8)
```

(Do NOT `git diff b5e636a..HEAD` to "find losses" — that surfaces upstream's deliberate structural changes (level2→level3, FIX_APPLIED→IMPLEMENTATION_READY, etc.) as if they were regressions, inviting a worker to revert the merge.)

- [ ] **Step 2: Rewrite alarm emphasis to plain declaratives**

Rewrite ALL-CAPS shouting + alarm emojis into plain declarative instructions; leave structure, keys, params, topics, prompt _meaning_, and identifier-style CAPS (topic/action names like `IMPLEMENTATION_READY`, `QUALITY_GATE_FAILED`) untouched. This is semantic-preserving tone editing only.

- [ ] **Step 3: Verify templates parse + resolve + pass**

```bash
node -e "for(const f of ['full-workflow','worker-validator','debug-workflow','heavy-validation','quick-validation']) \
  JSON.parse(require('fs').readFileSync('cluster-templates/base-templates/'+f+'.json','utf8'))"  # valid JSON
npx mocha tests/template-resolver.test.js tests/quality-gate.test.js
```

Expected: PASS (templates parse and resolve; placeholders/params intact).

Completion gate (none of the above asserts tone — mirror Task 4's de-escalation check; the deliverable is otherwise unverified):

```bash
for f in full-workflow worker-validator debug-workflow heavy-validation quick-validation; do
  echo "$f: $(grep -oE '⚠️|🔴|🚨|❌|💡|🚫' cluster-templates/base-templates/$f.json | wc -l)"
done   # expect 0 across all five after de-escalation
```

- [ ] **Step 4: Commit (conditional — may be a no-op if already clean)**

```bash
git add cluster-templates/base-templates/
git diff --cached --quiet || git commit -m "style: de-escalate shared base-template prompts (calm declarative tone) on v6.2.0"
```

---

### Task 6: Full verification + orphan/regression sweep + PR

**Files:** verify only (no new code unless a check fails).

- [ ] **Step 1: No leftover skips**

Run: `git grep -n 'merge/v6.2.0 Task' -- tests/`
Expected: ZERO.

- [ ] **Step 2: No orphaned new modules (match import specifiers, not substrings)**

```bash
for m in command-proofs agent-command-proofs-context agent-quality-gates-context \
  context-replay-policy detached-startup worktree-claude-config worktree-tooling-env \
  quality-gates pr-verification simulate-random-topology; do
  hits=$(git grep -lE "require\\(['\"][^'\"]*$m['\"]\\)|from ['\"][^'\"]*$m['\"]" -- src cli lib task-lib | grep -v "/$m\.js$")
  [ -n "$hits" ] && echo "$m: $hits" || echo "$m: ORPHAN"
done
```

Expected: each lists ≥1 importer, none print `ORPHAN`. (`pr-verification` and `simulate-random-topology` are single-importer — `agent-hook-executor.js` and the union `template-validation/index.js` respectively — so a dropped `require` from the Task-1/Task-0 edits shows up here.) For `quality-gates`, which has multiple importers (orchestrator.js, git-pusher-template.js, agent-quality-gates-context.js), additionally assert the union seam specifically:

```bash
git grep -n "require('./quality-gates')" -- src/orchestrator.js   # >0
```

- [ ] **Step 3: Require-resolution smoke (after build)**

```bash
npm run build:agent-cli-provider
node -e "require('./src/orchestrator');require('./src/agents/git-pusher-template');require('./src/agent/agent-hook-executor');require('./src/providers')"
```

Expected: no throw.

- [ ] **Step 4: Identity + rename + TUI greps (scoped)**

```bash
# identity — the plan's #1 risk; no test asserts package.name (update-checker's @covibes assertions were rewritten in Step 8)
node -e "if(require('./package.json').name!=='@covibes/zeroshot')throw new Error('rebrand leaked: '+require('./package.json').name)"
git grep -l the-open-engine -- package.json package-lock.json cli/ scripts/   # expect zero (scripts/setup-merge-queue.sh repointed in Step 8; package description's lineage note lives in README, not these paths)
git grep -l the-open-engine -- src/   # expect ONLY src/agent-cli-provider/{index,types}.ts + tests/agent-cli-provider/strict-lane.test.ts

git grep -n verify_github_pr -- src                          # zero
git grep -nE 'tui-launcher|launchTuiSession' -- src cli lib   # zero
```

(Do NOT grep bare `task-lib/tui` repo-wide — upstream's `eslint.config.mjs` legitimately lists `task-lib/tui.js` ignore globs.) The `src/agent-cli-provider/{index,types}.ts` + `strict-lane.test.ts` hits on `the-open-engine` are **intentional and dormant**: `agentCliProviderHelperMetadata.packageName` is an internal compile-time contract value never read at runtime (the build is plain `tsc`; `src/providers/index.js` consumes the adapters, not this metadata). Per the LOCKED "adopt agent-cli-provider" decision, leave them as upstream's internal contract — do not repoint (the literal type at `types.ts:9`, the value, and the `strict-lane.test.ts:26` assertion are coupled and would all have to change together for zero functional gain).

- [ ] **Step 5: Full build + lint + test**

Run: `npm ci && npm run build:agent-cli-provider && npm run lint && npm test`
Expected: PASS. "No merge/v6.2.0-tagged skips" — pre-existing upstream conditional/pending skips are fine; rely on Step 1's grep, not a zero-skip count.

- [ ] **Step 6: Inert behavior + tripwire tests (no live spawn)**

```bash
zeroshot tui ; zeroshot watch     # each prints "The TUI is not included in this Zeroshot release. Use `zeroshot logs -f`..." to stderr and exits 1 (graceful stub, not a crash; the `;` lets the second still run)
npx mocha tests/unit/command-proofs.test.js tests/context-replay-policy.test.js \
  tests/unit/gc-orphan-protection.test.js
```

(Correct paths: `command-proofs` and `gc-orphan-protection` live under `tests/unit/`.) The stub's non-zero exit is expected — treat the printed "TUI is not included" message as success, not the exit code. The `--skip-quality-gate → quality_gate:false` path is covered by the quality-gate unit tests — do NOT launch a real `zeroshot run`.

- [ ] **Step 7: Push + open PR**

```bash
git push -u origin merge/v6.2.0
gh pr create --base main --title "merge: upstream v6.2.0 re-architecture (preserve @covibes fork behaviors)"
```

---

## Out of Scope / Follow-ups (flag to user, do NOT do in this plan)

- **`CLAUDE.md`** has stale refs post-merge (Rust TUI rows, `git-pusher-agent.json` → `git-pusher-template.js`, provider section, install line, dual quality-gate concepts). Project rule forbids editing it without explicit ask — **flag, edit only on confirmation.**
- **`MEMORY.md`**: mark `fix/level3-model-alias` branch **superseded** (upstream shipped the equivalent in `adapters/claude.ts`); protected-branch note now obsolete.
- **Optional:** add direct coverage for `base-provider.validateLevel` minLevel auto-upgrade (it survives auto-merge but `tests/max-model.test.js:323` actually exercises `lib/settings.js validateModelAgainstMax`, not the provider method).
- Optionally repoint the `upstream` remote URL if `covibes/zeroshot` fully moved to `the-open-engine/zeroshot`.
