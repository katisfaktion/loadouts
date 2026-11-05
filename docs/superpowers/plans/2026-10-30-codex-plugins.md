# Codex Plugins Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Let loadouts propose and apply Codex plugins with their bundled hooks.
**Architecture:** Native Codex commands run against the generated project home. Existing artifact reconciliation owns plugin/marketplace keys and records partial progress; config generation preserves Codex-written plugin state.
**Tech Stack:** Bun 1.3.14, TypeScript, Bun.YAML/Bun.TOML, node:util parseArgs; no dependencies.
**Spec:** docs/superpowers/specs/2026-10-30-codex-plugins-design.md

## Global Constraints

- Work stays on feat/cli. No publication, real project/home writes, or live Ponytail acceptance.
- Tests use temporary homes, local catalogs and fake CLI executables; no network or real npx skills.
- Full bun test before each commit; TDD for runtime changes. All text is English.
- Preserve existing Claude keys and behavior. Keep hooks under Codex trust review.

## Review Focus

- Config regeneration or launch must preserve native plugin/marketplace and nested policy entries.
- Installer failure after side effects must retain retry/removal information and previous progress.
- Multiple plugins can share a marketplace; conflicting sources or unmanaged collisions fail before installers.
- Harness removal and switching must remove only owned Codex resources, retaining Claude equivalents.
- Unknown provenance and disabled/missing plugins must not become false claims of activation or conflict.

### Task 1: Native plugin declaration and lifecycle

**Files:** Modify src/loadout.ts, schemas/loadout.schema.json, src/codex.ts, src/sync.ts, src/lock.ts, src/doctor.ts, src/globals.ts, src/inspect.ts; add src/codex-plugins.ts, tests/codex-plugins.test.ts, tests/fixtures/fake-codex.ts; update tests/loadout.test.ts, tests/validate.test.ts, tests/harnessfiles.test.ts, tests/doctor.test.ts, tests/inspect.test.ts as needed.

**Interfaces:**
- Existing Source shape accepts codex.plugin and required codex.marketplace. Common plugins remain invalid.
- artifactsFor produces codex-plugin:ID and codex-marketplace:NAME:REPO; existing keys unchanged.
- syncCodexPlugins(project: string, lock: Lock, keys: string[]): Promise<void> owns native calls and lock progress.
- writeCodexHome keeps its signature and preserves plugins/marketplaces tables.
- GlobalState adds codexPlugins: string[] for enabled global declarations.
- Pending keys accept skill:, codex-plugin:, codex-marketplace: prefixes.

- [x] Write tests for Ponytail YAML/artifacts and invalid missing marketplace/common plugins; config policies surviving regeneration; fake native CLI lifecycle, no-op, shared marketplace, switch/removal, partial failure/retry/cancel, missing binary, namespace mismatch and ownership conflicts; doctor and inspection provenance.
- [x] Run targeted tests and observe failures before implementation.
- [x] Implement native operations using argument arrays, explicit CODEX_HOME, and validated JSON identities. Keep foreign config safe and validate marketplace conflicts before any installers.
- [x] Run targeted tests, then full `bun test`. Expected: all pass. Compile with `bun run build` and run compiled lifecycle against offline fixtures.
- [x] Commit: `feat: manage Codex plugins in project homes`.

### Task 2: Exploration and usage guidance

**Files:** Modify skills/loadouts-explore/SKILL.md, src/cli.ts, README.md; add .changeset/codex-plugins.md.
**Interfaces:** Codex plugin draft uses the same plugin/marketplace keys under codex. Explore still prints bundled instructions; no installations during drafting.

- [x] Use the observed real exploration failure (Ponytail selected through skills, losing hooks) as baseline; verify a fresh agent can propose native plugins using help/explore after the update.
- [x] Explain native plugin preference when hooks matter, source verification, no duplicate bundled skills, and `/hooks` trust after application. Document the Ponytail example and supported Codex CLI requirements.
- [x] Run full `bun test`, native build, and offline agent acceptance. Expected: valid draft with Codex plugin declaration, no installer calls.
- [x] Commit: `feat: guide exploration toward native Codex plugins`.

## Final verification

Request one independent review of the feature range from 94fd982. Fix important findings with RED/GREEN regressions and full suite. Rebuild dist/loadouts. Report commits, final suite, offline acceptance evidence, any deviations, and live Ponytail testing left to the user. Do not push.
