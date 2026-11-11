---
"loadouts": minor
---

Install and change project loadouts with `--json`.

- `loadouts list --sources --json` lists local and shared sources. Inspect one with `loadouts show <source> --json`.
- When `add --json` would replace a source, it reports both sources on stderr. Rerun with `--yes` to approve.
