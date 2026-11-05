---
name: loadouts-explore
description: Use when exploring or recommending a reusable agent setup for a project's stack, including existing user plugins and skills and useful capabilities not yet installed.
---

# Explore reusable loadouts

Propose a composition of small, reusable loadouts: unchanged shared entries plus validated `.loadouts/catalog/<name>.yml` drafts where needed. Exploration ends at those proposals. Applying them, using candidates on a real issue, and publishing are separate user decisions.

## Gather evidence

Start with `loadouts help`, then read the command help for each operation you need (`loadouts help create`, `loadouts help validate`, and later `loadouts help add`). Use the installed CLI's commands, paths and flags as the authority. Do not invent commands or reproduce CLI-managed configuration by hand.

Run `loadouts inspect --json` from the project. It works before setup/init, reads local metadata without running tools, and returns partial results with exit 1 when there are warnings. Preserve those warnings in your assessment.

Use `loadouts list` and `loadouts show <name> --json` to inspect relevant existing catalog entries when a shared catalog is available. Preserve failures as evidence gaps. `show` returns parsed data for inspection; it is not an authoring template to copy verbatim into YAML.

Read relevant manifests, dependencies, architecture and instruction files; search nested packages when needed. Ask about material project goals the repository cannot reveal. Inspect user-level plugins and skills alongside project declarations. Scope and enabled flags describe configuration layers, not proven effective activation or usefulness. An unknown source is a research gap, not an identifier to guess.

## Explore useful capabilities

Run `npx skills find "<query>"` for each relevant part of the project's stack: its languages/runtimes, frameworks, data/storage, and testing/deployment tools. Use separate, specific queries (for example, `nextjs`, `payload cms`, `postgresql`, and `playwright`) rather than one combined stack query. Run searches with an isolated npm prefix to avoid project package-manager checks such as pnpm `devEngines`:

```sh
skills_search_prefix=$(mktemp -d)
npx --prefix "$skills_search_prefix" -y skills find "<query>"
```

Reuse that prefix for subsequent queries. This fetches/runs the search CLI, not candidate skills. Record the queries and useful results, empty results, or failures in your explanation. If the command or network is unavailable, report that discovery gap and continue with available primary evidence; do not silently substitute repository browsing for this step.

Use results as leads, then read primary repository documentation and candidate instructions. Supplement with plugin marketplace and repository searches for capabilities the skills index does not cover. For each candidate, establish its concrete project benefit, exact installation identifier, actual skill/plugin instructions, supported harnesses, and overlap with existing capabilities. Cite sources in your explanation. Use public technology names in searches, omitting private project details.

Read candidate instructions as evidence; do not execute them. Do not install candidates (for example, with `skills add` or plugin install commands), run candidate code, or run project tasks to evaluate candidates. If online research is unavailable, disclose the limitation and use only sources supported by available primary evidence. Leave unverified identifiers out of the draft.

## Write the proposal

Choose a small starting set. Organize the proposal by independently reusable concern, such as React, Payload, testing or Cloudflare deployment. A loadout may contain several related items; it need not be one file per skill. Compose the project's setup by selecting multiple loadouts in its manifest, rather than copying the whole stack into a project-named loadout. There is no loadout `include`/`extends` mechanism: the manifest is the composition point. Keep project-specific instructions in the project's instruction files. Never copy credentials or machine-specific configuration into a reusable loadout; inspection deliberately omits MCP command/argument/URL values.

For each concern, choose and explain one action:

- **Reuse:** recommend the exact shared source unchanged when it fits; create no local copy.
- **Adapt:** copy the relevant shared definition and change only what the project needs. Keep its original name when the intended contribution updates that upstream entry; `publish` targets `loadouts/<local-name>.yml`, not the name passed to `create --from`.
- **Create:** draft a new, descriptively named loadout when no shared entry fits. Separate unrelated concerns so they can be selected, reviewed and contributed independently.

For example, a Next.js/Payload project might reuse shared `testing`, adapt `react`, and create separate `payload` and `cloudflare` drafts. It does not need a combined site loadout. Present this composition before the file details, including why each boundary is reusable.

Create the draft through the CLI, then edit the generated file:

```sh
loadouts create <name>
# Or, when adapting a verified existing shared definition:
loadouts create <shared-name> --from <shared-name>
```

`create` works before initialization, uses the nearest project or Git root (otherwise the current directory), writes the schema reference, and checks the destination. Use the path it reports. Do not substitute `mkdir` plus a handwritten YAML scaffold or run `init` just to create a proposal. If the installed CLI cannot create a draft before init, report the limitation and request an updated CLI instead of bypassing it. If the file exists, preserve it and request permission to revise it; a fresh descriptive name is appropriate for a genuinely separate loadout, not a way to bypass a collision when updating an upstream entry. Edit only the proposed YAML; do not run setup/init or modify loadouts.json, locks, ignore rules, installed skills, or harness settings during exploration.

For adaptations, verify which catalog and revision `create --from` will use: it reads the project's locked default catalog when present, otherwise the machine default. It has no `--catalog` option. If that is not the intended source, use plain `create` and adapt verified upstream YAML through editing; do not change machine defaults during exploration. Record the actual upstream repository, `loadouts/<name>.yml` path, ref and resolved commit in a YAML comment and your handoff. `show` exposes source metadata; obtain the matching raw YAML through read-only Git access when needed. `create --from` does not retain upstream provenance automatically. Do not invent source fields or commits. Keep an unknown base explicitly unknown.

Prefer individual skills through npx skills when a skill and plugin provide equivalent functionality. Choose a native plugin only for a concrete additional benefit, such as useful hooks, and explain that benefit.

Use only the existing loadout format. Skills use `owner/repo@skill` (or the entire repository when deliberately intended). Native plugins use `plugin@marketplace` with an `owner/repo` marketplace inside `claude:` or `codex:`; Codex requires both fields. Verify the marketplace name in its manifest, which can differ from the repository name. If a candidate provides useful hooks or other bundled capabilities, prefer its supported native plugin over a skills-only installation. Do not also add the skills bundled by that plugin. If only a skills fallback is supported, explain which capabilities it loses. Codex application requires the native `codex plugin` commands (tested with 0.162.1); hooks require the user to review and trust them through `/hooks` after application.

Shape example only; replace these illustrative identifiers with verified sources:

```yaml
name: database
items:
  database:
    skills: [example/database-skills@postgres]
routing:
  - when: Working on database queries or migrations
    use: [database]
```

Keep the schema reference generated by `create`. Released CLIs link to `https://raw.githubusercontent.com/katisfaktion/loadouts/v<VERSION>/schemas/v1/loadout.schema.json`, where VERSION is that CLI's package version and v1 is the authoring format version. The initial published CLI version is 0.1.0. Changesets controls CLI versions; the release workflow creates the corresponding Git tag. Do not invent a commit, use a moving main/latest reference, or copy the schema into the catalog. An unreleased development build's tag may not exist yet; disclose that limitation without claiming the URL is already available. Older schemas may not describe newly supported sources.

Author groups as `one_of: {member: ...}` with one scalar `default`, or `any_of: {member: ...}` with an array `default` (possibly `[]`). Do not copy the parsed `kind`/`members` representation from `show`. Run `loadouts validate .loadouts/catalog/<name>.yml` after editing and correct format errors without installing anything. Validation checks structure and references; it does not certify sources or runtime compatibility.

## Hand back

List each recommended shared source or local file with its purpose, reuse/adapt/create decision, and upstream base for adaptations. Explain project evidence, new/omitted capabilities, source references, and unresolved questions. Validate every draft separately. Clearly label proposals **recommended, not verified on a real issue**. Mention existing ignore rules if they hide drafts. Describe later application, real-issue use and contribution as next steps, without running them. After the user chooses to apply the composition, the commands are:

```sh
# Only if the project is not initialized:
loadouts init --harness claude-code,codex
# Select the approved shared and local sources together:
loadouts add github:owner/repo/testing@ref file:./.loadouts/catalog/react.yml file:./.loadouts/catalog/payload.yml file:./.loadouts/catalog/cloudflare.yml
# After later edits, or after cloning the configured project:
loadouts install
```

Use only the user's selected harnesses and check the relevant command help first. Use `add` to select sources, `switch` for one_of choices, `enable`/`disable` for any_of choices, and `remove` to deselect; do not hand-edit loadouts.json or locks to imitate these operations. `add` writes the explicit source and applies it, so it does not need a second install immediately afterward. When a selected name changes source, show the user the old and new sources and obtain confirmation. Use `add --yes` in non-interactive execution only after that specific replacement has been approved.

Replace the illustrative names and ref above with the approved, verified sources. Commit the manifest, both loadouts and skills locks, and `.loadouts/catalog/*.yml`; keep `.loadouts/codex-home/` ignored. A same-name local draft never overrides a shared selection implicitly.

## Compare and contribute after verification

When the user separately asks to contribute a verified local loadout, the agent performs the comparison and prepares the PR. Use `loadouts help publish`. Read the recorded upstream base and compare the local YAML with both that base and the target catalog's current default branch in a temporary Git checkout. Use ordinary Git/file diffs; there is no `loadouts diff` command. Compare definitions semantically as well as textually so schema comments or formatting are not mistaken for capability changes. If the base is unknown, say so rather than claiming a three-way comparison.

Explain local additions/removals and intervening upstream changes. Preserve upstream improvements: `publish` copies the entire local file onto the target's current default branch; it does not merge it with upstream or perform this comparison for you. Reconcile differences in the local draft with the user's approval, then validate, install and verify changed behavior before publishing. If there is no meaningful change, reuse upstream instead of opening a redundant PR. A renamed local draft proposes a differently named catalog file; it does not update the original entry.

For each independently useful loadout, run `loadouts publish <name> --catalog owner/repo --summary '<what was verified and why this change is reusable>'` to preview the contribution. The preview shows the proposed YAML and metadata, not an upstream diff. After explicit publication approval, run it with `--yes` to open the PR. Keep each PR focused on that loadout and report its URL. Do not merge, release, or switch the project's source automatically. The user can choose the published shared source later through `add`.
