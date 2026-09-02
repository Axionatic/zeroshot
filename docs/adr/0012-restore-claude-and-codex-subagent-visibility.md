---
status: accepted
---

# Restore Claude and Codex subagent visibility

The post-v6.46 telemetry feature branch must restore foreground terminal visibility for direct child agents spawned by both Claude and Codex. Both providers feed one bounded, provider-neutral lifecycle sink and the existing TTY footer, while telemetry remains best-effort and cannot affect provider execution, session ownership, retries, output, or terminal truth.

Use each provider's supported `SubagentStart` and `SubagentStop` hooks. For Codex, consume the documented `agent_id`, `agent_type`, and turn/session fields rather than restoring PR 31's parser for incidental `--json` collaboration events; require a hook-capable Codex version and degrade to no Codex child rows when hooks are unavailable or disabled. Inject only Zeroshot-owned per-run hook configuration, never mutate user configuration, and do not bypass trust for unrelated hooks.

The orchestrating agent should provide a terse title as part of every assignment (`description` for Claude and `task_name` for Codex). Consume that title only when supported hook events can correlate it reliably with the child ID; never inspect provider transcripts to infer it. When correlation is unavailable—particularly for concurrently launched Claude agents—show the provider's agent type instead.
