# Additive loadout includes

## Intent and agreed behavior

Exploration should prefer suitable, proven catalog entries before discovering new components. A project may select a small composition loadout that includes those entries and adds focused capabilities. Shared definitions remain independent and retain their identity; they are not copied or flattened into a project-specific file.

The user chose additive composition, not inheritance with overrides. Include order must not decide conflicts. Identical requirements deduplicate; incompatible sources, explicit choices or component definitions fail with their provenance before changing the project setup. The agent cross-checks conventions and routing instructions for semantic contradictions. The CLI must not claim to understand or automatically resolve contradictory prose.

## Approaches

- **Manifest-only composition:** the existing behavior. Simple, but a reusable combination cannot itself be shared as a loadout.
- **Additive includes:** chosen. A YAML definition can reference other loadouts and declare its own items, conventions and routing. Existing component reconciliation receives each distinct loadout once.
- **Inheritance and overrides:** rejected for this version. No replacing or suppressing included items, last-writer-wins merging, or implicit local shadowing.

## Format

```yaml
name: website
includes:
  react:
    source: github:acme/agent-loadouts/react@v1.2.0
  testing:
    source: github:acme/agent-loadouts/testing@v1.2.0
    choices:
      runner: [playwright]
items:
  accessibility:
    conventions: Preserve keyboard navigation and visible focus.
routing:
  - when: Changing interface components
    use: [accessibility]
```

Identifiers here are illustrative. `includes` is a mapping from the included loadout's actual name to `{source, choices?}`, using the same entry shape and source syntax as `loadouts.json`. The key must match the source name and the target YAML name. Choices are group-to-member arrays, including an explicit empty array for an `any_of` group. No aliases, shorthand catalog names, version ranges, `extends`, exclusions or arbitrary paths are introduced.

Existing YAML remains valid. A composition with nonempty `includes` may omit `items`; the parser normalizes omitted items to `{}`. A definition with neither `items` nor nonempty `includes` is invalid. Each loadout's routing continues to reference only items/groups/components declared in that loadout. Included routing is carried along independently. Parent routing cannot reach into a child's item namespace in this version.

Local definitions can include `file:./.loadouts/catalog/<name>.yml` and existing explicit GitHub/local-Git sources. File sources always resolve relative to the consuming project root, never the current shell directory. A shared Git catalog definition cannot include consumer-local files: reject this rather than reading arbitrary project content on behalf of a remote catalog. Existing safe-path checks apply to every local descendant.

Shared catalogs continue to use flat `loadouts/<name>.yml` entries. Includes name full sources; there is no new implicit same-catalog resolution rule. Schemas remain under `schemas/v1/`; this is an additive format extension tied to the containing CLI release tag.

## Resolution, conflicts and provenance

Resolve all directly selected roots and their transitive includes before applying anything. Traverse deterministically, retain every edge and root, and load each unique name/source resolution once. Detect cycles using the active ancestry path, not a global visited set: a diamond is valid; `a → b → a` is not. Include the full path in cycle and missing-child errors.

Names keep their current project-wide identity. A source is the full explicit source string, including its declared ref. Different source strings for the same name are conflicts even if two tags currently point at the same commit; they have different future update semantics. The same source reuses one pinned resolution across all incoming paths. Different item names are scoped by their loadout, so `react/review` and `testing/review` do not collide merely by sharing an item key.

Collect explicit choices from every direct selection and include edge before applying defaults. An explicit choice beats an omitted choice/default. Different explicit selections for the same group conflict; `any_of` selections compare as sets, so `[a, b]` equals `[b, a]`, while `[]` conflicts with `[a]`. Do not union incompatible requests. Validate group names, members and cardinality against the resolved child. Defaults come from that child's pinned definition. Preserve old flat-project behavior while reading legacy locks; new graph resolutions use the declaration/default rule above, without treating a previously defaulted choice as a new explicit request.

Identical component declarations deduplicate using existing artifact identities. MCP definitions compare structurally with object-key order ignored and argument order preserved. A marketplace namespace backed by different repositories conflicts, even when its artifact keys differ. Known skill-name/source collisions continue to use the skills/package-skills collision checks. An upstream repository may reveal skill names only during staged discovery: do not promise those unknown collisions can be detected without contacting the installer. They must still fail without overwriting conflicting skill contents and preserve existing recovery state.

Errors show the component or loadout, both definitions/sources, and root-to-owner paths. Deterministic structural conflicts must occur before manifest, lock, generated config or managed skills are written, and before installers or MCP processes are started. Git cache fetches needed for resolution are allowed. This is not a new transaction/rollback guarantee for external installer failures; preserve the existing partial-progress recovery mechanism.

Conventions and routing from each unique resolved loadout are emitted once. Preserve attribution to loadout/item so an agent can locate conflicting instructions. The exploration agent must compare loadout-level and active item-level conventions, routing guidance and the project's existing instructions. It explains contradictions with their sources and seeks a user decision when priorities are unclear. It must not silently discard one rule, claim a CLI validation pass proves compatibility, or rewrite shared entries without authorization.

## Manifest and lock

`loadouts.json` remains the declaration of direct selections only. Resolving includes never adds children to it. No manifest format change is needed.

New successful installs write lock format **7**. Version 1–6 locks remain readable. Existing artifact key strings, native configuration locations and partial recovery fields remain unchanged. Format 7 adds:

- `roots`: the applied direct selection mapping, including explicit choices.
- `includes`: a mapping for every resolved node to its applied include mapping; leaves use `{}`.

Existing `resolved`, `loadouts` and `local` maps contain the entire reachable graph: source resolutions, effective choices and applied local YAML snapshots respectively. Local snapshots and catalog commits preserve exact applied definitions. Derive human-readable include paths from `roots` and `includes` instead of storing a second redundant path list.

Validate graph records at the lock boundary: all roots/edge targets exist, keys agree with target names and sources, every node is reachable, no cycle exists, and root/edge explicit choices agree with effective selections. Local snapshots must agree with their saved include edges. Continue checking remote definitions when loaded; lock parsing itself must not fetch the network.

Readiness compares the current manifest to `roots`, not to the complete resolved node set. An included-only node is installed, not an undeclared pending selection. Local edits remain pending until install, following existing snapshot semantics; doctor reports changed/missing included local files too. When migrating a lock-only project, use saved roots for format 7 and treat all nodes in old flat locks as roots.

## Lifecycle and commands

- `install` resolves changed declarations and applies local edits throughout the reachable graph while reusing unchanged pinned catalog resolutions. Repetition is idempotent.
- `update` refreshes shared resolutions within declared refs, including transitive descendants, and retains applied local snapshots as today. Newly referenced children resolve once. Removed edges release only nodes no longer reachable from any root.
- Convenience selection commands preserve unrelated applied local snapshots. Existing refresh scope rules extend to reachable nodes; adding a new local child must read it because it has no saved snapshot.
- Removing one root retains dependencies and artifacts still needed by another root. Removing a direct child selection keeps it installed if another include still requires it. Attempting to remove an included-only node explains which parents require it instead of silently doing nothing.
- `switch`, `enable` and `disable` continue to modify direct manifest selections. For included-only nodes, explain that the user must edit the parent's `includes.<name>.choices`, or explicitly add the same child source as a direct selection first. A direct selection never overrides a contradictory include choice. No command silently edits shared YAML or promotes an indirect dependency to a root.
- `status` and `status --json` distinguish direct selections from included nodes and expose parent edges. `show` follows an installed included node's pinned source, rather than accidentally reading a same-name local draft or machine-default catalog. `doctor` explains missing descendants, pending local edits and graph problems with their include paths.
- Launchers remain read-only and use graph-aware readiness. They do not resolve new dependencies or change personal configuration.
- `validate` remains offline, validating one file's syntax and local routing references; it validates include entry shape but does not fetch descendants or claim the whole graph is conflict-free. Installation is the graph-resolution gate.

## Contribution workflow

The agent starts with catalog discovery and reuse, then identifies missing capabilities. It may propose a composition loadout plus independently reusable additions. Included upstream definitions are not copied merely to compose them. Direct adaptations still retain their source/revision evidence for later comparison.

After separate real-issue verification, the agent compares changes against their original base and current upstream and prepares focused PRs. `publish` uses the applied lock graph for readiness and ownership checks, including the selected node's descendants. An applied local node may be published even when selected through another loadout rather than directly; it must still match its applied snapshot.

Publication copies only the chosen YAML, retaining includes. A publishable composition's dependency closure must use portable GitHub sources; reject consumer-local and machine-specific absolute Git dependencies with a list of paths to fix. Publish local dependencies first, then change the composition to their available shared sources, install and verify, and contribute the composition. Never inline them or silently rewrite sources. The preview remains free of GitHub calls; it uses recorded graph data. Real publishing checks the target branch as today, and the agent reviews intervening upstream changes before approval. No merging, catalog release or automatic local-to-shared source switch is added.

## Constraints and verification

- Bun **1.4.4**, Bun.YAML/Bun.TOML, existing Optique parser; no new runtime or development dependencies.
- English code, messages, documentation and commits; preserve existing source syntax and artifact keys.
- Tests use temporary homes, local Git catalogs and existing fake skills/plugin/installer scripts. No network, real HOME or real `npx skills` in tests.
- Full `bun test` before every commit; never weaken assertions to obtain a pass.
- No modifications to acm-website, real agent configuration, installed CLI, catalog publication or release actions as part of this implementation.
- Preserve the untracked illustration under `docs/assets/`; it is unrelated to this change.

Verification covers diamonds, cycles, source/choice conflicts, missing descendants, source-order independence, stable repeated installs, transitive updates, ownership-aware removal, legacy locks, native artifacts, publication closure and read-only launch. Agent acceptance scenarios must demonstrate catalog-first discovery, composition without copying, and explicit convention conflict review.
