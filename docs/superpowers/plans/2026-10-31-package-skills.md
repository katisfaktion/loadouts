# Package Skills Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Synchronize explicitly selected library companions from installed dependencies during loadouts install.
**Architecture:** Validate selectors in loadout.ts, stage native sync in package-skills.ts, reuse skill filesystem/lock helpers, and reconcile package ownership through sync.ts.
**Tech Stack:** Bun 1.3.14, existing node utilities, fake skills installer; no new dependencies.
**Spec:** docs/superpowers/specs/2026-10-31-package-skills-design.md

## Global Constraints

- Keep the manifest unchanged and retain frozen Git skill behavior.
- No network tests or real user configuration writes; full bun test before commit.
- Changes follow RED→GREEN; preserve unrelated files and native lock entries.

## Review Focus

- Exclusions and shared ownership across loadouts/harnesses must survive removal.
- Same-name package/Git/unmanaged skills must fail without overwriting data.
- Missing, upgraded, removed and newly available packages must have coherent status.
- Installer failure, unsafe paths and malformed lock data must preserve recovery.
- pnpm/workspace links and fresh checkouts must not produce machine-specific paths.

### Task 1: Package companion installation

**Files:** src/loadout.ts, schemas/loadout.schema.json, src/package-skills.ts,
src/skills.ts, src/lock.ts, src/manifest.ts, src/sync.ts, src/agentsmd.ts,
src/doctor.ts, src/help.ts, README.md, tests/loadout.test.ts,
tests/package-skills.test.ts, tests/fixtures/fake-skills.ts, one changeset.

**Interfaces:** Source.packageSkills?: {include: string[]; exclude?: string[]}.
Lock.packageSkills?: Record<string, {version: string | null; skills: string[];
requiredBy: string[]}>; Lock.version also accepts 4.
syncPackageSkills(project: string, lock: Lock, loaded: Record<string, Loadout>): Promise<void>.
packageSkillStatus(project: string, lock: Lock): {missing: string[]; changed: string[]}.
Artifact keys: package-skill:<harness>:<package>#<skill>.

- [x] Add selector validation regressions and offline package fixtures; extend fake-skills with canonical-only experimental_sync and native node_modules lock entries.
- [x] Add failing tests for initial install, version/content refresh without update, missing/newly available/removed packages, alternatives/exclusions/routing, shared ownership, fresh checkout, collision preservation, failing installers and malformed/path-traversing metadata.
- [x] Run bun test tests/loadout.test.ts tests/package-skills.test.ts and observe failures.
- [x] Implement validation/schema, staged synchronization and version-4 ownership; integrate routing/readiness/doctor with the existing helpers.
- [x] Run targeted tests until green; document YAML, synchronization, supported layouts, missing dependencies and independent Intent selection in README/help.
- [x] Run bun test, bun run build and git diff --check. Verify the compiled workflow offline. Obtain one fresh final review and fix important findings with RED→GREEN regressions and a green full suite.
- [x] Commit as `feat: sync package companion skills from loadout items`.
