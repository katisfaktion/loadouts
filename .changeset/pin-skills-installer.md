---
"loadouts": patch
---

The CLI chooses the skills installer from the project's `skills-lock.json` format.

- New projects and version 2 locks use `skills@1.8.0`. Version 1 locks use `skills@1.7.6` for installs and updates to preserve their frozen hashes.
- GitHub skill sources accept mixed-case repository names.
- If a migrated entry has an empty hash, other entries still work. To restore the affected skill, recover its verified contents or run `loadouts update` to accept a new hash.
