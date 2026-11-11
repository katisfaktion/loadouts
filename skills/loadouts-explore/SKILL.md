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

Choose a small starting set. Organize the proposal by independently reusable concern, such as React, Payload, testing or Cloudflare deployment. A loadout may contain several related items; it need not be one file per skill.

The default project proposal is a list of focused sources to select directly in `loadouts.json` after approval, plus local YAML drafts only for adaptations and missing concerns. The manifest already records the complete project setup. A request for one complete or easy-to-switch setup does not by itself require a project-wide wrapper YAML.

If the user identifies a bundle to reuse across projects, propose a composition YAML with additive `includes` and select that bundle once in the manifest. List its children as included dependencies, not duplicate direct selections. Use member includes when a reusable concern offers alternatives, such as a frontend React/Vue choice. Explain the concrete reuse purpose of each composition file.

Do not copy upstream definitions merely to compose them. Includes preserve each entry's identity; they provide no inheritance, exclusions or overrides, and order never resolves conflicts. Keep project-specific instructions in the project's instruction files. Never copy credentials or machine-specific configuration into a reusable loadout; inspection deliberately omits MCP command/argument/URL values.

For each concern, choose and explain one action:

- **Reuse:** recommend the exact shared source unchanged when it fits; create no local copy.
- **Adapt:** copy the relevant shared definition and change only what the project needs. Keep its original name when the intended contribution updates that upstream entry; `publish` targets `loadouts/<local-name>.yml`, not the name passed to `create --from`.
- **Create:** draft a new, descriptively named loadout when no shared entry fits. Separate unrelated concerns so they can be selected, reviewed and contributed independently.

For example, a single Next.js/Payload project with suitable shared React and testing entries can select both directly and create a focused Payload draft. Its proposal needs only that new YAML file, not a website wrapper. If the same website bundle is intended for several projects, a website composition can include those sources without copying them. Present the proposed selections before the file details, including why each boundary is reusable.

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

List each recommended shared source or local file with its purpose, reuse/adapt/create decision, and upstream base for adaptations. Explain project evidence, new/omitted capabilities, source references, full active include closure and effective choices, convention/routing review findings, and unresolved user priorities. Distinguish structural validation, agent judgment and real-issue verification. Validate every draft separately. Clearly label proposals **recommended, not verified on a real issue**. Mention existing ignore rules if they hide drafts. Describe later application, real-issue use and contribution as next steps, without running them.

When the user chooses to apply a proposal, read `loadouts agents apply`. When asked to contribute a verified local definition, read `loadouts agents publish`.
