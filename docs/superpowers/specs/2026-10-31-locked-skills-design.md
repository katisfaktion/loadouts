# Locked skill restoration

Ordinary installation must restore missing selected skills from the committed
`skills-lock.json` using `npx skills experimental_install --frozen-lockfile`.
This verifies downloaded contents; it does not audit already installed folders.
The loadouts lock remains the record of selection and ownership. No lock format
or loadout syntax changes are needed.

Restore only selected missing skills in a temporary directory with a filtered
native lock, then copy successful results and recreate Claude's relative links.
Codex reads the canonical `.agents/skills` directory. Missing links alone need
no download. Do not overwrite a conflicting real Claude skill directory.
Reject invalid lock data and unsafe names before using filesystem paths.

New selections use `skills add`; stage its output too, so overlapping names and
partial retries cannot silently change an existing hash or replace another
source. Preserve successful partial ownership and unrelated native lock entries.
Missing lock entries for previously owned missing skills require recovery or an
explicit update. Legacy installations whose files remain present still work.

`loadouts update` explicitly refreshes selected skill contents and native lock
hashes, as well as shared catalog definitions. Update each source once across
harnesses. It preserves local YAML snapshots and does not refresh unmanaged
skills. Ordinary install never falls back from frozen restore to latest add.

Commit all three files: `loadouts.json`, `loadouts.lock.json`, `skills-lock.json`.
Downloaded skill folders and links may be ignored. To survive unavailable
historical sources, retain full verified skill folders in Git or trusted build
artifacts/backups. Recovery may use those copies; accepting newer content needs
an explicit update and review. No new cache, archive command or revision syntax.

All tests are offline, use temporary HOME and fake skills. No runtime dependency,
real user configuration changes, publication or global binary installation.
