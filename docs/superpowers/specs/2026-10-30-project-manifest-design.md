# Project manifest and installation design

## Intent and approval

Kai approved proceeding on 2026-10-30: a committed manifest declares selected loadouts and explicit sources; install resolves a lock and sets up the project. Local definitions are committed in `.loadouts/catalog/`. Keep generated, ignored `.loadouts/codex-home/`. Apply edited selected local definitions on install; leave unselected drafts inactive. Prefer individual skills, choosing native plugins only for justified extra capabilities such as hooks. Reproducibility is best effort for components.

## Approaches

The previous lock-only selection model was considered first. It cannot express desired configuration independently of a machine's installation record. Kai chose the manifest/lock approach. Automatic local shadowing was replaced by explicit sources, avoiding accidental source switches. An external Codex cache was considered and rejected: per-project home remains inside the project.

## Files and syntax

`loadouts.json` is the user-editable source of truth:

```json
{
  "harnesses": ["claude-code", "codex"],
  "loadouts": {
    "base": {"source": "github:katisfaktion/agent-loadouts/base"},
    "backend": {"source": "file:./.loadouts/catalog/backend.yml", "choices": {"runtime": ["bun"]}}
  }
}
```

Builder decisions: use optional `choices` with existing group-to-array syntax; omitted groups use defaults on first resolution and retain locked selections thereafter. A source's name must match its manifest key and YAML name. No aliases, dependency graph, additional runtime dependencies or provider framework.

- `github:owner/repo/name[@ref]` reads `loadouts/name.yml`. Omitted ref resolves highest stable version tag, falling back to HEAD, as today. Install retains matching locked commits. Update resolves newer versions within the declared ref (explicit tags remain selected).
- `file:./.loadouts/catalog/name.yml` reads a project-relative YAML file, using the existing loadout schema. Require local definitions inside this directory, reject traversal and symlinks escaping it. Missing files fail with a repair hint, never fall back remotely.
- Compatibility with existing absolute local Git catalogs and offline fixtures: `file:/absolute/catalog#name[@ref]` denotes a Git catalog and retains Git resolution. It is explicitly machine-specific; prefer GitHub sources for sharing. This is a compatibility form, not a new provider architecture.
- Manifest validates unknown fields, harness names, duplicate harnesses, choices shape, names, sources, and source/name agreement. Commit a separate editor schema for this manifest alongside the existing YAML schema. Do not claim an unpublished HTTPS schema URL is available.

`loadouts.lock.json` remains committed. Version 3 adds `resolved[name] = {source, catalog?}`; `local` retains exact applied local YAML snapshots, `loadouts` retains resolved choices. `catalog` remains a legacy/browsing convenience for the first shared resolution; per-entry `resolved` is authoritative. Existing installed/pending/incomplete records remain ownership and recovery evidence, never proof of files existing on this machine. Read versions 1 and 2 for migration. Artifact key strings remain unchanged.

`.loadouts/catalog/*.yml`, manifest, lock and generated shared harness settings are committed. Codex home alone is ignored. Retain `.loadouts/.gitkeep` for portable MCP npm prefixes, and ensure catalog exists on init/create/install. No changes to users' global config/login state.

## Commands

- `init`: creates an empty manifest and local catalog; no installation or lock required. Existing manifest is not overwritten. Explicit conflicting harness flags fail. Legacy projects migrate using existing harnesses without requiring machine defaults.
- `install`: requires a manifest or legacy lock; migrates legacy projects, resolves new/changed sources, applies current selected file contents, reuses unchanged Git commits, validates everything before installers/config mutations, and reconciles actual installation. Creates/updates lock. Repeated successful installs are idempotent. Repair missing skills and per-harness links, Claude declarations, Codex config/plugins/auth link. Claude plugin activation continues via native project settings (not a new global CLI installer).
- `add <name|source>...`: a bare selected name retains its declared source; a new bare name means the configured shared catalog, even if a same-name local file exists. Explicit file/GitHub arguments select that source. `--catalog` remains a convenience for shared names. `--with` edits manifest choices. Resolve and validate before persisting changes; persist valid intended manifest immediately before external side effects, retain partial progress in lock on failure.
- `remove/switch/enable/disable/harness`: edit manifest and reconcile. Removal must work even when the removed definition is missing/invalid. Unrelated local edits remain unapplied for these convenience commands; explicit install/add of that local definition applies edits. This preserves existing recovery workflows.
- `update`: refresh shared resolutions, preserve explicit choices and local applied snapshots; use install to apply local edits. Errors identify removed chosen members. No arbitrary component version promises.
- `create/explore`: write schema-linked drafts under `.loadouts/catalog/`; do not select/install drafts. Exploration uses stack-specific `npx skills find` and explains every plugin's added value.
- `list/show/status/doctor/inspect/publish/launch`: understand manifests, explicit sources, new paths, and pending installation. Show selected source instead of implicit shadowing. Doctor diagnoses manifest/lock drift and duplicates without changing source, and tells users to install. Publish only a selected, successfully applied local file with current contents and no pending manifest change; no automatic source transition after a PR.

## Migration and safety

`init` or `install` migrates lock-only projects. Move legacy `.loadouts/*.yml` drafts into catalog, including unselected drafts. Preflight all paths and refuse existing different destination contents or unsafe links; never overwrite. Matching duplicate contents can be consolidated. Preserve applied snapshots separately from edited drafts and preserve selections, partial names and pending records. Manifest records explicit shared sources or migrated file paths. Existing local Git catalogs keep pinned revisions through the compatibility form. Rerunning migration is safe, including after interrupted file moves. Other commands give a clear init/install hint for legacy projects where needed.

Builder rulings: legacy source refs are omitted while retaining the exact resolved commit, preserving the old update-to-latest behavior; users can add an explicit ref afterward. Convenience commands apply current manifest intent while preserving unrelated local YAML drafts. Reject `@` and `#` in compatibility Git catalog paths. Skill presence means canonical SKILL.md and (for Claude) a readable harness SKILL.md link/copy. Create structural catalog directories before MCP preflight because npm requires the prefix directory.

Initial install must not write a successful lock before checks pass. Failure during installers records partial ownership and incomplete state. Retain previous definitions needed for removal and MCP comparison. Never treat a deleted file as authorization to switch sources. Validate malformed lock/manifest files rather than silently resetting.

## Verification

Offline fixture catalogs, fake skills/native Codex, temp HOME only. Test manifest validation and source pins, direct manifest install, clone recovery without machine cache, missing per-harness links, idempotency, local edits, explicit shared/local collisions, migration conflicts and edited drafts, partial retry/removal, hand-edited settings preservation, multi-catalog resolution, update ref semantics, read-only diagnostics and publish gating. Full `bun test` before each commit; native build and compiled fixture workflow at completion. Independent final review. No push, publication, real project migration, or real HOME writes.
