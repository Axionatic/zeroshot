---
status: accepted
---

# Limit subagent telemetry to foreground launches

Enable Claude and Codex subagent lifecycle collection only when Zeroshot launches a run with a supported foreground TTY footer. Detached, daemon-only, silent, worker, and later-attachment paths do not install provider tracking hooks or create telemetry files, and `zeroshot logs -f` does not reconstruct child activity for a run launched without telemetry.

Apply this activation decision once, before provider launch, and pass the resulting capability to either provider adapter. This replaces the fork's broader Claude behavior, which currently installs and activates tracking for every orchestrated Claude agent even when no footer consumes the events, while keeping telemetry observational and minimizing configuration, storage, cleanup, Docker, and cross-UID surface area.
