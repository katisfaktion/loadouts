# loadouts

**Reusable agent setups for Claude Code and Codex.**

Give each project the skills, tools and working conventions it needs. Declare the setup once, commit it alongside your code, and restore it with `loadouts install`.

A **loadout** is a YAML file that brings together skills, plugins, MCP servers and instructions for a kind of work. Keep loadouts in your project while you refine them, then share proven ones through a GitHub catalog.

Compose a project from focused loadouts—such as React, Payload, testing and deployment—selected together in `loadouts.json`. Each can be reused and improved independently. Loadout files currently have no `include` mechanism.

- **Reuse what works.** Select shared loadouts or write your own project-local definitions.
- **Keep the team in sync.** Commit a manifest and locks so a new checkout can restore the declared setup.
- **Use your agents normally.** Loadouts writes native project configuration for Claude Code, Codex CLI and Codex Desktop.
- **Explore with your agent.** Discover relevant skills and draft a loadout before deciding to install anything.

## Install

Download the binary for your platform from [GitHub Releases](https://github.com/katisfaktion/loadouts/releases), rename it to `loadouts` (`loadouts.exe` on Windows), and put it on your `PATH`. On Linux and macOS, make it executable:

```sh
chmod +x loadouts
```

You will also need:

- Git for shared catalogs.
- Node.js with `npx` for skill installation.
- Claude Code, Codex, or both, installed and signed in.
- The GitHub CLI (`gh`) if you want to contribute loadouts through pull requests.

Bun is needed only to [build from source](#development). If a release binary is not yet available, use that route.

## Start with a project

**Already cloned a project that has `loadouts.json`?** Install its application dependencies first if it uses packaged companion skills, then run:

```sh
loadouts install
loadouts status
```

**Setting up a new project?** From its root, choose your agents and create a local loadout:

```sh
loadouts init --harness claude-code,codex
loadouts create workflow
```

Use `--harness codex` or `--harness claude-code` if you use only one. Initialization creates the manifest and local catalog; it does not install components.

Edit `.loadouts/catalog/workflow.yml`. Keep its generated schema comment and add your setup. This small loadout gives both agents reusable working conventions; add other concerns as separate loadouts:

```yaml
name: workflow
items:
  workflow:
    conventions: Run the project's tests before proposing a change. Follow existing code patterns.
routing:
  - when: Making changes to this project
    use: [workflow]
```

Validate and apply it:

```sh
loadouts validate .loadouts/catalog/workflow.yml
loadouts add file:./.loadouts/catalog/workflow.yml
loadouts status
```

Now open Claude Code or Codex as usual, including Codex Desktop. You can also use `loadouts claude` or `loadouts codex`: these check the installation before starting the agent and forward your arguments unchanged.

Personal agent settings still apply. Loadouts does not isolate your global configuration or grant project or hook trust on your behalf.

## Reuse a shared catalog

A catalog is a Git repository of loadout definitions. Set one as your default to use short names:

```sh
loadouts setup --catalog OWNER/REPO --harness claude-code,codex
loadouts list
loadouts show NAME
loadouts add NAME
```

Replace `OWNER/REPO` and `NAME` with your catalog and a loadout it contains. `setup` saves machine defaults and adds a `LOADOUTS.md` reference to your agents' global instructions, so they can discover the CLI workflow.

You can always select another catalog explicitly, including a particular tag, branch or commit:

```sh
loadouts add github:OWNER/OTHER-REPO/NAME@v1.0.0
```

If a name is already selected from another source, `add` shows the old and new sources and asks before replacing it. A local file with the same name does not silently override the selection; `doctor` explains the collision.

### Catalog repository layout

Shared catalogs keep their definitions directly inside a top-level `loadouts/` directory:

```text
agent-loadouts/
├── README.md
└── loadouts/
    ├── react.yml
    ├── payload.yml
    └── testing.yml
```

Each file contains one loadout, with `name` matching its filename: `react.yml` declares `name: react`. Use `.yml`; nested directories and `.yaml` files are not discovered. The repository needs committed definitions, but no package manifest, catalog index or copy of the CLI schemas. A README explaining the entries is recommended.

This shared layout is different from a consuming project's `.loadouts/catalog/` directory. `publish` copies a verified local `.loadouts/catalog/react.yml` to `loadouts/react.yml` in the catalog and proposes it through a PR.

See [maintaining a catalog](docs/reference.md#shared-catalog-repositories) for a complete entry, local validation, version selection and contribution review.

## Everyday workflow

| What you want to do | Command |
| --- | --- |
| Restore a checkout or apply edits to selected local loadouts | `loadouts install` |
| See selected loadouts and installation state | `loadouts status` |
| Diagnose missing components or configuration conflicts | `loadouts doctor` |
| Refresh shared loadouts and selected skill contents | `loadouts update` |
| Remove a selection and its managed setup | `loadouts remove NAME` |
| Choose one alternative in a loadout | `loadouts switch NAME/GROUP CHOICE` |
| Enable or disable an optional member | `loadouts enable NAME/GROUP MEMBER` / `loadouts disable NAME/GROUP MEMBER` |
| Read command usage and examples | `loadouts help COMMAND` |

Selection commands apply the resulting setup immediately. After directly editing `loadouts.json` or a selected local YAML file, run `loadouts install`.

`install` reuses locked shared catalog revisions. `update` deliberately refreshes them within the declared refs. A fixed catalog tag stays fixed, but the skills and plugins it references may still change upstream.

## What belongs in Git?

| File or directory | Purpose |
| --- | --- |
| `loadouts.json` | The loadouts, sources, choices and agents your project selects |
| `loadouts.lock.json` | Resolved catalog commits, applied local definitions and managed artifacts |
| `skills-lock.json` | Skill sources and hashes used for restoration |
| `.loadouts/catalog/*.yml` | Your project-local loadout definitions |
| Native project settings and instructions | Generated `.mcp.json`, shared Claude settings, `.codex` configuration and managed agent instructions |

Commit those files when present, along with the generated ignore rules and `.loadouts/.gitkeep`. Downloaded skill folders and links can stay ignored; keep project-authored skills in Git. Local installer receipts, caches and authentication do not belong in the repository.

Restoration is **best effort**. Missing locked Git skills are restored with hash verification, but a hash cannot recover contents that upstream no longer provides. Plugin marketplaces may also serve newer contents. For setups that must remain available, retain trusted copies of the full skill folders. See [restoration and recovery](docs/reference.md#project-manifest-and-installation).

## Create a loadout with your agent

Ask your agent:

> I want to create an agent loadout for this project.

`loadouts explore` provides the agent with an [exploration guide](skills/loadouts-explore/SKILL.md). It directs the agent to inspect the project and your existing setup, search with `npx skills find`, and propose a composition: reuse suitable shared loadouts unchanged, adapt those that need improvements, and create separate local drafts for missing concerns. It uses `loadouts create` and `loadouts validate` for each draft.

Exploration stops at proposals. It does not install drafts or claim they have been proven on a real task. Review them, select the approved sources with `loadouts add`, and try them on your own work.

Once it has proved useful, preview a contribution to your catalog:

```sh
loadouts publish workflow --catalog OWNER/REPO --summary 'Describe the real work used to verify this loadout'
```

Add `--yes` to push a contribution branch and open a pull request using authenticated `gh`. Publication does not merge the PR or switch your project to the shared source.

For an adapted loadout, ask your agent to compare it with its original revision and current upstream before proposing the change. Keep the upstream name to update the same catalog entry. The agent reviews and reconciles the differences; `publish` copies the whole file and does not merge upstream changes automatically.

## What can a loadout include?

- **Skills** installed through `npx skills`. Prefer individual skills when they provide what you need.
- **Package companion skills** selected with `packageSkills` from installed application dependencies. Update your dependencies, then run `loadouts install` to synchronize their companions; no separate `loadouts update` is needed.
- **Native Claude and Codex plugins** when their hooks or other bundled features add value beyond skills alone.
- **MCP servers**, working conventions and routing instructions that tell agents when to use each part of the setup.
- **Installer integrations**, currently codebase-memory, that reuse an existing global installation and configure and index the project.

Loadouts can offer mutually exclusive choices (`one_of`), optional combinations (`any_of`), and agent-specific overrides. See the [configuration reference](docs/reference.md) for examples and integration requirements.

The [loadout YAML schema](schemas/v1/loadout.schema.json) and [manifest schema](schemas/v1/manifest.schema.json) support editors and agents. `loadouts create` adds a schema URL pinned to the CLI release that created the draft. Catalogs can release independently of the CLI.

## Development

Use **Bun 1.4.4**:

```sh
git clone https://github.com/katisfaktion/loadouts.git
cd loadouts
bun install
bun test
bun run build
./dist/loadouts help
```

The binary is written to `dist/loadouts`; put it on your `PATH` to use it elsewhere. Tests use temporary homes and fixtures without calling external services or real skill installers. CI runs tests on pull requests.

For a versioned change, add a descriptive Changeset with `bunx changeset`. Changesets opens a release PR; after a maintainer merges it, CI publishes a Git tag and platform binaries. Nothing is published to npm.

Repository maintainers must configure `RELEASE_TOKEN` with contents and pull-request write access so automated release PRs trigger CI. Release automation does not merge PRs.
