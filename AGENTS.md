<!-- loadouts:begin -->
## Agent loadouts

Managed by `loadouts` (agent-authoring, bun-cli, github-contributions, sdlc). Change with `loadouts help`, not by editing this section.

### When to use what

| When | Use | Source |
| --- | --- | --- |
| Writing or changing agent skills | plugin `skill-creator` (Claude Code) | agent-authoring/skills |
| Building Claude Code plugins, hooks, commands or subagents | plugin `plugin-dev` (Claude Code) | agent-authoring/plugins |
| Auditing or revising AGENTS.md / CLAUDE.md | plugin `claude-md-management` (Claude Code) | agent-authoring/instructions |
| Selecting bun test flags or building and cross-compiling the standalone CLI | skills `bun-development` | bun-cli/tooling |
| Adding or changing CLI commands, options or argument parsing with Optique | skills `optique` | bun-cli/interface |
| Drafting or revising a GitHub issue or pull request | skills `gh`; skills `unslop` | github-contributions/github, writing |
| Writing or editing contribution docs, Changesets, commit messages or review comments | skills `unslop` | github-contributions/writing |
| Creating or splitting commits for a contribution | skills `git-commit`; skills `unslop` | github-contributions/commits, writing |
| Planning, specifying, implementing or debugging a change | plugin `superpowers` | sdlc/methodology |
| Reviewing a diff or pull request, or wanting an independent second pass | plugin `codex` (Claude Code) | sdlc/review |
| Writing, changing or reviewing code | plugin `ponytail` | sdlc/style |

### Conventions

- **bun-cli/verification:** Run bun test before committing. For CLI integration tests, use a temporary HOME, a fixture catalog and fake installers; keep network calls and the developer's agent setup out of the test.

- **bun-cli/interface:** When changing a CLI command, keep its help, exit codes and machine-readable output consistent. Add a Changeset for user-visible behavior changes.

- **github-contributions/github:** Before drafting or submitting a GitHub issue, read the matching form in .github/ISSUE_TEMPLATE/ and address its required fields. For PRs, read .github/PULL_REQUEST_TEMPLATE.md and keep its headings. Follow the template even when supplying a body directly to gh or an API. A request for a draft ends with a title and body.

- **github-contributions/writing:** Edit the prose without changing template headings, quoted errors, commands, or reported test results.
- **github-contributions/commits:** Give each commit one purpose and a Conventional Commits subject. Before submitting a PR, review the commits against its target branch. Fold fixups and work-in-progress commits into the changes they complete, split unrelated changes, and order the series so a reviewer can follow it. Verify the final diff and rerun the project checks after rewriting. Get approval before rewriting published history.

- **sdlc/methodology/superpowers:** Spec -> plan -> TDD -> verification -> review before shipping.
- **sdlc/style/ponytail:** Shortest working diff; platform features before dependencies.
<!-- loadouts:end -->
