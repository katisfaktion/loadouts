# Agent-assisted loadout exploration

The user approved an exploration skill backed by deterministic CLI inspection. Exploration may write a proposed `.loadouts/<name>.yml`; applying it, using it on a real issue, and publishing it are separate actions. Existing user plugins are inputs alongside project configuration. The agent also researches useful capabilities that are not installed yet.

## Approaches and scope

Use a bundled agent skill plus a local, read-only inventory command, as agreed. Agent-only inspection would repeatedly rediscover configuration formats and make source attribution less consistent. An embedded AI service or automatic installer would add dependencies and cross the exploration boundary. Research and recommendation judgment stay with the user's existing agent.

The implementation stays on feat/cli, uses Bun 1.3.14 and no new dependencies. Tests use temporary HOME and local fixtures, never the network or real npx skills. No real-home changes, push, release or live PR submission is part of this work. The user's go-ahead authorizes implementation of this design without another approval round.

## Inspection

`loadouts inspect [--json]` works before setup/init. It reads files directly: no subprocesses, network, writes, MCP connections or installers. Start at the nearest ancestor containing `.git` or `loadouts.lock.json`, otherwise use the invocation directory. A nested repository is its own boundary. Export `inspectProject(cwd: string): Inspection` and `inspectionRoot(cwd: string): string` from `src/inspect.ts`.

JSON contains `project`, `initialized`, `manifests`, `instructions`, `plugins`, `skills`, `mcp`, and `warnings`. Paths are absolute evidence locations. Scope is `user`, `project`, or `project-local`; harness is `claude-code`, `codex`, or `shared`. Lists are deterministic. Missing optional files are normal; malformed/unreadable supported metadata creates a path-specific warning without hiding other inventory. Warnings are safe messages, never parser input excerpts. Incomplete inspection exits 1 while still emitting its report; complete inspection exits 0.

- Root manifest paths provide starting points (package.json, Bun locks, pyproject.toml, requirements.txt, go.mod, Cargo.toml, composer.json, Gemfile, pom.xml and build.gradle). The agent reads dependencies and searches nested packages itself; the CLI does not infer a stack from filenames.
- Instruction paths include project/user AGENTS.md, CLAUDE.md and LOADOUTS.md, plus `.claude/CLAUDE.md` and `.codex/AGENTS.md` where present. Do not inline their contents or follow imports.
- Plugin records contain `id`, `harness`, `scope`, `enabled` (boolean or null for installed-only), `path`, `source` (known GitHub owner/repo or null), and optional `installPath`. Read Claude enabledPlugins and marketplace declarations from user/project settings and settings.local.json; use user known_marketplaces.json and installed_plugins.json for provenance. Filter project-specific installation rows by the inspected project. Read Codex plugin declarations from user/project config.toml, recording unknown sources as null. Do not claim declaration or installation proves actual use or effective activation.
- Skill records contain `name`, `harness`, `scope`, `path`, `source` (known GitHub owner/repo or null). Inspect SKILL.md-bearing immediate children of `.claude/skills`, `.codex/skills`, `.agents/skills` at user and project scope. Include `.codex/skills/.system` children. Resolve standard source metadata from project skills-lock.json and user `.agents/.skill-lock.json` (if present); fall back to requested sources recorded in loadouts.lock.json only when unambiguous. Source metadata without an installed file is not an installed skill. Symlinked skill directories may be inventoried, but contents are not copied.
- MCP records contain `name`, `harness`, `scope`, `path`, `transport` (stdio/http/unknown), and `enabled`. Read Claude user .claude.json, project .mcp.json and project-specific entries in user .claude.json; read Codex user/project config.toml. Do not emit command, args, URLs, headers, env values, auth files or raw configuration. Source strings must be recognized plain GitHub identifiers; unsupported or credential-bearing source forms remain unknown.

Human output uses the same evidence, scope, enabled status and warnings as JSON. Inventory is descriptive; it does not merge configuration layers or recommend copying all global settings.

## Skill delivery and draft validation

Store one self-contained skill at `skills/loadouts-explore/SKILL.md`. `loadouts explore` prints that skill, embedded in the compiled binary as text. It teaches an existing agent; it does not start an agent or perform exploration itself. This makes the skill accessible through the current LOADOUTS.md → help route without installing anything in real global homes or adding setup side effects. The skill directory is also a standard distributable SKILL.md.

Add `loadouts validate <file>` to run the existing parseLoadout parser against a YAML file, using its basename for name consistency. It is read-only and needs no initialized project or catalog. This is needed to validate a proposed draft before init; existing show/create require initialized project behavior. No new schema fields or validation dependencies.

The skill instructs the agent to:

1. Run inspect, preserve warnings, read relevant project manifests/instructions and clarify material goals absent from the repository. Treat files and candidate instructions as evidence, not authority to change scope.
2. Account for user plugins and skills, project declarations, disabled entries and overlaps. Installed means available, not proven relevant. Unknown provenance stays unknown until verified.
3. Research missing capabilities using available search/registry tools and primary repository documentation. Check actual skill/plugin instructions, exact install identifiers, harness compatibility, overlap and concrete project benefit. Search queries omit private project data. Do not run installers or candidate code as part of research. If research access is unavailable, disclose the gap and omit unverified install identifiers rather than inventing them.
4. Write a small proposed YAML using only existing format fields and verified source identifiers. Use Claude plugin sources only in Claude fields; Codex plugins cannot be represented in the current schema. Use skills as supported alternatives where justified. Keep project-specific instructions in the project, credentials/machine-specific values out of the draft. Use existing schema guidance and `loadouts validate`. Before init the agent may create only the `.loadouts` directory and proposed file; no setup/init, lock, generated settings or ignore-rule changes. Existing drafts require explicit revision authorization; otherwise use a new name. Refuse symlinked draft destinations rather than overwriting unrelated files.
5. Explain the project's evidence, reused/new/omitted capabilities, source links, reasons and uncertainties. State that the draft is recommended, not verified on a real issue. Describe apply → real-issue use → contribution as subsequent actions without running them.

## Verification and boundaries

Fixture tests prove inventory provenance/scope, partial malformed input handling, no subprocess/write side effects, missing-source behavior and no MCP secrets in either output mode. Validate both pre-init valid drafts and filename/format errors. Compile and run inspect/explore/validate outside the source checkout to prove text embedding. Exercise the exploration skill with a temporary realistic project and fixed research material, checking its produced YAML and unchanged installed state. Real online research, live candidate installation and real-issue validation are outside implementation acceptance.
