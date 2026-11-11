---
name: loadouts-diagnose
description: Use when a project agent lacks an expected tool, loadouts install fails, or project and personal agent settings appear to conflict.
---

# Diagnose a project's agent setup

1. Use `loadouts inspect --json` to see which project and user files declare the tool. This works before initialization. Preserve any warnings about unreadable metadata.
2. In an initialized project, use `loadouts status --json` to compare the requested source, harness and choices with the applied state. Check whether the item is active, including its parent choice or include.
3. Run `loadouts doctor --json`. Exit 1 can carry useful findings. Read each finding and its suggested fix. Doctor checks MCP reachability, so it may start a declared server or contact its URL.

Choose the remedy that matches the evidence:

| Finding | Next action |
| --- | --- |
| Missing managed files, pending changes or an interrupted install | Fix the reported cause and run `loadouts install` to reconcile the project. Preserve the locks and any user-edited files. |
| Missing package companion | Install the project's application dependencies, then rerun `loadouts install`. Confirm the installed package ships the selected skill. |
| A frozen Git skill hash is missing or its contents have changed upstream | Recover the matching lock and full skill folder from a trusted copy. Use `loadouts update` only if the user wants to accept current contents. |
| Same name in a project and a catalog | Identify the selected source with `status`. A collision alone needs no change. For an intentional replacement, follow `loadouts agents apply`. |
| Tool appears in both personal and project settings | Identify the owning scope before changing it. If the user wants global cleanup, `loadouts global prune` previews its effect across projects. Review it together before using `--yes`. |
| Configured plugin or hook has no effect | Check the selected harness and its native project or hook trust. A declaration alone does not verify hook execution. |

After a repair, repeat the check that exposed the problem. Report what now works and any findings still open. Keep a request for diagnosis read-only unless the user also asked for the repair.
