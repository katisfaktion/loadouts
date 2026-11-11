---
"loadouts": patch
---

Use skills 1.8.0 for new projects and version-2 skills lockfiles. Projects with a version-1 skills lockfile automatically use skills 1.7.6 for installs and updates so their frozen content hashes remain valid.

GitHub skill sources accept mixed-case repository names. If skills migrated a lockfile with an empty hash, other entries remain usable. To restore the affected skill, recover its verified contents or run `loadouts update` to accept a new hash.
