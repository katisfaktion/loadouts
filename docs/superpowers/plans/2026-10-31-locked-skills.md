# Locked Skills Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Restore committed skill contents without silently accepting upstream changes.

**Architecture:** Keep the native installer boundary in src/skills.ts. Stage frozen restores and new/updated additions, then reconcile selected canonical folders, native lock entries and harness links. Wire explicit updates through sync.ts.

**Tech Stack:** Bun 1.3.14, node filesystem utilities, existing fake skills process.

**Spec:** docs/superpowers/specs/2026-10-31-locked-skills-design.md

## Global Constraints

- No runtime dependencies, network tests, real HOME writes or outward actions.
- Preserve artifact keys, ownership recovery and existing lock formats.
- Full bun test before committing; test first and observe failure.

## Review Focus

- Partial additions must not overwrite previously locked contents on retry.
- A second harness must reuse the same contents instead of fetching latest.
- Unrelated skill lock entries must stay unchanged and inactive.
- Malformed locks, unsafe names and conflicting directories must fail safely.
- Removal after restoration must retain still-selected skills and permit retry.

### Task 1: Restore and update selected skills

**Files:** src/skills.ts, src/sync.ts, src/errors.ts, tests/fixtures/fake-skills.ts,
tests/install.test.ts, tests/skills.test.ts, src/cli.ts, src/help.ts, README.md,
and one changeset.

**Interfaces:** Keep addSkills/removeSkills/listSkills signatures. Add
`installSkills(project: string, identifier: string, h: Harness, opts: {names?: string[]; pending?: boolean; update?: boolean}): Promise<string[]>`.
Extend sync options with `updateSkills?: boolean`; install passes its existing
update option. Successful/partial names retain the CliError.installed contract. The optional
CliError.skillDiscoveryPending flag distinguishes unfinished discovery from
restoration/link repair; removeSkillLinks(project: string, names: string[]): void
removes Claude links while retaining skills still selected for another harness.

- [x] Extend the fake to write native lock hashes and support frozen canonical-only restores; introduce changed-content and restore-failure fixtures.
- [x] Write failing integration tests for a fresh clone with all three files, failed hash verification with unchanged lock/no fallback, offline link repair, explicit update, partial retry drift, unrelated entries, missing/invalid locks and name conflicts.
- [x] Run `bun test tests/install.test.ts tests/skills.test.ts`; confirm new assertions fail for the missing behavior.
- [x] Implement the staged installation and restoration boundary and wire update. Preserve partial ownership on copy/link failure, validate names and native lock shape, and clean staging directories in finally.
- [x] Run targeted tests until green. Update README/help and changeset with commit guidance, update behavior and historical-content recovery limits.
- [x] Run full `bun test`, `bun run build` and `git diff --check`; all must pass. Get one fresh final code review; fix important findings with failing regressions first.
- [x] Commit as `feat: restore skills from the committed lockfile`.
