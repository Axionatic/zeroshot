---
status: accepted
---

# Emit a labelled draft at the revision cap

When the document-drafting pack reaches its configured revision limit without unanimous validator approval, emit the best reconstructed document rather than discarding it or presenting it as approved. Mark termination as `MAX_ITERATIONS` and append the unresolved sections with each validator verdict and reason.

The first iteration owns the complete document and later iterations supply explicit deltas, so the final artifact must be deterministically reconstructed from that history. Emit exactly one terminal result and make the incomplete validation state conspicuous while preserving the useful draft for human revision.
