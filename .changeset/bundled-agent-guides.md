---
"loadouts": minor
---

Find workflow guides, configure your agents and check their setup from the CLI.

- Use `loadouts agents explore` in place of `loadouts explore`. Run `loadouts agents` to find the offline guides for exploring, applying, diagnosing and publishing loadouts.
- Use `loadouts global configure` in place of `loadouts setup`. Rerun it to refresh the guide reference in each configured agent's `LOADOUTS.md`.
- Run `loadouts doctor` from any directory to check machine configuration, guide imports and workflow instructions.
- Root help groups commands by task: Guidance, Workflow, Diagnostics and Setup. Each group has its own color. The program name is orange and optional arguments are dimmed.
- Use `loadouts help <command>` for syntax, examples and what the command changes. Invalid help requests point to the relevant page.
