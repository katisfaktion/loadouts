# loadouts

Declare project agent setups in `loadouts.json` and install them into Claude Code and Codex. Sources can be shared Git catalogs or committed project-local definitions. Loadouts select skills, native Claude and Codex plugins, MCP servers, routing instructions and conventions. The project lock records each resolved catalog commit, local YAML snapshots, choices and installed artifacts.

## Install

Download the binary for your platform from [GitHub Releases](https://github.com/katisfaktion/loadouts/releases), rename it to `loadouts` (`loadouts.exe` on Windows), and put it on your `PATH`. On Linux and macOS, make it executable with `chmod +x loadouts`.

Git and Node.js with `npx` are required for catalog access and skill installation. Install Claude Code or Codex to use the corresponding launch command. For Codex, run `codex login` before the first launch.

## Typical flow

```sh
loadouts setup --catalog katisfaktion/agent-loadouts --harness claude-code,codex
loadouts init
loadouts add base frontend backend
loadouts status
loadouts doctor
loadouts claude
```

`setup` writes machine defaults and a `LOADOUTS.md` help hint beside each selected harness's global instructions. It adds `@LOADOUTS.md` to `~/.claude/CLAUDE.md` and an absolute `@` reference to `~/.codex/AGENTS.md`, preserving existing text. Other project commands find `loadouts.json` or a legacy lock in the current directory or its nearest ancestor. Skills are installed through `npx skills`; no runtime packages are bundled separately.

```sh
loadouts switch base/methodology agent-skills
loadouts enable backend/runtime go
loadouts disable backend/runtime go
loadouts remove frontend
loadouts update
loadouts codex
```

Check in `loadouts.json`, `loadouts.lock.json`, `skills-lock.json`, `.loadouts/catalog/*.yml`, generated project settings and agent instructions, including the `.loadouts/.gitkeep` marker. Downloaded `.agents/skills/` folders and `.claude/skills/` links may be ignored or committed; keep any project-authored skills in version control. `loadouts install` restores missing locked files and harness links. Commit native Codex configuration in `.codex/config.toml`, profiles in `.codex/agents/` and hooks in `.codex/hooks.json`. Installer receipts and generated Claude assets remain ignored. Authentication, plugin caches and new sessions use the normal Codex home (or your explicitly set `CODEX_HOME`). Existing `.loadouts/codex-home/` remains ignored and untouched as historical session storage; install does not move or delete old sessions.

For declared `npx` MCP servers, loadouts adds `--prefix .loadouts` so project package-manager checks (such as pnpm `devEngines`) do not block startup. This relative path is portable in both harness configurations; it needs no home-variable expansion. The tracked `.loadouts/.gitkeep` marker keeps the directory present even in fresh checkouts without local YAML. npm still uses each developer's normal download cache, and the server runs from the project directory. Explicit npm options remain after that default prefix, and `pnpm` commands are unchanged. For existing projects, rerun `loadouts init` with their configured harnesses, then `loadouts install` to refresh generated MCP settings. Commit the refreshed `.mcp.json` and marker; keep `.loadouts/codex-home/` ignored.

`loadouts claude` and `loadouts codex` perform a read-only installation check, then launch normally with your arguments and environment unchanged. They do not install, write configuration, isolate personal settings or set `CODEX_HOME`. Run `loadouts install` for repairs. Ordinary `claude`, ordinary `codex` and Codex Desktop discover the same native project files without the loadouts preflight. Each harness applies its own inheritance rules; personal configuration still loads. Codex must trust the project before loading project configuration, and hooks require native approval. Loadouts never grants either trust.

`loadouts doctor` reports missing setup, active non-selected alternatives and possible duplicate codebase-memory hooks across user/project scopes. Unrelated personal components are allowed. Diagnostics describe declarations, not proof that hooks executed. `loadouts global prune` remains an explicit preview of global changes; `--yes` applies them, and it does not remove Codex plugins.

Run `loadouts help` (also `--help` or `-h`) for grouped commands, or `loadouts help <command>` for usage, flags and examples generated from the Optique command grammar. `loadouts <command> --help` works too, except for `claude` and `codex`, which forward every argument to the agent. `list`, `show`, `status` and `doctor` support `--json`. Exit codes: 0 success, 1 check failed, 2 usage error, 3 missing environment dependency. `add` asks for confirmation when replacing a selected source; scripts must explicitly approve it with `--yes`.

Terminal output uses restrained colors for commands, changes and diagnostics. Redirected output is plain by default. Set `NO_COLOR=1` or `NODE_DISABLE_COLORS=1` to disable color, or `FORCE_COLOR=1` to enable it in pipes; `FORCE_COLOR=0` disables it. Explicit disable takes precedence. JSON, exploration Markdown and agent output remain unchanged. Installation reports changed artifacts and written-file counts; status shows sources and selected groups, including pending selections.

## Project manifest and installation

`loadouts init` creates an empty manifest without installing components. Selection commands (`add`, `remove`, `switch`, `enable`, `disable`, `harness`) edit it and apply the resulting setup. They also apply other pending manifest changes, but retain unrelated local YAML snapshots.

```json
{
  "harnesses": ["claude-code", "codex"],
  "loadouts": {
    "base": {"source": "github:katisfaktion/agent-loadouts/base"},
    "backend": {
      "source": "file:./.loadouts/catalog/backend.yml",
      "choices": {"runtime": ["bun"]}
    }
  }
}
```

Local sources have exactly the form `file:./.loadouts/catalog/<name>.yml`. The key, filename and YAML `name` must agree. GitHub sources use `github:owner/repo/<name>[@ref]`; optional refs can be tags, branches or commits. For existing local Git catalogs and offline testing, `file:/absolute/catalog#<name>[@ref]` is also supported, but it is machine-specific and its path cannot contain `@` or `#`. Replace it with a GitHub source before sharing the manifest with other developers.

After cloning a configured project, run `loadouts install`. It reuses pinned Git resolutions, resolves new or changed sources, applies selected local edits, and restores missing skills, harness links and generated configuration. It also restores native Codex plugins when their normal user cache is missing. Repeating it leaves a complete, unchanged setup alone. `loadouts update` deliberately refreshes shared resolutions within the declared refs and selected skill contents/hashes; a fixed catalog tag or commit stays on that ref, but does not pin its referenced skills. Failed application retains ownership and pending work for a later install or removal. Status and doctor check actual skill files, harness links and generated declarations; launch and publication require those artifacts to be present. A committed lock alone is not proof of installation. Removing a disappeared source uses recorded ownership; unavailable historical MCP definitions cause a fresh reachability check of the desired servers.

`skills-lock.json` is the native skills lock and must be committed alongside the loadouts files. Missing selected Git skills are restored using `npx skills experimental_install --frozen-lockfile` in a temporary directory containing only their lock entries. Claude links are recreated locally; Codex reads `.agents/skills/`. A missing link alone needs no download. Existing skill folders are not rehashed. New selections use `skills add`, but cannot overwrite an existing locked hash during ordinary installation. Partial failures retain recovery ownership. Legacy Claude copies are converted to links when every file matches the canonical skill directory; differing copies and unsafe paths must be moved aside explicitly.

If upstream no longer supplies the locked contents, install fails without accepting new hashes. Recover the full skill folders (including supporting files) from a trusted checkout or CI artifact built from that lock. For stronger availability, commit those verified folders or keep a durable backup; a hash alone is not an archive. If no matching copy exists, review newer contents and deliberately run `loadouts update`, then review and commit the changed `skills-lock.json`. A missing native lock for an owned missing skill also requires restoring the lock or explicitly updating. There is no automatic fallback to latest. Upstream documents the experimental restore command in its [command reference](https://github.com/vercel-labs/skills/blob/main/docs/commands.md).

Reproducibility remains best effort: catalog commits and local definitions are recorded and restored skill downloads are hash-checked, but historical contents may be unavailable and plugin marketplaces may fetch newer component contents. Loadouts does not promise exact transitive component versions. Prefer individual `npx skills` skills when equivalent; use native plugins for a concrete additional benefit such as hooks.

[schemas/v1/manifest.schema.json](schemas/v1/manifest.schema.json) provides manifest editor guidance. Use schemas from the matching published CLI release, with HTTPS references pinned to its `v<VERSION>` Git tag. Schema references support editors and agents; they do not introduce a runtime schema download.

## Package companion skills

A loadout item can select skills shipped with application dependencies:

```yaml
name: frontend
items:
  ui:
    packageSkills:
      include: ["@acme/ui"]
      exclude: ["@acme/ui#experimental"]
    conventions: Use @acme/ui for shared interface components.
routing:
  - when: Building interface components
    use: [ui]
```

Use an exact package name for all its companions, or `package#skill` for one.
Versions, paths and wildcards are not selectors. `packageSkills` also works in
`one_of`/`any_of` members and harness overrides. An override replaces the entire
selection; `include: []` disables it for that harness. Exclusions apply to that
item only: another selected item may still require the same skill.

Install or update your application dependencies first, then run `loadouts install`.
It synchronizes the selected companions from the installed package, including new
skills from package-wide selections. No `loadouts update` is needed for dependency
changes, and loadouts never installs application dependencies. Missing packages
produce a diagnostic and leave conventions available. Status notices packages
that become available, change version or disappear; doctor explains missing
packages. A missing explicitly named skill in an installed package is an error.

Loadouts stages `npx skills experimental_sync --copy --no-remote --no-cleanup
--no-frozen-lockfile` for each selected package, then applies only selected skills.
It supports root `SKILL.md`, `skills/<name>/SKILL.md` and
`dist/skills/<name>/SKILL.md` payloads, including standard TanStack Intent package
skills. Selection is independent of Intent CLI permissions, hooks and loading.
Companion payloads must be regular files/directories; package-directory symlinks
used by pnpm and workspaces are supported. Yarn PnP without `node_modules` is not.
Remote redirects declared by packages are not fetched.

`loadouts.json` continues to select the loadout YAML. `loadouts.lock.json` records
package versions, resolved skill names and requiring item IDs; `skills-lock.json`
records native package sources and hashes. Commit both locks and your application
package lock. Skill folders remain generated copies, refreshed on install; they
can stay ignored. Removing a selection removes only loadouts-owned companions.
Replacing a selected Git skill with a same-name package companion transfers its
recorded ownership during `loadouts install`; remove the Git selection in the same
edit. Discovery failures keep the previous Git skill available, and interrupted
transfers can be retried or removed. The native lock must still identify the
recorded Git source. Same-name conflicts with other packages, retained Git skills or unmanaged files fail before
replacing package companions. Independently sourced Git skills keep their frozen
restoration behavior.

## Installer integrations

Use an upstream CLI when it already installs the skill, hooks and agent profiles
needed for an integration. The first supported installer is codebase-memory:

```yaml
name: memory
items:
  graph:
    installer: codebase-memory
routing:
  - when: Exploring code structure and assessing change impact
    use: [graph]
```

Save this as `.loadouts/catalog/memory.yml`, then run:

```sh
loadouts add file:./.loadouts/catalog/memory.yml
```

`codebase-memory-mcp` must already be installed on PATH. Your existing installation
is reused; loadouts never downloads, upgrades, globally reconfigures or uninstalls
it. A missing executable produces an upstream installation hint. This field names
a supported adapter, not an arbitrary shell command. It also works in alternatives
and harness overrides. Declare other skills, plugins and MCP servers in separate
items.

The adapter runs the native configuration-only installer in a temporary HOME and
imports its skill, three agent profiles and hooks into the selected project
harnesses. It declares a portable `codebase-memory-mcp` MCP command, so repeat
installation and Codex launch retain the server. Generated Claude settings go in
`.claude/settings.local.json`; generated skills and agents are ignored alongside
the local ownership receipt in `.loadouts/installers/`. Keep the YAML, manifest,
lock, `.mcp.json`, native `.codex` files and ignore rules committed. Codex skills go in `.agents/skills/codebase-memory/`, profiles in `.codex/agents/`, hooks in `.codex/hooks.json`, and installer guidance in the root managed `AGENTS.md` section. Profile MCP commands resolve from PATH. Migration retains the index receipt and leaves archived assets intact. Modified or conflicting assets are
preserved with an error; move them aside or restore them before retrying.

On first selection on this machine, installation indexes the absolute project
path using `codebase-memory-mcp cli index_repository`. It uses your normal shared
service and cache; it does not create a service per project or change global
indexing settings. The project then appears in CBM's index list and dashboard.
Repeated installs do not repeat successful indexing. Missing local assets are
repaired; failed indexing is retried. A fresh checkout or a moved project is
indexed at its new absolute path.

CLI indexing creates an index, not a watch. Eligible MCP sessions register watches
under CBM's global settings. To keep the dashboard running, use
`codebase-memory-mcp daemon start --open`. See the upstream
[configuration reference](https://github.com/DeusData/codebase-memory-mcp/blob/main/docs/CONFIGURATION.md)
for watcher lifetime and automatic indexing.

Removing the last selection or a harness removes only its owned project assets
and hooks. The global executable, service and project index remain. Use the
upstream CLI directly for deliberate global updates or index deletion. Codex hook
trust remains your decision through `/hooks`; install and doctor do not certify
that hooks executed. Global installations remain visible under normal inheritance, including both loadouts launchers. If user and project hooks overlap, doctor warns that they may run twice; review the native hook scopes before approving them.

The project lock records the observed executable version (lock format 6). Versions
are best effort and may differ between machines; active CBM sessions on one machine
must share a compatible installation. Installation refreshes native project assets
when the executable changes. Native installer integration was tested on Linux with
codebase-memory-mcp 0.12.1; newer upstream layouts are checked before importing.

## Native Codex plugins

Use a native plugin when you want its bundled hooks as well as its skills. For example, save `.loadouts/catalog/ponytail.yml`:

```yaml
name: ponytail
items:
  ponytail:
    codex:
      plugin: ponytail@ponytail
      marketplace: DietrichGebert/ponytail
```

Both Codex fields are required. The suffix in `plugin` is the marketplace name from its manifest, which need not match the repository name. This requires Codex's `plugin add`, `plugin list` and `plugin marketplace upgrade` commands with JSON output; tested with Codex 0.162.1.

After reviewing the draft, run `loadouts validate .loadouts/catalog/ponytail.yml`, initialize with the Codex harness if needed, then `loadouts add file:./.loadouts/catalog/ponytail.yml` and `loadouts codex`. In Codex, use `/hooks` to review and trust the plugin hooks. Loadouts does not approve hooks automatically. Skills-only installations do not include plugin hooks; remove a previously selected skills-only entry from its loadout before applying the native plugin to avoid duplication.

Plugin and marketplace declarations live in `.codex/config.toml`. Loadouts refreshes selected marketplace snapshots in the normal Codex home, installs missing plugins in a temporary staging home, and imports only validated plugin cache contents. User enablement, authentication and trust are left alone. An intact second install reuses the cache; `loadouts update` explicitly refreshes it. Removing a selection removes its owned project declarations and retains shared cached contents.

Plugin reproducibility is best effort: the normal cache is shared, and updating the same marketplace/plugin/version identity can affect other projects using it. No per-project isolation is promised. A fresh checkout restores missing cache contents using its declarations and lock without enabling plugins globally.

Generated Codex settings use TOML table sections and preserve unrelated native project settings and owned plugin policies. Migration adopts identical native entries but rejects conflicting destinations before changing project configuration. It does not export legacy trust, authentication or session settings.

## Catalog editing

To build a loadout from a real project, ask your agent:

> I want to create an agent loadout for this project.

The agent discovers the workflow through `loadouts help`, then reads `loadouts explore` and the relevant command help. You do not need to name the command in your request. `loadouts explore` prints the bundled [exploration skill](skills/loadouts-explore/SKILL.md); it does not start an agent. The skill is included in the native binary and needs no global skill installation. Your agent inspects the project and existing user plugins and skills, runs `npx skills find` separately for the relevant stack technologies, verifies candidates against primary sources and plugin documentation, uses `loadouts create` to scaffold `.loadouts/catalog/<name>.yml`, edits and validates it, and explains source evidence and uncertainties. Existing drafts are preserved unless revision is explicitly authorized. Recommendations are not marked as verified on a real issue.

These commands work before setup or initialization:

```sh
loadouts inspect --json
loadouts create backend
loadouts validate .loadouts/catalog/backend.yml
```

`inspect` reads project and user plugin declarations, installed skill metadata, MCP names/transports, and manifest/instruction paths. It reports configuration scopes and known GitHub sources without invoking `npx`, connecting to MCP servers, or writing files. MCP commands, arguments, URLs, credentials and raw file contents are omitted. Unknown sources remain unknown; declarations do not prove effective activation or use. Inventory covers the supported Claude/Codex configuration files and standard skills directories, not every possible extension or environment override. Root manifests are starting points; the agent investigates nested packages. Missing optional files are normal; invalid/unreadable supported metadata produces warnings and exit 1 with the remaining report intact.

`validate` uses the same parser as application, checks the filename/name relationship and declared references, and makes no changes. The editor schema additionally flags unknown fields. Neither check verifies that a source exists or a candidate works well in practice.

Exploration creates only a draft and its directories through `loadouts create`; it does not initialize or apply the project. Once you choose to apply it, the agent uses `init` when needed and `add` to select the exact source, with `switch`/`enable`/`disable` for choices rather than manually editing CLI-managed configuration. Publication follows separate real-issue verification.

Every initialized project has a committed local catalog in `.loadouts/catalog/`. Reuse shared loadouts when they fit, or explore a local definition:

```sh
loadouts create pipeline
# Edit .loadouts/catalog/pipeline.yml with your agent or editor.
loadouts add base
loadouts add file:./.loadouts/catalog/pipeline.yml
loadouts doctor
# After editing selected local definitions:
loadouts install
```

`loadouts create backend --from backend` copies a shared definition into `.loadouts/catalog/backend.yml` for adaptation. Creation never overwrites a file, selects it, or installs anything. A new bare `add backend` selects the shared catalog; re-adding an already selected name retains its explicit source. Use a `file:` or `github:` source to change it. Replacing a selected source (including through `--catalog` or a changed ref) shows the old and new sources and asks for confirmation, defaulting to no. All replacements are confirmed together before applying any part of the command. Non-interactive replacements require `loadouts add ... --yes`; the warning still appears. Explicit choices are retained and validated against the replacement. Local definitions never silently override shared selections. `doctor` explains name collisions and which source is selected; `show` follows that selection. Use `show <name> --catalog <repo>` to inspect a different shared catalog.

The lock retains the exact local YAML last applied, so editing a draft does not change unrelated convenience commands or agent launches. `install` applies edits to all selected local files; unselected drafts stay inactive. `doctor` explains edits and missing definitions. Removing a selected local file does not fall back to the shared catalog: restore it or remove its selection. `update` refreshes shared definitions within their declared refs and preserves applied local snapshots. Source, harness or choice edits in the manifest require installation before launching or publishing.

For existing lock-only projects, run `loadouts init` to migrate old `.loadouts/*.yml` files into `.loadouts/catalog/` and create the manifest. Migration preserves edited/unselected drafts, applied snapshots, choices, recovery state and `.loadouts/codex-home/`; it refuses conflicting destination files. Review the manifest and drafts, then run `loadouts install`. Legacy catalog commits remain pinned, but add an explicit `@ref` if future updates should stay on that ref: old locks cannot distinguish an explicitly chosen tag from an automatically selected one. Version-1–5 locks remain readable. A successful install writes version 6, which identifies native project ownership and optionally records package companions and installer versions. Older CLI versions cannot read newer lock formats.

Once the loadout has been verified in your project, preview its contribution:

```sh
loadouts publish pipeline --summary 'Verified in the data project with bun test'
loadouts publish pipeline --summary 'Verified in the data project with bun test' --yes
```

Publication requires an explicitly selected local file, its current contents and manifest selections to have been successfully applied. The summary records what you actually verified, including any relevant alternative choices. Preview makes no GitHub calls. `--yes` uses Git and authenticated `gh` to copy only that YAML into a temporary catalog checkout, push a topic branch (using your fork when necessary), and open a PR. It never merges, releases, or switches the project's source. Use `--catalog owner/repo` to select the contribution target, particularly when the project uses a local Git catalog. Existing PR template text is included with the verification notes. Forking or pushing still requires the appropriate GitHub permissions.

[schemas/v1/loadout.schema.json](schemas/v1/loadout.schema.json) defines the YAML format for editor completion and validation. `loadouts create` writes a readable draft with an HTTPS schema reference derived from its own package version. It works before initialization at the nearest project or Git root, or the current directory when neither exists, and never overwrites an existing draft. No local CLI checkout is required for editor support. The reference has this form, with `<VERSION>` replaced by the published CLI version:

```yaml
# yaml-language-server: $schema=https://raw.githubusercontent.com/katisfaktion/loadouts/v<VERSION>/schemas/v1/loadout.schema.json
```

Changesets versions the CLI; the release workflow creates `v<VERSION>` at the commit containing both the code and schemas. The initial CLI release is `0.1.0`; both editor schemas start at format version `v1`, independently of CLI versions and the internal lock format. Compatible schema additions stay in `schemas/v1/`; a breaking authoring-format change needs a new schema directory. Keep release tags immutable. A catalog can version independently and continue referencing the same CLI schema until it adopts a newer format. Do not copy schemas into catalogs or point to a moving branch. A development build's release tag may not exist yet; its generated URL becomes usable when that release is published. CLI validation works offline regardless.

The schema rejects unknown fields and checks source, group, MCP and routing structure. Author groups as `one_of` with a scalar default or `any_of` with an array default; the `kind`/`members` form returned by inspection is not the editor format. `create --from` converts copied groups to authoring syntax. The CLI additionally verifies that `name` matches the filename, defaults name existing group members, and routing references resolve. Validate a committed catalog entry with `loadouts show <name> --catalog <path-to-catalog>`.

## Development

Use Bun 1.4.4. Run `bun install`, `bun test`, and `bun run build`. CI runs the test suite once per pull-request update; merging to `main` runs release automation without repeating tests. Tests use temporary homes, local Git catalogs and a fake skills installer. No test calls real `npx skills` or external services.

The unpublished baseline is `0.0.0`. The initial minor Changesets generate the `0.1.0` release PR; merging that PR publishes the first tag and binaries. Review the catalog separately after the CLI release exists.

Run `bunx changeset` for a versioned change. Changesets Action v2 opens or updates `changeset-release/main`; merging remains a manual decision. After that PR is merged into `main`, the release workflow builds Linux, macOS and Windows binaries and creates a GitHub release if its version is not tagged yet. Ordinary pushes do not release; rerun the failed release workflow to retry. Nothing is published to npm.

Configure a repository `RELEASE_TOKEN` with contents and pull-request write access so automated release-PR updates trigger CI, as in `acm-website`. Without it, the workflow falls back to `GITHUB_TOKEN`: enable GitHub Actions PR creation in repository settings, and note that bot-generated PR updates do not trigger the normal push/PR checks. No workflow merges PRs automatically.
