---
"loadouts": minor
---

Create readable, schema-linked local drafts with `create`, including before project initialization, and validate them offline. Publish version-1 editor schemas for loadout YAML and the project manifest under `schemas/v1/`; generated YAML references the matching CLI release tag on GitHub.

Inspect project and user setup metadata without exposing MCP configuration values. The bundled exploration skill discovers the CLI through help, searches for stack-specific skills, and proposes small, reusable loadouts composed through the project manifest. It reuses shared entries, uses `create` and `validate` for focused adaptations and new drafts, and records upstream evidence for agent-led comparisons and contribution PRs. Applying drafts, testing them on real issues and publishing remain separate decisions. Approved selection changes use CLI commands rather than handwritten manifests or locks.

Preview contributions from verified local loadouts with `publish`; explicit `--yes` pushes a contribution branch and opens a catalog pull request.
