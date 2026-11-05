# Project Manifest Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Declare explicit loadout sources in a committed project manifest and install or restore the setup, migrating existing projects safely.

**Architecture:** Keep the artifact reconciler and native installers. Add a manifest/source module for validation, resolution and legacy migration, extend the lock with per-entry resolutions, then route selection commands through that model. Restore actual missing skills without discarding ownership records.

**Tech Stack:** Bun 1.3.14, TypeScript, node:util parseArgs, Bun.YAML/Bun.TOML, no runtime additions.

**Spec:** docs/superpowers/specs/2026-10-30-project-manifest-design.md

## Global Constraints

- English throughout; temp HOME, local fixture Git catalogs, fake skills/Codex; no network or real-home/project changes.
- Keep `.loadouts/codex-home/`, auth symlink and artifact key strings unchanged.
- Manifest and `.loadouts/catalog/*.yml` are committed. Version-3 lock retains version-1/2 read support and partial recovery.
- Explicit sources, no silent local fallback; best-effort component reproducibility.
- Full `bun test` before every commit. No publishing or pushing.

## Review Focus

1. Interrupted legacy migration and conflicting destination files must not lose drafts or applied snapshots (Task 2).
2. Fresh checkout has ownership records but missing skill files/links/native plugin home (Task 2).
3. File-source traversal/symlinks and malformed source/key combinations fail before installation (Task 1).
4. Failed source changes retain old artifact ownership and pending install state for retry/removal (Task 2).
5. Manifest drift, explicit local/shared duplicates and partial reconciliation must block misleading publication/launch (Task 3).

### Task 1: Manifest, source resolution and version-3 lock

**Files:** Create `src/manifest.ts`, `schemas/manifest.schema.json`, `tests/manifest.test.ts`; modify `src/lock.ts`, `src/paths.ts`, `src/sync.ts` (loaded definitions only).

**Interfaces:**
- `Manifest { harnesses: Harness[]; loadouts: Record<string, {source: string; choices?: Choices}> }`.
- `readManifest(project): Manifest`, `writeManifest(project, manifest): boolean`.
- `parseSource(source): {kind: "file"; name: string; path: string} | {kind: "catalog"; name: string; repo: string; ref?: string}`.
- `catalogSource(repo, name, ref?): string` and `fileSource(name): string` format sources.
- `readSourceFile(project, source): string` validates file boundaries and reads current definition.
- `resolveManifest(project, manifest, previous?: Lock, opts?: {update?: boolean; refreshLocal?: string[] | true}): Promise<Lock>`: pinned reuse, per-entry catalogs, preserved explicit/resolved choices, retained ownership. No writes.
- Lock adds `resolved?: Record<string, {source: string; catalog?: CatalogRef}>`; v3 required when present. `loadedLoadouts` uses the per-entry catalog before legacy catalog. `findProject` recognizes manifests.

- [x] Step 1: Write failing tests: manifest-only project discovery; invalid harness/unknown keys/name-source mismatch/traversal rejected; GitHub syntax; file syntax; symlink escape rejected; source resolution chooses explicit remote despite same-name draft; first file install resolves defaults; shared resolution is reused until update; two catalogs resolve separately; explicit tag stays pinned; malformed v3 resolutions rejected; writes are stable.
- [x] Step 2: Run `bun test tests/manifest.test.ts`. Expected: FAIL for missing manifest module.
- [x] Step 3: Implement interfaces with existing catalog and loadout helpers; add manifest editor schema. Keep v1/2 writes unchanged until resolved entries exist.
- [x] Step 4: Run `bun test`. Expected: PASS.
- [x] Step 5: Commit `feat: declare loadouts with explicit manifest sources`.

### Task 2: Install, migration and manifest-driven mutations

**Files:** Modify `src/manifest.ts`, `src/local.ts`, `src/sync.ts`, `src/cli.ts`, `src/skills.ts`, tests/helpers.ts and existing workflow tests; create `tests/install.test.ts`.

**Interfaces:**
- `migrateProject(project): Manifest` migrates legacy lock-only state and drafts; validates destinations before writes, preserves snapshots/choices/ownership, idempotent.
- `install(project, opts?: {manifest?: Manifest; update?: boolean; refreshLocal?: string[] | true}): Promise<void>` resolves then calls sync with validated manifest persistence immediately before mutation. Install defaults refreshLocal true; convenience commands supply list/false equivalent.
- `sync` accepts optional `beforeApply?: () => void` and `repair?: boolean` alongside check; previous lock is optional on first install.
- `missingSkills(project, names, harness): boolean` checks canonical files and Claude links; Codex consumes `.agents/skills`. Fake skills creates/removes Claude links to match actual placement.
- Init creates manifest but no lock on fresh project. Local helpers now target `.loadouts/catalog/`. Mutating commands edit manifest, retain explicit source on bare re-add, and use shared default for new bare names.

- [x] Step 1: Write failing tests: direct-manifest install, clone restore under new HOME with cleared artifacts, idempotency/no repeated installers, missing Claude link repair, local edit refresh, no implicit shadowing, lockless preflight failure without writes, manifest source removal cleans up with missing file, partial failure retry/remove, migrate edited + unselected drafts preserving locked snapshot, collision refusal without changes, migration rerun, malformed lock no reset. Update existing tests only for approved manifest/path semantics, retaining safety assertions.
- [x] Step 2: Run `bun test tests/install.test.ts`. Expected: FAIL because install unknown.
- [x] Step 3: Implement migration and CLI integration, keep safety ordering and existing sync ownership. Update current workflow fixtures to explicit file selections/new paths. Init recognizes existing harnesses.
- [x] Step 4: Run `bun test`. Expected: PASS.
- [x] Step 5: Commit `feat: install and migrate manifest-based project setups`.

### Task 3: Diagnostics, publishing, help and exploration

**Files:** Modify `src/doctor.ts`, `src/cli.ts`, `src/inspect.ts`, `src/publish.ts`, `src/launch.ts`, `src/help.ts`, README.md, skills/loadouts-explore/SKILL.md, relevant tests; add changeset.

**Interfaces:** Existing public command signatures retained. Diagnostics inspect manifest without writes, installed status distinguishes uninstalled setup, show resolves selected explicit source. Publish requires selected file source, matching applied contents/choices/harnesses and completed sync. Agent guidance prefers skills and uses new draft paths and explicit file add/install workflow.

- [x] Step 1: Write failing tests for manifest-only status/doctor/inspect, manifest drift and source collision explanation, selected shared show despite local draft, publish blocked on manifest drift, launch requires installation, nested cwd resolution. Run focused tests. Expected: FAIL for old diagnostics.
- [x] Step 2: Implement and update help/README with manifest example, source syntax, install/update distinction, migration instructions, tracked files and best-effort guarantee. Keep no network publication in tests.
- [x] Step 3: Run `bun test` and `bun run build`. Expected: PASS. Run compiled CLI fixture workflow: init/create/add/install, delete generated artifacts, install restores; inspect status and unchanged second install.
- [x] Step 4: Fresh-agent acceptance of help/explore: derive manifest/local draft workflow and skills-first recommendation, no candidate install/publication. Expected: new catalog path, explicit file source, plugins justified by capabilities.
- [x] Step 5: Commit `feat: explain manifest installation across loadout workflows`.
