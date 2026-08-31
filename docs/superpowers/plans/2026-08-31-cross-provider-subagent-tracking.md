# Cross-Provider Subagent Tracking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Display direct Claude Code and Codex subagents in Zeroshot's status footer for normal and isolated cluster-agent runs.

**Architecture:** Claude lifecycle hooks and a Codex JSONL log observer produce the same per-parent event records. `SubagentTracker` consumes complete JSONL records and maintains active child state. Tracking is best-effort telemetry and never changes provider execution results.

**Tech Stack:** Node.js CommonJS, Python 3 hook, Mocha/Chai, Docker isolation tests.

**Spec:** Approved plan in the 2026-08-31 conversation; this document is its executable form.

## Global Constraints

- Track direct children only; nested Codex spawns must not appear under the root parent.
- Do not change the public CLI, provider parser contract, or watcher filtering behavior.
- Direct task runs using `--silent-json-output` are outside the MVP.
- Missing, malformed, late, or unavailable telemetry must never affect task success, parsing, retries, or provider selection.
- Preserve the unrelated untracked `docs/2026-08-31-upstream-v6.46-reconciliation-report.md` file.

---

### Task 1: Shared event contract and reliable consumer

**Files:**

- Create: `src/subagent-events.js`
- Modify: `src/subagent-tracker.js`
- Test: `tests/subagent-tracker.test.js`
- Test: `tests/unit/subagent-events.test.js`

**Interfaces:**

- Produces `getSubagentEventsDir(clusterId)`, `getSubagentEventsFile(clusterId, parentAgentId)`, and `appendSubagentEvent(filePath, event)`.
- Event records remain `{event:'start'|'stop', agent_id, description?, agent_type?, ts}`.

- [ ] Write tests proving literal paths, valid append behavior, split-record retention across polls, active-pair deduplication, and `start -> stop -> start` support.
- [ ] Run the focused tests and confirm failures are caused by missing behavior.
- [ ] Implement the helpers and advance tracker offsets only through the final complete newline.
- [ ] Re-run the focused tests and confirm they pass.
- [ ] Commit only Task 1 files.

### Task 2: Correct Claude descriptions and isolated hook delivery

**Files:**

- Modify: `cluster-hooks/track-subagents.py`
- Modify: `src/isolation-manager.js`
- Modify: `src/agent/agent-task-executor.js`
- Test: `tests/unit/subagent-tracking-hook.test.js`
- Test: `tests/unit/docker-config.test.js`
- Test: `tests/unit/isolated-mode-output-capture.test.js`

**Interfaces:**

- Python hook keeps the shared event record shape.
- Isolated Claude runs receive `ZEROSHOT_TRACK_SUBAGENTS=1` and a writable per-parent event-file path mounted under `/tmp/zeroshot-subagents/<clusterId>/`.

- [ ] Write tests proving a single transcript candidate supplies its description and parallel candidates fall back to `agent_type`.
- [ ] Write hermetic tests proving both lifecycle hooks are installed in the container config and the writable mount/environment reach isolated Claude execution.
- [ ] Run focused tests and confirm the expected failures.
- [ ] Implement minimal hook correlation fallback and isolated mount/environment wiring; create each host event file before its agent starts.
- [ ] Re-run focused tests and confirm they pass.
- [ ] Commit only Task 2 files.

### Task 3: Codex observer and executor lifecycle integration

**Files:**

- Create: `src/codex-subagent-observer.js`
- Modify: `src/agent/agent-task-executor.js`
- Test: `tests/unit/codex-subagent-observer.test.js`
- Test: `tests/unit/isolated-mode-output-capture.test.js`
- Test: `tests/context-replay-policy.test.js`

**Interfaces:**

- Produces `createCodexSubagentObserver({ parentAgentId, eventsFile, now? })`, returning `{ observeLine(line), finishParent() }`.
- `observeLine` captures `thread.started`, accepts only completed root-thread `spawn_agent` calls with receiver IDs, and stops only known children on terminal states or successful `close_agent`.
- `finishParent` is idempotent, finalizes before cleanup emission, stops all known active children, and rejects all later replay.

- [ ] Add literal Codex fixtures covering root and nested spawns, multiple receivers, malformed records, failed calls, terminal states, successful close, unknown IDs, replay, and finalization.
- [ ] Add executor tests proving default `json` and `stream-json` records reach the observer in normal and isolated followers and that all settle paths finalize after the last drain.
- [ ] Run focused tests and confirm expected failures.
- [ ] Implement the observer and wire one instance into each Codex parent log follower before broadcast handling.
- [ ] Route success, failure, stale/missing task, polling exhaustion, kill, timeout, log-path/status/parsing errors, resolve, and reject through the same guarded finalization.
- [ ] Re-run focused tests and confirm they pass.
- [ ] Commit only Task 3 files.

### Task 4: Isolation proof, reliability documentation, and verification

**Files:**

- Modify: `tests/integration/isolation-manager.test.js`
- Create: `scripts/smoke-codex-subagents.js`
- Modify: relevant user-facing tracking documentation discovered during implementation.

**Interfaces:**

- Opt-in smoke test reports the installed Codex version and whether successful collaboration telemetry was observed; absence is a reported outcome, not a failure.

- [ ] Add a Docker-enabled test that appends inside the container and verifies the host reads the record.
- [ ] Add the non-gating real-CLI smoke script and document its invocation.
- [ ] Document that explicit `--silent-json-output` direct task runs cannot provide observer tracking and that some Codex versions emit zero collaboration telemetry.
- [ ] Run focused tests, `npm test`, `npm run typecheck`, and `npm run lint`.
- [ ] Run `npm run test:slow` when Docker is available; otherwise record the Docker availability result.
- [ ] Run `npm run check:agent-cli-provider:ci` only if adapter or parser files changed.
- [ ] Commit only Task 4 files.
