# Loadout Exploration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an existing agent inspect project/user setups, research useful additions, and write a validated local draft without applying it.

**Architecture:** A filesystem-only inventory feeds a bundled exploration skill. CLI text delivery embeds the skill in native binaries; the existing YAML parser validates drafts before initialization.

**Tech Stack:** Bun 1.3.14, TypeScript, Bun.YAML/Bun.TOML, node:util parseArgs; no new dependencies.

**Spec:** docs/superpowers/specs/2026-10-30-exploration-design.md

## Global Constraints

- Stay on feat/cli. English throughout. Full bun test before every commit.
- Tests use temporary HOME and local fixtures, never network or real npx skills.
- No real-home changes, push, release or live PR submission. Inspection executes no subprocess and writes no files.
- Exploration can write a proposed YAML only; apply, real-issue use and publication are separate actions.
- Preserve existing CLI signatures, artifact keys and YAML fields. No dependencies or unrelated refactoring.

## Review Focus

1. Missing/malformed/unreadable metadata must preserve usable partial inventory and actionable warnings, without leaking parser input (Task 1).
2. User/project/local precedence, installed-only plugins and ambiguous skill sources must not be presented as proven effective usage (Task 1).
3. MCP secrets and credential-bearing source URLs must not escape in JSON, human output or errors (Task 1).
4. Inspection and validation must work before init and from nested repositories without subprocess/cache/config mutations (Tasks 1–2).
5. The exploration skill must preserve drafts, handle unknown sources and unavailable research, and stop before installation or verification on real issues (Task 3).

### Task 1: Read-only inventory

**Files:** create src/inspect.ts and tests/inspect.test.ts; modify src/cli.ts.

**Interfaces:** `inspectionRoot(cwd: string): string`; `inspectProject(cwd: string): Inspection`. Inspection has `project: string`, `initialized: boolean`, `manifests: string[]`, `instructions: string[]`, `plugins: PluginRecord[]`, `skills: SkillRecord[]`, `mcp: McpRecord[]`, `warnings: string[]`. Record fields and scope/harness values are fixed by the spec. Export the Inspection interface; private helper types stay in inspect.ts. `inspect [--json]` rejects positionals, prints inventory, exits 1 for warnings/0 otherwise. Missing optional files produce no warnings.

- [ ] Write CLI tests for pre-init user/project/local plugin declarations and source evidence; installed-only and project-filtered registry entries; Codex plugin inventory; skills from standard directories, source locks and unambiguous applied-lock fallback; disabled entries; MCP transport without values; manifest/instruction paths; nested-root discovery; malformed files preserving results; no subprocess calls or file changes.
- [ ] Run `bun test tests/inspect.test.ts`: expected failures because inspect is unknown.
- [ ] Implement the filesystem readers with local error isolation and safe allowlisted metadata projection. Reuse home/JSON/parser conventions; do not call scanGlobals/listSkills since they spawn npx. Preserve unknown sources as null. Sort output deterministically. Register inspect with human output exposing the same scopes/sources/warnings as JSON.
- [ ] Run targeted tests then full `bun test`: expected all pass.
- [ ] Commit `feat: inspect project and user agent setups without side effects`.

### Task 2: Validate pre-init drafts

**Files:** modify src/cli.ts; create tests/validate.test.ts.

**Interfaces:** `validate <file>` accepts exactly one file, reads it without writing, and calls `parseLoadout(text, basename(file))`. Success output `Valid loadout: <name>`/exit 0; malformed YAML or name mismatch exit 1; missing/unexpected args exit 2. No new library interface or schema fields.

- [ ] Write tests for valid pre-init local YAML, unknown/invalid fields as handled by the existing parser, filename mismatch, malformed YAML, missing files, usage errors and unchanged directory state. Assert no lock/config creation.
- [ ] Run `bun test tests/validate.test.ts`: expected unknown command failures.
- [ ] Implement the command using existing parser/CliError conventions and node:path basename. Keep parser semantics unchanged; schema remains editor/agent guidance.
- [ ] Run targeted tests then full `bun test`: expected all pass.
- [ ] Commit `feat: validate local loadout drafts before initialization`.

### Task 3: Bundled exploration skill

**Files:** create skills/loadouts-explore/SKILL.md, tests/explore.test.ts, .changeset/exploration.md; modify src/cli.ts and README.md.

**Interfaces:** `explore` accepts no arguments and prints the embedded SKILL.md. Use Bun's text import so the native binary is independent of repository files. Skill name `loadouts-explore`, standard name/description frontmatter; no additional skill assets or automatic global installation.

- [ ] Run a baseline agent scenario without the skill using a temporary project and fixed research fixtures; record observed gaps before writing the skill. Write CLI tests for exact bundled text output from an uninitialized directory, no state mutations and invalid arguments.
- [ ] Run `bun test tests/explore.test.ts`: expected unknown command failure.
- [ ] Write the skill covering inspect → stack/goals → existing user/project capabilities → source-backed research → proposed YAML → validation and explanation. Include one valid source-format example and existing schema link. Preserve existing drafts/symlink boundaries; no init/add/install/issue work/publish. Unknown candidates stay out of executable YAML. Keep recommendation rationale in the response rather than new YAML fields.
- [ ] Register explore; document how to ask an agent to read `loadouts explore`, inspect/validate examples, scope/privacy limits and the subsequent separate apply/use/publish steps. Add minor Changeset.
- [ ] Run the same fixture scenario with the skill; validate resulting YAML and inspect installed-state/draft preservation. Run skill-creator quick_validate. Record any baseline that already passed honestly.
- [ ] Run full `bun test`, native build and inspect/explore/validate outside the checkout; expected all pass. Confirm Changeset minor status.
- [ ] Commit `feat: guide agents through loadout exploration and drafting`.

Finish with one independent feature review from the starting commit, fix important findings with RED→GREEN regressions and a green full suite, preserve the local feature branch and report evidence. User go-ahead retains inline execution without a further approval round.
