---
"loadouts": minor
---

Distribute the CLI on npm as `@katisfaktion/loadouts`, with exact-version optional packages containing native binaries for Linux (glibc) and macOS x64/arm64 and Windows x64. Installing with npm requires Node.js but not Bun, and does not run installation scripts or download binaries outside npm.

Extend the Changesets release workflow to publish the platform packages before the CLI and GitHub release, with provenance and support for npm trusted publishing. Release retries skip already-published versions and stop on registry errors. Document installation and maintainer authentication setup.
