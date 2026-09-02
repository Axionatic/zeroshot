---
status: accepted
---

# Retain approved preflight quality gates

Retain the Node-side quality-gate discovery machinery as an optional preflight stage that runs before a Zeroshot cluster contacts any model. A newly discovered or changed command requires one-time interactive confirmation; once approved for that repository, the cached command runs automatically on later invocations so an unhealthy baseline can fail quickly and cheaply.

In a non-interactive run, Zeroshot must run an approved cached command when one exists. If none exists, a narrow explicit flag may allow the missing gate rather than attempting discovery or failing for lack of confirmation. Retain the existing `--skip-quality-gate` compatibility option as the broader opt-out from the fork's pre-validation machinery, but neither preflight option may affect protected-handoff gates. Deterministic discovery remains available, while LLM-assisted discovery is suggestion-only and never authorizes execution; safer unattended discovery is deferred.

Preflight establishes only that the starting repository is healthy. Code-review preflight must occur before analysis; implementation workflows also retain their pre-validation check after implementation and before validation. A preflight result is distinct from protected-handoff quality gates and cannot serve as final proof after the run has changed the working tree. Keep this machinery in the active Node product rather than depending on upstream's external `cmdproof` binary while the native/Rust product remains latent.
