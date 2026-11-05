# Package companions in loadout items

Approved behavior: `packageSkills: {include: ["@acme/ui"], exclude:
["@acme/ui#experimental"]}` belongs to a loadout item, including alternatives.
It follows normal harness overrides. Include/exclude selectors name an exact npm
package or package#skill; no version, path or wildcard syntax. Exclusions affect
that item's requests; another selected item may still request the same skill.
The manifest continues selecting loadouts and choices, with no new top-level key.

Install synchronizes selected companions from installed packages, accepting their
current versions and contents without requiring update. It never installs or
upgrades libraries or fetches package-declared Git skills. Missing packages are
reported but do not prevent conventions or the rest of the setup from applying.
Package disappearance removes previously owned companions. Repeated installation
is idempotent. Git skills retain their separate frozen restoration behavior.

Use `skills experimental_sync --copy --no-remote --no-cleanup
--no-frozen-lockfile -a codex -y --include <package>` in an isolated staging
directory with the selected installed package reachable through node_modules.
Staging protects the project's unrelated native lock entries and skills. Verify
the staged native lock and payload before copying. Loadouts reconciles only its
recorded ownership, refuses collisions, and repairs relative Claude links.
Standard packaged SKILL.md layouts, including Intent-published skills in that
layout, use this same path. Intent's CLI permissions, hooks and on-demand loading
are not installed or changed; packageSkills is an explicit independent selection.
The supported package lookup is node_modules, including pnpm/workspace symlinks;
Yarn PnP without node_modules is not supported by this upstream sync path.

Lock version 4 adds `packageSkills`, mapping exact package names to
`{version: string | null, skills: string[], requiredBy: string[]}`. Version null
means not installed. Versions 1–3 remain readable and projects without package
companions keep their existing lock format. Native package hashes/paths remain
in skills-lock.json. Ownership keys are `package-skill:<harness>:<package>#<skill>`
with `[skill]` as their value. Routing resolves an item's applied companions;
empty selections produce no empty table row. No absolute paths are committed.

Status/doctor show package resolutions, missing packages and changed versions or
missing managed files. A newly available or changed package requests install;
a still-absent package is a warning, not a launch blocker. Failed writes retain
incomplete state and successful ownership for retry/removal.

No runtime dependencies, real HOME writes, network tests, global installation,
pushes or publication. Native installer processes are replaced by the fixture.
