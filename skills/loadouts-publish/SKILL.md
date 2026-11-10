---
name: loadouts-publish
description: Use when preparing a catalog pull request for a project-local loadout verified on real work.
---

# Publish a verified loadout

Identify the applied local YAML, its target catalog and what the user verified on a real task. Record the active choices. Ask for missing verification evidence before proposing a contribution.

Read `loadouts help publish`. In a temporary checkout of the target catalog's current default branch, inspect `loadouts/<name>.yml`.

- For a new entry, check for an existing loadout that already covers the concern. Explain where the new entry fits.
- For an adaptation, compare the local YAML with both its recorded base revision and the current upstream file using Git. If the base revision is unknown, state which revisions you could compare. Summarize capability and choice changes separately from formatting edits.

The publish command copies the whole YAML file to its destination. Preserve intervening upstream changes. If the draft needs reconciliation, get approval for the edits, run `loadouts validate` on the file, install and verify the revised behavior. Skip a PR when the upstream entry already does the job. Renaming a draft changes the catalog filename the PR will propose.

Publish local dependencies first. Check every include declaration in the YAML being published, including inactive branches, and every declaration in pinned definitions inspected for the active closure for portable GitHub sources: replace local file or machine-specific Git sources with available shared sources, then install and verify the composition before contributing it. Keep includes intact; do not inline dependencies or silently rewrite sources. Preview uses applied graph records and pinned descendant definitions in the existing local Git cache; it refuses missing cache objects without fetching or cloning and makes no GitHub calls.

The preview and PR identify verified active choices: inactive targets were checked for source portability only. Do not fetch inactive targets during preview or claim they were installed or tested.

For each independently useful loadout, run `loadouts publish <name> --catalog owner/repo --summary '<what was verified and why this change is reusable>'` to preview the contribution. The preview shows the proposed YAML and metadata, not an upstream diff. After explicit publication approval, run it with `--yes` to open the PR. Keep each PR focused on that loadout and report its URL. Do not merge, release, or switch the project's source automatically. The user can choose the published shared source later through `add`.
