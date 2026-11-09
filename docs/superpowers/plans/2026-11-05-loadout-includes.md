# Additive Loadout Includes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Compose reusable catalog and local loadouts through additive includes, with deterministic conflicts and catalog-first agent exploration.

**Architecture:** Resolve a dependency graph from the manifest's direct selections before the existing artifact reconciliation. Keep nodes separate and persist roots/edges alongside the existing per-node resolutions and snapshots in lock format 7. Reuse native installers and artifact keys; the agent, not the CLI, judges prose compatibility.

**Tech Stack:** Bun 1.4.4, TypeScript, Bun.YAML/Bun.TOML, existing Optique command grammar, local Git fixtures and fake external installers. No dependencies added.

**Spec:** `docs/superpowers/specs/2026-11-05-loadout-includes-design.md`

## Global Constraints

- Read this plan and its spec completely before implementation. Preserve interfaces below; explain a necessary interface change before making it.
- Bun **1.4.4**, Bun.YAML/Bun.TOML, existing Optique parser; no new runtime or development dependencies.
- English code, messages, documentation and commits; preserve existing source syntax and artifact keys.
- Tests use temporary homes, local Git catalogs and existing fake skills/plugin/installer scripts. No network, real HOME or real `npx skills` in tests.
- Full `bun test` before every commit; never weaken assertions to obtain a pass.
- No modifications to acm-website, real agent configuration, installed CLI, catalog publication or release actions as part of this implementation.
- Preserve the untracked illustration under `docs/assets/`; it is unrelated to this change.
- Includes add requirements; they never override conflicting sources, explicit choices or component definitions. No aliases, `extends`, include exclusion, cross-loadout routing or new diff command.
- Do not run semantic convention checks in the CLI. Structural validation cannot certify prose compatibility or real-issue usefulness.

## Review Focus

- Diamonds, direct-plus-indirect selections and reordered declarations must not become false cycles or change effective output. Task 2 pins these cases.
- Dropping one parent must not delete a still-required shared artifact or promote children into direct manifest selections. Tasks 3 and 4 pin these cases.
- Stale local snapshots, refreshed catalog graphs and partial failure must not downgrade format 7 or forget recovery ownership. Tasks 2 and 3 pin these cases.
- Preflight failures must preserve project files and avoid starting MCP/installer processes; identical definitions must deduplicate independently of object-key order. Task 3 pins these cases.
- Publication must reject nonportable transitive dependencies without network calls or silent inlining; convention contradictions must remain visible to the agent. Tasks 5 and 6 pin these cases.

## File responsibilities and compatibility

- Create `src/sources.ts` by moving the existing source syntax helpers out of `manifest.ts`, with shared selection validation. This prevents the YAML parser from importing the manifest/lock resolver just to validate an include.
- `src/loadout.ts` and `schemas/v1/loadout.schema.json`: optional include mapping and include-only compositions; keep per-loadout item/routing semantics.
- `src/manifest.ts`: graph resolution, choice agreement, roots-only manifest matching and legacy migration.
- `src/lock.ts`: format 7 validation/persistence and pure provenance/closure traversal helpers.
- `src/sync.ts`: existing artifact reconciliation, include-aware command checks and status. Preserve graph metadata in every recovery write.
- `src/cli.ts`, `src/doctor.ts`, `src/launch.ts`: inspect and validate applied transitive selections using existing command interfaces.
- `src/agentsmd.ts`: preserve convention/routing ownership and avoid duplicate emission of shared nodes.
- `src/publish.ts`: publication readiness and portability of an applied node's dependency closure.
- Existing test files cover the relevant public behavior; create `tests/includes.test.ts` for graph fixtures and composition lifecycle scenarios. Extend `tests/helpers.ts` only for genuinely shared fixture setup.
- `skills/loadouts-explore/SKILL.md`, `README.md`, `docs/reference.md`, `src/commands.ts` help prose and `.changeset/authoring-and-exploration.md`: describe the final supported behavior.

## Task 1: Shared selections and YAML include syntax

**Files:** Create `src/sources.ts`; modify `src/manifest.ts`, `src/loadout.ts`, `schemas/v1/loadout.schema.json`; tests in `tests/loadout.test.ts`, `tests/manifest.test.ts`, `tests/validate.test.ts`.

**Interfaces:**
- `src/sources.ts` exports `LoadoutSelection { source: string; choices?: Choices }`, where `Choices` is a type-only import from `loadout.ts`.
- Move and export existing `ParsedSource`, `parseSource(source: string): ParsedSource`, `fileSource(name: string): string`, `catalogSource(repo: string, name: string, ref?: string): string` without changing accepted syntax or output strings. Re-export the old helpers from `manifest.ts` so existing imports keep working.
- Add `validateSelection(name: string, value: unknown): LoadoutSelection` for exact `{source, choices?}` shape, source/key agreement, identifier validity and distinct string-array members. The manifest and loadout parser contextualize errors with their existing filename/field diagnostics.
- `Manifest.loadouts: Record<string, LoadoutSelection>`; `Loadout.includes?: Record<string, LoadoutSelection>`. Existing `parseLoadout(yamlText: string, file: string): Loadout` signature remains.

- [ ] Write failing parser/schema/CLI-validation tests with `includes: { testing: { source: "github:acme/catalog/testing@v1.0.0", choices: { tools: [] } } }`. Assert the parsed mapping is retained, missing `items` normalizes to `{}`, and old definitions keep their current parsed shape when includes are absent.
- [ ] Add rejected cases: source/key mismatch, malformed source, unknown selection field, scalar choices, duplicate members, invalid include mapping, name-only file, and unsupported cross-loadout routing. Assert `validate` does not invoke Git or installers even when a referenced source does not exist.
- [ ] Run `bun test tests/loadout.test.ts tests/manifest.test.ts tests/validate.test.ts`; observe the new valid include cases fail before implementation.
- [ ] Extract the existing helpers and implement shared selection validation, parser retention and schema support. Keep `items` required unless nonempty includes exist. Keep unknown-field enforcement aligned between the new include block and editor schema; do not broaden unrelated legacy parser behavior.
- [ ] Run the targeted tests, then full `bun test` and `git diff --check`.
- [ ] Commit as `feat: add declarative loadout include syntax`.

## Task 2: Resolve and persist the complete dependency graph

**Files:** `src/manifest.ts`, `src/lock.ts`, `src/sync.ts` (version preservation/readiness only), `tests/includes.test.ts`, `tests/manifest.test.ts`, `tests/install.test.ts`, `tests/launch.test.ts`.

**Interfaces:**
- Extend `Lock.version` to `1 | 2 | 3 | 4 | 5 | 6 | 7`.
- Add `Lock.roots?: Record<string, LoadoutSelection>` and `Lock.includes?: Record<string, Record<string, LoadoutSelection>>`; both are required for version 7. Old formats treat every applied node as a root and have no edges.
- Preserve `resolveManifest(project: string, manifest: Manifest, previous?: Lock, opts?: {update?: boolean; refreshLocal?: string[] | true}): Promise<Lock>`. Its result is format 7 with complete reachable `resolved`, `loadouts`, `local`, `roots` and `includes` maps. Existing installed/recovery/package/installer fields survive unchanged.
- Add pure helpers in `lock.ts`: `loadoutPaths(lock: Lock, name: string): string[][]` and `loadoutClosure(lock: Lock, name: string): string[]`. Return deterministic sorted paths/names; include the requested node in its closure. Legacy known nodes have path `[[name]]` and closure `[name]`.
- Preserve `manifestMatchesLock(manifest: Manifest, lock: Lock): boolean`, `readLock(project: string): Lock`, `writeLock(project: string, lock: Lock): boolean`, and `loadedLoadouts(lock: Lock): Promise<Record<string, Loadout>>` signatures.

- [ ] Write failing temporary-catalog tests for `website → react/testing`, an include-only parent, nested local descendants, and diamond `website → frontend/testing → shared`. Assert `Object.keys(lock.roots)` contains only direct selections, all unique nodes occur in `resolved/loadouts/includes`, and both paths to `shared` remain available.
- [ ] Add cycle `a → b → a`, missing descendant, conflicting full source strings, shared-catalog-to-local-file reference, traversal/symlink input, and identical declarations in reversed order. Assert errors show root-to-owner paths; reordered declarations produce equivalent stable serialized locks.
- [ ] Add choice tests: explicit versus default, agreeing explicit `any_of` arrays in different orders, `[]` versus `[a]`, disagreeing `one_of`, invalid group/member. Assert explicit agreement is collected across the entire graph before defaults, and different explicit choices fail without union or precedence.
- [ ] Add install/update snapshot tests: unchanged second resolution, unchanged source pin reuse after upstream advances, transitive refresh on update, newly included child resolution, dropped unreachable child, install refresh of edited local descendants, update retaining local snapshots, and convenience operations retaining unrelated local edits.
- [ ] Add malformed format-7 lock tests: missing graph fields, dangling edges, unreachable node, cycle, edge/source mismatch, inconsistent root/edge/effective choices and mismatched local snapshot edges. Assert lock reading stays offline. Keep representative version 1–6 read/migration assertions, and assert a successful install upgrades to 7 without marking native Codex data legacy.
- [ ] Run `bun test tests/includes.test.ts tests/manifest.test.ts tests/install.test.ts tests/launch.test.ts` and observe failures.
- [ ] Implement graph traversal in `resolveManifest` using an active recursion stack plus a resolved-node map. Reuse existing catalog resolution caching/pinning. Aggregate explicit requests separately from defaults; store direct edges, not a flattened merged loadout. Use prototype-safe maps for user-controlled names.
- [ ] Validate and persist graph metadata in `lock.ts`; use roots for manifest readiness and lock-only migration. Update `sync` to retain version 7 in success and failure paths while keeping native migration eligibility at `< 6`. Ensure `loadedLoadouts` checks saved include edges against the loaded pinned definitions without refreshing their sources.
- [ ] Run targeted tests, full `bun test` and `git diff --check`.
- [ ] Commit as `feat: resolve and lock additive loadout graphs`.

## Task 3: Conflict preflight and shared artifact lifecycle

**Files:** `src/sync.ts`, `src/agentsmd.ts`; relevant conflict checks in `src/claude.ts`, `src/codex.ts`, `src/codex-plugins.ts`, `src/skills.ts`, `src/package-skills.ts` only where reuse needs integration; tests in `tests/includes.test.ts`, `tests/sync.test.ts`, `tests/agentsmd.test.ts`, `tests/package-skills.test.ts`, `tests/installers.test.ts`.

**Interfaces:** Keep `desired(lock: Lock, loadouts: Record<string, Loadout>): Map<string, {itemId: string; mcp: McpServer | null}>`, `sync(...)`, renderer/installer APIs and every artifact key unchanged. Use graph provenance helpers to explain both origins on conflict; select a stable representative `itemId` for deduplicated identical artifacts.

- [ ] Write failing graph-install tests for differing MCP commands/args/env with the same harness/server name and different repositories for a single plugin marketplace namespace. Snapshot the existing manifest, locks, generated files and fake process logs; assert conflicts preserve every snapshot and invoke no MCP, plugin, skill or installer command.
- [ ] Test identical MCP definitions with different object-key order, the same skill requested through multiple nodes, shared package companions, and a shared codebase-memory integration. Assert one desired artifact per identity and no repeated first-install work for a diamond.
- [ ] Test two direct roots sharing a child: remove one, retain its shared skills/config/conventions/index assets; remove the last, remove only owned project artifacts. Retain personal/unmanaged files and global installer/service state. Exercise failure/retry with version-7 roots and edges intact.
- [ ] Test routing and conventions for the child are emitted once with attributable loadout/item names. Contradictory prose must remain present; no CLI semantic filtering. Keep existing empty-any_of routing suppression.
- [ ] Run the targeted tests and observe failures, then implement the smallest additions to existing preflight and reconciliation. Preflight graph-known component conflicts before any project mutation or process launch. Keep existing staged discovery/recovery for skill collisions not knowable from declarations.
- [ ] Run targeted tests, full `bun test` and `git diff --check`.
- [ ] Commit as `feat: reconcile included loadouts without silent conflicts`.

## Task 4: Explain included selections in CLI commands

**Files:** `src/cli.ts`, `src/sync.ts`, `src/doctor.ts`, `src/commands.ts`; tests in `tests/includes.test.ts`, `tests/cli.test.ts`, `tests/doctor.test.ts`, `tests/launch.test.ts`, `tests/source-replacement.test.ts`.

**Interfaces:** Preserve command names/options. Add `roots` and `includes` to `status --json` for graph locks without removing existing fields. Human status labels direct versus included entries and lists their immediate parents. `show` follows `lock.resolved[name]` for an included-only node, while a manifest declaration still wins when a direct source change is pending.

- [ ] Write failing CLI tests proving an included-only installed node is shown as included rather than undeclared, JSON exposes roots/edges, and `show` reads its pinned source even with a same-name local draft or different default catalog.
- [ ] Test doctor with edited/missing local descendants and graph resolution failures: include path and actionable fix are present, and unrelated diagnostics remain available. Test read-only launch with a healthy include graph and with pending direct manifest changes.
- [ ] Test `remove` on an included-only node: it fails with requiring parent paths and changes nothing. Removing a direct selection that remains included preserves installation. Test `switch`/`enable`/`disable` on included-only groups: actionable error points to the declaring include choices or adding the same source directly; no implicit promotion/YAML edit. After explicit promotion, agreeing choices work and contradictory include choices still fail.
- [ ] Run targeted CLI/doctor/launch tests and observe failures. Implement source lookup, presentation and command guards using the lock helpers; keep root/child source-replacement confirmations intact.
- [ ] Run targeted tests, full `bun test` and `git diff --check`.
- [ ] Commit as `feat: explain included loadout sources and choices`.

## Task 5: Publish portable verified compositions

**Files:** `src/publish.ts`, `tests/publish.test.ts`, `tests/includes.test.ts`; extend `tests/fixtures/fake-gh.ts` only if existing fake operations cannot cover the scenario.

**Interfaces:** Preserve `publish(project: string, name: string, opts: {summary: string; catalog?: string; yes?: boolean}): Promise<string>`. Use `loadoutClosure` and saved graph metadata for readiness, descendant artifact ownership and portable-source checks. The chosen applied local node need not itself be a root.

- [ ] Write failing tests for an applied composition with portable GitHub includes and an applied included-only local leaf. Assert preview makes no GitHub calls, retains include declarations, and approved fake publication stages exactly `loadouts/<name>.yml` without flattening dependencies or copying project files.
- [ ] Test direct and transitive consumer-local/absolute-Git dependencies: reject publication with dependency paths before GitHub commands. The chosen local node itself is allowed; its nonportable descendants are not. Test stale local snapshots, changed manifest selections and missing child artifacts cannot publish.
- [ ] Test the dependency-first workflow using fake GitHub catalog operations: a local leaf is publishable, its local parent is blocked until the parent's dependency is replaced by an available shared source and reinstalled. Preserve current no-diff, PR template, fork and partial-push failure behavior.
- [ ] Run `bun test tests/publish.test.ts tests/includes.test.ts` and observe failures. Implement graph-based checks using only saved data during preview; do not add remote schema or source lookups.
- [ ] Run targeted tests, full `bun test` and `git diff --check`.
- [ ] Commit as `feat: publish portable loadout compositions`.

## Task 6: Catalog-first exploration, convention review and acceptance

**Files:** `skills/loadouts-explore/SKILL.md`, `README.md`, `docs/reference.md`, `src/commands.ts` help prose, `.changeset/authoring-and-exploration.md`; existing delivery coverage in `tests/explore.test.ts`, new composition acceptance cases in `tests/includes.test.ts`.

**Interfaces:** `loadouts explore` still prints the bundled skill; no agent is launched by the command. No new explore options. Existing CLI delivery test compares the served guide with the file; test agent behavior separately rather than adding keyword-presence assertions.

- [ ] Before editing the skill, run a fresh-agent baseline with the current guide: a catalog already has suitable React/testing entries, Payload is missing, and an included testing convention conflicts with a project instruction. Ask for exploration only. Record whether the agent inspects catalogs first, composes without copying, discovers only remaining gaps, and exposes the convention conflict without installation/publication.
- [ ] Update guidance to inspect relevant catalog entries and their full include closure before external discovery. Rank evidence of fit/verification rather than treating a catalog location as proof. Reuse suitable entries, write focused additions and optionally a composition YAML, and preserve source evidence for actual adaptations.
- [ ] Require a convention/routing review across the proposed active selections and project instructions. The handoff names sources, identifies contradictions and unresolved priorities, and distinguishes structural CLI validation from agent judgment and real-task verification. Applying/publishing remain separate decisions.
- [ ] Explain include shape, explicit choices, conflicts, roots versus descendants, CLI limitations on indirect choices, schema release compatibility and dependency-first publication in human docs/help. Replace previous statements that includes are unsupported. Update the pending descriptive authoring Changeset; do not version packages or publish a release.
- [ ] Run the same fresh-agent acceptance scenario and an edge case with conflicting explicit choices, an unknown adaptation base and pre-existing edited local drafts. Require catalog-first composition, convention conflict attribution, preserved drafts, no invented commands and no unapproved application/publication.
- [ ] Run full `bun test`, `bun run build` and `git diff --check`. In a temporary HOME/project with local Git catalogs and fake commands, verify compiled init/add/install/status/show/doctor/update/remove and publication preview across a nested/diamond graph. Verify unchanged second install and no real network/process invocation. Confirm the binary's explore output exactly matches the updated skill.
- [ ] Review the whole change for dropped recovery state, format downgrades, accidental local reads from remote includes and lost artifact ownership; fix findings with failing regressions first and rerun the full suite.
- [ ] Commit as `feat: guide catalog-first composition and convention review`.

## Plan self-review

- Format/source validation: Task 1; graph, pins, explicit choices and lock compatibility: Task 2.
- Conflict preflight, attribution, ownership and recovery: Task 3; user-facing commands/readiness: Task 4.
- Portable publication and no-network preview: Task 5; agent responsibility, docs and compiled acceptance: Task 6.
- Review Focus cases have explicit owning tests above. Shared selection and graph helper signatures are defined once and reused. No override behavior, new registry, component version model or prose inference engine is introduced.

## Handoff

The user has already selected native execution with `executing-plans` for this project. Review this plan and the companion spec before implementation; preserve that execution method. Report completed task commits, the final full-suite summary, compiled acceptance evidence, agent behavior evidence, and any deviation or remaining limitation. Do not include the untracked illustration in these commits.
