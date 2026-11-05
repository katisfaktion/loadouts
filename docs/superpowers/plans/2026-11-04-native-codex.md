# Native Codex and Consistent Launchers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make installed setups discoverable by ordinary Claude/Codex launches and Codex Desktop, with both loadouts launchers adding only installation checks.

**Architecture:** Install reconciles native project files while authentication and runtime caches stay in normal user homes. Native Codex plugin installation runs in a disposable staging home; only validated cache contents are imported. Existing lock and installer recovery mechanisms protect migration and removal.

**Tech Stack:** Bun, Bun.TOML/Bun.YAML, node:util parseArgs, existing native Codex and installer executables; no new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-04-native-codex-design.md`

## Global Constraints

- Neither launcher writes configuration, installs components, adds isolation flags, changes CODEX_HOME, or requires auth.json.
- Preserve user arguments, environment, child exit status, unrelated configuration, and the entire old `.loadouts/codex-home/`.
- Never grant project/hook trust, change user-level plugin enablement, or remove shared caches on project removal.
- Keep upstream marketplace names, plugin identities, YAML, manifest, and artifact key strings unchanged.
- Use existing modules; no new runtime dependencies, isolation option, or second user-facing workflow.
- Tests use temporary HOME/CODEX_HOME/XDG roots, fixture catalogs, and fake executables; no network or real npx skills. Native acceptance uses local Git fixtures with network protocols disabled.
- TDD for each task; full `bun test` must pass before every commit. Preserve meaningful assertions when replacing tests of intentionally superseded behavior.
- No push, publication, real-home mutation, or acm-website application without the authorization required by the original work order.

## Review Focus

- A legacy lock does not own identically named entries in an existing `.codex/config.toml`; migration must reject differing destination entries before mutation (Task 2).
- A fresh checkout can contain native project files and a lock but no local receipts or plugin caches; install must restore availability without global enablement (Tasks 2–3).
- Native command output and cache symlinks are trust boundaries; reject traversal, identity mismatches, partial JSON, and outside-root paths before importing (Task 2).
- Failure between writing declarations and installing assets must support retry and removal without losing foreign files, old history, or the index receipt (Tasks 2–3).
- Native inheritance can expose alternatives and duplicate hooks; distinguish benign personal settings from effective conflicts, including explicit project disablement (Task 4).

## File responsibilities

- `src/launch.ts`: installation preflight followed by a normal launch.
- `src/codex.ts`: native project config preparation, normal user-home resolution, portable TOML serialization, legacy config migration.
- `src/codex-plugins.ts`: native marketplace snapshots, staged plugin installation, safe cache import and pending ownership.
- `src/lock.ts`, `src/manifest.ts`, `src/sync.ts`: version-6 layout ownership, reconciliation order, missing-artifact checks and recovery.
- `src/installers.ts`, `src/agentsmd.ts`: native installer asset destinations, receipts, hooks and managed project guidance.
- `src/doctor.ts`, `src/globals.ts`, `src/inspect.ts`: native locations and inherited configuration diagnostics.
- `src/cli.ts`, `src/help.ts`, `README.md`, `.changeset/native-agent-launches.md`: launch contract, migration, trust and version compatibility.
- Existing corresponding tests and fake executables cover the changed contracts. New integration scenarios belong in those tests.

### Task 1: Make both launchers pure preflight wrappers

**Files:** `src/launch.ts`, `src/cli.ts`, `tests/launch.test.ts`, `tests/installers.test.ts`, `tests/codex-plugins.test.ts`, `tests/fixtures/fake-codex.ts`, `tests/helpers.ts`.

**Interfaces:** Keep `launch(bin: "claude" | "codex", project: string, args: string[]): Promise<number>`. Keep `claudeArgv(project: string, args: string[]): string[]` and `codexEnv(project: string, env: Record<string, string | undefined>): Record<string, string | undefined>` during this migration; the former returns `["claude", ...args]`, the latter preserves env unchanged. No implicit Codex home selection remains in launch.

- [ ] Write regression tests asserting `claudeArgv(project, ["--model", "x"])` equals `["claude", "--model", "x"]`, and `codexEnv(project, {KEEP: "yes"})` equals `{KEEP: "yes"}`. Also assert an explicit CODEX_HOME is preserved.
- [ ] For each launcher, use a fake executable that reports argv/env and exits 7. Assert exact argument forwarding, inherited environment, exit 7 without auth.json, and byte/mtime stability of installed config, lock and ignore files. Retain tests rejecting missing binaries, mismatched manifests, incomplete locks and missing artifacts before spawning.
- [ ] Run `bun test tests/launch.test.ts` and observe failures caused by isolation/auth checks.
- [ ] Remove configuration writes and auth checks from launch; use the existing preflight then spawn with normal environment. Update installer launch fixtures to inspect project-native files once Task 3 moves them; until then test preservation without claiming ordinary discovery.
- [ ] Update fake Codex's launch-only branch and existing plugin-launch assertions to verify argument/environment forwarding and unchanged installed files. Keep its isolated plugin-install branch until Task 2 replaces installation; do not claim this intermediate commit supplies native Codex discovery.
- [ ] Make `tempEnv()` explicitly set temporary CODEX_HOME, USERPROFILE, CLAUDE_CONFIG_DIR and XDG config/cache homes so inherited developer environment cannot redirect subprocesses into real state. Keep the fake skills command.
- [ ] Run focused tests, then `bun test`. Commit: `refactor: make agent launchers use native configuration`.

### Task 2: Install native Codex configuration and plugins safely

**Files:** `src/codex.ts`, `src/codex-plugins.ts`, `src/lock.ts`, `src/manifest.ts`, `src/sync.ts`, `src/doctor.ts`, `src/inspect.ts`, `tests/harnessfiles.test.ts`, `tests/codex-plugins.test.ts`, `tests/fixtures/fake-codex.ts`, `tests/install.test.ts`, `tests/sync.test.ts`, `tests/mcpcheck.test.ts`, `tests/manifest.test.ts`, `tests/doctor.test.ts`, `tests/installers.test.ts`.

**Interfaces:**
- Add `codexConfigPath(project: string): string`, returning `<project>/.codex/config.toml`, and `codexUserHome(): string`, honoring nonempty CODEX_HOME or defaulting to `<home>/.codex`.
- Replace `writeCodexHome` with `prepareCodexConfig(project: string, lock: Lock, artifacts: Map<string, {itemId: string; mcp: McpServer | null}>): string`. It returns validated complete TOML without mutation. Keep `stringifyCodexConfig`, `expandProject`, and `ensureGitignore` contracts.
- Keep `syncCodexPlugins(project: string, lock: Lock, keys: string[]): Promise<void>`, adding optional fourth argument `{update?: boolean}` for explicit refresh. Configuration is already prepared and written before cache work.
- Lock versions 1–5 mean legacy isolated-home ownership; version 6 means native project ownership. Version 6 has the same fields as version 5 but `installers` and `packageSkills` are independently optional. No new artifact strings. Preserve the incoming version through manifest resolution until native preflight succeeds.
- Continue `installed[key] = []` for Codex plugins/marketplaces, with existing pending keys until native installation is verified. Do not store machine-specific cache paths in the shared lock.

- [ ] Write tests for native MCP/plugin destinations, preserved model and foreign settings, nested plugin policy retention, no auth links or project trust grants, and byte-stable second installation. Test legacy lock plus conflicting native entry leaves both configs and lock untouched; identical migrated entries are reusable.
- [ ] Write lock tests reading versions 1–6, rejecting malformed version-6 optional fields, preserving v6 through manifest changes, and retaining an older version on failed preflight. Assert an old lock cannot authorize deleting a foreign native entry during harness removal.
- [ ] Write plugin tests for a fresh cache, a fresh checkout with tracked native declarations, lost caches, shared marketplace retention, source changes, explicit update, missing executable, malformed output, unexpected identity, failed refresh, interrupted import retry/cancellation, and rejection of outside-root/symlink cache paths. Assert real temporary user config bytes never change and no native add/remove command targets its home.
- [ ] Run `bun test tests/harnessfiles.test.ts tests/codex-plugins.test.ts tests/manifest.test.ts` and observe native-location/ownership failures.
- [ ] Implement pure preparation: parse existing native TOML, validate relevant table shapes and symlink destinations, merge/remove only owned entries, and carry selected legacy plugin policy forward. Legacy ownership permits importing matching definitions, never replacing conflicting native entries. Preserve unrelated data; do not copy old trust, hooks.state, auth, caches or session configuration. Keep real TOML tables.
- [ ] In sync, perform native preflight before any application side effect. Once preflight succeeds, record incomplete version-6 ownership before native writes; preserve the existing try/finally lock recovery. Write project config once, then prepare caches. Never regenerate config from launch. Native missing-artifact checks use `.codex/config.toml`; legacy Codex locks require install even if old files exist. Removing Codex only removes managed entries.
- [ ] Switch doctor and inspection config paths in this task and remove the auth-symlink check; retain inheritance changes for Task 4. Update every config-path assertion in sync/install/MCP/installer tests, while leaving legacy installer asset-path assertions until Task 3. No production caller of the removed writer may remain.
- [ ] Use targeted native marketplace refresh/list commands with explicit configuration overrides for selected sources, so untrusted projects can prepare caches without a trust grant. Treat nonempty native JSON error arrays as failures even if exit status is zero. Validate declared marketplace/plugin identity and source.
- [ ] For missing/new/updated plugins, create a disposable staging home with selected marketplace declarations, run native refresh and add there, and validate returned pluginId, marketplaceName, version and installedPath. Import only its directory beneath `plugins/cache/<marketplace>/<plugin>/<version>` into `codexUserHome()`. Reject unsafe components and links escaping either root. Prepare in a destination sibling before replacing a cache entry; intact installs reuse it. Never import staging config/auth/trust. Remove the stage on success or failure. Cache replacement must be explicit for changed sources/update; removing a project declaration never deletes shared cache contents.
- [ ] Update fake Codex to model separate project declarations and user caches, staged installs, targeted refresh/list, identity failures and partially produced results. It must fail if an add/remove call targets the temporary user's actual Codex home. Retain existing recovery and native-policy assertions under the new command contract.
- [ ] Run focused tests, then `bun test`. Commit: `feat: install Codex setup in native project configuration`.

### Task 3: Migrate installer assets without losing history or index state

**Files:** `src/installers.ts`, `src/agentsmd.ts`, `src/sync.ts`, `tests/installers.test.ts`, `tests/fixtures/fake-installer.ts`, `tests/agentsmd.test.ts`.

**Interfaces:**
- Codex hook destination `.codex/hooks.json`; profiles `.codex/agents/codebase-memory{,-scout,-auditor}.toml`; skill `.agents/skills/codebase-memory/`.
- Keep receipt `.loadouts/installers/codebase-memory.json` and all existing receipt fields. Accept old and new supported paths when reading receipts; new receipts own only active native destinations.
- Keep `syncInstallers(project: string, lock: Lock, keys: string[]): Promise<void>` and `missingInstallerArtifacts(project: string, lock: Lock): string[]`. Add `prepareInstallers(project: string, lock: Lock, keys: string[]): Promise<() => Promise<void>>` to perform generation/conflict checks before application; syncInstallers invokes its returned application function. Sync prepares once, before configuration mutation, then applies once at the existing installer phase.
- Add optional fourth `installerInstructions = ""` argument to `renderSection`; render imported Codex installer guidance inside the existing root loadouts section. Store this staged guidance as `.loadouts/installers/codebase-memory.md`, owned and hashed in the existing receipt, so retries, absence checks and removal use existing ownership logic.

- [ ] Add tests moving a legacy fixture's config/assets/receipt to native layout while retaining old files byte-for-byte, global service state and indexedRoot. Assert no second indexing call, native profiles and skill discovery, portable profile MCP commands, and root managed instructions.
- [ ] Test differing destination profiles/skills/hooks fail before config mutation; matching committed generated files are adopted on a receipt-free checkout. Test edited native assets, symlinks, hook conflicts, partial migration retry/cancellation, harness removal, and a missing/edited legacy asset. Old archived files must never be deleted during active artifact removal.
- [ ] Run `bun test tests/installers.test.ts tests/agentsmd.test.ts` and observe legacy-path failures.
- [ ] Split existing installer preparation/application at its current validation boundary without changing staging safety. Reuse previous version/identity/harnesses/assets where intact; translate legacy receipt paths to new destinations and retain indexedRoot. Preserve previousFiles/previousHooks during interrupted writes. Exclude archived old-home paths from removal and hook updates.
- [ ] Import Codex skill files into `.agents/skills`; preserve safe matching files, reject different foreign contents. Normalize generated Codex profile MCP commands to the PATH-resolved `codebase-memory-mcp`, preserving other profile settings and required fields. Import staged guidance into the managed root section. Preserve all unrelated root instructions and native hooks; never import upstream trust state.
- [ ] Make missingInstallerArtifacts report legacy-only receipts as needing migration and check active native assets afterward. Keep old-home ignore rules and ignored receipts; do not ignore the whole `.codex` directory. Update the fake installer to emit guidance so the shared-instructions behavior is exercised.
- [ ] Run focused tests, then `bun test`. Commit: `feat: migrate installer assets to native Codex locations`.

### Task 4: Explain native inheritance and verify complete workflows

**Files:** `src/doctor.ts`, `src/globals.ts`, `src/inspect.ts`, `src/cli.ts`, `src/help.ts`, `README.md`, `.changeset/native-agent-launches.md`, `tests/doctor.test.ts`, `tests/codex-plugins.test.ts`, `tests/inspect.test.ts`, `tests/cli.test.ts`.

**Interfaces:** Preserve Finding's existing kind/message/fix shape and inspect JSON structure. `doctor` reports actual conflicts or missing setup, not every unrelated inherited component. Preserve nonzero exit for findings. Native user-home scans honor CODEX_HOME. Old isolated-home state is recovery data, not an active configuration layer.

- [ ] Write tests where unrelated personal plugins/MCP/skills coexist without a prune recommendation; non-selected effective alternatives still produce conflicts. Explicit project-disabled plugins must not be reported active solely because user config enables them. Same integration hooks at user and project scope warn about possible duplicate execution without modifying either.
- [ ] Test doctor no longer requires auth.json or its symlink; malformed native config and missing artifacts remain actionable. Inspection reports native project and effective user-home paths and excludes archived home declarations. Help for each launcher explicitly describes normal inheritance, read-only preflight and `loadouts install` for repairs.
- [ ] Run `bun test tests/doctor.test.ts tests/inspect.test.ts tests/cli.test.ts` and observe old isolation diagnostics/help failures.
- [ ] Update diagnostics and documentation to native locations, safe migration, preserved historical sessions, normal authentication, trust requirements, shared plugin-cache implications and lock v6 compatibility. Do not infer effective hook execution from files, disable personal configuration, or replace `global prune` semantics beyond removing unsolicited recommendations to use it.
- [ ] Run `bun test` and `bun run build`. Run compiled help and isolated compiled install/launch checks. Confirm two installs leave managed bytes and mtimes unchanged.
- [ ] Run the compiled CLI against local Git marketplace fixtures in a fresh temporary user home, with Git file-only transport. Cover both an untrusted and a test-trusted project, no auth.json, cache preparation, normal native MCP/plugin discovery and unchanged user configuration. Trust only the disposable test project for the discovery check. Save logs outside the repo.
- [ ] Verify the installed codebase-memory adapter in a temporary project with existing global binary, native skill/profile/hook placement and no repeated indexing. This acceptance modifies only temporary project files and its test index; do not change the global service configuration. Report any unavailable acceptance explicitly.
- [ ] For Desktop, open a temporary configured project normally and verify native MCP, plugin, skill, agent and hook visibility in a fresh session. If desktop automation is unavailable, give exact user checks and leave Desktop acceptance pending; never equate CLI success with Desktop proof.
- [ ] Applying to acm-website is a separate real-project acceptance after required real-home approval: preserve all current edits, snapshot generated files, install twice, verify the second run changes nothing, and keep old session storage. No push or unrelated commit.
- [ ] Commit after all available checks pass: `feat: document and diagnose native agent configuration`.

## Evidence available before implementation

- Graph/source review covered launch, sync, Codex config/plugins, installer receipts, diagnostics and inspection. Coverage reported no recorded gaps for those files at generation `2026-11-04T17:31:47Z`; source was also read directly.
- Native CLI fixture `/tmp/loadouts-native-untrusted-zjag_e8p/` demonstrates fresh marketplace snapshots, the fact that list does not install contents, staged native installation, and successful discovery after importing the returned cache directory. Destination user config/trust remained absent after the final check. This is a feasibility check, not verification of the future implementation.
- The user selected consistent native launch behavior. No separate isolation mode or launcher-driven repair is planned.
