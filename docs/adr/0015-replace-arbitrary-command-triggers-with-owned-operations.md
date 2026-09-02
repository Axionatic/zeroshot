---
status: accepted
---

# Replace arbitrary command triggers with owned operations

Do not restore the fork's generic `execute_system_command` template action. Its quality-check uses move to the dedicated approved preflight and protected-handoff gate boundaries, while review-report generation, document reconstruction, and revision-context construction become typed, in-process runtime operations with explicit lifecycle events and bounded failures.

Templates therefore cannot introduce shell commands, subprocesses, or environment-dependent routing. Preserve the deterministic workflow outcomes, not the historical command-execution mechanism.
