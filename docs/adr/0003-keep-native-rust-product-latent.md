---
status: accepted
---

# Keep the native Rust product latent

Continue using the established Node `zeroshot` product for internal workflows. The installed executable resolves through `/home/mark/.npm-global/bin/zeroshot` to this checkout’s Node CLI, and the shell’s `zs` helpers all delegate to that command; upstream currently describes the Rust-native, OECP, and cluster-protocol work as experimental.

Reconciliation must import, build, and test the upstream Rust/native, hosted-target, Python, and protocol sources so the fork does not drift, but it must not install the `zeroshot-rust` CLI for routine use, expose a native target, configure hosted endpoints, or fork the `openengine.cluster/v1` protocol. Reconsider integration when upstream explicitly declares the native product stable and supported, rather than coupling the decision to a guessed release number.
