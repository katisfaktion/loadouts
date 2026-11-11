---
"loadouts": patch
---

New projects and v2 skills lockfiles use `skills@1.8.0`. Existing v1 locks use `skills@1.7.6` to preserve their hashes.

- GitHub skill sources now accept mixed-case repository names.
- An empty hash in a migrated lock affects only that skill. Restore its verified contents or accept a new hash with `loadouts update`.
