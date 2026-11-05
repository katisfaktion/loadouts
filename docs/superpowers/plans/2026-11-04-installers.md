# Installer integrations Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans inline with TDD.

**Goal:** Adopt an installed codebase-memory CLI and configure/index selected projects.
**Architecture:** One supported installer adapter, native upstream configuration,
ordinary MCP artifacts, and a local ownership receipt. No generic shell runner.
**Tech Stack:** Bun, TypeScript, native CLI, no new dependencies.
**Spec:** docs/superpowers/specs/2026-11-04-installers-design.md

## Global Constraints

- English only; no network or real HOME in automated tests.
- Reuse the existing global binary; no global install/update/uninstall.
- Preserve unrelated and modified user files, retry incomplete work.
- Full `bun test` before each commit, no pushes.

## Review Focus

- Reinstall and launch must retain MCP, skills, profiles and hooks without duplicates.
- Hand-edited files, symlinks and unrelated hook entries must survive.
- Failed configuration or indexing must remain retryable without false success.
- Shared selection and harness removal must not uninstall the shared service/index.
- Existing binary and global configuration must remain untouched.

### Task 1: Format and artifact contract

**Files:** src/loadout.ts, schemas/loadout.schema.json, src/agentsmd.ts, tests/loadout.test.ts
**Interfaces:** `Source.installer?: "codebase-memory"`; retain artifactsFor signature.
Produce `installer:<harness>:codebase-memory` with null and the ordinary MCP artifact
with `{command: "codebase-memory-mcp", args: []}`. Reject unknown installers and
ambiguous declarations combining an installer with other component sources.

- [ ] Write tests for both harnesses, overrides, invalid names and routing.
- [ ] Run `bun test tests/loadout.test.ts`; observe failures.
- [ ] Implement parser, schema, artifacts and routing labels.
- [ ] Run `bun test`; expect all passing.
- [ ] Commit `feat: declare native installer integrations`.

### Task 2: Reconciliation and lifecycle

**Files:** src/installers.ts, src/sync.ts, src/lock.ts, src/manifest.ts,
src/doctor.ts, tests/installers.test.ts, tests/fixtures/fake-installer.ts
**Interfaces:** `syncInstallers(project: string, lock: Lock, keys: string[]): Promise<void>`;
`missingInstallerArtifacts(project: string, lock: Lock): string[]`;
`Lock.installers?: Record<string, {version: string}>`, lock version 5.

- [ ] Write failing lifecycle tests: adoption, repeat, repair, removal, shared
  selection, harness changes, failure/retry, modified file protection and symlinks.
- [ ] Run `bun test tests/installers.test.ts`; observe failures.
- [ ] Implement staged native config, owned imports/hooks, local receipt,
  one-shot project indexing, lock integration and diagnostics.
- [ ] Run `bun test`; expect all passing.
- [ ] Commit `feat: reconcile installed CLI integrations and project indexes`.

### Task 3: Guidance and real acceptance

**Files:** README.md, src/help.ts, docs/superpowers/specs/2026-11-04-installers-design.md
**Interfaces:** Document only the implemented `installer: codebase-memory` syntax.

- [ ] Explain the global prerequisite, project indexing, reinstall/removal, hook
  trust, generated files and best-effort versions in help and README.
- [ ] Run the real installer in a temporary HOME/project through two loadouts
  installs, deletion/repair, launch-config generation and deselection. Verify
  indexing using the real CLI with an isolated service/cache.
- [ ] Run `bun test` and `bun run build`; expect success.
- [ ] Commit `docs: explain installer integrations and record acceptance`.
- [ ] Fresh review of this change; fix material findings with regression tests.
