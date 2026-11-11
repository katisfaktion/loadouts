# loadouts

> [!NOTE]
> The initial version of this README was written by an AI agent.

**Save a project's agent setup and equip Claude Code and Codex with it.**

Think of a loadout as the gear you save for a particular job in a game. A skill for UI review, a design plugin and a Storybook MCP server are individual pieces. A design loadout puts them in one YAML file, along with the conventions to follow and instructions for when to use each tool.

![A design loadout equips Claude Code and Codex and sends conventions and skill routing to AGENTS.md.](docs/assets/loadouts-overview.png)

A project can select several loadouts. Keep the ones you're trying in the project, then share the ones that prove useful in a catalog. Your teammates can restore the selection from a fresh checkout and open Claude Code or Codex as usual, including Codex Desktop.

## Install

```sh
npm install -g @katisfaktion/loadouts
loadouts help
```

The npm package installs a native binary. Keep npm optional dependencies enabled. It supports Linux with glibc and macOS on x64 and arm64, and Windows on x64. The npm launcher requires Node.js 22 or later. To install skills, use Node.js 22.20.0 or later with `npx`. You can also download a standalone binary and put it on your `PATH`. [GitHub Releases](https://github.com/katisfaktion/loadouts/releases)

## Restore a project

If the repository already has `loadouts.json`, install its application dependencies first so any skills shipped with those packages are available. Then run this at the project root.

```sh
loadouts install
loadouts status
```

Open your agent normally. Its personal settings still apply. Codex may ask you to trust the project or approve hooks. To check for missing components or conflicting settings, run `loadouts doctor`.

## Set up a new project

Start with the agents you use. The following example selects a shared software development workflow from the author's [working catalog](https://github.com/katisfaktion/agent-loadouts).

```sh
loadouts init --harness claude-code,codex
loadouts show sdlc --catalog katisfaktion/agent-loadouts
loadouts add github:katisfaktion/agent-loadouts/sdlc@v0.1.0
```

Use just `--harness codex` or `--harness claude-code` for one agent. `add` records the selection and applies it immediately. Use Git for shared catalogs and have the selected agents installed and signed in.

If you use the same catalog across projects, save it as your machine default. You can then use short names such as `loadouts add sdlc`. Explicit `github:` sources work with any catalog.

```sh
loadouts setup --catalog katisfaktion/agent-loadouts --harness claude-code,codex
loadouts list
```

## Create a loadout with your agent

Loadouts is agent-first. Your agent can find the workflow through `loadouts help`. Give it a project-level request like this one.

> I want to create an agent loadout for this project. Look for existing catalog entries first and propose anything we're missing.

`loadouts explore` prints instructions for the agent. It inspects your stack and current setup, checks the catalog, and searches for skills to fill specific gaps. It can write and validate small, reusable drafts. You decide when to install a draft and try it on a real task.

To try the same workflow yourself, run `loadouts create testing`. Keep the generated schema comment and put the following definition in `.loadouts/catalog/testing.yml`.

```yaml
name: testing
items:
  regression:
    conventions: Reproduce each bug with a failing test before fixing it.
routing:
  - when: Fixing a bug
    use: [regression]
```

```sh
loadouts validate .loadouts/catalog/testing.yml
loadouts add file:./.loadouts/catalog/testing.yml
```

Both agents now see the convention in the managed project instructions. A loadout can also select skills bundled with dependencies, offer a choice of tools, or include other loadouts. [YAML examples and choices](docs/reference.md#compose-and-adapt-reusable-entries)

## Keep the team in sync

Commit `loadouts.json` (what you chose), `loadouts.lock.json` (what loadouts applied), and `skills-lock.json` when present (which skill contents to restore). Include the local catalog, generated project instructions, shared native settings and ignore rules. Downloaded skill folders can stay ignored. Keep project-authored skills in Git.

| When | Run |
| --- | --- |
| You've edited local YAML, changed application dependencies or pulled a teammate's changes | `loadouts install` |
| You want newer catalog revisions and skill contents | `loadouts update`, then review the lockfile diff |
| You want a different tool for a feature | `loadouts switch NAME/GROUP CHOICE`, or `enable` / `disable` for optional members |
| You want to share a tested local loadout | `loadouts publish NAME --catalog OWNER/REPO --summary 'What you verified'` |

`publish` previews the contribution. Add `--yes` to push a branch and open a PR using authenticated `gh`. After the catalog releases it, you can select the shared source in your project. Changing a selected name's source asks for confirmation.

For lockfile recovery, catalog layout and the files each agent reads, see the [configuration and workflow reference](docs/reference.md).

## Development

Use Bun 1.4.4 in a checkout of this repository.

```sh
bun install --frozen-lockfile
bun test
bun run build
./dist/loadouts help
```

To use the repository's own agent setup, run `loadouts install` after `bun install`. It combines the shared SDLC workflow with the local [Bun and Optique](.loadouts/catalog/bun-cli.yml) and [GitHub contribution](.loadouts/catalog/github-contributions.yml) loadouts.

For user-visible changes, add a Changeset with `bunx changeset`. CI tests the PR. Merging the Changesets release PR publishes the native binaries and npm packages. [Release workflow and credentials](docs/reference.md#releasing-the-cli)
