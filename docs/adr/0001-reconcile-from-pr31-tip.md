---
status: accepted
---

# Reconcile from the PR 31 merge tip

Treat `main` at `1bc71f6881da82de9f28dc5c78107a9151ed24c0` as the authoritative fork tip for the upstream v6.46 reconciliation. PR 31 contained the original four ship-hook commits plus cross-provider telemetry and isolation/lifecycle hardening, then GitHub squash-merged that series; using the older `6cc79d6` tip would omit already-landed work, while merging both tips would duplicate overlapping changes.

The reconciliation report and customization manifest must therefore be refreshed against `1bc71f6`. Preserve the PR's logical commit history as provenance, but do not add `6cc79d6` as another integration parent. With the currently pinned upstream baseline, the structural count becomes `0 behind, 79 + N ahead`, where `N` is the reviewed adaptation and review-fix commit count.
