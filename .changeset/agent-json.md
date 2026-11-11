---
"loadouts": minor
---

Use JSON output to discover loadouts and apply changes without a prompt.

- Run `loadouts list --sources --json` to see each local and shared source. Pass a source to `loadouts show <source> --json` to inspect it. `loadouts list --json` still returns names.
- Pass `--json` to `install`, `add`, or another project selection command to get one structured result.
- If `add --json` would replace a source, it reports the old and new sources on stderr. Review them and rerun with `--yes` to approve. Interactive `add` still prompts before replacing a source.
