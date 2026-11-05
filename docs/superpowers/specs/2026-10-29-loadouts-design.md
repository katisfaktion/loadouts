# loadouts: Design

As of: October 29, 2026. From the conversation between Kai and Claude; decisions made by the AI are marked as such at the end.

## Intent

Kai wants to declare agent setups per use case and attach them to projects, instead of installing plugins, skills and MCP servers globally. Each project loads only what it needs.

**Problem today:** Setup is repeated constantly, and it is unclear what is already installed globally. Loaded skills and MCP servers often go unused unless `AGENTS.md` says when they are meant to be used; memory entries are weaker for this than `AGENTS.md`.

## Terms

| Term | Meaning |
| --- | --- |
| **Harness** | The coding agent itself: Claude Code, Codex. |
| **Loadout** | Declaration for a use case (e.g. `frontend`, `backend`, `infra`): items, groups, routing, conventions. |
| **Item** | Something loadable: skills, a plugin, MCP servers, plus convention text and routing lines. Sources can differ per harness. |
| **Group** | Freely named set of items in a loadout. `one_of`: exactly one active (exclusive or). `any_of`: any subset. Both with a default. |
| **Catalog** | GitHub repo with loadouts, versioned via Git tags. Default: `katisfaktion/agent-loadouts`. |
| **Lock file** | In the project: which harnesses, loadouts, chosen alternatives and catalog version are loaded. |

## Goals

- New project: fully set up in **one minute**, no further thought needed afterwards.
- Existing project: switched to suitable loadouts in **a few minutes**.
- Harnesses: **Claude Code** and **Codex**.
- Good DX and agent experience: given "Load my backend loadout", an agent should manage on its own with just the CLI.

## Must not happen (anti-goals)

1. Global plugins or skills are active even though the project does not need them.
2. Competing plugins or skills are active at the same time (e.g. `obra/superpowers` and `addyosmani/agent-skills`).
3. A declared MCP server later becomes unreachable without anyone noticing.

## Non-goals

- Publishing on npm.
- Different skills per team member (YAGNI, only Kai uses it).
- Multiple catalogs at the same time.
- Different alternatives per harness within one project.
- Codex plugins in version 1 (Codex has its own plugin ecosystem; later).

## Repos

- `katisfaktion/loadouts`: the CLI, command `loadouts`.
- `katisfaktion/agent-loadouts`: the catalog.

## Technology and distribution

- **Bun + TypeScript.** Shipped as a single binary per platform (`bun build --compile`), attached to **GitHub Releases**.
- **Versioning with Changesets**, without npm: the release action builds the binaries and creates the release.
- **Skill installation via `npx skills`** (including `skills-lock.json` in the project); the CLI does not reimplement it.

## Loadout format (in the catalog)

One file per loadout, `loadouts/<name>.yml`.

```yaml
name: base
items:
  methodology:                        # group, freely named
    one_of:
      superpowers:
        claude: { plugin: superpowers@superpowers-dev, marketplace: obra/superpowers }
        codex:  { skills: [obra/superpowers] }
      agent-skills:
        skills: [addyosmani/agent-skills]          # no harness given: applies to all
    default: superpowers
  ponytail:
    claude: { plugin: ponytail@ponytail, marketplace: DietrichGebert/ponytail }
    codex:  { skills: [DietrichGebert/ponytail] }
    conventions: Terse code, platform features before dependencies.
routing:
  - when: Planning, specifying or implementing a feature
    use: [methodology]                # reference to a group → active alternative(s)
  - when: Writing, changing or reviewing code
    use: [ponytail]
```

```yaml
name: backend
items:
  runtime:
    any_of:
      bun:    { skills: […], conventions: bun for scripts and CLIs. }
      python: { skills: […], conventions: Python only for AI/ML. }
      go:     { skills: […], conventions: Go for infrastructure and systems. }
    default: [bun]
```

```yaml
name: frontend
items:
  shadcn:
    skills: [shadcn/ui@shadcn]
    mcp:
      shadcn: { command: npx, args: [shadcn@latest, mcp] }
routing:
  - when: Adding or changing UI components, e.g. "add a button with shadcn"
    use: [skill:shadcn, mcp:shadcn]
```

Rules:

- **Sources:** Fields without `claude:`/`codex:` apply to all harnesses; `claude:`/`codex:` override per harness.
- **Skill identifiers:** `owner/repo` loads all skills of the repo, `owner/repo@skill` exactly one (same notation as `npx skills`).
- **Plugin or skills:** Individual skills via `npx skills` when only selected ones are needed. A plugin only when it adds real value (hooks, commands, MCP servers) and that value justifies possibly loading many unneeded skills along with it.
- **MCP:** `command`/`args`/`env` (stdio) or `url` (HTTP). Placeholder `{project}` = project path.
- **Routing references:** `skill:<name>`, `mcp:<name>`, `plugin:<name>`, an item key or a group name. Every reference must point to something declared in the loadout; the CLI checks this when loading.
- **Conventions:** Free text per item (and optionally per loadout), placed next to the routing in `AGENTS.md`. Languages and tools with their own skills (bun, Python, Go, Claude Design) are ordinary items.
- **Groups** belong to the loadout and are addressed as `<loadout>/<group>`.

## Files in the project

| File | Contents | Owner |
| --- | --- | --- |
| `loadouts.lock.json` | Harnesses, catalog (`repo@ref` + commit), loadouts, chosen alternatives, what was installed | CLI |
| `AGENTS.md` | Section between `<!-- loadouts:begin -->` and `<!-- loadouts:end -->`: routing table and conventions. The rest belongs to the project. | CLI (only the section) |
| `CLAUDE.md` | contains `@AGENTS.md` (added if missing) | Project |
| `.claude/settings.json` | `extraKnownMarketplaces`, `enabledPlugins` (merged, not overwritten) | Shared |
| `.mcp.json` | MCP servers for Claude Code (merged) | Shared |
| `.claude/skills/`, `.agents/skills/`, `skills-lock.json` | Skills | `npx skills` |
| `.loadouts/codex-home/` | Generated `CODEX_HOME` for `loadouts codex`; gitignored | CLI |

The routing table in `AGENTS.md` names the exact identifiers the agent sees in its tool list.

## User configuration

`~/.config/loadouts/config.toml`: default catalog and the harnesses Kai uses at all.

## Commands

```sh
loadouts setup --catalog katisfaktion/agent-loadouts --harness claude-code,codex   # once per machine
loadouts init --harness claude-code,codex       # once per project
loadouts list | show <loadout>
loadouts add <loadout>... [--with <loadout>/<group>=<choice>[,<choice>]] [--catalog repo@ref]
loadouts switch <loadout>/<group> <alternative>     # one_of
loadouts enable|disable <loadout>/<group> <member>  # any_of
loadouts remove <loadout>
loadouts update                                 # latest catalog version, shows changes
loadouts harness add|remove <harness>           # applies to all loaded loadouts
loadouts status
loadouts doctor
loadouts claude [args...]                       # start Claude Code with only the project's loadouts
loadouts codex [args...]                        # start Codex with only the project's loadouts
loadouts global prune [--yes]                   # turn off global leftovers, after confirmation
loadouts help [command]
```

### Isolated start instead of global changes

Preferred approach against anti-goal 1 (Kai, October 29): global installations are not touched, but hidden at startup.

- **`loadouts claude`** starts `claude --setting-sources project,local --strict-mcp-config --mcp-config .mcp.json` plus passed-through arguments. User-wide settings (including globally enabled plugins) and foreign MCP servers stay out; only what `loadouts` has entered in the project applies.
- **`loadouts codex`** starts `codex` with `CODEX_HOME` pointing to a project-specific directory that the CLI generates from the loadouts (MCP servers, skills, later plugins). This also lets Codex get project-local MCP servers without changing the user configuration. The directory is `.loadouts/codex-home/` (gitignored), and its `auth.json` is a symlink to `~/.codex/auth.json` (see Resolved questions).
- `--bare` (Claude Code) is unsuitable: no OAuth login, no automatic `CLAUDE.md`.
- `doctor` warns when global plugins, skills or MCP servers exist that would be active when starting directly without `loadouts`.

### What applies where: terminal, desktop apps, cloud

| Environment | What applies | Role of `loadouts` |
| --- | --- | --- |
| Cloud sessions (Claude Code on the web, Codex Cloud) | Fresh container with the cloned repo; local global installations do not exist there. | Project files must be checked in; then exactly the loadout applies. |
| Desktop apps on your own machine | Project files **and** user-wide settings; no startup options. | Project files take effect; global leftovers can only be avoided by keeping global settings as empty as possible. |
| Terminal | Like desktop, but with startup options. | `loadouts claude` / `loadouts codex` hide global state. |

This results in layering:

1. **Project files are the foundation** and take effect everywhere. They are checked in.
2. **The isolated start is an add-on for the terminal.**
3. **For the desktop apps:** keep as little as possible installed globally. `doctor` shows what interferes globally; **`loadouts global prune`** turns it off after explicit confirmation (`--yes` for agents) and first lists exactly what changes for all projects. Whatever reaches the project via loadouts can gradually be removed globally.

### Commands in detail

- **`setup`** writes the catalog to the user configuration and a single hint sentence into the user-wide `CLAUDE.md` or `AGENTS.md` (the only deliberately global thing), e.g. "Agent setups are managed by `loadouts`; see `loadouts help`." Shows what was written.
- **`init`** creates the lock file and records the project's harnesses. There is no per-command `--harness`.
- **`add`** uses defaults unless `--with` overrides them. Checks before writing: references, conflicts, MCP reachability.
- **`switch`/`enable`/`disable`** uninstall and install the affected items and update routing and conventions.
- **`doctor`** checks the three anti-goals: globally active plugins/skills/MCP servers that do not belong to the project; two active members of a `one_of` group (also global versus project-local); reachability of every MCP server (stdio: start + `initialize` with timeout; HTTP: request). Changes nothing, suggests commands. Global sources: `~/.claude/settings.json` (`enabledPlugins`), `~/.claude/skills/`, global skills from `npx skills`, `~/.codex/config.toml` (`mcp_servers`) and the global Codex skills.
- **`remove`** and deselecting an alternative remove exactly what the lock file records as installed for that item (plugins from `.claude/settings.json`, skills via `npx skills remove`, MCP entries), unless another loaded item still needs it.
- **`update`** takes over new catalog contents but keeps the alternatives chosen in the project. If a chosen alternative disappears from the catalog, `update` aborts with an explanation.

## DX and agent experience

- No command asks interactively; everything via arguments and options.
- `--json` for `list`, `show`, `status`, `doctor`.
- Clear exit codes: 0 success, 1 check failed (e.g. doctor finds problems), 2 usage error, 3 environment missing (e.g. `npx` or `codex` not found).
- `help` with examples per command, written so that an agent can derive the right invocation from it.
- Error messages say what went wrong and how to fix it.
- Idempotent: running the same command twice changes nothing the second time.

## Success criteria (verifiable)

1. In an empty folder, `loadouts init` + `loadouts add base frontend backend` set up Claude Code and Codex in under one minute (with network available; time measured).
2. `loadouts switch base/methodology agent-skills` removes superpowers completely and loads agent-skills; routing lines switch along with it.
3. `loadouts doctor` reports a deliberately globally installed, undeclared plugin, a deliberate `one_of` conflict and a deliberately unreachable MCP server, each with exit code 1.
4. An existing `AGENTS.md` stays unchanged outside the marked section.
5. An agent accomplishes "Load my backend loadout" in a fresh project with only `loadouts help` and without asking back.
6. With a globally enabled, undeclared plugin, a session started via `loadouts claude` does not show that plugin; a session started via `loadouts codex` shows only the project's MCP servers.

## Resolved questions

Checked locally on October 29, 2026 with Claude Code 2.1.311 and codex-cli 0.162.1 (WSL2). The runs were started from inside a Claude desktop app session and inherited its environment.

- **`--setting-sources project,local` hides `~/.claude/skills/`: yes.** A temporary probe skill in `~/.claude/skills/` was listed in the session's `init` event without the option and was missing with it. With the option, project skills in `.claude/skills/` still load, and a plugin enabled in the project's `.claude/settings.json` (`ponytail@ponytail`, already in the plugin cache) loads too. Globally enabled plugins, `skillOverrides` from user settings, and the claude.ai MCP connectors disappear. `CLAUDE_CONFIG_DIR` is not needed. Three `cc-plugin-*` plugins stayed visible; they come from the desktop host, not from user settings, and should not show up in a plain terminal.
- **Codex keeps its login with `CODEX_HOME` in a project directory: only if `auth.json` is brought along.** An empty `CODEX_HOME` reports `Not logged in`. A copy of `~/.codex/auth.json` and a symlink to it both report `Logged in using ChatGPT`, and `codex exec` works with the symlink from a directory inside the project. Decision: **symlink**, never copy. A copy would split the refresh token: whichever side refreshes first rotates it and can log the other side out. Not covered by the test: whether a token refresh writes through the symlink or replaces it. No refresh happened during the test. `doctor` checks that `auth.json` in the generated home is still a symlink to `~/.codex/auth.json`.
- **Side effects of a custom `CODEX_HOME`:** Codex writes its whole state there (`sessions/`, `*.sqlite`, `cache/`, `skills/`, `plugins/`, `models_cache.json`). So the generated home is per-project state: it lives at `.loadouts/codex-home/`, is listed in `.gitignore`, and session history and `codex resume` only see sessions started through `loadouts codex`. `codex mcp list` with that home showed only the MCP servers from its `config.toml`; the global `mcp_servers` were gone.

## Open questions

- **Desktop apps:** Do the Claude and Codex apps honor `CLAUDE_CONFIG_DIR` or `CODEX_HOME` when started with the environment variable set? If so, an isolated start would be possible there too.
- **Codex and project-local MCP servers without `loadouts codex`:** A test with `.codex/config.toml` in the project was not shown by `codex mcp list` (possibly only for trusted projects). With the isolated start via `CODEX_HOME` the problem largely goes away.
- **Codex plugins** as a separate source type (later).
- **Exact skill names** in repos like `shadcn/ui` and `cloudflare/skills` are resolved by the CLI at load time via `npx skills add <repo> --list`.
- **Source for the diagram skill** in the catalog is still missing.
- **Merging with conflicting rules** in an existing `AGENTS.md` may be done by an agent; the source of truth remains the loadout. Whether the CLI offers its own help for this is open.

## AI decisions (to review)

- Name of the lock file `loadouts.lock.json` and the user configuration `~/.config/loadouts/config.toml`.
- Markers `<!-- loadouts:begin/end -->` for the managed section.
- Exit codes 0/1/2/3.
- `doctor` changes nothing itself but suggests commands, because global changes affect all projects.
- Catalog version is stored as a Git ref plus resolved commit.
- Generated Codex home at `.loadouts/codex-home/`, gitignored, with `auth.json` symlinked rather than copied.
