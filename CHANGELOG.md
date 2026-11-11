# loadouts

## 0.2.0

### Minor Changes

- ac2417a: Install and change project loadouts with `--json`.
  
  - `loadouts list --sources --json` lists local and shared sources. Inspect one with `loadouts show <source> --json`.
  - When `add --json` would replace a source, it reports both sources on stderr. Rerun with `--yes` to approve.
- ac2417a: Run `loadouts agents` to read the offline guides for exploration, installation, troubleshooting and publishing.
  
  - `loadouts explore` moved to `loadouts agents explore`.
  - `loadouts setup` moved to `loadouts global configure`. Run it once to refresh your agent instructions.
  - `loadouts doctor` now checks machine settings and guide imports outside a project.
  - Help groups commands by task and points invalid requests to the relevant page.

### Patch Changes

- 144edb9: Slow installs show the current step and elapsed time. For skills, they also show the source and target agent.
- 144edb9: New projects and v2 skills lockfiles use `skills@1.8.0`. Existing v1 locks use `skills@1.7.6` to preserve their hashes.
  
  - GitHub skill sources now accept mixed-case repository names.
  - An empty hash in a migrated lock affects only that skill. Restore its verified contents or accept a new hash with `loadouts update`.
- 144edb9: `loadouts init` and `loadouts install` remove the obsolete `.loadouts/codex-home/` ignore rule.
- 5d0e873: Run `npx agent-loadouts help` or install with `npm install -g agent-loadouts`. It ships the same binary as `@katisfaktion/loadouts`.

## 0.1.0

### Minor Changes

- 7e8cd5d: Create readable, schema-linked local drafts with `create`, including before project initialization, and validate them offline. Publish version-1 editor schemas for loadout YAML and the project manifest under `schemas/v1/`; generated YAML references the matching CLI release tag on GitHub.
  
  Make the agent workflow discoverable from top-level help. Exploration defaults to focused direct selections in the project manifest; composition YAML is reserved for reusable bundles rather than routine project wrappers. Explain the equipment-loadout analogy and agent-first workflow in the public README, with a working catalog example.
  
  Inspect project and user setup metadata without exposing MCP configuration values. The bundled exploration skill discovers the CLI through help, inspects suitable catalog entries and their selected active include closure before searching remaining capability gaps, and proposes small, reusable loadouts selected directly or composed through additive includes. It reviews active conventions and routing against project instructions with source attribution and unresolved user decisions, without claiming structural validation proves semantic compatibility. It reuses shared entries, uses `create` and `validate` for focused adaptations and new drafts, and records upstream evidence for agent-led comparisons and contribution PRs. Applying drafts, testing them on real issues and publishing remain separate decisions. Approved selection changes use CLI commands rather than handwritten manifests or locks.
  
  Preview contributions from verified local loadouts with `publish`; explicit `--yes` pushes a contribution branch and opens a catalog pull request.
  
  Support additive includes with explicit group choices, graph conflict provenance and dependency-aware lifecycle operations. Keep direct roots in the manifest and the applied graph in lock format 1. Publish portable compositions with dependencies contributed first, retaining includes rather than copying upstream entries.
  
  Support recursive item choices and conditional member includes using slash-separated choice paths. Apply defaults and resolve dependencies only in active branches, retain shared artifacts on branch changes, and clear deselected descendant requests when changing a direct parent choice. Exploration distinguishes reusable conditional alternatives from cohesive nested options. Publication checks inactive declarations for portable sources while identifying only the active choices actually verified.
- 7e8cd5d: Provide composable command parsing with Optique and Bun-inspired grouped help, terminal colors and consistent command summaries. Preserve readable plain output for redirected streams and machine-readable JSON for inspection and diagnostics. Report actionable errors and stable exit codes; source replacement prompts default to no, and noninteractive replacements require explicit `--yes`.
- 7e8cd5d: Apply Claude Code and Codex setups through their native project configuration, including ordinary launches and Codex Desktop. Manage selected skills, plugins, MCP servers, conventions and routing guidance while preserving personal configuration, plugin policy and hook trust. The `claude` and `codex` commands add a read-only installation check before forwarding the launch.
  
  Integrate an existing global codebase-memory installation: import project skills, hooks and agent profiles, and index the selected project without installing or reconfiguring the global service. Explicit global cleanup remains separate from project installation.
- 7e8cd5d: Distribute the CLI on npm as `@katisfaktion/loadouts`, with exact-version optional packages containing native binaries for Linux (glibc) and macOS x64/arm64 and Windows x64. Installing with npm requires Node.js but not Bun, and does not run installation scripts or download binaries outside npm.
  
  Extend the Changesets release workflow to publish the platform packages before the CLI and GitHub release, with provenance and support for npm trusted publishing. Release retries skip already-published versions and stop on registry errors. Document installation and maintainer authentication setup.
  
  Include discovery keywords on the CLI package and author information, project links and the MIT license in every npm distribution.
- 7e8cd5d: Declare reusable agent setups in loadout YAML and select them in a project `loadouts.json` manifest. Combine explicit GitHub catalog sources with committed local drafts under `.loadouts/catalog/`, choose alternatives with `switch`, `enable` and `disable`, and retain applied source resolutions and ownership in `loadouts.lock.json`.
  
  Use `install` to restore the declared setup and apply local edits, and `update` to refresh shared sources within their declared refs. Same-name source replacements show the old and new source and require confirmation; unrelated settings and modified owned files are protected. `status` and `doctor` explain missing components, pending changes, collisions and recoverable installation failures.
- 7e8cd5d: Restore missing Git skills through the native frozen `skills-lock.json`, verify locked hashes and repair harness links. Commit both skill and loadout locks; explicitly update to accept new selected skill contents. Reproducibility remains best effort when upstream historical content or plugin versions are unavailable.
  
  Select `packageSkills` from installed project dependencies, including workspace and pnpm links. `install` synchronizes companions after dependency upgrades without installing application libraries, follows package-level selections and exclusions, and records observed versions and ownership. Handle Git-to-package skill migration and repeated installs without manual cleanup.
  
  Run skills and npx MCP commands with npm isolation compatible with pnpm-only projects. Generated MCP configuration uses a portable project-relative prefix.
