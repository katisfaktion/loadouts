# Nested Choices and Conditional Includes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Support concern-based loadouts with nested choice groups and selected-member includes without weakening additive conflicts or ownership.

**Architecture:** Extend ordinary items with recursive `items` and `includes`; share declared traversal, active choice resolution and include aggregation. Resolve conditional dependency graphs to a deterministic stable state before synchronization, record active results in lock 8, and use those same rules throughout inspection and lifecycle commands.

**Tech Stack:** Bun 1.4.4, TypeScript, Bun.YAML/Bun.TOML, existing Optique and node built-ins.

**Spec:** `docs/superpowers/specs/2026-11-06-nested-choices-design.md` (approved).

## Global Constraints

- No new runtime or development dependencies. English code, messages, help and docs.
- Existing source formats, artifact keys and native configuration ownership remain unchanged. Formats 1–7 remain readable; successful installs write lock 8; schemas stay under v1.
- Explicit requests agree as sets; no overrides, implicit ancestor activation or any_of union.
- Structural failures occur before project writes/installer calls. Preserve partial recovery for later external failures.
- Tests use temporary HOME/projects, local fixture catalogs and existing fake commands, never network/real HOME/real npx skills.
- Write failing tests, observe failure, implement, observe pass; run full `bun test` before every commit. Never weaken tests.
- Continue on feat/cli. No push, merge, publication, installed CLI replacement or acm-website changes. Preserve untracked docs/assets.
- Each worker owns only its listed task files, adjusts to others' changes, and never reverts unrelated edits. Controller serializes commits and review gates.

## Review Focus

- Prototype-named keys and overlapping paths (`py`/`python`) must neither inherit object properties nor remove unrelated choices (Tasks 1, 3).
- Provisional default dependencies can disappear after another root supplies a request; no ghost errors, requests, installed artifacts or pinned nodes (Task 2).
- Duplicate active include occurrences of one child retain source/choice conflict attribution even though lock edges aggregate them (Tasks 1, 2).
- Old lock snapshots and packageSkills ownership must survive migration without reinterpreting old applied state or truncating nested IDs (Task 2).
- Inactive includes must not be fetched by install/preview or smuggle local machine paths into published YAML (Tasks 2, 3).

## File responsibilities

`src/loadout.ts` owns recursive parsing/traversal/choices; `src/sources.ts` validates selection paths. Both schemas describe the syntax. `manifest.ts` resolves graph state; `lock.ts` validates/preserves applied state. `sync.ts`, `agentsmd.ts`, `doctor.ts`, `publish.ts` and CLI/help adapt existing behaviors. Public docs, exploration guidance and a Changeset explain the new authoring model. Keep this structure; do not introduce a policy engine or blanket refactor.

### Task 1: Recursive items, choices and include declarations

**Files:** Modify `src/loadout.ts`, `src/sources.ts`, `src/local.ts`, both `schemas/v1/*.schema.json`; test `tests/loadout.test.ts`, `tests/manifest.test.ts`, `tests/validate.test.ts`, `tests/local.test.ts`.

**Interfaces:**
- Extend `Item` with `items?: Record<string, Item | Group>` and `includes?: Record<string, LoadoutSelection>`; Group members remain Item and defaults remain normalized string arrays.
- Export `declaredItems(loadout: Loadout): Record<string, Item | Group>` with relative slash paths including members. Use own-key-safe maps and traversal.
- Export `resolveChoices(loadout: Loadout, requests?: Choices): Choices`: validate explicit paths/cardinality, resolve active groups top-down, reject explicit inactive descendants. Return active effective choices only.
- Export `includeDeclarations(loadout: Loadout, choices?: Choices): {name: string; selection: LoadoutSelection; path: string}[]`. Omitted choices means all declared includes; supplied choices means top-level + active-item includes. `path` is exact YAML location such as `items.framework.one_of.react.includes.react` or `includes.react`.
- Export `activeIncludes(loadout: Loadout, choices: Choices): Record<string, LoadoutSelection>`: aggregate the active occurrences, merge disjoint compatible explicit choice keys, reject source or same-path choice disagreement with both occurrence locations.
- Existing `defaultChoices`, `activeItems`, `sourceFor`, `parseLoadout` signatures remain; defaultChoices delegates to active resolution, activeItems emits active containers and leaves with stable full IDs, sourceFor excludes structural fields.

- [ ] Write tests asserting nested default choices equal `{languages:["python"], "languages/python/framework":["pytest"], "languages/python/extras":[]}`, selected containers/leaves carry conventions/artifacts once, explicit inactive paths throw, explicit empty suppresses descendants, and multiple groups/deeper ordinary items work.
- [ ] Test recursive schema/parser agreement, invalid defaults/paths/kinds, malformed harness nesting, cyclic YAML aliases, prototype keys, recursive routing reference validation, shared-target include aggregation/conflicts with precise locations. Assert all-declaration enumeration includes inactive sources while active enumeration does not.
- [ ] Run `rtk proxy bun test tests/loadout.test.ts tests/manifest.test.ts tests/validate.test.ts`; observe feature failures.
- [ ] Implement the interfaces and recursive schema references. Preserve existing flat IDs and behavior; group syntax remains one_of/any_of/default, nested groups live in member items. Validate unknown structural keys rather than silently ignoring them. Extend only choice-key validation to slash paths; source/member identifiers retain their roles.
- [ ] Preserve create-from-normalized-source compatibility: recursively convert the existing internal group representation to authoring YAML before validation in createLocal, preserving source-name validation before renaming. Keep the existing compatibility test unchanged and add nested/include-only/cyclic-input coverage.
- [ ] Run targeted tests, then full `rtk proxy bun test`; expected all pass.
- [ ] Commit `feat: support nested loadout choices and member includes` with only task files.

### Task 2: Stable conditional graphs and lock format 8

**Files:** Modify `src/manifest.ts`, `src/lock.ts`, `src/sync.ts` (desired validation and graph-version handling only), connected graph-version checks in `src/cli.ts`, `src/publish.ts`, `src/doctor.ts`, `src/launch.ts` if needed; tests `tests/includes.test.ts`, `tests/manifest.test.ts`, `tests/install.test.ts`, `tests/package-skills.test.ts` plus only new-success expected-version assertions elsewhere.

**Interfaces:**
- Consume Task 1 helpers. Keep resolveManifest, readLock/writeLock, validateLockedLoadout, loadoutPaths/loadoutClosure, manifestMatchesLock and install signatures unchanged.
- Lock.version adds 8. V8 existing roots/includes/loadouts/resolved/local fields hold the active graph; no extra persisted provenance field. Aggregate edges via activeIncludes, derive member origins from definitions.
- V7 validation retains old top-level include semantics. V8 validation uses resolveChoices and activeIncludes, verifies all incoming requests and effective choices; readLock never fetches.

- [ ] Add local-catalog graph tests: nested selected includes, skipped nonexistent inactive target, compatible duplicate child edges, conflicting members/sources, active cycle versus dormant cycle, diamonds, graph order independence, shared ownership and transitive branch removal. Assert full project snapshot and fake-command log unchanged on preflight errors.
- [ ] Add a multi-root case where a provisional default includes a missing child but a later active include selects another member: final graph succeeds without the old child/request. Add opposite-order roots and a self-invalidating conditional cycle that must fail without mutation.
- [ ] Add v8 tamper/roundtrip/migration cases including nested packageSkills requiredBy and legacy v7 reads; expected version for newly installed locks is 8, old fixtures remain old fixtures.
- [ ] Run relevant tests; observe the intended failures.
- [ ] Replace unconditional traversal with deterministic rounds, retaining existing source read/pin/update/legacy-file logic:
  1. Begin with roots and no previous-round edges; gather reachable occurrences using only the preceding round's emitted edges for the same full source. Preserve locations, stop repeated ancestry expansion, and collect all incoming requests before resolving each node.
  2. Group by name; conflicting source/request or read/choice failures become deferred diagnostics and the unresolved node emits no edges. Valid nodes use resolveChoices and activeIncludes to emit their next edges. Cache reads by full source/pin; discard unreachable state each round.
  3. Canonical state comprises reachable incoming selections, effective choices, emitted edges, and diagnostics (sorted, independent of declaration order). If unchanged, reject diagnostics/active cycles or return the complete valid graph. If a non-stable state repeats, report conditional non-convergence with paths. Never select an arbitrary conflicting source, retain previous-lock defaults, or install provisional artifacts.
  4. Every final emitted child must be resolved/reachable; verify before returning. Inactive catalog-local declarations are rejected structurally using all-declaration enumeration, with no inactive fetch.
- [ ] Widen graph-version consumers and nested packageSkills IDs; desired() uses shared recursive choice validation. Preserve structural-before-migration and recovery boundaries. Do not change user command mutation semantics yet.
- [ ] Run targeted tests and full `rtk proxy bun test`; expected all pass.
- [ ] Commit `feat: resolve conditional includes and persist active loadout graphs`.

### Task 3: Nested CLI choices, routing, diagnostics and publication

**Files:** Modify `src/sync.ts`, `src/agentsmd.ts`, `src/doctor.ts`, `src/publish.ts`, `src/commands.ts`, `src/cli.ts`; tests `tests/cli.test.ts`, `tests/commands.test.ts`, `tests/agentsmd.test.ts`, `tests/doctor.test.ts`, `tests/publish.test.ts`, `tests/includes.test.ts`.

**Interfaces:** Existing commands and public signatures remain. Group operands are LOADOUT/PATH; split only the first slash to identify the loadout. Use declaredItems/resolveChoices, never property-path guessing. add --with supports the same paths atomically. Included-only mutation guards retain their existing policy and name exact member include locations.

- [ ] Write CLI tests for nested switch/enable/disable/--with, inactive target errors, wrong cardinality and included-only guards. Parent deselection removes only explicit descendant keys under deselected member path segments from its own manifest entry and reports them; other roots/includes still conflict. Test py/python and prototype keys; explicit stale --with input must fail rather than be silently cleaned.
- [ ] Write routing/convention tests for active containers/leaves and nested path targets, shared child once, inactive references omitted and no empty rows. Doctor checks active nested one_of groups and ignores groups under inactive ancestors.
- [ ] Write publication tests rejecting dormant local/absolute includes in any inspected definition, preserving exact YAML, checking active closure only and no inactive fetch. Preview/PR text must state selected verification scope and inactive source-portability-only checks.
- [ ] Run targeted tests and observe failures; implement using shared recursive helpers and segment-aware descendant matching. Keep parent routing local to its own loadout; included loadouts emit their own routing. Preserve read-only status/show/launch behavior and native artifact ownership.
- [ ] Update command help operands/examples to expose nested paths and branch cleanup behavior.
- [ ] Run targeted tests and full `rtk proxy bun test`; expected all pass.
- [ ] Commit `feat(cli): manage nested choices and conditional loadout branches`.

### Task 4: Public guidance, Changeset and compiled acceptance

**Files:** Modify `README.md`, `docs/reference.md`, `skills/loadouts-explore/SKILL.md`, `.changeset/authoring-and-exploration.md`; test `tests/explore.test.ts` and `tests/cli.test.ts` if behavioral guidance coverage needs extension. Acceptance scripts/logs stay in this plan's ignored workspace.

**Interfaces:** Use the exact approved YAML and Task 3 commands. Exploration first reuses proven concern loadouts, then chooses conditional includes for reusable alternatives or nested items for related options. Never claim unselected branches were installed/verified.

- [ ] Add failing guide/help checks for both supported composition forms and selected-only verification scope; run relevant tests and observe missing guidance failures. Read writing-skills instructions before editing the skill and use a fresh-agent behavior scenario if required.
- [ ] Update public examples, path grammar, active defaults/inactive errors, parent-switch cleanup, conflict rules, format8 compatibility, and publishing inactive portability caveat. Update the existing Changeset with user-facing behavior.
- [ ] Run targeted tests and full `rtk proxy bun test`; expected all pass.
- [ ] Run `rtk proxy bun run build`. With the compiled binary, an isolated HOME/project, local Git catalog and fake commands, install a concern composition combining nested testing choices and frontend React/Vue includes; switch framework and nested test option; confirm obsolete/shared artifacts, status/show/doctor, and byte-identical repeated install. Validate an inactive local include publication refusal with no GitHub call.
- [ ] Record exact suite/build/compiled evidence and run git diff --check. Commit `docs: explain nested choices and conditional loadout composition`.

## Execution and final gate

The user approved the design and explicitly requested implementation; proceed without another approval round. Reuse the previously requested subagent-driven review method, with scoped task ownership and task-by-task gates. Review the final feature range (base 6ecd80c through final HEAD), fix real findings with regressions, and report commits, full-suite summary, compiled acceptance and any deviations. Leave merging and publication to the user.
