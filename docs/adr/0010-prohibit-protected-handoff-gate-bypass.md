---
status: accepted
---

# Prohibit protected-handoff quality-gate bypass

Required quality gates for a protected PR or ship handoff have no bypass. A workflow may still terminate with its report, draft, or blocked-state result when required evidence is missing, stale, unavailable, or failing, but the git-pusher enforcement boundary must not mutate or hand off the repository. Pre-validation options such as `--skip-quality-gate` apply only to the fork's earlier workflow machinery and never disable upstream `requiredQualityGates` enforcement.
