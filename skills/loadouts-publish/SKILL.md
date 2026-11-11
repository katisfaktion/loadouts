---
name: loadouts-publish
description: Use when preparing a catalog pull request for a project-local loadout verified on real work.
---

# Publish a verified loadout

Identify the applied local YAML, the target catalog, the active choices and the real task used to verify them. Ask for any missing verification evidence.

## Compare the draft with the catalog

Inspect `loadouts/<name>.yml` on the target catalog's current default branch in a temporary checkout. The local draft's name determines the destination filename.

- For a new entry, check whether another loadout already covers the task. If it does, skip the PR. Otherwise explain what the new entry adds.
- For an adaptation, compare the draft with both its recorded base revision and the current upstream file. If the base is unknown, say which revisions you compared. Describe changes to capabilities and choices separately from formatting edits.

Publishing copies the whole YAML file. If upstream has changes the draft would overwrite, ask before editing the draft. Run `loadouts validate <file>`, install the revision and verify it on the task again.

## Check includes

Keep the include declarations. Publish local dependencies first, replace their local sources with available `github:` sources, then install and verify the composition.

Preview checks every include in the chosen YAML and in each active dependency, including declarations under unselected choices. It reads pinned definitions from the local Git cache and stops if an object is missing. When reporting results, distinguish the choices you tested from the others: inactive targets were checked for source portability only.

## Preview and open the PR

Run `loadouts publish <name> --catalog owner/repo --summary '<what you verified>'` for each independently useful loadout. Show the proposed YAML, PR description and your comparison with upstream. The offline preview supplies the YAML and description. Use the Git comparison for the diff.

After explicit publication approval, repeat the command with `--yes` and report the PR URL. Leave merging, releasing and switching the project's selected source to the user.
