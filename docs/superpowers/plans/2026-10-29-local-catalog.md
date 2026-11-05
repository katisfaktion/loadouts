# Project-local catalog implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Draft and apply local loadouts alongside shared ones, then propose verified definitions through GitHub PRs.

**Architecture:** Local YAML files live in `.loadouts/`. Applied YAML snapshots in a version-2 lock isolate editing from installation. Existing artifact reconciliation stays shared; publication copies one verified definition into a temporary catalog checkout.

**Tech Stack:** Bun 1.3.14, TypeScript, Bun.YAML, node:util parseArgs, Git, gh; no added dependencies.

**Spec:** docs/superpowers/specs/2026-10-29-local-catalog-design.md

## Global Constraints

- English throughout; stay on feat/cli. Full bun test before every commit.
- Tests use temporary HOME, local fixture catalogs and fake skills/gh. No network or real-home mutation in tests.
- No new dependencies. Existing release process and YAML format remain unchanged.
- No actual push, PR, release, or repository creation by this agent without separate approval.
- Commands are noninteractive; publish requires --yes for external writes.

## Review Focus

1. Local edits must not leak into unrelated reconciliation or launch; lock snapshots preserve the last-applied definition (Task 2).
2. Deleted/invalid local definitions never silently switch to remote; remove must remain possible (Tasks 2–3).
3. Local YAML must be tracked while generated credentials/session state remain ignored, including existing projects (Task 1).
4. Local MCP changes must be checked before any install/file mutation, retaining partial-install recovery (Task 2).
5. Publication must include only the chosen applied YAML, preview without side effects, handle forks and explain recovery after a push succeeds but PR creation fails (Task 4).

### Task 1: Local files, creation and discovery

**Files:** create src/local.ts, tests/local.test.ts; modify src/cli.ts, src/codex.ts, tests/launch.test.ts as needed.

**Interfaces:** `localFile(project: string, name: string): string` validates a name; `localNames(project: string): string[]`; `readLocal(project: string, name: string): string | null`; `createLocal(project: string, name: string, from?: string): Promise<string>`. `init` always ensures local directory and narrow ignore rule. `create <name> [--from <shared-name>]` refuses overwrite. list JSON remains names; show adds source metadata.

- [ ] Write failing tests for init/ignore migration with actual git check-ignore, schema-linked creation, overwrite/path traversal refusal, copying a shared definition, merged discovery and local-first show from a child directory.
- [ ] Run bun test tests/local.test.ts and observe failures.
- [ ] Implement local file helpers and commands; reuse catalog parser and writeIfChanged. Narrow only exact old generated ignore rules; preserve other bytes.
- [ ] Run targeted tests, then full bun test.
- [ ] Commit `feat: create and discover project-local loadouts`.

### Task 2: Applied snapshots and reconciliation

**Files:** modify src/lock.ts, src/sync.ts, src/cli.ts; extend tests/local.test.ts.

**Interfaces:** Lock accepts version 1 or 2, optional `local: Record<string,string>` snapshots and `incomplete?: boolean`; writeLock writes version 2. Set incomplete when mutation starts and clear only after successful reconciliation. `loadedLoadouts(lock)` resolves snapshots before shared catalog. status adds `sources` mapping names to local/catalog. Reapply reads only explicitly requested local files; update retains snapshots; remove deletes the selected snapshot. Existing signatures and artifact keys stay unchanged.

- [ ] Write failing tests for local-only offline apply, mixed sources and local shadowing, unchanged snapshots across unrelated operations, explicit reapply, local MCP preflight refusal, missing/invalid local refusal plus removal, remote update preserving local files, and version-1 lock compatibility/rejection of malformed snapshots.
- [ ] Run targeted tests and observe failures.
- [ ] Implement snapshot resolution and local-first selection; compare old/new desired definitions for local changes too.
- [ ] Run targeted tests, then full bun test.
- [ ] Commit `feat: apply local loadouts with locked snapshots`.

### Task 3: Doctor explanations

**Files:** modify src/doctor.ts; extend tests/local.test.ts.

**Interfaces:** Finding.kind adds `local`. Applied checks still read locked snapshots. Local findings explain collisions, draft edits, invalid drafts and deleted files, with explicit add/restore/remove fixes; all findings remain non-mutating.

- [ ] Write failing tests for collisions before/after applying local, changed/missing/invalid drafts and byte-identical lock/files after doctor.
- [ ] Run targeted tests and observe failures.
- [ ] Implement local findings, including configured-catalog fallback where necessary; retain other doctor checks.
- [ ] Run targeted tests, then full bun test.
- [ ] Commit `feat: explain local catalog conflicts in doctor`.

### Task 4: Contribution PR workflow and documentation

**Files:** create src/publish.ts, tests/publish.test.ts, tests/fixtures/fake-gh.ts, .changeset/local-catalog.md; modify src/cli.ts and README.md.

**Interfaces:** `publish(project: string, name: string, opts: {summary: string; catalog?: string; yes?: boolean}): Promise<string>` returns preview text or PR URL. `publish <name> --summary <text> [--catalog owner/repo] [--yes]`. Fake gh is injected through PATH and uses local fixture Git remotes, never a runtime hook. Temporary clone is removed in finally.

- [ ] Write failing tests for preview without gh calls, unapplied/changed/pending rejection, successful upstream and fork PR paths with only the chosen YAML committed, no-diff refusal, command failure and post-push recovery instructions.
- [ ] Run targeted tests and observe failures.
- [ ] Implement the bounded git/gh sequence, structured argv and body file. Update README/help with complete exploration→apply→doctor→publish flow and local precedence; add minor Changeset.
- [ ] Run full bun test, native build/help and local fake-publication acceptance.
- [ ] Commit `feat: propose verified local loadouts as catalog PRs`.

Finish with one independent review of this feature's commit range, resolve important findings with regression tests, and report commits, verification and any remaining live-publication limitation. The user's proceed instruction authorizes inline execution without another plan approval round.
