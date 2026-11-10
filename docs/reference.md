# Configuration and workflow reference

For a first installation, follow the [README](../README.md). Use `loadouts help COMMAND` for flags and examples.

- [Select sources and restore a checkout](#project-manifest-and-installation)
- [Write loadout YAML and choices](#compose-and-adapt-reusable-entries)
- [Select package companion skills](#package-companion-skills)
- [Configure agents and diagnose a project](#agent-configuration-and-diagnostics)
- [Use native Codex plugins](#native-codex-plugins) or [the codebase-memory installer](#installer-integrations)
- [Explore with an agent](#agent-assisted-exploration)
- [Maintain a shared catalog](#shared-catalog-repositories) and [contribute a local loadout](#publish-a-verified-loadout)
- [Release the CLI](#releasing-the-cli)

## Project manifest and installation

Commit `loadouts.json` at the project root. It selects the agents and the loadouts you want directly. Here, the project uses a released software development workflow and a local definition for its own tooling.

```json
{
  "harnesses": ["claude-code", "codex"],
  "loadouts": {
    "sdlc": {"source": "github:katisfaktion/agent-loadouts/sdlc@v0.1.0"},
    "bun-cli": {"source": "file:./.loadouts/catalog/bun-cli.yml"}
  }
}
```

`loadouts init` creates an empty manifest and a local catalog. Project commands find the nearest project from the current directory or its ancestors. Use `add`, `remove`, `switch`, `enable`, `disable` and `harness` to change your selections and apply them in one step. These commands also apply pending manifest edits, keeping unrelated local YAML at its last applied contents. After editing a selected YAML file directly, run `loadouts install`.

### Which source will be used?

| Source | Resolution |
| --- | --- |
| `file:./.loadouts/catalog/testing.yml` | The file in this project. The selection key, filename stem and YAML `name` must match. |
| `github:OWNER/REPO/testing@REF` | The entry at a tag, branch or commit in a GitHub catalog. |
| `github:OWNER/REPO/testing` | The highest version-sorted stable tag of the form `vX.Y.Z` or `X.Y.Z`. Falls back to the clone's HEAD if none exists. |
| `file:/absolute/catalog#testing@REF` | A local Git catalog, useful for testing. The ref is optional. The absolute path is machine-specific and cannot contain `@` or `#`. |

Set a machine default with `loadouts setup --catalog OWNER/REPO`. A new short name such as `loadouts add testing` uses the shared catalog. Re-adding an existing name keeps its selected source. Use the full source to switch between a project file and a shared definition. If the source changes, `add` shows both sources and asks for confirmation before applying anything. Scripts can approve with `--yes`. Existing explicit choices must be valid in the replacement.

`loadouts list` shows local and shared entries. `doctor` explains a same-name collision and identifies the selected source. `show NAME` follows the project's selection. Use `show NAME --catalog OWNER/REPO` to inspect another catalog.

### What install and update do

| | `loadouts install` | `loadouts update` |
| --- | --- | --- |
| Shared definitions | Reuse locked commits. Resolve new or changed sources. | Resolve again within each declared ref. An immutable tag or commit stays fixed. |
| Selected local definitions | Read current YAML, including reachable local includes. | Keep the applied local snapshots. |
| Git skills | Restore missing locked skills and repair agent links. Discover newly selected skills. | Fetch selected skill contents and record their hashes. |
| Package companion skills | Sync from the installed application dependency. | Also uses the installed package version. |
| Codex plugins | Restore missing plugin cache entries. | Refresh selected marketplaces and plugins. |

During a slow operation, an interactive terminal shows the current step and elapsed time on stderr. A complete, unchanged install reports `Nothing changed.` A failed apply records completed work and outstanding ownership so you can fix the reported cause and retry.

### Files to commit

| Path | Contents |
| --- | --- |
| `loadouts.json` | Direct selections, sources, explicit choices and harnesses. [Manifest schema](../schemas/v1/manifest.schema.json) |
| `loadouts.lock.json` | Applied setup, format 1. `roots` records direct requests, `includes` active edges and `loadouts` effective choices. The lock also records resolved commits, local YAML snapshots and managed artifacts. |
| `skills-lock.json` | Native skills lock. Git entries record sources and verification hashes. Package entries also identify their package. |
| `.loadouts/catalog/*.yml`, `.loadouts/.gitkeep`, `.gitignore` | Project definitions, portable project directory and ignore rules. |
| `AGENTS.md`, `CLAUDE.md` and shared native settings | Project instructions, Claude settings, `.mcp.json`, `.codex/config.toml`, and any managed Codex profiles or hooks. |

Commit your application's package lock when using companion skills. Downloaded skill directories and their Claude links can stay ignored. Keep skills authored by your project in Git. Keep machine-local receipts, agent caches and credentials on the machine.

### Restoring Git skills

Loadouts chooses the skills installer from **the version of `skills-lock.json`**. New projects and version 2 locks use `skills@1.8.0`. Version 1 locks use `skills@1.7.6` because the two formats hash identical files differently. Plain `install` chooses the compatible installer automatically. This version is independent of `loadouts.lock.json`.

A new Git selection uses `skills add`. Repository owner and name match case-insensitively. A skill name after `@` identifies one skill. For a missing locked skill, loadouts stages just the needed entries and runs `skills experimental_install --frozen-lockfile`. Codex reads the restored directory under `.agents/skills/`. Claude uses a link from `.claude/skills/`. Repairing a missing link does not require a download. Existing skill folders are not rehashed. Loadouts converts an existing Claude copy to a link only when the entire directory matches.

If you set `LOADOUTS_SKILLS_CMD` to pin the installer as a workaround in 0.1.0, unset it before running `loadouts install` so the CLI can choose the version that matches each project.

| If installation reports… | What to do |
| --- | --- |
| A frozen hash mismatch or missing entry | Restore the matching lock and full skill folder, including supporting files, from a trusted checkout or backup. |
| No verified hash for a missing skill | Skills 1.8 can leave an empty hash when migrating a lock. Other entries remain usable. Recover a verified copy, or review the current upstream contents and run `loadouts update` to accept them. |
| An unsupported skills-lock version | Use a loadouts release that supports that format. Changing the version number by hand can pair the entries with the wrong hash algorithm. |
| A locally modified skill directory conflicts with installation | Save your edits and move the conflicting directory aside before retrying. |

Review the lockfile diff after an update. A catalog commit pins its YAML. The Git skill hash can verify a download, but cannot recover files that disappeared upstream. Plugin marketplaces can serve newer contents. For long-term availability, keep trusted copies of the complete skill folders.

## Compose and adapt reusable entries

One YAML file describes one loadout. Use root-level `conventions` for instructions that apply whenever the loadout is selected. Put instructions specific to an item or a choice on that item. A `routing` row names a task and the active items or components that should handle it.

```yaml
name: testing
conventions: Run the affected suite before submitting a change.
items:
  languages:
    any_of:
      python:
        items:
          framework:
            one_of:
              pytest:
                conventions: Use pytest fixtures for shared test setup.
              unittest:
                conventions: Use unittest test cases and assertions.
            default: pytest
    default: []
routing:
  - when: Writing or changing Python tests
    use: [languages/python/framework]
```

`one_of` has one selected member and takes a scalar YAML default. `any_of` takes an array and can default to `[]`. An inactive branch contributes no routing or conventions. After selecting the loadout, run these commands on a feature branch.

```sh
loadouts enable testing/languages python
loadouts switch testing/languages/python/framework unittest
```

The manifest stores both choices as arrays, for example `{"languages":["python"],"languages/python/framework":["unittest"]}` inside the selection's `choices`. Paths include the parent member names. Omit a choice to accept an include's request or the YAML default. Write `[]` to explicitly select no members of an `any_of` group. Switching away from a parent removes that direct selection's requests for its inactive descendants. Re-enabling it uses defaults. A hand-edited request for an inactive descendant is an error.

### Include another loadout

Select independent concerns directly in `loadouts.json`. If several projects need the same combination, write a loadout with `includes`. A composition can consist entirely of includes. In this example, each framework choice includes its own loadout.

```yaml
name: frontend
items:
  framework:
    one_of:
      react:
        includes:
          react:
            source: github:your-org/agent-loadouts/react
      vue:
        includes:
          vue:
            source: github:your-org/agent-loadouts/vue
    default: react
```

Replace the example sources with entries in your catalog. Each include key must match its target's name. It takes a full `source` and optional `choices` in the same form as a manifest selection. Put these declarations on the common item, outside `claude` and `codex`. A project definition can include another project file. Shared catalog definitions must use shareable sources for publication.

Only active includes are resolved. Multiple paths to the same entry share one installation. All active requests for a name must agree on its source string and any explicit choice for the same group. Different explicit choices conflict, even for `any_of`. The CLI reports incompatible component definitions and cycles with their origins. Ask the agent to check for contradictory prose conventions across the selected loadouts and existing instructions.

`status --json` shows direct selections, active choices and include edges. To change an included-only child's choice, edit its parent's include request or add the child as a direct selection with the same source and compatible choices. Removing a parent retains children still required elsewhere. Routing paths refer to the declaring loadout's items, groups, members or components (`skill:NAME`, `plugin:NAME`, `mcp:NAME`). Each included loadout brings its own routing.

## Package companion skills

Use `skills: [owner/repo@skill]` for a GitHub skill. Use `packageSkills` when the instructions ship with the library your project actually runs. This example selects the Optique skill from the installed `@optique/core` dependency.

```yaml
name: cli
items:
  parser:
    packageSkills:
      include: ["@optique/core#optique"]
routing:
  - when: Changing CLI options or argument parsing
    use: [parser]
```

Select a package name to include all its companions, including ones added in future package versions. Use `package#skill` to select one, or list exceptions in `exclude`. Each exclusion applies to its own item. A harness override replaces the item's selection for that harness. Use `include: []` there to disable it.

After a dependency upgrade, install the application dependencies and run `loadouts install`. The CLI uses the installed package, copies its selected skills and updates the locks. It supports workspace package directories and pnpm symlinks. A missing package produces a diagnostic. A present package missing an explicitly requested skill is an error.

Discovery uses `skills experimental_sync` with local copies, remote fetches disabled and cleanup disabled. Supported layouts include a root `SKILL.md`, `skills/NAME/SKILL.md` and `dist/skills/NAME/SKILL.md`, including TanStack Intent package skills. This requires a `node_modules` installation. Companion payloads must contain ordinary files and directories.

To replace a Git skill with its package companion of the same name, remove the Git selection and add the companion in the same edit, then install. Loadouts checks the native lock and ownership before transferring the skill. Retained same-name skills from another source or conflicting unmanaged files require resolution first.

## Agent configuration and diagnostics

`setup` writes machine defaults and a `LOADOUTS.md` help reference beside each selected agent's global instructions. Project selections live in the project. Open Claude Code, Codex CLI or Codex Desktop normally to use their native project files. `loadouts claude` and `loadouts codex` add a read-only preflight and forward your arguments. Each agent keeps its normal personal configuration, authentication and trust settings. Use `loadouts help codex` or `loadouts help claude` for launcher help.

| Command | What it tells you |
| --- | --- |
| `loadouts status` | Selected sources and choices, pending changes and installation state. |
| `loadouts doctor` | Missing files, edited local definitions, source collisions, active unselected alternatives and possible duplicate integration hooks. Findings concern declarations. Review hook execution in the agent. |
| `loadouts inspect --json` | Project and user skill metadata, plugin declarations, MCP names and transports, manifest and instruction paths. It omits MCP arguments, URLs and credentials. Unreadable metadata produces warnings with the remaining inventory. |
| `loadouts global prune` | A preview of global leftovers. Applying the preview requires `--yes`. Codex plugins are excluded from pruning. |

`list`, `show`, `status` and `doctor` support `--json`. Exit codes are 0 for success, 1 for a failed check or operation, 2 for invalid usage and 3 for a missing environment dependency. Redirected output is plain by default. `NO_COLOR=1` or `NODE_DISABLE_COLORS=1` disables color. `FORCE_COLOR=1` enables it in pipes unless explicitly disabled.

### MCP servers

Declare a stdio server with `command`, `args` and optional `env`, or an HTTP server with `url`. New or changed servers undergo a reachability check during application. This server runs over stdio.

```yaml
name: ui
items:
  components:
    mcp:
      shadcn:
        command: npx
        args: [shadcn@latest, mcp]
```

For `npx`, the generated command adds `--prefix .loadouts`. This avoids npm's project-level package-manager checks in pnpm projects. The server still runs from the project directory. Commit the generated `.mcp.json` or `.codex/config.toml` and the `.loadouts/.gitkeep` marker so the prefix exists on a fresh checkout.

## Native Codex plugins

Prefer an individual skill when you only need its instructions. Select a native plugin when you also want its hooks or other bundled capabilities. Here the Codex plugin provides Ponytail.

```yaml
name: style
items:
  ponytail:
    codex:
      plugin: ponytail@ponytail
      marketplace: DietrichGebert/ponytail
```

The suffix after `@` is the marketplace name in the plugin manifest. The `marketplace` field is the GitHub repository. Claude declarations use the corresponding `claude` block. Remove a skills-only selection when switching to the plugin if both supply the same capability.

Codex requires native `plugin add`, `plugin list` and `plugin marketplace upgrade` with JSON support (tested with Codex 0.162.1). Project enablement lives in `.codex/config.toml`. Loadouts stages missing plugins, imports their validated cache entries into the normal Codex home and preserves unrelated settings. The cache is shared between projects. Removing a project selection keeps the cached plugin available. Trust the project in Codex and review hooks in `/hooks`.

## Installer integrations

The `codebase-memory` adapter uses an existing `codebase-memory-mcp` executable on your `PATH`. Select it in a local or shared loadout.

```yaml
name: memory
items:
  graph:
    installer: codebase-memory
routing:
  - when: Exploring code structure and assessing change impact
    use: [graph]
```

Loadouts runs the upstream configuration installer in a temporary home. It imports the skill, three agent profiles, hooks, MCP declaration and instructions for the selected agents. Keep the manifest, lock, native project configuration and ignore rules in Git. Generated Claude assets, local settings and the machine-local receipt in `.loadouts/installers/` stay ignored. Codex profiles live under `.codex/agents/`, hooks in `.codex/hooks.json` and shared instructions in `AGENTS.md`. A conflict or modified managed asset produces an error so you can save your edits.

On the first install for this project path, the adapter runs `codebase-memory-mcp cli index_repository`. The project appears in the shared index and dashboard. Subsequent installs reuse the receipt, retry failed indexing and repair missing assets. A fresh checkout or a different path gets its own indexing run. Indexing and watching are separate upstream operations. To open the dashboard, use `codebase-memory-mcp daemon start --open`. [Upstream configuration reference](https://github.com/DeusData/codebase-memory-mcp/blob/main/docs/CONFIGURATION.md)

Removing the selection removes its owned project configuration. The shared executable, service and index remain available. Manage global upgrades or index deletion with the upstream CLI. Loadouts records the observed executable version and refreshes project assets when it changes. The adapter was tested on Linux with codebase-memory-mcp 0.12.1. It checks the upstream layout before importing files.

## Agent-assisted exploration

Ask your agent to propose a setup for the project. `loadouts agents` lists the bundled workflows. `loadouts agents explore` prints the exploration guide as Markdown and works offline before initialization. The earlier `loadouts explore` spelling remains an alias. [Exploration skill](../skills/loadouts-explore/SKILL.md)

1. Read the project's manifests and inspect existing project and user tools with `loadouts inspect --json`. Check which native plugins supply hooks as well as skills.
2. Look in the configured catalog first. Read promising entries and their active includes. For unmet needs, run `npx skills find` for each relevant part of the stack and verify candidates against their upstream documentation.
3. Select suitable shared entries in the proposal. For each gap, use `loadouts create NAME` to draft a focused local definition and `loadouts validate .loadouts/catalog/NAME.yml` to check it. Validation checks the file, defaults and routing offline. Installation resolves the include graph.
4. Review the proposed sources, choices and conventions. Apply the approved selections with `loadouts add`. Trying the setup on real work is a separate step.

To adapt a shared entry, `loadouts create NAME --from NAME` uses the project's locked default catalog, falling back to the machine default. For another catalog, create a draft and copy from verified upstream YAML. Record the source path, ref and commit in a comment or review notes so the agent can compare changes later. Creation preserves existing drafts.

## Shared catalog repositories

A catalog is a Git repository with committed definitions directly under `loadouts/`. A consuming project's local definitions live under `.loadouts/catalog/`. The author's [agent-loadouts repository](https://github.com/katisfaktion/agent-loadouts) is a working example.

```text
agent-loadouts/
├── README.md
├── loadouts/
│   ├── testing.yml
│   └── frontend.yml
└── .github/
    └── pull_request_template.md
```

Only the `loadouts/*.yml` files are required. Use one loadout per file and match its `name` to the filename stem. Nested paths and `.yaml` files are outside discovery. Keep the definitions and their destination paths as ordinary files and directories. A README can explain when each entry is useful. The catalog needs no package manifest, index or schema copy.

Validate a working file, then inspect the committed catalog from its root.

```sh
loadouts validate loadouts/testing.yml
loadouts list --catalog "$PWD"
loadouts show testing --catalog "$PWD" --json
```

The last two commands read Git objects. Uncommitted edits are visible to `validate` only. For a tagged catalog, the default view uses its selected release. Use stable, immutable tags for catalog releases.

### Schema versions

`loadouts create` adds an HTTPS schema reference to each draft. Keep it when publishing. This example points to the v1 YAML schema in CLI release 0.1.0.

```yaml
# yaml-language-server: $schema=https://raw.githubusercontent.com/katisfaktion/loadouts/v0.1.0/schemas/v1/loadout.schema.json
```

The Git tag identifies the CLI release. The `schemas/v1/` directory identifies the authoring format. A catalog can release on its own schedule and keep the same schema reference until it uses features from a newer CLI. The schema provides editor completion and flags unknown fields. CLI validation works offline. [Loadout schema](../schemas/v1/loadout.schema.json)

### Publish a verified loadout

Run `loadouts agents publish` to read the bundled publishing guide offline. Use the same name as the upstream entry if you mean to change it. After trying the local setup on real work, ask the agent to diff the draft against its original commit and the catalog's current default branch. Preserve intervening upstream changes. Validate and install the reconciled draft and verify its behavior again.

```sh
loadouts publish testing --catalog OWNER/REPO --summary 'Verified on a regression fix in the CLI project'
```

Replace the sample summary with the work you actually performed. Preview requires an applied local definition and the verified active graph. It checks the local Git cache without contacting GitHub. If pinned definitions are missing, restore the cache with `loadouts install`. Every include in the file being published and in inspected active definitions must use a portable GitHub source, even inside an inactive branch. Publish local dependencies first. Verification covers the selected alternatives only.

Add `--yes` to copy the complete chosen YAML into `loadouts/NAME.yml` on a contribution branch and open a PR with authenticated `gh`. Includes keep their sources. The CLI uses a fork when needed and includes the destination PR template when present. Review and merge happen in the catalog. Once the shared entry is available, switch the consuming project explicitly with `loadouts add github:OWNER/REPO/NAME@REF`.

## Releasing the CLI

Contributors add a Changeset (`bunx changeset`) for each user-visible change. CI runs tests on PRs with Bun 1.4.4. Changesets opens the version PR. A maintainer merges it to start publication. [Release workflow](../.github/workflows/release.yml)

The workflow builds five platform packages (Linux and macOS on x64/arm64, Windows on x64), publishes those first, then publishes the launcher `@katisfaktion/loadouts` with exact optional dependencies on those binaries. The source package stays private. The GitHub release is created last, with tag `v<VERSION>` pointing at the code and schemas for that release.

Set `RELEASE_TOKEN` with GitHub contents and pull-request write access so the release PR triggers CI. For npm, configure trusted publishing on all six packages for owner `katisfaktion`, repository `loadouts`, workflow `release.yml`. The workflow also accepts a publish-capable `NPM_TOKEN` for bootstrapping the scope. After correcting a partial publication failure, rerun the workflow. It skips package versions already on npm and stops on registry or authentication errors.
