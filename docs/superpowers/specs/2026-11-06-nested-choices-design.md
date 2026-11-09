# Nested choices and conditional loadout includes

Status: approved by the user on 2026-11-06; implement both capabilities.

## Intent and scope

The user wants concern-based loadouts: a testing loadout can contain language-specific framework choices, and a frontend loadout can offer React or Vue by including smaller reusable loadouts from its selected members. Both capabilities are required. Preserve additive composition, explicit source identity, shared ownership, and conflict reporting; introduce no overrides, aliases, expressions, or new dependencies.

This extends the approved additive-includes design. Existing flat YAML and top-level includes remain valid. Source formats, native agent configuration, skill installation, global services, and publication approval requirements stay unchanged.

## Approaches and decision

1. Conditional includes alone reuse smaller loadouts but force authors to create extra files for related choices that belong together. The user explicitly wants nested groups too.
2. Nested groups alone organize one definition but duplicate independently reusable loadouts. The user explicitly wants conditional includes too.
3. Recursive item containers with optional includes support both through the existing item/group distinction. This is the recommended implementation approach: a member is still an item, and an item can additionally contain named items/groups or include other loadouts.

The user approved both capabilities and the recursive syntax, inactive-choice behavior, graph-resolution rules, and lock version below.

## YAML and choice paths

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
          extras:
            any_of:
              coverage:
                conventions: Check coverage for changed behavior.
              property-testing:
                conventions: Prefer property tests for broad input spaces.
            default: []
      typescript:
        items:
          framework:
            one_of:
              vitest:
                conventions: Use Vitest for unit tests.
              jest:
                conventions: Use Jest for unit tests.
            default: vitest
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

The GitHub repositories above are illustrative. All current item capabilities (skills, packageSkills, harness-specific plugins, MCP, installer, conventions) remain available on containers and leaves. An active container contributes its own capabilities once, then its active descendants. `items` and `includes` belong to the common item, not to `claude` or `codex`; choice activation is shared by harnesses. Group objects retain only `one_of` or `any_of` and `default`; use member `items` for nesting. Ordinary items may also contain `items` and `includes`, so there is one recursive item type rather than a second member-only format.

Existing default syntax remains: one_of has a scalar default, any_of has an array default. Validate every declared branch's syntax, identifiers, defaults, and include selection shape even if inactive. Reject recursive YAML aliases/cyclic object structures rather than recursing indefinitely. Do not interpret unknown group/container fields as ordinary capabilities or silently ignore a misspelled nesting key.

Choice keys are slash-separated paths relative to a loadout, including member names and omitting literal `items`/`one_of`/`any_of` keys. Segments use the existing item identifier character set; slash is reserved as the separator. The same path form is used in manifest choices, include choices, CLI operands, status, and lock effective choices. Arrays still contain immediate member names, not paths.

```json
{
  "languages": ["python"],
  "languages/python/framework": ["pytest"],
  "languages/python/extras": ["coverage"]
}
```

A child loadout keeps its own identity and choice namespace. An include configures its choices through its existing `choices` mapping; do not invent paths across loadout boundaries. An included-only loadout retains the existing edit-the-declaring-include or explicit-direct-selection workflow.

## Activation and explicit requests

- An item is active only when all containing choice members are selected. Root items and ordinary child items under an active container are unconditional.
- Resolve parent groups before descendants. Apply defaults only for active groups that have no explicit request. The lock records active groups only, including effective empty arrays.
- Explicit requests from direct roots and all active include occurrences must agree at each choice path. Compare any_of arrays as sets, never union different requests. Omission accepts an explicit request elsewhere or the definition's default. Explicit empty still means select none.
- A request for an unknown group/member is an error. A request for a known but inactive descendant is also an error, showing which ancestor must be selected. A child request never implicitly enables its ancestors.
- Separate active members may include the same child. Equal sources and compatible requests merge by group path; omitted and explicit requests combine as before. Contradictory requests report both member locations. The resulting child is applied only once.
- Source, artifact, and convention behavior remains additive. Structural conflicts fail before project writes/installers; agents review semantic contradictions in conventions.

## Conditional graph resolution

Only top-level includes and includes in active items form dependency edges. Inactive includes do not require their targets to exist or fetch their repositories during install. Source syntax is validated everywhere. A shared catalog definition is forbidden from declaring a consumer-local include even in an inactive branch; this is a declaration portability rule, not a selection-dependent permission.

Resolve the complete active graph and compatible requests before producing desired artifacts or changing project files. Roots, declarations and branches must have deterministic traversal/canonicalization. Reuse existing pinned-source, update, and local-snapshot rules. Cache definition reads by full source/resolution, not merely by name, so alternatives cannot accidentally share a definition.

Conditional edges introduce feedback: a later active include can supply an explicit request that replaces a default and removes a previously explored edge. Recompute reachability and requests when activation changes; never accumulate requirements from branches that are no longer active. Start each resolution from current declarations, not the previous lock's defaulted choices. Settle unconditional incoming requirements before expanding provisional defaults where possible.

The implementation should use deterministic rounds of reachable declarations, incoming requests, effective choices, and emitted edges. Conflicting or invalid provisional nodes remain unresolved with recorded diagnostics rather than arbitrarily picking a source/member; they emit no outgoing conditional edges. Rebuild each round from roots and the preceding active-edge state. Only a stable, valid result may be applied. Deferred missing-source/choice diagnostics must be discarded if their incoming branch disappears before stability. Previously explored source reads may populate the cache but cannot persist in the final lock or artifact set unless reachable.

Detect repeated non-stable states and reject self-invalidating/oscillating conditional graphs with their relevant paths. Do not add a general constraint solver, search for alternative satisfying selections, or let traversal order decide a result. Active include cycles remain invalid and diamonds remain valid. This deliberately defines a deterministic resolution procedure rather than promising arbitrary boolean dependency solving. The implementation plan must spell out the round state and terminating/error cases before coding the resolver.

## Locking and ownership

Successful installs write lock format **8**. Read formats 1–7 without changing their established semantics; do not apply the new active-edge interpretation to old version-7 records. Existing artifact identifiers, partial recovery, and native configuration ownership remain unchanged.

Keep the existing graph fields: `roots` holds direct declarations, `includes` holds the aggregated active child selection mapping for each active loadout, `loadouts` holds effective active choice paths, and `resolved`/`local` cover the active closure. Each owner-child entry combines compatible active include occurrences. Leaves still have an empty include map. No new persisted provenance structure is necessary: member locations derive from the saved local definition or pinned catalog definition and effective choices.

Lock validation must recompute active groups and active include occurrences from available pinned definitions and compare their normalized aggregate with the saved graph. Preserve offline read behavior: parsing a lock never fetches catalogs. Check remote definitions when loaded. Unknown paths, inactive effective entries, tampered edges, conflicting requests, cycles, and unreachable nodes are invalid. Nested item IDs also require widening packageSkills `requiredBy` validation beyond its current fixed depth.

Install, update, migration, readiness, show, status, doctor, launchers, prune, publication and graph-path helpers must recognize format 8. Switching choices releases only unreachable managed components; other roots and active members retain shared artifacts. Global services and unmanaged files remain untouched. New locks cannot be read by older CLIs; document that compatibility boundary.

## CLI and generated guidance

Existing commands accept paths without adding commands or flags:

```sh
loadouts enable testing/languages python
loadouts switch testing/languages/python/framework unittest
loadouts enable testing/languages/python/extras coverage
loadouts switch frontend/framework vue
```

`add --with` also accepts nested group paths. `show` exposes the full declared tree and includes; `status` exposes active choices/edges. A command targeting an inactive nested group fails with guidance to enable its ancestor first.

Switching/disabling a parent removes explicit choices under deselected members **from that same direct manifest entry only**, as part of the requested branch change. Report those removed descendant requests. Re-enabling the branch then uses its defaults. Do not modify other roots or shared YAML; incompatible requests from those locations still fail atomically. Manually edited manifests with stale inactive requests remain errors rather than being silently rewritten. Unrelated and still-active descendant requests are retained. Process all `--with` values as one declaration; do not silently discard explicitly supplied inactive choices there.

Recursive active item IDs preserve existing IDs for flat definitions and append item/member path segments for nested definitions. AGENTS.md includes active container and leaf conventions once with full attribution. Local routing may target any declared item/group/member path and expands only active descendants, with segment-aware matching; component references retain existing syntax and scan recursively. A parent's routing does not cross into an included loadout's namespace; that loadout contributes its own routing. Empty routing rows remain omitted.

Doctor must distinguish nested active groups from inactive descendants when checking non-selected alternatives; do not report every package in an inactive language branch as a choice conflict. Include diagnostics and mutation guards identify the actual declaring member path as well as the loadout chain. SourceFor and artifact gathering must not leak `items`/`includes` into harness component configurations.

## Publication and exploration

Publication still copies only the selected YAML and requires applied active closure readiness. Check **all include declarations present in the YAML being published**, including inactive branches, for portable GitHub sources. Also check all declarations in the pinned definitions inspected for its active closure. This prevents publishing a dormant project-local dependency simply because it was not selected.

Do not fetch inactive targets in an offline preview or claim they were installed/tested. The preview and PR body identify the verified active choices and explain that inactive targets were checked for source portability only. Resolving/verifying every possible branch is outside this feature. Active closure preview retains the existing pinned-cache/no-network guarantee.

Update exploration guidance to organize by concern: reuse suitable catalog loadouts first, use conditional includes for independently reusable alternatives, and nested groups for cohesive local options. Agents must use actual create/validate/add/choice commands and review only selected closure semantics before applying; do not imply one successful installation verifies all alternatives. Update public README, reference, command help, examples, both v1 schemas, and an appropriate Changeset. Schema version directory remains v1; release tags select the schema revision as before.

## Implementation scope and verification

Primary code: `src/loadout.ts`, `sources.ts`, `manifest.ts`, `lock.ts`, `sync.ts`, `agentsmd.ts`, `doctor.ts`, `publish.ts`, and CLI/help definitions. Audit connected readers and packageSkills ownership paths rather than assuming the graph helpers are the only lock consumers. Shared recursive traversal/choice resolution should replace flat assumptions without introducing a separate policy engine.

Use Bun 1.4.4, existing dependencies, temporary HOME/projects, local fixture catalogs, and fake skills/plugin/installer commands. No tests may use real network, real HOME, or real npx skills. Follow failing test → implementation → passing test; run the full suite before each commit. Preserve the existing untracked illustration and other unrelated work. Continue on the existing feature branch; no push, merge, publication, installed CLI replacement, or acm-website changes are included.

Required coverage:

- Recursive parse/schema agreement; multiple nesting levels and groups per member; mixed container capabilities; malformed paths/defaults/aliases; safe prototype-named keys.
- Nested defaults, explicit empty, inactive/unknown choices, precise source/item attribution, recursively generated routing/conventions, container and descendant artifacts.
- Conditional includes with nested choices, same-child multiple occurrences, diamonds, active/inactive cycles, cross-root explicit/default reconciliation, reversed declaration order, source/choice conflicts, and feedback/repeated-state failure.
- A provisional default edge that disappears must not leave a locked node, request, artifact or spurious final error; inactive targets must not be fetched. Conflicts fail before project writes and fake installer calls.
- Branch switches, descendant-request cleanup, shared retention, last-owner removal, idempotent second install, transitive update, local snapshots, packageSkills ownership, legacy lock reads/migration and tampered v8 rejection.
- Existing command grammar and help; nested switch/enable/disable/--with, included-only guards, read-only launch/status/show, and doctor.
- Offline publication portability checks on inactive declarations, no inactive-target fetches, active cache refusal, unchanged YAML output and explicit verification scope.
- Full test suite, native build, compiled isolated scenario combining nested groups with a conditional React/Vue include, branch switching and a byte-identical second install.

Implementation-specific helper names, test placement, and refactoring boundaries belong in the plan. No additional user-facing options or features are implied.
