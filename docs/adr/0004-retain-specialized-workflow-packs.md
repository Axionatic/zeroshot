---
status: accepted
---

# Retain all three specialized workflow packs

Retain the fork’s code-review, documentation-review, and document-drafting workflow families as important internal product enhancements. Reconcile each family independently against the current upstream runtime, preserving its intended contracts and specialist roles rather than mechanically replaying its historical implementation.

The packs remain opt-in: upstream’s generic executor/verifier workflows stay as the default, while explicit configuration and the existing `zs` helpers select the specialized conductors or specialists. Each family must have its own schema, topology, zero-result, retry, iteration-bound, output, and failure-path verification before it is considered restored.
