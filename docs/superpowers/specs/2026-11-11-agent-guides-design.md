# Bundled agent workflow guides

A coding agent starting in any directory can run `loadouts agents` to choose a workflow and read only the instructions it needs. Ship the Markdown in the binary so the guidance matches the installed CLI and works offline.

## Approaches

Adding another top-level command for each guide makes workflows harder to find alongside the commands that change the project. A single combined document makes an agent read unrelated instructions. Group the guides under `agents` with a short index and one topic per workflow.

## Commands

- `loadouts agents` lists the exploration and publication guides with a one-line purpose for each.
- `loadouts agents explore` prints the existing exploration workflow up to its handoff to publication. Keep `loadouts explore` as an alias.
- `loadouts agents publish` prints the comparison, verification, preview and approval workflow. The existing `loadouts publish NAME` command performs the preview or opens the PR.
- Unknown topics and extra arguments produce a usage error. Reading guides requires no project, external programs or setup.
- Link the index from root help and the help hint written by setup. Preserve user notes and make repeated setup idempotent.
