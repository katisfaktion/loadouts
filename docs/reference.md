# Configuration and workflow reference

For installation and a first project, start with the [README](../README.md). This reference covers source selection, restoration, integrations and catalog authoring. Use `loadouts help <command>` for command syntax.

## Agent configuration and diagnostics

`setup` writes machine defaults and a `LOADOUTS.md` help hint beside each selected harness's global instructions. It adds `@LOADOUTS.md` to `~/.claude/CLAUDE.md` and an absolute `@` reference to `~/.codex/AGENTS.md`, preserving existing text. Other project commands find `loadouts.json` or a legacy lock in the current directory or its nearest ancestor. Skills are installed through `npx skills`; no runtime packages are bundled separately.

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

[schemas/v1/manifest.schema.json](../schemas/v1/manifest.schema.json) provides manifest editor guidance. Use schemas from the matching published CLI release, with HTTPS references pinned to its `v<VERSION>` Git tag. Schema references support editors and agents; they do not introduce a runtime schema download.

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

### Shared catalog repositories

A shared catalog is a Git repository with a flat, top-level `loadouts/` directory. This is separate from `.loadouts/catalog/`, where consuming projects keep local drafts.

```text
agent-loadouts/
├── README.md                         # Recommended: purpose and usage of each entry
├── loadouts/                         # Required: committed loadout definitions
│   ├── react.yml
│   ├── payload.yml
│   └── testing.yml
└── .github/
    └── pull_request_template.md      # Optional: included by loadouts publish
```

Only direct `loadouts/*.yml` entries are discovered. Files ending in `.yaml`, definitions at the repository root, and nested paths such as `loadouts/frontend/react.yml` are not discovered. Each file defines one loadout; its `name` must equal the filename without `.yml`. Use letters, digits, dots, underscores or hyphens in names. Use ordinary files and directories; the publisher rejects symlinks in destination paths.

No `package.json`, catalog index, `loadouts.json` or loadouts lockfile is required to distribute a catalog. Those last two files describe a consuming project's selections and applied setup. A catalog repository can itself use loadouts for its own development, but those project files do not define its public entries. Keep the CLI schemas in the CLI repository and reference a published release over HTTPS.

A complete minimal entry at `loadouts/testing.yml` is:

```yaml
# yaml-language-server: $schema=https://raw.githubusercontent.com/katisfaktion/loadouts/v0.1.0/schemas/v1/loadout.schema.json
name: testing
items:
  regression:
    conventions: Add a regression test for each bug fix and run the relevant test suite.
routing:
  - when: Fixing bugs or changing tested behavior
    use: [regression]
```

The schema URL becomes available when that CLI release is published. `loadouts validate` works offline and does not fetch the schema. Add verified skills, plugins or MCP definitions to the appropriate items as needed; a catalog does not need to vendor their contents.

From a catalog checkout, validate each YAML file before committing:

```sh
loadouts validate loadouts/testing.yml
```

After committing, inspect what consumers will see without publishing the repository:

```sh
loadouts list --catalog "$PWD"
loadouts show testing --catalog "$PWD" --json
```

The path must be absolute. These commands read Git objects through a cached clone, so uncommitted edits are not visible. If the repository already has release tags, the default view selects a tag rather than the newest branch commit. Validate working files directly when reviewing an unpublished change.

Consumers can select `github:OWNER/REPO/testing` or an explicit `github:OWNER/REPO/testing@REF`. Without a ref, the resolver chooses the highest version-sorted stable tag matching `vX.Y.Z` or `X.Y.Z`; if none exists, it uses the clone's `HEAD`. Prerelease tags are not automatically selected. The lock records the resolved commit. `install` restores that resolution, while `update` can advance it within the declared ref. Use immutable tags for catalog releases; the catalog's version is independent of the CLI version used by its schema comments.

### Compose and adapt reusable entries

Select multiple focused loadouts in the project manifest instead of placing the whole stack in a single YAML file. There is no `include` or `extends` field. Keep related capabilities together—React conventions and React skills may belong in one entry—while keeping independently reusable concerns such as Payload and deployment separate. Reuse suitable shared entries unchanged instead of copying them all locally.

To adapt a shared `react` entry for a future upstream improvement, use `loadouts create react --from react` after checking its source. `create --from` uses the project's locked default catalog, or the machine default if there is no locked default; it does not accept a catalog override. For another source, use plain `create` and edit the draft from verified upstream YAML. Record the actual repository, file path, ref and resolved commit in a YAML comment or review notes: copying does not retain that provenance automatically. Do not add unsupported provenance fields to the YAML format.

Keeping the name `react` makes publication target `loadouts/react.yml`. Renaming the draft to `react-custom` instead proposes `loadouts/react-custom.yml`; it will not update the original. Existing drafts must be reviewed before editing and are never overwritten by `create`.

After application and real-issue verification, ask your agent to compare the local definition against both its recorded base revision and the target catalog's current default branch. Use a temporary Git checkout and ordinary Git/file diffs. The CLI has no diff command, and `publish` preview prints proposed YAML and PR metadata rather than an upstream diff. Review semantic changes as well as formatting. If the original base is unknown, report that limitation.

`publish` writes the complete local file on top of the target's default branch; it does not perform a three-way merge. Preserve intervening upstream improvements before contributing. Reconcile the draft, validate it, install it, and verify changed behavior again. Then preview and, with publication approval, open a focused PR for each useful loadout. If nothing meaningful differs, no PR is needed. After a merge/release, switching the project from its local file to the shared source remains an explicit `add` decision.

### Agent-assisted exploration

To build a loadout from a real project, ask your agent:

> I want to create an agent loadout for this project.

The agent discovers the workflow through `loadouts help`, then reads `loadouts explore` and the relevant command help. You do not need to name the command in your request. `loadouts explore` prints the bundled [exploration skill](../skills/loadouts-explore/SKILL.md); it does not start an agent. The skill is included in the native binary and needs no global skill installation. Your agent inspects the project and existing user plugins and skills, runs `npx skills find` separately for the relevant stack technologies, and verifies candidates against primary sources and plugin documentation. It proposes a composition of unchanged shared entries, focused adaptations, and new reusable loadouts; it uses `loadouts create` and `validate` for each draft and explains source evidence and uncertainties. Existing drafts are preserved unless revision is explicitly authorized. Recommendations are not marked as verified on a real issue.

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

[schemas/v1/loadout.schema.json](../schemas/v1/loadout.schema.json) defines the YAML format for editor completion and validation. `loadouts create` writes a readable draft with an HTTPS schema reference derived from its own package version. It works before initialization at the nearest project or Git root, or the current directory when neither exists, and never overwrites an existing draft. No local CLI checkout is required for editor support. The reference has this form, with `<VERSION>` replaced by the published CLI version:

```yaml
# yaml-language-server: $schema=https://raw.githubusercontent.com/katisfaktion/loadouts/v<VERSION>/schemas/v1/loadout.schema.json
```

Changesets versions the CLI; the release workflow creates `v<VERSION>` at the commit containing both the code and schemas. The initial CLI release is `0.1.0`; both editor schemas start at format version `v1`, independently of CLI versions and the internal lock format. Compatible schema additions stay in `schemas/v1/`; a breaking authoring-format change needs a new schema directory. Keep release tags immutable. A catalog can version independently and continue referencing the same CLI schema until it adopts a newer format. Do not copy schemas into catalogs or point to a moving branch. A development build's release tag may not exist yet; its generated URL becomes usable when that release is published. CLI validation works offline regardless.

The schema rejects unknown fields and checks source, group, MCP and routing structure. Author groups as `one_of` with a scalar default or `any_of` with an array default; the `kind`/`members` form returned by inspection is not the editor format. `create --from` converts copied groups to authoring syntax. The CLI additionally verifies that `name` matches the filename, defaults name existing group members, and routing references resolve. Validate a committed catalog entry with `loadouts show <name> --catalog <path-to-catalog>`.

