---
"loadouts": minor
---

Declare reusable agent setups in loadout YAML and select them in a project `loadouts.json` manifest. Combine explicit GitHub catalog sources with committed local drafts under `.loadouts/catalog/`, choose alternatives with `switch`, `enable` and `disable`, and retain applied source resolutions and ownership in `loadouts.lock.json`.

Use `install` to restore the declared setup and apply local edits, and `update` to refresh shared sources within their declared refs. Same-name source replacements show the old and new source and require confirmation; unrelated settings and modified owned files are protected. `status` and `doctor` explain missing components, pending changes, collisions and recoverable installation failures.
