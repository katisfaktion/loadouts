---
"loadouts": minor
---

Create readable, schema-linked local drafts with `create`, including before project initialization, and validate them offline. Publish version-1 editor schemas for loadout YAML and the project manifest under `schemas/v1/`; generated YAML references the matching CLI release tag on GitHub.

Make the agent workflow discoverable from top-level help. Exploration defaults to focused direct selections in the project manifest; composition YAML is reserved for reusable bundles rather than routine project wrappers. Explain the equipment-loadout analogy and agent-first workflow in the public README, with a working catalog example.

Inspect project and user setup metadata without exposing MCP configuration values. The bundled exploration skill discovers the CLI through help, inspects suitable catalog entries and their selected active include closure before searching remaining capability gaps, and proposes small, reusable loadouts selected directly or composed through additive includes. It reviews active conventions and routing against project instructions with source attribution and unresolved user decisions, without claiming structural validation proves semantic compatibility. It reuses shared entries, uses `create` and `validate` for focused adaptations and new drafts, and records upstream evidence for agent-led comparisons and contribution PRs. Applying drafts, testing them on real issues and publishing remain separate decisions. Approved selection changes use CLI commands rather than handwritten manifests or locks.

Preview contributions from verified local loadouts with `publish`; explicit `--yes` pushes a contribution branch and opens a catalog pull request.

Support additive includes with explicit group choices, graph conflict provenance and dependency-aware lifecycle operations. Keep direct roots in the manifest and the applied graph in lock format 1. Publish portable compositions with dependencies contributed first, retaining includes rather than copying upstream entries.

Support recursive item choices and conditional member includes using slash-separated choice paths. Apply defaults and resolve dependencies only in active branches, retain shared artifacts on branch changes, and clear deselected descendant requests when changing a direct parent choice. Exploration distinguishes reusable conditional alternatives from cohesive nested options. Publication checks inactive declarations for portable sources while identifying only the active choices actually verified.
