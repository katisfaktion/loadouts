# CLI Ergonomics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give loadouts cohesive Optique parsing and Bun-inspired help and human output.

**Architecture:** Compose command parsers in one module, pass parsed values to existing handlers, and derive help from the same grammar. Share a small terminal formatter across help and human results; leave machine and child-process output untouched.

**Tech Stack:** Bun, TypeScript, @optique/core, existing Bun YAML/TOML.

**Spec:** docs/superpowers/specs/2026-11-04-cli-ergonomics-design.md

## Global Constraints

- Preserve command names, options, exit codes, JSON formats, and exact launcher forwarding.
- Retain detailed agent guidance and examples; no completion or interactive features.
- Honor NO_COLOR, NODE_DISABLE_COLORS, FORCE_COLOR and per-stream TTY state.
- Tests use isolated homes, fixture catalogs and fake tools; no network or real installations.
- Run the full `bun test` suite before every commit; native compilation must work.
- Use the existing feat/cli branch; do not push or change real agent configuration.

## Review Focus

- Missing/extra arguments and unknown options must fail with code 2 before side effects (Task 1).
- Repeated --with, empty choices, options after positionals and literal arguments after -- must retain meaning (Task 1).
- Launcher --help, unknown flags and -- must reach the child unchanged (Task 1; existing launch tests plus parser regression).
- Forced colors must never contaminate JSON or exploration Markdown; redirected output stays plain by default (Tasks 2–3).
- Help must document every accepted option, remain aligned with ANSI enabled, and retain long installation guidance (Task 2).

### Task 1: Compose CLI arguments with Optique

**Files:** Create src/commands.ts and tests/commands.test.ts; modify src/cli.ts, src/sync.ts, package.json, bun.lock.

**Interfaces:** Export `parseCommand(argv: string[]): ParsedCommand` from commands.ts. ParsedCommand contains `name: string`, `positionals: string[]`, `values: {catalog?: string; harness?: string; from?: string; summary?: string; yes?: boolean; json?: boolean; with?: string[]}`. Export command parsers for help rendering. CLI handlers and projectCommand consume parsed arguments instead of reparsing strings. Raw launcher positionals preserve original argv.

- [ ] Write parser tests for every command shape, missing/extra arguments, repeated options, empty choice values, separators, unknown options and launcher forwarding.
- [ ] Run `bun test tests/commands.test.ts` and observe failure before implementation.
- [ ] Add @optique/core; implement composed grammar and migrate existing handler parsing. Keep command summaries/examples in the existing registry until Task 2.
- [ ] Run parser and CLI/launch tests, then full `bun test`.
- [ ] Commit `refactor(cli): compose command parsing with Optique` with design and plan.

### Task 2: Render cohesive help and terminal colors

**Files:** Create src/output.ts and tests/output.test.ts; modify src/help.ts, src/cli.ts, src/commands.ts, tests/cli.test.ts, tests/helpers.ts.

**Interfaces:** output.ts exports `paint(text: string, tone: Tone, stream?: "stdout" | "stderr"): string`; Tone is magenta/blue/cyan/green/yellow/red/dim. helpText(command?: string) retains its public signature. Help usage/options derive from Optique documentation, command registry retains summaries/examples. Human error rendering uses stderr color policy.

- [ ] Add tests for root aliases, grouped aligned help, all command options, NO_COLOR/FORCE_COLOR precedence, plain pipes, raw JSON and exploration guidance.
- [ ] Watch the focused tests fail.
- [ ] Implement shared color policy, screenshot-inspired help with generated usage/options, and colored errors. Preserve detailed help paragraphs.
- [ ] Run focused tests and full `bun test`.
- [ ] Commit `feat(cli): add Bun-inspired help and terminal styling`.

### Task 3: Apply styling to human results and verify the built CLI

**Files:** Modify src/cli.ts, src/sync.ts, src/codex-plugins.ts, src/package-skills.ts, README.md; extend tests/output.test.ts and tests/cli.test.ts as needed.

**Interfaces:** Existing JSON/status schemas and business functions remain unchanged. Human status uses labeled source and choice rows. Sync retains artifact changes and Nothing changed; successful nonempty changes end with counts of additions, removals and written files.

- [ ] Test readable status, install summary/idempotence, doctor fixes and colored warnings while JSON remains parseable under forced color.
- [ ] Observe failures, implement shared styling at human-output sites and document terminal behavior.
- [ ] Run focused tests and full `bun test`; run `bun run build` and compiled help/error/fixture workflow checks, including a terminal preview.
- [ ] Commit `feat(cli): unify install and diagnostic output`.
- [ ] Run one fresh independent final review; fix important findings with regression tests and a green full suite, record lesser limitations, retain the feature branch without publishing.
