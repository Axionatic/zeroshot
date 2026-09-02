---
status: accepted
---

# Retain workflow batching and retire autocompact injection

Retain explicit bounded subagent batching in the code-review, documentation-review, and document-drafting packs, but do not reintroduce automatic `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE` injection. Claude Code now exposes an owned configuration surface for the threshold, and the current upstream runtime owns provider context budgeting; preserve any value explicitly supplied by the user instead.

For the v6.46 reconciliation, keep a conservative fixed batch limit while porting and verifying the packs. Adaptive machine-aware concurrency is a deferred enhancement, not a migration prerequisite. Its later design may use available machine parallelism with four execution threads reserved and a floor of two concurrent workers, but it must also impose explicit provider, harness, memory, and configured maxima before replacing the fixed limit.
