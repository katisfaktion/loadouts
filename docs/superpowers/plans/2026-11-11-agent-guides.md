# Bundled agent guides implementation plan

**Goal:** Let an agent discover and read the exploration and publication workflows offline.
**Architecture:** Use the existing Optique command grammar and Bun text imports. Keep each workflow in its own SKILL.md.
**Spec:** [Bundled agent workflow guides](../specs/2026-11-11-agent-guides-design.md)

## Global constraints

Keep the exploration alias and the operational publish command. Use a temporary HOME and project for CLI tests. Preserve existing user instructions.

## Review focus

Verify an empty project, an empty PATH, unknown topics, extra arguments and repeated setup. Compare guide output to the source Markdown in both CLI and compiled binary.

## Steps

1. Apply the catalog's agent-authoring selection to the repository.
2. Add failing CLI tests in tests/explore.test.ts and update the hint expectations in tests/config.test.ts.
3. Register agents in src/commands.ts and src/cli.ts. Split publication into skills/loadouts-publish/SKILL.md. Point help, setup, README and reference to the guides.
4. Run the targeted and full suites, build the binary, and check it from a temporary project. Add a minor Changeset.
