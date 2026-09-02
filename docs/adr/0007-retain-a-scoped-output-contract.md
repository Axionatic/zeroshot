---
status: accepted
---

# Retain a scoped deterministic output contract

Retain `zeroshot run --output <file>` for the code-review, documentation-review, and document-drafting packs because internal scripts use deterministic artifact paths. Reject the option for workflows that do not declare exactly one Markdown artifact rather than accepting it ambiguously.

Resolve relative destinations from the original invocation directory before daemon or worktree changes, append `.md` when no extension is supplied, create missing parent directories, and persist the resolved destination across foreground, daemon, and resumed execution. Successful completion atomically replaces the destination and reports its resolved path; failed execution must leave any previous file untouched. The contract applies only to the established Node product.
