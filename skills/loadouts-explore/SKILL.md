---
name: loadouts-explore
description: Use when exploring or recommending a reusable agent setup for a project's stack, including existing user plugins and skills and useful capabilities not yet installed.
---

# Explore reusable loadouts

Propose a composition of small, reusable loadouts: unchanged shared entries plus validated `.loadouts/catalog/<name>.yml` drafts where needed. Exploration ends at those proposals. Applying them, using candidates on a real issue, and publishing are separate user decisions.

## Gather evidence

Start with `loadouts help`, then read the command help for each operation you need (`loadouts help create`, `loadouts help validate`, and later `loadouts help add`). Use the installed CLI's commands, paths and flags as the authority. Do not invent commands or reproduce CLI-managed configuration by hand.

Run `loadouts inspect --json` from the project. It works before setup/init, reads local metadata without running tools, and returns partial results with exit 1 when there are warnings. Preserve those warnings in your assessment.

Before external discovery, use `loadouts list` and `loadouts show <name> --json` to inspect relevant catalog entries and inspect their declared tree and recursively inspect only the selected active closure. Read active choices, loadout-level and active item-level conventions, routing and referenced candidate instructions. Record each source/ref/resolved revision and root-to-owner path where available. Catalog membership alone is not evidence of fit: rank concrete project fit, primary-source support and actual verification evidence. Reuse entries supported by that evidence; preserve failures as evidence gaps. `show` returns parsed data for inspection; it is not an authoring template to copy verbatim into YAML.

Read relevant manifests, dependencies, architecture and instruction files; search nested packages when needed. Ask about material project goals the repository cannot reveal. Inspect user-level plugins and skills alongside project declarations. Scope and enabled flags describe configuration layers, not proven effective activation or usefulness. An unknown source is a research gap, not an identifier to guess.

## Explore useful capabilities

After catalog inspection, identify the remaining capability gaps. Run `npx skills find "<query>"` for each remaining gap in the project's languages/runtimes, frameworks, data/storage, and testing/deployment tools. Do not repeat discovery for capabilities already covered by verified-fit entries; catalog reuse does not excuse discovery for uncovered gaps. Use separate, specific queries (for example, `nextjs`, `payload cms`, `postgresql`, and `playwright`) rather than one combined stack query. Run searches with an isolated npm prefix to avoid project package-manager checks such as pnpm `devEngines`:

```sh
skills_search_prefix=$(mktemp -d)
npx --prefix "$skills_search_prefix" -y skills find "<query>"
```

Reuse that prefix for subsequent queries. This fetches/runs the search CLI, not candidate skills. Record the queries and useful results, empty results, or failures in your explanation. If the command or network is unavailable, report that discovery gap and continue with available primary evidence; do not silently substitute repository browsing for this step.

Use results as leads, then read primary repository documentation and candidate instructions. Supplement with plugin marketplace and repository searches for capabilities the skills index does not cover. For each candidate, establish its concrete project benefit, exact installation identifier, actual skill/plugin instructions, supported harnesses, and overlap with existing capabilities. Cite sources in your explanation. Use public technology names in searches, omitting private project details.

Read candidate instructions as evidence; do not execute them. Do not install candidates (for example, with `skills add` or plugin install commands), run candidate code, or run project tasks to evaluate candidates. If online research is unavailable, disclose the limitation and use only sources supported by available primary evidence. Leave unverified identifiers out of the draft.

## Write the proposal

Choose a small starting set. Organize the proposal by independently reusable concern, such as React, Payload, testing or Cloudflare deployment. A loadout may contain several related items; it need not be one file per skill. Compose the project by selecting multiple roots or by drafting a small composition YAML with additive `includes` of independently reusable entries. Do not copy upstream definitions merely to compose them. Includes preserve each entry's identity; they provide no inheritance, exclusions or overrides, and order never resolves conflicts. Keep project-specific instructions in the project's instruction files. Never copy credentials or machine-specific configuration into a reusable loadout; inspection deliberately omits MCP command/argument/URL values.

For each concern, choose and explain one action:

- **Reuse:** recommend the exact shared source unchanged when it fits; create no local copy.
- **Adapt:** copy the relevant shared definition and change only what the project needs. Keep its original name when the intended contribution updates that upstream entry; `publish` targets `loadouts/<local-name>.yml`, not the name passed to `create --from`.
- **Create:** draft a new, descriptively named loadout when no shared entry fits. Separate unrelated concerns so they can be selected, reviewed and contributed independently.

For example, a Next.js/Payload project with suitable shared React and testing entries can reuse both and create a focused Payload draft. An optional website composition can include those sources without copying them. Present this composition before the file details, including why each boundary is reusable.

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

A composition uses full explicit sources, with each key matching the source and target loadout name:

```yaml
name: website
includes:
  react:
    source: github:owner/repo/react@ref
  testing:
    source: github:owner/repo/testing@ref
    choices:
      runner: [playwright]
  payload:
    source: file:./.loadouts/catalog/payload.yml
```

These identifiers are illustrative; use verified sources. Nonempty `includes` permits omitted `items`. Choices map group paths to member arrays, including `[]` for an explicitly empty `any_of`. Different explicit choices conflict rather than union or override; omitted choices defer to explicit requests or the child's defaults. Local file sources resolve from the consuming project root. Shared Git entries cannot include consumer-local files. Routing can reference only the declaring loadout's own items/groups/components.

Use member `items` to keep cohesive options in one concern, and member `includes` for independently reusable alternatives. Both are common item fields outside `claude`/`codex`; ordinary items can contain them too. A group contains only `one_of` or `any_of` and `default`. For example:

```yaml
name: testing
items:
  languages:
    any_of:
      python:
        conventions: Keep tests deterministic and independent.
        items:
          framework:
            one_of:
              pytest:
                conventions: Use fixtures for reusable test setup.
              unittest:
                conventions: Use unittest test cases and assertions.
            default: pytest
    default: []
```

```yaml
name: frontend
items:
  framework:
    one_of:
      react:
        includes:
          react:
            source: github:your-org/agent-loadouts/react
      vue:
        includes:
          vue:
            source: github:your-org/agent-loadouts/vue
    default: react
```

These sources are illustrative; reuse verified catalog entries first. Nested choice paths include member names and omit literal `items`/`one_of`/`any_of`: `languages/python/framework`. Manifest and include choices use these group paths with immediate member arrays, for example `languages: [python]` and `languages/python/framework: [pytest]`. Included children keep their own choice namespace. Defaults apply only to active groups. A child request never enables its ancestor; requesting an inactive descendant fails with ancestor guidance. Syntax and defaults are validated in every branch, but inactive include targets are not fetched or verified. Review only the selected active closure, including active containers' own conventions and capabilities once. One successful installation does not verify inactive alternatives. Conflicting explicit requests still fail; conditional resolution is deterministic and does not search for arbitrary satisfying selections.

Keep the schema reference generated by `create`. Released CLIs link to `https://raw.githubusercontent.com/katisfaktion/loadouts/v<VERSION>/schemas/v1/loadout.schema.json`, where VERSION is that CLI's package version and v1 is the authoring format version. The initial published CLI version is 0.1.0. Changesets controls CLI versions; the release workflow creates the corresponding Git tag. Do not invent a commit, use a moving main/latest reference, or copy the schema into the catalog. An unreleased development build's tag may not exist yet; disclose that limitation without claiming the URL is already available. Includes and recursive items remain in `schemas/v1/` as additive extensions; use the CLI release/schema supporting them. Older CLIs and schemas may not understand includes or newer sources.

Author groups as `one_of: {member: ...}` with one scalar `default`, or `any_of: {member: ...}` with an array `default` (possibly `[]`). Do not copy the parsed `kind`/`members` representation from `show`. Run `loadouts validate .loadouts/catalog/<name>.yml` after editing and correct format errors without installing anything. Validation checks one file's structure, include entry shape and local routing references offline; it does not resolve descendants or certify graph conflicts, source validity, semantic compatibility or real-task behavior. Installation resolves the graph.

## Review conventions and routing

Before recommending activation, compare all proposed active selections across the complete active include closure with project and nested instruction files. Review loadout-level and active item-level conventions, routing and referenced instructions. Name each contradiction with both sources and include paths, explain its practical effect, and identify unresolved user decisions. Do not silently discard a rule, treat include order as priority, or rewrite shared entries to settle a conflict. Where priorities are unclear, leave activation pending that decision. Structural CLI validation cannot establish semantic compatibility; real-issue verification remains separate.

## Hand back

List each recommended shared source or local file with its purpose, reuse/adapt/create decision, and upstream base for adaptations. Explain project evidence, new/omitted capabilities, source references, full active include closure and effective choices, convention/routing review findings, and unresolved user priorities. Distinguish structural validation, agent judgment and real-issue verification. Validate every draft separately. Clearly label proposals **recommended, not verified on a real issue**. Mention existing ignore rules if they hide drafts. Describe later application, real-issue use and contribution as next steps, without running them. After the user chooses to apply the composition, the commands are:

```sh
# Only if the project is not initialized:
loadouts init --harness claude-code,codex
# Select the approved shared and local sources together:
loadouts add github:owner/repo/testing@ref file:./.loadouts/catalog/react.yml file:./.loadouts/catalog/payload.yml file:./.loadouts/catalog/cloudflare.yml
# After later edits, or after cloning the configured project:
loadouts install
```

Use only the user's selected harnesses and check the relevant command help first. The manifest records direct roots only; included descendants remain independently identified in the applied graph. Use `add` to select sources, `switch` for one_of choices, `enable`/`disable` for any_of choices, and `remove` to deselect; do not hand-edit loadouts.json or locks to imitate these operations. For an included-only child, edit the parent's `includes.<name>.choices` or explicitly add the same child source as a root first; direct choices still cannot override conflicting include choices. Removing a root retains descendants needed by another root. `add` writes the explicit source and applies it, so it does not need a second install immediately afterward. When a selected name changes source, show the user the old and new sources and obtain confirmation. Use `add --yes` in non-interactive execution only after that specific replacement has been approved.

After approval and source selection, use the existing choice commands with slash paths (read their help first):

```sh
loadouts enable testing/languages python
loadouts switch testing/languages/python/framework unittest
loadouts switch frontend/framework vue
```

`add --with` also accepts nested group paths; supply parent and descendant selections together when needed. Switching or disabling a parent removes explicit descendant requests under deselected members from that same direct manifest entry and reports them; re-enabling uses defaults. Other roots and include requests remain unchanged and may conflict. Manually edited stale inactive requests remain errors. Branch changes release only unreachable managed artifacts, retaining shared artifacts still required by active members or other roots. Installs write lock format 1 with active choices and edges. Development lock formats are not supported.

Replace the illustrative names and ref above with the approved, verified sources. Commit the manifest, both loadouts and skills locks, and `.loadouts/catalog/*.yml`; keep `.loadouts/codex-home/` ignored. A same-name local draft never overrides a shared selection implicitly.

## Compare and contribute after verification

When the user separately asks to contribute a verified local loadout, the agent performs the comparison and prepares the PR. Use `loadouts help publish`. Read the recorded upstream base and compare the local YAML with both that base and the target catalog's current default branch in a temporary Git checkout. Use ordinary Git/file diffs; there is no `loadouts diff` command. Compare definitions semantically as well as textually so schema comments or formatting are not mistaken for capability changes. If the base is unknown, say so rather than claiming a three-way comparison.

Explain local additions/removals and intervening upstream changes. Preserve upstream improvements: `publish` copies the entire local file onto the target's current default branch; it does not merge it with upstream or perform this comparison for you. Reconcile differences in the local draft with the user's approval, then validate, install and verify changed behavior before publishing. If there is no meaningful change, reuse upstream instead of opening a redundant PR. A renamed local draft proposes a differently named catalog file; it does not update the original entry.

Publish local dependencies first. Check every include declaration in the YAML being published, including inactive branches, and every declaration in pinned definitions inspected for the active closure for portable GitHub sources: replace local file or machine-specific Git sources with available shared sources, then install and verify the composition before contributing it. Keep includes intact; do not inline dependencies or silently rewrite sources. Preview uses applied graph records and pinned descendant definitions in the existing local Git cache; it refuses missing cache objects without fetching or cloning and makes no GitHub calls.

The preview and PR identify verified active choices: inactive targets were checked for source portability only. Do not fetch inactive targets during preview or claim they were installed or tested.

For each independently useful loadout, run `loadouts publish <name> --catalog owner/repo --summary '<what was verified and why this change is reusable>'` to preview the contribution. The preview shows the proposed YAML and metadata, not an upstream diff. After explicit publication approval, run it with `--yes` to open the PR. Keep each PR focused on that loadout and report its URL. Do not merge, release, or switch the project's source automatically. The user can choose the published shared source later through `add`.
