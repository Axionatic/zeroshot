# Zeroshot: Multi-Agent Coordination Engine

Message-passing primitives for multi-agent workflows. **Install:** `npm i -g @covibes/zeroshot` or `npm link` (dev).

## CRITICAL RULES

| Rule                               | Why                          | Forbidden                                    | Required                                         |
| ---------------------------------- | ---------------------------- | -------------------------------------------- | ------------------------------------------------ |
| **GENERAL PURPOSE ONLY**           | Zeroshot runs on ANY repo    | Hardcoded paths, scripts, languages, domains | Discover from target repo's CLAUDE.md/README     |
| **Never spawn without permission** | Consumes API credits         | "I'll run zeroshot on 123"                   | User says "run zeroshot"                         |
| **Never use git in validators**    | Git state unreliable         | `git diff`, `git status` in prompts          | Validate files directly                          |
| **Never ask questions**            | Agents run non-interactively | `AskUserQuestion`, waiting for confirmation  | Make autonomous decisions                        |
| **Never edit CLAUDE.md**           | Context file for Claude Code | Editing this file                            | Read-only unless explicitly asked to update docs |

### 🔴 GENERAL PURPOSE REQUIREMENT (CRITICAL)

**Zeroshot is a GENERAL-PURPOSE multi-agent orchestrator. It MUST work on ANY repository, ANY programming language, ANY domain.**

**FORBIDDEN in templates/prompts:**

- Hardcoded script names (`check-all.sh`, `validate.sh`)
- Hardcoded test commands (`npm test`, `pytest`, `cargo test`)
- Hardcoded file paths (`server/`, `src/`, `tests/`)
- Hardcoded context file names (`CLAUDE.md` - other providers use different files)
- Language-specific assumptions (TypeScript, Python, Rust)
- Domain-specific assumptions (web, CLI, mobile)
- Provider-specific assumptions (Claude, Codex, Gemini)
- Covibes-specific patterns

**REQUIRED:**

- Discover validation commands from target repo's context files (README, Makefile, package.json, pyproject.toml, Cargo.toml, etc.)
- Discover test runners from target repo's build system
- Use generic examples in prompts (e.g., "the repo's validation script" NOT "./scripts/check-all.sh")
- Use generic terms for context files ("repo context files" NOT "CLAUDE.md")
- Work correctly on: Python projects, Rust crates, Go modules, Ruby gems, Java/Kotlin, C/C++, etc.
- Work correctly with: Claude, Codex, Gemini, OpenAI, and any future providers

**Worker git operations:** Allowed with isolation (`--worktree`, `--docker`, `--pr`, `--ship`). Forbidden without isolation (auto-injected restriction).

**Read-only safe:** `zeroshot list`, `zeroshot status`, `zeroshot logs`

**Destructive (needs permission):** `zeroshot kill`, `zeroshot clear`, `zeroshot purge`

**Detached runs:** Always forward `zeroshot run` options via `ZEROSHOT_RUN_OPTIONS` (see `buildDaemonEnv` + `buildStartOptions`) so PR/worktree config survives daemon mode.

## 🔴 BEHAVIORAL STANDARDS

```
WHEN USER POSTS LOGS → THERE IS A BUG. INVESTIGATE.
WHEN TESTS FAIL → Test is source of truth unless PROVEN otherwise.
FAIL FAST. Silent failures are worst. Errors > Warnings. Don't swallow errors.
KEEP IT SIMPLE: don't overengineer, read existing code before writing new, build what was asked — not what you think should be built.
VALIDATION_RESULT is law: workers must address every validator complaint before claiming completion.
```

## Where to Look

| Concept                  | File                                |
| ------------------------ | ----------------------------------- |
| Conductor classification | `src/conductor-bootstrap.js`        |
| Base templates           | `cluster-templates/base-templates/` |
| Message bus              | `src/message-bus.js`                |
| Ledger (SQLite)          | `src/ledger.js`                     |
| Trigger evaluation       | `src/logic-engine.js`               |
| Agent wrapper            | `src/agent-wrapper.js`              |
| Providers registry       | `src/providers/index.js`            |
| Provider implementations | `src/providers/`                    |
| Provider detection       | `lib/provider-detection.js`         |
| Provider capabilities    | `src/providers/capabilities.js`     |
| Rust TUI (Ratatui)       | `tui-rs/crates/zeroshot-tui/`       |
| Docker mounts/env        | `lib/docker-config.js`              |
| Container lifecycle      | `src/isolation-manager.js`          |
| Issue providers          | `src/issue-providers/`              |
| Git remote detection     | `lib/git-remote-utils.js`           |
| Input helpers            | `src/input-helpers.js`              |
| Settings                 | `lib/settings.js`                   |

## CLI Quick Reference

```bash
# Flag cascade: --ship → --pr → --worktree
zeroshot run 123                  # Local, no isolation
zeroshot run 123 --worktree       # Git worktree isolation
zeroshot run 123 --pr             # Worktree + create PR
zeroshot run 123 --pr --pr-base dev # PR base: dev, worktree base: origin/dev (incl. -d)
zeroshot run 123 --ship           # Worktree + PR + auto-merge
zeroshot run 123 --docker         # Docker container isolation
zeroshot run 123 -d               # Background (daemon) mode

# Management
zeroshot list                     # All clusters (--json)
zeroshot status <id>              # Cluster details
zeroshot logs <id> [-f]           # Stream logs
zeroshot resume <id> [prompt]     # Resume failed cluster
zeroshot stop <id>                # Graceful stop
zeroshot kill <id>                # Force kill

# Utilities
zeroshot                          # Rust TUI (TTY only)
zeroshot tui                      # Rust TUI explicit entry
zeroshot watch                    # Rust TUI Monitor view
zeroshot export <id>              # Export conversation
zeroshot agents list              # Available agents
zeroshot settings                 # View/modify settings
zeroshot providers                # Provider status and defaults
```

**UX modes:**

- Foreground (`zeroshot run`): Streams logs, Ctrl+C **stops** cluster
- Daemon (`-d`): Background, Ctrl+C detaches
- Attach (`zeroshot attach`): Connect to daemon, Ctrl+C **detaches** only

**Settings:** `defaultProvider`, `providerSettings` (claude/codex/gemini), legacy `maxModel`, `defaultConfig`, `logLevel`

**Git Auto-Detection:** Bare numbers (e.g., `123`) automatically detect provider from git remote URL.

Priority order for bare numbers:

1. Force flags (`--github`, `--gitlab`, `--devops`) - Explicit CLI override
2. Git remote detection - Automatic from `git remote get-url origin`
3. Settings (`defaultIssueSource`) - Global user preference
4. Legacy fallback - GitHub (only when no git context and no settings)

## Architecture

**Pub/sub message bus + SQLite ledger.** Agents subscribe to topics, execute on trigger match, publish results.

```
Agent A → publish() → SQLite Ledger → LogicEngine → trigger match → Agent B executes
```

### Core Primitives

| Primitive    | Purpose                                                     |
| ------------ | ----------------------------------------------------------- |
| Topic        | Named message channel (`ISSUE_OPENED`, `VALIDATION_RESULT`) |
| Trigger      | Condition to wake agent (`{ topic, action, logic }`)        |
| Logic Script | JS predicate for complex conditions                         |
| Hook         | Post-task action (publish message, execute command)         |

### Agent Configuration (Minimal)

```json
{
  "id": "worker",
  "role": "implementation",
  "modelLevel": "level2",
  "triggers": [{ "topic": "ISSUE_OPENED", "action": "execute_task" }],
  "prompt": "Implement the requested feature...",
  "hooks": {
    "onComplete": {
      "action": "publish_message",
      "config": { "topic": "IMPLEMENTATION_READY" }
    }
  }
}
```

### Provider Model Levels

- Use `modelLevel` (`level1`/`level2`/`level3`) for provider-agnostic configs.
- Set `provider` per agent or `defaultProvider`/`forceProvider` at cluster level.
- Provider names: `claude`, `codex`, `gemini`, `opencode` (legacy `anthropic`/`openai`/`google` map to these).
- `model` remains a provider-specific escape hatch.
- Codex/Opencode only: `reasoningEffort` (`low`/`medium`/`high`/`xhigh`).

### Logic Script API

```javascript
// Ledger (auto-scoped to cluster)
ledger.query({ topic, sender, since, limit });
ledger.findLast({ topic });
ledger.count({ topic });

// Cluster
cluster.getAgents();
cluster.getAgentsByRole('validator');

// Helpers
helpers.allResponded(agents, topic, since);
helpers.hasConsensus(topic, since);
```

### Context Strategy `since` Values

Acceptable: `cluster_start`, `last_task_end`, `last_agent_start`, or an ISO timestamp string.
`last_agent_start` scopes history to the most recent iteration start for the executing agent.

## Conductor: 2D Classification

Classifies tasks on **Complexity × TaskType**, routes to parameterized templates.

| Complexity | Description            | Validators |
| ---------- | ---------------------- | ---------- |
| TRIVIAL    | 1 file, mechanical     | 0          |
| SIMPLE     | 1 concern              | 1          |
| STANDARD   | Multi-file             | 3          |
| CRITICAL   | Auth/payments/security | 5          |

| TaskType | Action                |
| -------- | --------------------- |
| INQUIRY  | Read-only exploration |
| TASK     | Implement new feature |
| DEBUG    | Fix broken code       |

**Base templates:** `single-worker`, `worker-validator`, `debug-workflow`, `full-workflow`

### Fork Conductor Configs

| System             | Tier   | Config               | Analysts           | Validators | Iters | Level | Tokens |
| ------------------ | ------ | -------------------- | ------------------ | ---------- | ----- | ----- | ------ |
| **Design review**  | Trace  | `docs-review-trace`  | 2 core             | 1          | 3     | L2    | 100k   |
|                    | Vector | `docs-review-vector` | 3–4                | 2–3        | 4     | L2    | 150k   |
|                    | Axiom  | `docs-review-axiom`  | 5–8                | 2–3        | 5     | L3    | 150k   |
| **Code review**    | Bell   | `code-review-bell`   | 2 core             | 1          | 3     | L2    | 100k   |
|                    | Book   | `code-review-book`   | core + conditional | 2          | 4     | L2    | 150k   |
|                    | Candle | `code-review-candle` | all                | 2          | 5     | L3    | 150k   |
| **Doc generation** | Facet  | `doc-facet`          | 2–3                | 1          | 3     | L2    | 100k   |
|                    | Lens   | `doc-lens`           | 3–5                | 2          | 4     | L2    | 150k   |
|                    | Prism  | `doc-prism`          | 5–8                | 3          | 5     | L3    | 150k   |

**Code Review Classification:** ChangeScope × RiskDomain → Bell/Book/Candle. PATCH/GENERAL → Bell; PATCH/SENSITIVE or MODULE/GENERAL → Book; MODULE/SENSITIVE or CROSS_CUTTING → Candle.

**Perspectives:** Core (all tiers): Correctness, Error Handling. Conditional: Security (`has_security_surface`), Tests (`has_test_changes`), API (`has_api_changes`). Extended (Candle): Performance, Architecture, Regression Risk.

**Validators:** validator-evidence (fact-checker, CLI tools) + validator-rigor (reasoning quality). Bell = evidence only; Book/Candle = both. Monotonic: no new findings after iteration 1.

**Docs Review Classification:** ArtifactScope × ReviewComplexity → Trace/Vector/Axiom.

**Doc Draft Classification:** DocumentIntent × ContentDomain → Facet/Lens/Prism.

**Workflow files:** `cluster-templates/base-templates/{docs-review,code-review,doc-draft}-workflow.json` · Tier configs: `cluster-templates/{docs-review,code-review}-{tier}.json`, `cluster-templates/doc-{tier}.json` · Conductors: `cluster-templates/{docs-review,code-review,doc-draft}-conductor.json`

### Intentional Differences Between Families

These differences look inconsistent but are warranted by domain semantics. **Do NOT standardize.**

| Aspect                      | Code Review                                              | Doc Draft                                      | Docs Review                     | Why Different                                                                                                                                                                     |
| --------------------------- | -------------------------------------------------------- | ---------------------------------------------- | ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Verdicts**                | ACCEPT/ACCEPT_WITH_NOTES/DOWNGRADE/REJECT/NEEDS_EVIDENCE | ACCEPT/APPROVE_WITH_NOTES/REVISE/REJECT        | Same as code-review             | Finding-based reviews need DOWNGRADE (severity recalibration) + NEEDS_EVIDENCE. Section-based docs need REVISE (fix the content).                                                 |
| **Refinement**              | Monotonic (no new findings)                              | Non-monotonic delta (SPLIT/MERGE/RESTRUCTURE)  | Monotonic                       | Review scope is fixed; document structure evolves.                                                                                                                                |
| **Post-validation**         | Raw VALIDATION_RESULT → analyst                          | revision-preparer → REVISION_CONTEXT → drafter | Raw VALIDATION_RESULT → analyst | Doc-draft delta model makes it hard to reconstruct current state from raw messages. Reviews don't need this — findings are self-contained.                                        |
| **Classification 1st axis** | ChangeScope (PATCH/MODULE/CROSS_CUTTING)                 | DocumentIntent (INFORMATIONAL/ACTIONABLE)      | ArtifactScope (SINGLE/CHAIN)    | Inputs are fundamentally different: code diffs vs document briefs vs design artifacts.                                                                                            |
| **Conductor junior level**  | level2                                                   | level1                                         | level2                          | Doc-draft classification (2 binary fields) is simpler than code-review (6-field output including boolean detection) or docs-review (4-field output with artifact type detection). |
| **Conductor fallback**      | BOOK (middle)                                            | LENS (middle)                                  | VECTOR (middle)                 | All use middle tier — safe default that balances coverage vs cost.                                                                                                                |

## Isolation Modes

| Mode     | Flag         | Use When                                           |
| -------- | ------------ | -------------------------------------------------- |
| Worktree | `--worktree` | Quick isolated work, PR workflows                  |
| Docker   | `--docker`   | Full isolation, risky experiments, parallel agents |

**Worktree:** Lightweight git branch isolation (<1s setup).

**Docker:** Fresh git clone in container, credentials mounted, auto-cleanup.

## Docker Mount Configuration

Configurable credential mounts for `--docker` mode. See `lib/docker-config.js`.

| Setting                | Type                    | Default              | Description                                           |
| ---------------------- | ----------------------- | -------------------- | ----------------------------------------------------- |
| `dockerMounts`         | `Array<string\|object>` | `['gh','git','ssh']` | Presets or `{host, container, readonly}`              |
| `dockerEnvPassthrough` | `string[]`              | `[]`                 | Extra env vars (supports `VAR`, `VAR_*`, `VAR=value`) |
| `dockerContainerHome`  | `string`                | `/root`              | Container home for `$HOME` expansion                  |

**Mount presets:** `gh`, `git`, `ssh`, `aws`, `azure`, `kube`, `terraform`, `gcloud`, `claude`, `codex`, `gemini`, `opencode`

Provider CLIs in Docker require credential mounts; Zeroshot warns when missing.

**Env var syntax:** `VAR` (pass if set) · `VAR_*` (wildcard match) · `VAR=value` (always set) · `VAR=` (set empty)

**Config priority:** CLI flags > `ZEROSHOT_DOCKER_MOUNTS` env > settings > defaults

```bash
zeroshot settings set dockerMounts '["gh","git","ssh","aws"]'  # Persistent
zeroshot run 123 --docker --mount ~/.custom:/root/.custom:ro   # Per-run
zeroshot run 123 --docker --no-mounts                          # Disable all
```

## Anti-Patterns (Zeroshot-Specific)

### 1. Git Commands in Validator Prompts

❌ `"Run git diff to verify..."` · ✅ `"Read src/index.js and verify function exists..."`
**WHY:** Multiple agents modify git state concurrently. Validators read stale state.

### 2. Using Git Stash

❌ `git stash` (hides work) · ✅ `git add -A && git commit -m "WIP: ..."`
**WHY:** WIP commits are visible to other agents, never lost, squashable.

### 3. Hardcoding in Templates

Parameterize from `cluster.config.complexity`, never hardcode in templates.

## Git Workflow

**Nothing blocks direct pushes to `main`.** Deliberate — solo internal fork. `.husky/pre-push` PART 1 is disabled and `main` has no branch protection or rulesets. There is no merge queue.

**Pre-push hook does block** (all skipped when `CI` is set): manual `v*` version tags · a failing `npm run lint && npm run typecheck && npm test` · `.audit-ignore` older than 30 days.

PR workflow is still preferred for anything non-trivial, since CI only runs on PRs:

```bash
git switch -c feat/my-feature
# ... make changes ...
git push -u origin feat/my-feature
gh pr create --base main
gh pr merge --auto --squash
```

**Git Safety (multi-agent):** Use WIP commits instead of stashing. Use `git switch` instead of `git checkout`. Use `git restore` instead of `git checkout --`.

## Development Process

- **Test-First:** Write tests WITH code. Pre-commit hook validates test file exists.
- **Validation:** Run `npm run lint && npm run test` for >50-line changes. Trust pre-commit for trivial.
- **CI Diagnosis:** Diagnose each failing job independently. Fix one, push, rerun, repeat. Do NOT assume single root cause.
- **Release Pipeline:** CI triggers on pushes to `main` and PRs targeting `main` — this fork has no `dev` branch. `install-matrix` (cross-platform) needs `check` to pass and is gated to `main` refs, PRs based on `main`, and merge groups. Neither job is a required check, so neither can block a merge or a direct push.

## Enforcement Philosophy

**ENFORCE > DOCUMENT. If enforceable, don't document.**

| Preference | Method                         |
| ---------- | ------------------------------ |
| Best       | Type system (compile-time)     |
| Good       | ESLint rule (build-time)       |
| Okay       | Pre-commit hook, runtime guard |
| Worst      | Documentation                  |

**The error message IS the documentation.** Write error messages with what + fix.

## Persistence + Known Limitations

| File                        | Content               |
| --------------------------- | --------------------- |
| `~/.zeroshot/clusters.json` | Cluster metadata      |
| `~/.zeroshot/<id>.db`       | SQLite message ledger |

**Bash subprocess output not streamed:** Claude CLI returns `tool_result` after subprocess completes.

**Kubernetes/SQLite:** Network filesystems (EFS/NFS/CephFS) cause latency and lock contention. Set `ZEROSHOT_SQLITE_JOURNAL_MODE=DELETE` for non-WAL-friendly FS. Don't run multiple pods against the same `~/.zeroshot` volume.

## Fixed Bugs (Reference)

**Template Agent CWD Injection (2026-01-03):** `--ship` worktree created but template agents ran in main dir. Fix: cwd injection in `_opAddAgents()` + resume path. Test: `tests/worktree-cwd-injection.test.js`

**PR Mode Completion Hang (2026-01-15):** PR-mode clusters hung after PR creation — no `CLUSTER_COMPLETE` published. Fix: `onComplete` hook in `src/agents/git-pusher-agent.json`. Test: `tests/integration/orchestrator-flow.test.js`

**Analyst Context Overflow (fork):** 5–8 subagents spawned in one message exceed 200K context before auto-compaction. Fix: Batch spawns (max 4/message), `AUTOCOMPACT_PCT_OVERRIDE` by level (90/87/84%), output density guidance. Files: `agent-task-executor.js:700`, base templates.

**Validator Infinite Loop on 0 Findings (fork):** `reviews.length > 0 &&` guard → `approved: false` on clean code (`[].every()` is vacuously true). Fix: Removed guard from all 10 transforms across 3 templates. Also: persist `paramOverrides` on resume. Files: base templates, `orchestrator.js`.

## Platform Extensions (Fork)

### Parameterised Templates

`TemplateResolver` substitutes `{{param}}` placeholders in base templates. Conditional agents (`"condition"` field) included only if param is truthy. Unresolved placeholders fail hard. Pure placeholder values preserve JS types (numbers/booleans remain types).

Implementation: `src/template-resolver.js`

### `execute_system_command` Trigger

Runs a shell command on trigger fire. Message content piped to stdin as JSON. Env includes `CLUSTER_ID` and `ZEROSHOT_ROOT`. Options: `stopClusterAfter`, `timeout`, `onSuccess`/`onFailure` topic routing (idle on failure when configured, enabling re-trigger loops). Output truncated to 5000 chars. `contentFromOutput: true` uses script stdout as published message content.

Implementation: `src/agent/agent-lifecycle.js:316`

### Subagent Tracking

Live StatusFooter display of Claude Code subagents (Task tool). `buildSpawnEnv()` sets `ZEROSHOT_TRACK_SUBAGENTS=1` + events file path → Claude hook writes JSONL start/stop events → `SubagentTracker` polls with offset tracking → `StatusFooter` renders tree rows.

**Claude provider only.** Both the installer and the env wiring live inside `if (providerName === 'claude')` — codex/gemini/opencode agents emit no events.

The producer hook ships in `cluster-hooks/track-subagents.py` and is installed by `ensureSubagentTrackingHook()`, alongside `ensureAskUserQuestionHook()` / `ensureDangerousGitHook()`. It differs from those in registering on two lifecycle events (`SubagentStart` + `SubagentStop`) rather than one `PreToolUse` matcher — both ends are required, since start-only leaves subagents active forever and stop-only never shows them — and in registering nothing when its script is missing, rather than pointing Claude at a file that will never exist.

🔴 **Hook scripts must be resolved from `cluster-hooks/`, never the `hooks/` symlink.** `npm pack` drops symlinks, so `hooks/` does not exist in an installed package and every hook silently fails to install.

Implementation: `cluster-hooks/track-subagents.py` (producer), `src/agent/agent-task-executor.js` (`ensureSubagentTrackingHook`, `buildSpawnEnv` env wiring), `src/subagent-tracker.js` (consumer), `src/status-footer.js` (render). Test: `tests/unit/subagent-tracking-hook.test.js`

### Quality Gate

Zero-cost checks (lint, typecheck, tests) between worker completion and validator start. Reads `.zeroshot-quality` from project root. Templates: `worker-validator`, `full-workflow`, `code-review-workflow` (all accept `quality_gate` param, default `true`).

**Code review variant:** quality gate runs on `ISSUE_OPENED` (before analysis). Failure aborts via `quality-gate-stopper` — no LLM tokens spent.

**Setup:** Auto-detected on first `zeroshot run` (heuristic with LLM fallback, stored in `~/.zeroshot/projects/`). **Skip:** `--skip-quality-gate` flag.

## CI & Branch Protection (Fork)

**No branch protection, by choice.** No rulesets, and `main` has no legacy protection — nothing server-side requires PRs, status checks, or up-to-date branches. (An empty `main-protection` ruleset was deleted on 2026-08-03; "active" with zero rules only ever implied protection that did not exist.) Auto-merge and squash-merge are enabled at the repo level. CI runs on pushes to `main` and on PRs, but is not a required check and cannot gate either.

**Audit exclusion:** `.audit-ignore` (gitignored) lists known-unfixable GHSA IDs → pre-push hook syncs to `AUDIT_IGNORE` GitHub Actions secret → CI filters `npm audit --json` output, failing only on new advisories.

**Staleness check:** pre-push blocks if `# Last reviewed:` date is >30 days old. Resolution: run `npm audit --omit=dev`, remove fixed advisories, update date.

| File                         | Purpose                                                  |
| ---------------------------- | -------------------------------------------------------- |
| `.audit-ignore`              | GHSA exclusion list (gitignored, single source of truth) |
| `.github/workflows/ci.yml`   | Reads `AUDIT_IGNORE` secret, filters audit JSON          |
| `.husky/pre-push` (PART 4/5) | Staleness check + secret sync                            |

## CLAUDE.md Writing Rules

- **Scope:** Narrowest possible. Module-specific → nested CLAUDE.md. Cross-cutting → root.
- **Priority:** Critical gotchas > routing tables > anti-patterns with WHY > commands/troubleshooting
- **Delete:** Tutorial content, directory trees, interface definitions, parent duplicates
- **Format:** Tables over prose. `ALWAYS`/`NEVER`/`CRITICAL` for rules. ❌/✅ examples with WHY.
