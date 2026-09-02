---
status: accepted
---

# Restore subagent visibility after upstream reconciliation

Complete and verify the v6.46 reconciliation without carrying or redesigning the fork's legacy telemetry implementation inside the integration merge. The reconciled working tree may temporarily lack terminal subagent visibility, while PR 31 and its predecessor remain available in repository ancestry as behavioral and test evidence.

After the reconciled baseline is accepted, create a dedicated feature branch from it and restore the selected subagent-visibility behavior using upstream's private per-run configuration overlays and lifecycle boundaries. This deliberately separates upstream adoption from telemetry redesign, making both changes independently reviewable and avoiding retention of the legacy global Claude-configuration machinery as disabled code.
