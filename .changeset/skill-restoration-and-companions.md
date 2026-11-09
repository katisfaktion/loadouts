---
"loadouts": minor
---

Restore missing Git skills through the native frozen `skills-lock.json`, verify locked hashes and repair harness links. Commit both skill and loadout locks; explicitly update to accept new selected skill contents. Reproducibility remains best effort when upstream historical content or plugin versions are unavailable.

Select `packageSkills` from installed project dependencies, including workspace and pnpm links. `install` synchronizes companions after dependency upgrades without installing application libraries, follows package-level selections and exclusions, and records observed versions and ownership. Handle Git-to-package skill migration and repeated installs without manual cleanup.

Run skills and npx MCP commands with npm isolation compatible with pnpm-only projects. Generated MCP configuration uses a portable project-relative prefix.
