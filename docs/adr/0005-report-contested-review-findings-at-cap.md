---
status: accepted
---

# Report contested review findings at the iteration cap

When the code-review or documentation-review pack reaches its configured analyst-iteration limit, always synthesize a truthful final report rather than suppressing output or implying approval. Classify findings as confirmed, contested, or withdrawn; retain validator notes and severity adjustments; and label the overall result `NOT_READY` whenever any finding remains contested.

Reaching the cap is a normal bounded termination condition, not evidence that disputed findings became valid or that the reviewed artifact is ready. The workflow must emit exactly one terminal result and preserve enough evidence for a human to understand which conclusions were independently confirmed and which remain unresolved.
