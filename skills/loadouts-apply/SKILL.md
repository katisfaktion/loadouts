---
name: loadouts-apply
description: Use when restoring a checkout, applying a proposed loadout, adjusting choices for a feature, or refreshing selected tools.
---

# Apply a project's loadouts

Start with the user's task. Run `loadouts inspect --json` if you don't know whether the project is initialized. For an existing setup, `loadouts status --json` shows the direct selections, included loadouts, sources and active choices.

## Restore a checkout or apply local edits

When the repository has `loadouts.json`, install its application dependencies first if it selects package companion skills. Run `loadouts install --json` to apply selected local YAML, reuse locked catalog commits and restore missing components. Use the same command after upgrading a library that ships companion skills.

Use `loadouts update --json` when the user wants to refresh shared definitions or accept new skill contents. Review the lockfile diff afterward. If a frozen restore fails, read `loadouts agents diagnose` before deciding what to change.

## Select tools for a task

If the user asks which tools fit a feature, compare the task with the project's existing selections and choices. Propose the smallest change. Read `loadouts agents explore` when you need to discover a new capability. A request for recommendations ends with the proposal.

For an approved selection, read `loadouts help add`. In a new project, run `loadouts init --harness` with the selected agents. Machine-wide defaults and instruction imports belong to `loadouts global configure`; a project selection alone needs no global setup.

- Read candidates with `loadouts list --sources --json`. Pass the chosen source to `loadouts show <source> --json` to inspect it and `loadouts add <source> --json` to apply it. If stderr contains `error.code = confirmation_required`, show the old and new sources from `error.replacements`. Rerun the same command with `--yes` after the user approves those replacements.
- Use `switch` for a single alternative, `enable` or `disable` for optional members, and `remove` to drop a direct selection. Each command applies its change immediately. For example, after `loadouts enable testing/languages python`, use `loadouts switch testing/languages/python/framework unittest` if that is the chosen framework.
- To set choices together when adding a loadout, use `add --with` for each group path. Switching a parent removes explicit descendant requests for its deselected members. For an included-only child, edit its parent's include choices or select the same child source directly. Explicit requests must agree across active parents.

## Verify the result

Check `loadouts status --json` and review the changes to the manifest, locks, selected local definitions and generated agent configuration. Include those files when committing the setup. A repeat `loadouts install --json` on an intact setup returns empty `added`, `removed` and `files` arrays. Check any optional `notes` for unavailable companions or installer messages.

Installation verifies the declared setup. To evaluate whether it helps on real work, use it on the user's chosen task and record which harness, choices and behavior you observed. When asked to share a verified local definition, read `loadouts agents publish`.
