---
status: accepted
---

# Adopt upstream identity without publishing the internal fork

Treat this repository as an internal-use source fork of `the-open-engine/zeroshot`, not as a separately distributed Covibes product. Reconciliation should adopt upstream’s `@the-open-engine/zeroshot` package identity, repository references, update topology, and public documentation baseline; the former `covibes/zeroshot` GitHub URL is only a redirect, and `@covibes/zeroshot` on npm remains upstream’s legacy migration bridge.

Do not publish this fork to npm, PyPI, crates.io, GHCR, GitHub Releases, or any other public registry, and do not activate release credentials or trusted-publisher bindings. Preserve the existing `zeroshot` command and `~/.zeroshot`/`.zeroshot` state locations so internal use does not require a state migration. Upstream release workflows and package sources may be retained for alignment and dry-run verification, but every publication path must remain disabled.
