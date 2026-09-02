---
status: accepted
---

# Defer calm prompt language until after reconciliation

Adopt upstream's current core prompts during the v6.46 reconciliation rather than replaying the fork's wording patches. Preserve calm, non-escalatory language as an explicit post-reconciliation design objective, informed by Anthropic's research linking desperation-related representations with increased reward-hacking and calm-related steering with reduced reward-hacking; revisit it as a focused feature branch with behavioral tests after the upstream baseline is stable.

After reconciliation, restore minified JSON at prompt-assembly boundaries as a separate bounded formatting change, with serialization and prompt-rendering tests. Do not restore abbreviated timestamps. Defer terse and calm prompt wording to a later behavioral evaluation rather than coupling it to JSON minification.
