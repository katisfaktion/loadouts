# Project-local loadouts and catalog contributions

The user approved proceeding after choosing `.loadouts/<name>.yml`, local-first resolution, and doctor explanations for collisions. The schema remains editor/agent guidance; no minimum CLI version field is introduced. This extends the original one-catalog design with one project-local catalog alongside the existing shared catalog.

## Workflow and approaches

Use stable shared definitions; create or copy a local definition when exploring; apply it in the project; contribute the verified YAML as a PR. Explicit-only local selection was considered and rejected in conversation in favour of familiar local-first resolution. A separate Git repository for each project's drafts would require committing every experiment and was rejected as unnecessary. Local files are ordinary tracked project files.

`init` creates `.loadouts/` and ignores only `.loadouts/codex-home/`. Existing generated `.loadouts/` ignore lines are narrowed without removing unrelated rules. `create <name> [--from <shared-name>]` writes a schema-linked minimal definition or a copy of a shared definition, never overwriting a file. It does not install anything. Names must be safe file basenames.

`list` merges local and shared names, labels their origin in human output, and retains the JSON name-array interface. `show` prefers the local working file and includes source metadata. An explicit `--catalog` on list/show inspects that catalog directly. Source metadata also appears in status. Shared catalog references remain pinned.

## Applying and locking

`add` prefers a local file, including when a shared definition of the same name is already applied. Invalid local YAML fails rather than falling back remotely. Existing group selections are retained and validated; incompatible choices must be corrected explicitly. Local-only add needs no shared catalog access. Mixed local/shared selections work in one project.

The implementation decision is a version-2 lock with optional `local: Record<string, string>` containing exact applied YAML snapshots keyed by selected loadout name. Entries absent from that map use the existing shared `catalog` reference. Version-1 locks remain readable and upgrade when written; older CLI versions reject version 2 rather than silently misinterpreting a local selection. Snapshots let unrelated operations, doctor and launch use the applied definition while its working file is being edited. Removal still works if the local file is gone. Reapplying a missing selected local definition errors instead of falling back. `remove` followed by `add` explicitly returns to the shared definition.

Builder-check resolution: `incomplete?: boolean` marks reconciliation from the start of mutation until all writes succeed. A failed reconciliation can retain the requested snapshot for recovery, but it is not verified as applied while this flag exists. Doctor explains incomplete reconciliation and publication refuses it, including non-skill write/removal failures. This closes the gap that skill-only pending keys cannot represent.

Remote update skips local definitions, preserves their snapshots and choices, and never rewrites local files. A local-only update reports no shared selections rather than contacting the network. A changed local MCP definition must pass the same preflight as a changed shared definition. Failed preflight leaves the prior lock and installed state unchanged; existing partial-install recovery continues to apply.

## Doctor

Doctor reports `local` findings for local/shared name collisions, edited applied drafts, missing applied drafts, and invalid local definitions. Collision messages identify both sources and state that local wins on the next apply; messages distinguish the applied source. Doctor reads but does not apply drafts. Findings follow the existing doctor exit-code convention (1 with findings), and JSON retains `{findings}`. An unselected draft need not be installed to be inspected. Collisions compare against the pinned shared catalog, or the configured catalog when available; inability to inspect it is reported without hiding local findings.

## Contributing a definition

`publish <name> --summary <text> [--catalog owner/repo] [--yes]` validates the local YAML and requires its exact contents to have been applied, with no pending installs for its active artifacts. The summary supplies the user's real-project verification notes; the CLI does not claim to certify every optional alternative. The target is the explicit catalog, the locked shared repository, or the configured default, and must be a GitHub owner/repo.

Without `--yes`, print the destination, exact YAML and PR title/body; perform no GitHub calls or Git writes. With `--yes`, use installed Git and gh: clone the target into a temporary directory, branch from its default branch, copy only the selected definition to `loadouts/<name>.yml`, and commit it. Push a topic branch to the upstream when the user can write; otherwise create/use the user's fork. Open a PR with the verification notes and print its URL. Never copy other project files, merge the PR, tag, release, or change the project's selections. A no-diff contribution errors before pushing. If PR creation fails after pushing, report the head branch and a concrete recovery command. Clean up the temporary clone.

Actual repository creation, pushes and PR submission by this agent still require the user's separate approval. Tests exercise publication with a fake gh and local bare Git repositories; no real GitHub write is performed during this implementation.

## Constraints and validation

Stay on the requested feat/cli branch. Bun 1.3.14, Bun YAML/TOML, node:util parseArgs; no dependencies added. English throughout. Tests use temporary homes and fixture skills/catalogs. Run the full suite before every commit. Test the whole local authoring/apply/doctor/contribution lifecycle, legacy-lock compatibility, missing files, invalid YAML, name traversal, ignore migration, partial installs, MCP preflight and PR failure recovery. Add one Changeset for this feature. Live GitHub publication remains separately approved.
