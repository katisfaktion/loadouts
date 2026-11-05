# loadouts CLI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the `loadouts` CLI. It loads declared agent setups from a Git catalog into a project for Claude Code and Codex, keeps them consistent, and starts each harness with only those setups.

**Architecture:** Every mutating command only edits the selections in `loadouts.lock.json`, then calls one reconciler, `sync()`. `sync()` turns the selections into a set of string-keyed *artifacts*, compares them with the artifacts the lock records as installed, and removes or adds the difference. Adding means `npx skills`, JSON merges into `.claude/settings.json` and `.mcp.json`, and a generated Codex home. Removal is plain set difference, so "unless another item still needs it" comes for free. Idempotency also follows: a second run finds an empty diff.

**Tech Stack:** Bun 1.3 + TypeScript, `bun test`, `node:util` `parseArgs`, `Bun.YAML.parse`, `Bun.TOML.parse`, `git`, `npx skills`. No runtime dependencies. Changesets (dev only) for versioning.

**Spec:** `docs/superpowers/specs/2026-10-29-loadouts-design.md`

## Global Constraints

- Everything in this repo (code, docs, commits, help texts, error messages) is in English.
- No command asks interactively. Everything goes through arguments and options.
- Exit codes: 0 success, 1 check failed, 2 usage error, 3 environment missing (e.g. `npx`, `git`, `claude` or `codex` not found).
- Every error message says what went wrong **and** how to fix it: `error: <what>` then `fix: <how>` on stderr.
- `--json` exists for `list`, `show`, `status`, `doctor`.
- Idempotent: running the same command twice changes nothing the second time. Files are written only when their content changes.
- Lock file `loadouts.lock.json`; user config `~/.config/loadouts/config.toml`; managed section between `<!-- loadouts:begin -->` and `<!-- loadouts:end -->`; generated Codex home `.loadouts/codex-home/` (gitignored), with `auth.json` symlinked to `~/.codex/auth.json`, never copied.
- Harness names on the CLI: `claude-code`, `codex`. YAML override keys: `claude:`, `codex:`. `npx skills` agent flags: `-a claude-code`, `-a codex`.
- Default catalog `katisfaktion/agent-loadouts`; catalog versions are Git tags; the lock stores `ref` plus resolved `commit`.
- Codex plugins are out of scope: a `plugin` in a Codex source is a catalog validation error.
- Home directory is `process.env.HOME` (tests point it at a temp dir). Overrides for tests: `LOADOUTS_SKILLS_CMD` (default `npx -y skills`), `LOADOUTS_CACHE` (default `~/.cache/loadouts`).

## Review Focus

1. **`AGENTS.md` with a begin marker but no end marker (or reversed):** refuse with exit 1 and a fix hint, never truncate the user's text. Test in Task 4.
2. **`npx skills` fails halfway through a sync:** the lock must record exactly what did get installed, so a rerun finishes the job and `remove` cleans up correctly. Test in Task 7.
3. **Hand-edited `.claude/settings.json` / `.mcp.json` with the user's own plugins, servers and other keys:** survive `add`, `switch` and `remove` untouched. Test in Task 5.
4. **`loadouts claude` in a project without `.mcp.json`:** still passes `--strict-mcp-config`, omits `--mcp-config` (a missing file would crash Claude). Test in Task 10.
5. **`loadouts codex` when `~/.codex/auth.json` does not exist:** exit 3 with "run `codex login` first". It must never start Codex in a way that writes credentials into the project. Test in Task 10.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `src/cli.ts` | Entry point: argument parsing, dispatch, error → exit code |
| `src/errors.ts` | `CliError` |
| `src/help.ts` | Help text and examples per command |
| `src/paths.ts` | Home, config, cache and project paths; `writeIfChanged` |
| `src/config.ts` | User config read/write, `setup` |
| `src/lock.ts` | Lock types, read/write, `init` |
| `src/loadout.ts` | Loadout types, YAML validation, selection resolution, artifact derivation |
| `src/catalog.ts` | Git-backed catalog: fetch, resolve ref, read loadouts |
| `src/agentsmd.ts` | Managed `AGENTS.md` section, `CLAUDE.md` import |
| `src/claude.ts` | Merge `.claude/settings.json` and `.mcp.json` |
| `src/codex.ts` | Generate `.loadouts/codex-home/`, `.gitignore` entry |
| `src/skills.ts` | `npx skills` wrapper |
| `src/mcpcheck.ts` | MCP reachability (stdio `initialize`, HTTP) |
| `src/sync.ts` | Reconciler and the lock-editing commands |
| `src/globals.ts` | Scan of global installations |
| `src/doctor.ts` | `doctor` |
| `src/launch.ts` | `loadouts claude`, `loadouts codex` |
| `src/prune.ts` | `global prune` |
| `tests/helpers.ts` | Temp HOME/project, fixture catalog repo, CLI runner |
| `tests/fixtures/fake-skills.ts` | Stand-in for `npx skills` |
| `tests/fixtures/mcp-ok.ts` | Minimal stdio MCP server |

---

### Task 1: Scaffold, CLI skeleton, errors, help

**Files:**
- Create: `package.json`, `tsconfig.json`, `.gitignore`, `src/cli.ts`, `src/errors.ts`, `src/help.ts`, `tests/helpers.ts`, `tests/cli.test.ts`

**Interfaces:**
- Produces:
  - `class CliError extends Error { constructor(message: string, code: 1 | 2 | 3, fix?: string) }`
  - `main(argv: string[]): Promise<number>` in `src/cli.ts`. Prints errors as `error: …\nfix: …` and returns the code. Unknown errors → 1. The file ends with `if (import.meta.main) process.exit(await main(Bun.argv.slice(2)))`.
  - `COMMANDS: Record<string, { usage: string; summary: string; examples: string[]; run: (args: string[]) => Promise<number> }>` in `src/cli.ts`. Later tasks register their command by adding an entry. Usage lines are copied from the spec's command block.
  - `helpText(command?: string): string` in `src/help.ts`, built from `COMMANDS`. With no command it shows an overview plus a "Typical flow" block (`setup`, `init`, `add`, `status`, `doctor`). With a command it shows usage, summary, examples and the exit codes.
  - `run(args: string[], opts?: { cwd?: string; env?: Record<string,string> }): Promise<{ code: number; stdout: string; stderr: string }>` in `tests/helpers.ts`. It spawns `bun src/cli.ts`.
  - `tempEnv(): { home: string; project: string; env: Record<string,string> }` in `tests/helpers.ts`. Both directories are fresh. `env` sets `HOME`, `LOADOUTS_CACHE` and `LOADOUTS_SKILLS_CMD=bun <repo>/tests/fixtures/fake-skills.ts`.

- [ ] **Step 1: Write the failing tests** in `tests/cli.test.ts`:
  - `loadouts help` exits 0 and stdout contains `loadouts add` and `Typical flow`.
  - `loadouts help add` exits 0 and contains `Example`.
  - `loadouts nosuch` exits 2, and stderr contains `error: unknown command "nosuch"` and `fix: run loadouts help`.
  - Every key of `COMMANDS` has at least one example (import `COMMANDS` directly).
- [ ] **Step 2:** `bun test tests/cli.test.ts`. Expected: FAIL (module not found).
- [ ] **Step 3:** Implement. `package.json`: `"type": "module"`, `"bin": { "loadouts": "src/cli.ts" }`, scripts `test` = `bun test`, `build` = `bun build --compile src/cli.ts --outfile dist/loadouts`. `.gitignore`: `node_modules/`, `dist/`, `.loadouts/`. `<command> --help` and `-h` print the same as `help <command>`.
- [ ] **Step 4:** `bun test`. Expected: PASS.
- [ ] **Step 5:** Commit `feat: CLI skeleton with help and exit codes`.

### Task 2: Loadout format and catalog

**Files:**
- Create: `src/loadout.ts`, `src/catalog.ts`, `tests/loadout.test.ts`, `tests/catalog.test.ts`
- Modify: `src/cli.ts` (register `list`, `show`), `tests/helpers.ts` (fixture catalog)

**Interfaces:**
- Produces (in `src/loadout.ts`):
  ```ts
  type Harness = "claude-code" | "codex";
  interface McpServer { command?: string; args?: string[]; env?: Record<string, string>; url?: string }
  interface Source { skills?: string[]; plugin?: string; marketplace?: string; mcp?: Record<string, McpServer> }
  interface Item extends Source { claude?: Source; codex?: Source; conventions?: string }
  interface Group { kind: "one_of" | "any_of"; members: Record<string, Item>; default: string[] }
  interface Loadout { name: string; conventions?: string; items: Record<string, Item | Group>; routing: { when: string; use: string[] }[] }
  type Choices = Record<string, string[]>;            // group key → chosen member keys
  interface ActiveItem { id: string; item: Item }      // id: "base/ponytail" or "base/methodology/superpowers"
  parseLoadout(yamlText: string, file: string): Loadout          // throws CliError(1) naming file and field
  defaultChoices(l: Loadout): Choices
  activeItems(l: Loadout, choices: Choices): ActiveItem[]
  sourceFor(item: Item, h: Harness): Source            // common fields overridden field-by-field by claude:/codex:
  artifactsFor(a: ActiveItem, h: Harness): Map<string, McpServer | null>
  ```
  Artifact keys (exact strings, relied on by Tasks 5–9):
  - `skill:<harness>:<identifier>` for each skill identifier, e.g. `skill:codex:obra/superpowers`
  - `plugin:<plugin>`, Claude only, e.g. `plugin:superpowers@superpowers-dev`
  - `marketplace:<name>:<owner/repo>`, Claude only, when `marketplace` is set. `<name>` is the part of `plugin` after `@`.
  - `mcp:<harness>:<server>`, whose map value is the server definition (`null` for all other keys)
- Produces (in `src/catalog.ts`):
  ```ts
  interface CatalogRef { repo: string; ref: string; commit: string }
  openCatalog(repo: string, ref?: string): Promise<CatalogRef>   // ref omitted → highest semver tag, else HEAD
  listLoadouts(c: CatalogRef): Promise<string[]>
  readLoadout(c: CatalogRef, name: string): Promise<Loadout>     // unknown name → CliError(2) listing available names
  ```
  `repo` is `owner/repo` (cloned from `https://github.com/<repo>.git`) or an absolute local path (tests). The bare clone lives at `$LOADOUTS_CACHE/catalogs/<repo with / → __>`. Use `git fetch --tags --force` when it already exists. Files are read with `git show <commit>:loadouts/<name>.yml` and listed with `git ls-tree --name-only <commit> loadouts/`. A missing `git` gives CliError(3).
- `tests/helpers.ts` gains `fixtureCatalog(): string`. It creates a local git repo with the spec's three example loadouts (`base`, `backend`, `frontend`). The frontend MCP server becomes `{ command: bun, args: [<abs>/tests/fixtures/mcp-ok.ts] }`, and the backend `skills: […]` placeholders become `[acme/bun-skills]`, `[acme/py-skills]`, `[acme/go-skills]`. It is tagged `v1.0.0`.

Validation rules `parseLoadout` enforces (each with its own test):
- An entry under `items` is a group if it has `one_of` or `any_of`; `one_of` default is a single string, `any_of` default a list; defaults must name members.
- Routing reference resolution: `skill:<name>` matches a skill identifier whose skill part (after `@`) or repo part (after `/`) equals `<name>`. `mcp:<name>` matches a declared server. `plugin:<name>` matches a plugin whose part before `@` equals `<name>`. A bare name must be an item or group key. Anything else → `CliError(1, 'loadouts/<file>: routing reference "<ref>" points to nothing declared in this loadout')`.
- A `plugin` inside `codex:`, or as a common field while there is no `claude:` override → error "Codex plugins are not supported yet; move the plugin under claude:".
- `name` must equal the file name.

- [ ] **Step 1: Write failing tests:**
  - `defaultChoices(base)` equals `{ methodology: ["superpowers"] }`.
  - `activeItems(base, {methodology:["agent-skills"]}).map(a=>a.id)` equals `["base/methodology/agent-skills","base/ponytail"]`.
  - `artifactsFor` of superpowers for `claude-code` has the keys `plugin:superpowers@superpowers-dev` and `marketplace:superpowers-dev:obra/superpowers`. For `codex` it has `skill:codex:obra/superpowers`.
  - `artifactsFor` of agent-skills for `claude-code` has the key `skill:claude-code:addyosmani/agent-skills`.
  - Each validation rule above, as a separate test.
  - In `tests/catalog.test.ts` with `fixtureCatalog()`: `openCatalog(path)` returns ref `v1.0.0` and a 40-char commit. `listLoadouts` returns `["backend","base","frontend"]`. `readLoadout(c,"nope")` throws code 2. `loadouts list --catalog <path>` and `loadouts show base --json` exit 0.
- [ ] **Step 2:** `bun test tests/loadout.test.ts tests/catalog.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement. `list`/`show` read the catalog from `--catalog`, else the lock, else the user config (Task 3 adds the last two; until then `--catalog` is required). `show` prints items, groups with kind and default, and routing.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Commit `feat: loadout format and git catalog`.

### Task 3: Paths, user config, lock, `setup`, `init`

**Files:**
- Create: `src/paths.ts`, `src/config.ts`, `src/lock.ts`, `tests/config.test.ts`
- Modify: `src/cli.ts` (register `setup`, `init`)

**Interfaces:**
- Produces:
  ```ts
  // paths.ts
  home(): string; configFile(): string; cacheDir(): string
  findProject(cwd: string): string | null           // nearest dir upwards containing loadouts.lock.json
  writeIfChanged(file: string, content: string): boolean   // creates parent dirs; true if written
  // config.ts
  interface UserConfig { catalog: string; harnesses: Harness[] }
  readConfig(): UserConfig                          // missing file → { catalog: "katisfaktion/agent-loadouts", harnesses: ["claude-code","codex"] }
  // lock.ts
  interface Lock { version: 1; harnesses: Harness[]; catalog: CatalogRef | null;
                   loadouts: Record<string, Choices>; installed: Record<string, string[]> }
  readLock(project: string): Lock                   // missing → CliError(2, "no loadouts.lock.json here", "run loadouts init")
  writeLock(project: string, lock: Lock): boolean   // JSON, 2-space indent, sorted keys, trailing newline
  requireProject(cwd: string): string               // findProject or the same CliError(2)
  ```
  `installed` maps artifact key → installed skill names (empty array for non-skill artifacts).
- `setup --catalog <repo> --harness <list>` writes `config.toml` as two plain lines (`catalog = "…"`, `harnesses = [ … ]`). It appends the sentence `Agent setups are managed by \`loadouts\`; see \`loadouts help\`.` to `~/.claude/CLAUDE.md` (claude-code) and/or `~/.codex/AGENTS.md` (codex) only if the sentence is absent. It prints every file it changed.
- `init [--harness <list>]` writes an empty lock in cwd. Harnesses come from the flag, else the config. An unknown harness → exit 2. If a lock already exists with the same harnesses → no change, exit 0. With different harnesses → exit 2 with `fix: use loadouts harness add|remove`.

- [ ] **Step 1: Write failing tests:**
  - `setup` twice: the second run reports nothing changed, and `~/.claude/CLAUDE.md` contains the sentence exactly once.
  - `init --harness codex` creates a lock with `harnesses: ["codex"]`.
  - `init --harness vim` exits 2.
  - `status` in a dir without a lock exits 2 with `fix: run loadouts init` (register a stub `status`; Task 7 fills it in).
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement. Read config with `Bun.TOML.parse`.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Commit `feat: user config, lock file, setup and init`.

### Task 4: Managed `AGENTS.md` section and `CLAUDE.md` import

**Files:**
- Create: `src/agentsmd.ts`, `tests/agentsmd.test.ts`

**Interfaces:**
- Consumes: `Loadout`, `Choices`, `activeItems`, `sourceFor`, `Harness`, `writeIfChanged`.
- Produces:
  ```ts
  renderSection(loaded: { loadout: Loadout; choices: Choices }[], harnesses: Harness[], installed: Record<string, string[]>): string
  spliceSection(existing: string, section: string): string   // throws CliError(1) on unbalanced markers
  ensureClaudeImport(project: string): boolean                // adds "@AGENTS.md" line to CLAUDE.md if absent; creates file if missing
  ```
- Section format (exact):
  ```
  <!-- loadouts:begin -->
  ## Agent loadouts

  Managed by `loadouts` (base, frontend). Change with `loadouts help`, not by editing this section.

  ### When to use what

  | When | Use |
  | --- | --- |
  | Writing, changing or reviewing code | plugin `ponytail` (Claude Code); skills `ponytail`, `ponytail-audit` (Codex) |

  ### Conventions

  - **ponytail:** Terse code, platform features before dependencies.
  <!-- loadouts:end -->
  ```
  Labels come from the referenced item's source per harness: a plugin becomes `` plugin `<name before @>` ``; skills become `` skills `<names>` ``, with names from `installed[skill:<h>:<id>]` and the identifier as fallback; MCP servers become `` MCP server `<name>` ``. A group reference expands to its active members. If both harnesses give the same label, the `(Claude Code)`/`(Codex)` suffixes are dropped. Loadout-level conventions get the loadout name as label. The Conventions heading is omitted when there are none.
- `spliceSection`: replaces the text between the markers inclusive. Without markers it appends `\n` + section (one blank line before it, no doubled blank lines). Removing all loadouts → the section is removed entirely, together with the blank line before it. Bytes outside the section are never changed.

- [ ] **Step 1: Write failing tests:**
  - A user `AGENTS.md` with text above and below an existing section: after splicing, the text outside the markers is byte-identical (spec criterion 4).
  - A file without a trailing newline gets the section appended after exactly one blank line.
  - Begin marker only → throws code 1, and the message contains both `<!-- loadouts:begin -->` and `<!-- loadouts:end -->` (Review Focus 1).
  - A rendered table row for `base` with `methodology: ["agent-skills"]` contains `agent-skills` and not `superpowers`.
  - `ensureClaudeImport` twice → the second call returns false.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Commit `feat: managed AGENTS.md section`.

### Task 5: Harness files: Claude merge and Codex home

**Files:**
- Create: `src/claude.ts`, `src/codex.ts`, `tests/harnessfiles.test.ts`

**Interfaces:**
- Consumes: artifact keys from Task 2, `writeIfChanged`.
- Produces:
  ```ts
  // claude.ts — only touches keys named by artifacts; everything else stays
  applyClaude(project: string, add: Map<string, McpServer | null>, remove: string[]): boolean
  // codex.ts — regenerates the whole file from desired codex MCP servers
  writeCodexHome(project: string, mcp: Record<string, McpServer>): boolean
  codexHome(project: string): string                 // <project>/.loadouts/codex-home
  ensureGitignore(project: string): boolean          // adds ".loadouts/" line if absent
  expandProject(s: McpServer, project: string): McpServer   // replaces {project} in command, args, env values, url
  ```
- Claude: `plugin:x` → `.claude/settings.json` `enabledPlugins[x] = true`. `marketplace:n:repo` → `extraKnownMarketplaces[n] = { source: { source: "github", repo } }`. `mcp:claude-code:n` → `.mcp.json` `mcpServers[n] = expanded def` (an HTTP server is written as `{ type: "http", url }`). Removal deletes exactly those keys. Empty objects are left in place.
- Codex `config.toml`: one `[mcp_servers.<name>]` table per server (`command`, `args`, `env` as an inline table, or `url`), written with `JSON.stringify` for strings. It also gets `[projects."<abs project>"]` with `trust_level = "trusted"`. Then `auth.json` is (re)created as a symlink to `$HOME/.codex/auth.json` when that file exists; an existing correct symlink is left alone.

- [ ] **Step 1: Write failing tests:**
  - Settings that already contain `{"model":"opus","enabledPlugins":{"mine@x":true}}`, and a `.mcp.json` with the user server `own`. Adding then removing `plugin:superpowers@superpowers-dev` + `mcp:claude-code:shadcn` leaves `model`, `mine@x` and `own` unchanged (Review Focus 3).
  - `{project}` in args expands to the absolute project path.
  - `writeCodexHome`: `Bun.TOML.parse` of the output has `mcp_servers.shadcn.command === "npx"`. `auth.json` is a symlink (`lstatSync().isSymbolicLink()`) to `$HOME/.codex/auth.json`. A second call returns false.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Commit `feat: Claude settings merge and generated Codex home`.

### Task 6: `npx skills` wrapper and MCP reachability

**Files:**
- Create: `src/skills.ts`, `src/mcpcheck.ts`, `tests/fixtures/fake-skills.ts`, `tests/fixtures/mcp-ok.ts`, `tests/skills.test.ts`, `tests/mcpcheck.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // skills.ts — command prefix from LOADOUTS_SKILLS_CMD (split on spaces), default "npx -y skills"
  addSkills(project: string, identifier: string, h: Harness): Promise<string[]>   // installed skill names
  removeSkills(project: string, names: string[], h: Harness): Promise<void>
  listSkills(opts: { global: boolean; cwd: string }): Promise<{ name: string; source: string | null }[]>
  // mcpcheck.ts
  checkMcp(s: McpServer, timeoutMs?: number): Promise<{ ok: true } | { ok: false; reason: string }>   // default 10000
  ```
- Real invocations, verified against `npx skills` on 2026-10-29. `--list` cannot be combined with `--json`, so names come from the install result:
  - `owner/repo@skill` → `add owner/repo -s skill -a <agent> -y --json`
  - `owner/repo` → `add owner/repo -s '*' -a <agent> -y --json`
  - Result: a JSON array of `{ name, status }`; return the names where `status === "installed"`. Any other status, or a non-zero exit → `CliError(1, "npx skills could not install <id>: <error>", "check the identifier with: npx skills add <repo> --list")`.
  - Remove: `remove <names…> -a <agent> -y`. List: `ls [-g] --json` → rows containing `name`, `path`, `scope`, `agents`, `source`, `sourceUrl`, and `sourceType`. The adapter returns only `name` and `source`.
  - Approved correction on 2026-10-30: skills 1.7.4 returns `source: null` for skills without provenance metadata. Retain those skills with an unknown source; do not infer repository conflicts from their names.
  - Spawn with `cwd: project`. If the command's binary is not found → CliError(3, …, "install Node.js so npx is available").
- `fake-skills.ts` implements the same CLI surface for tests. A repo listing comes from the env JSON `FAKE_SKILLS` (`{"acme/bun-skills":["bun"], …}`). It creates and deletes `.agents/skills/<name>/SKILL.md` (with `-g`: `$HOME/.agents/skills/…`), stores the source repo in a `.source` file next to it for `ls --json`, and appends each argv to `$FAKE_SKILLS_LOG`. With `FAKE_SKILLS_FAIL=<identifier>` it prints a failed status and exits 1.
- `mcp-ok.ts`: reads one JSON-RPC line and answers `initialize` with `{"jsonrpc":"2.0","id":<id>,"result":{"protocolVersion":"2025-06-18","capabilities":{},"serverInfo":{"name":"ok","version":"0"}}}`.
- stdio check: spawn, write an `initialize` request line (protocolVersion `2025-06-18`), wait for a line with a matching `id` and a `result`, then kill. HTTP check: a POST of the same request to `url` with `Accept: application/json, text/event-stream`. Any HTTP response below 500, including 401, counts as reachable (the auth flow belongs to the harness).

- [ ] **Step 1: Write failing tests:**
  - `addSkills(p, "acme/bun-skills", "codex")` returns `["bun"]`, and the log contains `-a codex`.
  - `FAKE_SKILLS_FAIL=acme/bun-skills` → throws code 1.
  - `checkMcp({command:"bun",args:[mcp-ok]})` → ok.
  - `checkMcp({command:"false"})` → not ok.
  - `checkMcp({command:"sleep",args:["30"]}, 500)` → not ok, and the reason contains `timeout`.
  - `checkMcp({url:"http://127.0.0.1:9"})` → not ok.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Commit `feat: npx skills wrapper and MCP reachability check`.

### Task 7: Reconciler and project commands

**Files:**
- Create: `src/sync.ts`, `tests/sync.test.ts`
- Modify: `src/cli.ts` (register `add`, `remove`, `switch`, `enable`, `disable`, `harness`, `status`)

**Interfaces:**
- Consumes: everything from Tasks 2–6.
- Produces:
  ```ts
  desired(lock: Lock, loadouts: Record<string, Loadout>): Map<string, { itemId: string; mcp: McpServer | null }>
  sync(project: string, lock: Lock, opts?: { check?: boolean }): Promise<{ added: string[]; removed: string[]; files: string[] }>
  ```
- `sync` order:
  1. Read every loaded loadout at `lock.catalog.commit`.
  2. Compute `desired` for all harnesses in `lock.harnesses`.
  3. Diff against `Object.keys(lock.installed)`.
  4. With `check` (default true), run `checkMcp` on every *new* `mcp:` artifact first. A failure → `CliError(1, "MCP server <n> (<itemId>) is not reachable: <reason>", "fix the server definition in the catalog or pick another alternative with --with")`, with nothing written.
  5. Remove skills, delete their lock entries, then add skills, recording each in `lock.installed` immediately.
  6. Write the Claude files, Codex home and `.gitignore`, the `AGENTS.md` section, and the `CLAUDE.md` import (each only for harnesses in the lock), then record the non-skill artifacts.
  7. Write the lock in a `finally` block, so partial progress is kept (Review Focus 2).
  8. Print `+ <key>` / `- <key>` / `wrote <file>` lines, or `Nothing changed.`
- Commands (each edits `lock` and then calls `sync`):
  - `add <loadout>... [--with <l>/<g>=<a>[,<b>]] [--catalog repo@ref]`: the first `add` without a catalog in the lock opens `--catalog`, else the config default. `--catalog` that differs from the lock's catalog → exit 2, `fix: use loadouts update`. New loadouts get `defaultChoices` overridden by `--with`. `--with` for a `one_of` group with more than one value, or naming a non-member → exit 2 with the valid members listed.
  - `remove <loadout>`
  - `switch <l>/<g> <alt>` (one_of only, else exit 2 suggesting enable/disable)
  - `enable|disable <l>/<g> <member>` (any_of only)
  - `harness add|remove <harness>`
  - `status [--json]`: harnesses, catalog `repo@ref (commit[0:7])`, loadouts with choices, installed keys. `--json` prints `{ harnesses, catalog, loadouts, installed }`.
- Conflicts check before writing: two active items that declare the same `mcp:` key with different definitions → `CliError(1)` naming both item ids.

- [ ] **Step 1: Write failing end-to-end tests** (via `run()` against `fixtureCatalog()` and fake skills):
  - `init --harness claude-code,codex` + `add base frontend backend --catalog <path>` exits 0. Then `.claude/settings.json` enables `superpowers@superpowers-dev` and `ponytail@ponytail`; `.mcp.json` has `shadcn`; the codex home `config.toml` has `shadcn`; `AGENTS.md` has the section; `CLAUDE.md` contains `@AGENTS.md`; `.gitignore` contains `.loadouts/`.
  - Running the same `add` again prints `Nothing changed.`, and the lock file's mtime is unchanged.
  - `switch base/methodology agent-skills` (spec criterion 2): `superpowers@superpowers-dev` is gone from settings, the fake log shows `remove` for the superpowers names under codex and `add addyosmani/agent-skills`, and the `AGENTS.md` row says `agent-skills`, not `superpowers`.
  - `enable backend/runtime go` adds `skill:*:acme/go-skills`; `disable` removes it.
  - `remove frontend` removes `shadcn` from `.mcp.json` and the codex home.
  - With `FAKE_SKILLS_FAIL=acme/go-skills`, `enable backend/runtime go` exits 1, but the lock still lists every artifact installed before the failure. A rerun after unsetting the variable succeeds (Review Focus 2).
  - A frontend catalog variant whose MCP command is `false` → `add frontend` exits 1, and neither `.mcp.json` nor the lock changed.
  - `switch base/nosuch x` exits 2.
- [ ] **Step 2:** `bun test tests/sync.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `bun test`. Expected: PASS.
- [ ] **Step 5:** Commit `feat: reconciler with add, remove, switch, enable, disable, harness, status`.

### Task 8: `update`

**Files:**
- Modify: `src/sync.ts`, `src/cli.ts`, `tests/sync.test.ts`

**Interfaces:**
- Consumes: `openCatalog`, `defaultChoices`, `desired`, `sync`.
- Produces: command `update`. It opens the catalog's latest tag, and for each loaded loadout keeps the existing choices. New groups get defaults; choices for groups that no longer exist are dropped with a printed note. A chosen member that no longer exists → `CliError(1, "<l>/<g>: alternative <a> no longer exists in <repo>@<ref>", "pick one of: <members> with loadouts switch, then run update again")` with nothing changed. It prints `<old ref> → <new ref>`, then `sync`'s `+`/`-` lines.

- [ ] **Step 1: Write failing tests:** after `add base`, tag `v1.1.0` in the fixture with the ponytail conventions changed. `update` moves the lock to `v1.1.0`, keeps `methodology: ["superpowers"]`, and `AGENTS.md` shows the new text. Then tag `v1.2.0` with `superpowers` deleted from the group: `update` exits 1 and the lock is still `v1.1.0`.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Commit `feat: update keeps chosen alternatives`.

### Task 9: Global scan and `doctor`

**Files:**
- Create: `src/globals.ts`, `src/doctor.ts`, `tests/doctor.test.ts`
- Modify: `src/cli.ts`

**Interfaces:**
- Consumes: `desired`, `listSkills`, `checkMcp`, `codexHome`, `readLock`.
- Produces:
  ```ts
  interface GlobalState {
    claudePlugins: string[];     // ~/.claude/settings.json enabledPlugins === true
    claudeSkills: string[];      // dirs with SKILL.md in ~/.claude/skills, minus skillOverrides[name] === "off"
    claudeMcp: string[];         // ~/.claude.json mcpServers keys
    codexMcp: string[];          // ~/.codex/config.toml mcp_servers keys without enabled = false
    codexSkills: string[];       // dirs in ~/.codex/skills except ".system"
    npxSkills: { name: string; source: string | null }[];   // listSkills({ global: true })
  }
  scanGlobals(): Promise<GlobalState>
  interface Finding { kind: "global" | "conflict" | "mcp" | "auth"; message: string; fix: string }
  doctor(project: string): Promise<Finding[]>
  ```
- Checks:
  1. **global:** every global plugin, skill or MCP server not in the project's desired artifacts. Skills match by name against `installed`, plugins by key. `fix`: `` `loadouts global prune` `` (or the per-item command from Task 11).
  2. **conflict:** for each `one_of` group, compute the artifacts of each *non-chosen* member. Plugins are present if enabled in project or global settings; skills are present if any project (`listSkills({global:false})`) or global skill has `source` equal to the identifier's repo (and `name` equal to its `@skill`, if given). `fix`: `` loadouts switch <l>/<g> <member> `` or a remove command.
  3. **mcp:** `checkMcp` on every desired MCP server.
  4. **auth:** codex in harnesses and `.loadouts/codex-home/auth.json` missing or not a symlink to `~/.codex/auth.json`.
- Output: one line per finding plus `  fix: …`, or `No problems found.` `--json` prints `{ findings }`. Exit 1 if there are any findings.

- [ ] **Step 1: Write failing tests** (spec criterion 3), in a project with `base` + `frontend` loaded:
  - `$HOME/.claude/settings.json` enabling `stray@x` → a `global` finding naming `stray@x`, exit 1.
  - Global npx skill `{name:"agent-skills-x", source:"addyosmani/agent-skills"}` (via the fake's `-g` store under `$HOME`) → a `conflict` finding naming `base/methodology`.
  - A catalog variant whose frontend MCP command is `false`, loaded by calling `sync(project, lock, { check: false })` directly → an `mcp` finding naming `shadcn`.
  - A clean setup → `No problems found.`, exit 0.
  - `--json` output parses, and `findings[0].kind` is set.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement. Run the MCP checks in parallel.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Commit `feat: doctor checks the three anti-goals`.

### Task 10: `loadouts claude` and `loadouts codex`

**Files:**
- Create: `src/launch.ts`, `tests/launch.test.ts`
- Modify: `src/cli.ts`

**Interfaces:**
- Produces:
  ```ts
  claudeArgv(project: string, args: string[]): string[]
  codexEnv(project: string, env: Record<string, string | undefined>): Record<string, string | undefined>
  launch(bin: "claude" | "codex", project: string, args: string[]): Promise<number>
  ```
- `claudeArgv`: `["claude", "--setting-sources", "project,local", "--strict-mcp-config", ...(.mcp.json exists ? ["--mcp-config", "<abs>/.mcp.json"] : []), ...args]`.
- `codexEnv`: `{ ...env, CODEX_HOME: codexHome(project) }`.
- `launch`:
  - `Bun.which(bin)` missing → CliError(3, "<bin> not found on PATH", "install it, then rerun").
  - For codex: `$HOME/.codex/auth.json` missing → CliError(3, "Codex is not logged in", "run `codex login` first, then rerun loadouts codex"). Otherwise call `writeCodexHome` to refresh the symlink.
  - Spawn with inherited stdio and cwd = project, and return the child's exit code.
  - Everything after the subcommand is passed through untouched, including flags. `parseArgs` must not see these args.

- [ ] **Step 1: Write failing tests:**
  - `claudeArgv` without `.mcp.json` contains `--strict-mcp-config` and not `--mcp-config` (Review Focus 4).
  - With `.mcp.json` it contains `--mcp-config` followed by the absolute path.
  - Passed args `["-p","hi","--model","x"]` end the argv unchanged.
  - `loadouts codex` with no `$HOME/.codex/auth.json` exits 3, and `.loadouts/codex-home/auth.json` does not exist (Review Focus 5).
  - `PATH` without `claude` → `loadouts claude` exits 3.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Commit `feat: isolated start for Claude Code and Codex`.

### Task 11: `global prune`

**Files:**
- Create: `src/prune.ts`, `tests/prune.test.ts`
- Modify: `src/cli.ts`

**Interfaces:**
- Consumes: `scanGlobals`, `GlobalState`.
- Produces: `prune(yes: boolean): Promise<string[]>`. It returns the planned or applied change lines.
- Plan, printed under `These changes affect all projects:`:
  - Claude plugin → set `enabledPlugins[p] = false` in `~/.claude/settings.json`.
  - `~/.claude/skills/<n>` → set `skillOverrides[n] = "off"`.
  - Codex MCP server → insert `enabled = false` on the line after `[mcp_servers.<n>]` in `~/.codex/config.toml`, unless an `enabled` line is already in that table. This is a text edit because Bun has no TOML writer; mark it with a `// ponytail:` comment.
  - Not changed, only listed with the exact command to run by hand:
    - `~/.claude.json` MCP servers → `claude mcp remove -s user <n>`
    - npx global skills → `npx skills remove -g <n>`
    - `~/.codex/skills/<n>` → `rm -r ~/.codex/skills/<n>`
- Without `--yes`, print the plan, then `Run again with --yes to apply.`, and exit 0. With `--yes`, apply and print the same lines in past tense. Prune is global and does not need a project.

- [ ] **Step 1: Write failing tests:**
  - Without `--yes`, the global files are byte-identical afterwards.
  - With `--yes`, `stray@x` becomes `false`, the global skill gets `"off"`, and the codex server `foo` gets `enabled = false`; other keys and comments in `config.toml` are unchanged.
  - Running `--yes` twice → the second run plans nothing.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Commit `feat: global prune with explicit confirmation`.

### Task 12: Release pipeline and README

**Files:**
- Create: `.changeset/config.json`, `.github/workflows/release.yml`, `.github/workflows/test.yml`, `README.md`
- Modify: `package.json` (`"private": true`, devDependency `@changesets/cli`)

**Interfaces:**
- `test.yml`: on push and PR, run `bun install` and `bun test` on ubuntu-latest.
- `release.yml`: on push to `main`, use `changesets/action` with `version: bunx changeset version` and no publish step. When the version PR is merged (the `package.json` version has no tag yet), it:
  - builds `bun build --compile --target=<t> src/cli.ts --outfile dist/loadouts-<t>` for `bun-linux-x64`, `bun-linux-arm64`, `bun-darwin-x64`, `bun-darwin-arm64` and `bun-windows-x64`;
  - runs `gh release create v<version> dist/*`.
- README: what it is, install (download the binary from Releases into `PATH`), the typical flow (`setup`, `init`, `add`, `doctor`, `loadouts claude`), and a pointer to `loadouts help`.

- [ ] **Step 1:** Write the files.
- [ ] **Step 2:** `bun run build && ./dist/loadouts help`. Expected: exit 0 and the help overview.
- [ ] **Step 3:** `bunx changeset status`. Expected: runs without error.
- [ ] **Step 4:** Commit `chore: release pipeline with changesets and compiled binaries`.

### Task 13: Seed catalog and acceptance run

**Files (in a sibling repo `~/codex/agent-loadouts`, not this one):**
- Create: `loadouts/base.yml`, `loadouts/frontend.yml`, `loadouts/backend.yml`, `README.md`

**Interfaces:**
- Contents: the spec's three examples, with real skill sources for the backend runtimes. Pick them with `npx skills find bun|python|go`, run `npx skills add <repo> --list` to confirm names, and ask Kai to confirm the picks. Validate locally with `loadouts show <name> --catalog ~/codex/agent-loadouts`, then tag `v0.1.0`.
- Creating and pushing the GitHub repo `katisfaktion/agent-loadouts` is outward-facing: ask Kai before `gh repo create`.

- [ ] **Step 1:** Write the loadouts, then commit and tag them in the sibling repo.
- [ ] **Step 2: Criterion 1:** in an empty temp dir, run `time (loadouts init --harness claude-code,codex && loadouts add base frontend backend --catalog ~/codex/agent-loadouts)`. Expected: exit 0, under 60 s real time.
- [ ] **Step 3: Criterion 6, Claude Code:** `loadouts claude -p ok --output-format stream-json --verbose --max-turns 1`. Expected: the `init` event's `plugins` contains no plugin that is enabled only in `~/.claude/settings.json`, and its `skills` contains nothing from `~/.claude/skills`.
- [ ] **Step 4: Criterion 6, Codex:** `CODEX_HOME=.loadouts/codex-home codex mcp list`. Expected: only `shadcn`.
- [ ] **Step 5: Criterion 5:** in a fresh project, start an agent with only `loadouts help` available and the prompt "Load my backend loadout". Expected: it runs `init` + `add backend` without asking back. Record the transcript outcome in the PR description.
- [ ] **Step 6:** Commit any fixes this run caused in the CLI repo.
