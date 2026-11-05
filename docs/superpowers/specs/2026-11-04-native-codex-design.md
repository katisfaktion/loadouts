# Native Codex project integration

Status: native discovery and consistent launchers approved; implementation details are in the accompanying plan.

## Intent and selected approach

After `loadouts install`, opening a trusted project in Codex Desktop or running ordinary `codex` must discover the selected setup without a launcher-specific `CODEX_HOME`. The user selected natural project integration over the existing isolated-home approach because the Desktop App does not inherit the launcher's environment.

Approaches considered:

- Keep `.loadouts/codex-home`: preserves isolation but fails the Desktop requirement.
- Rename the isolated home to `.codex`: still requires setting `CODEX_HOME` and mixes runtime state with project configuration.
- Use native project configuration and Codex's normal home: selected direction. Project settings coexist with personal settings; the CLI manages the project's declarations, not the user's whole Codex environment.

This changes the default. Do not add an isolation mode, new source types, runtime dependencies, or a second user-facing workflow.

## Project files and runtime state

| Purpose | Destination |
| --- | --- |
| MCP, marketplace, and plugin declarations | `.codex/config.toml` |
| Installer-generated Codex agent profiles | `.codex/agents/` |
| Installer-generated Codex hook definitions | `.codex/hooks.json` |
| Standalone skills, including package companions and the Codex installer skill | `.agents/skills/` |
| Project instructions and installer skill guidance | Existing managed section in root `AGENTS.md` |
| Loadout sources, installer receipts, and recovery data | Existing `.loadouts/` locations |
| Authentication, plugin caches, sessions, logs, and hook approvals | Normal Codex home; never copied into the project |

Native project settings and profiles are eligible for version control; caches and receipts remain ignored. Preserve an existing `.codex` directory and unrelated configuration. Do not blanket-ignore it. Preserve existing loadout syntax, manifest syntax, artifact identifiers, and package skill behavior. Existing machine-specific source values are not made portable by this change; generated files must not introduce an absolute user-home path.

Both `loadouts claude` and `loadouts codex` check that the manifest matches the applied lock and required artifacts exist, then launch the corresponding agent normally. Neither writes configuration or installs components during launch. Claude stops injecting `--setting-sources`, `--strict-mcp-config`, and `--mcp-config`. Codex stops replacing `CODEX_HOME`, creating authentication symlinks, and requiring file-based `auth.json`; Codex handles normal authentication, including other credential storage modes. Explicit arguments and environment remain the user's choice, and child exit status is preserved.

Ordinary launches and Desktop discover the same installed project files without these loadouts preflight checks. Both harnesses inherit personal configuration according to their native rules; loadouts does not promise identical precedence or capabilities across harnesses.

## Reconciliation and plugins

Merge only owned MCP, marketplace, and plugin entries into project configuration. Preserve unrelated settings such as model preferences and nested policies. Check destination conflicts before mutation. Use native-editable TOML tables, retaining the marketplace migration fix.

Keep upstream marketplace names and plugin identities. Do not synthesize a combined marketplace or repackage plugins. Project configuration declares sources and enabled plugins. Native marketplace refresh prepares marketplace snapshots, but plugin listing alone does not install plugin contents. Install missing plugins through native commands in a disposable staging home, then import only the validated plugin cache directory into the normal Codex cache. Native add/remove commands must never write enablement into the real user config. Do not copy staging configuration, credentials, trust state, or arbitrary returned paths into the user home.

Refresh only sources needed for installation or explicit update. Repeated install must leave an intact setup unchanged. Removing a project selection removes its owned project declaration; it does not uninstall a shared cached plugin or rewrite personal defaults. If that exposes an inherited personal selection, diagnostics explain it.

The installer adapter still generates assets in a temporary HOME, imports supported project assets, and uses the existing global codebase-memory service. It must migrate receipt paths, preserve edited assets, keep retries/removal safe, and retain the existing index receipt so a layout migration alone does not reindex the project. Hooks still require native review; installation does not grant trust.

## Migration from the isolated home

The next install recognizes an existing loadouts lock with the old layout and prepares native project files. It verifies all destination conflicts before replacing managed configuration or installer assets. Exact matching entries can be reused; unrelated conflicting entries remain protected.

Carry forward applicable plugin policies and installer definitions. Do not export authentication links, local trust grants, cache paths, or session state into shared project files. Preserve the entire old `.loadouts/codex-home` and its ignore rule as recovery/history storage. Stop using it for new launches, inspection of the active setup, and missing-artifact checks. Report that old sessions remain there rather than silently deleting or pretending to migrate them.

Record partial application through the existing lock and installer recovery mechanisms. A second successful install must change no managed files. Removal must work after an interrupted migration. The implementation plan proposes lock version 6 to distinguish ownership of native project entries from old isolated-home entries. This avoids treating an existing personal project entry as loadouts-owned merely because an older lock owns the same name in another directory; older locks remain readable. YAML, manifest, and artifact identifiers stay unchanged.

## Diagnostics and inherited configuration

`status`, `doctor`, `inspect`, launch checks, help, and README must follow native project locations. Stop requiring a generated-home authentication symlink. Explain that a project must be trusted before Codex loads its project configuration and hooks.

Personal/global skills, plugins, MCP servers, and hooks can remain active. Treat this as native inheritance, not a failed isolated installation. Report conflicting or duplicate integrations with their scopes; respect explicit project overrides where applicable. Do not automatically prune user configuration or disable global hooks. In particular, codebase-memory may already exist globally, and hooks from multiple active layers can run alongside each other.

## Verification and acceptance

- Regression tests use temporary homes, fixture catalogs, fake installers, and no network. Cover fresh installation, preserved personal/project settings, legacy migration, collisions, incomplete migration retry/removal, harness removal, and unchanged repeat installation.
- Verify ordinary Codex discovery with a separate temporary user home, local Git marketplace fixtures, and native MCP/plugin commands. Do not point `CODEX_HOME` at a project directory during this check.
- Verify codebase-memory skill/profile/hook placement and retained index receipts. Do not claim hook execution based only on file presence.
- Run the full `bun test` suite and build before committing implementation.
- Desktop acceptance must open the project normally and confirm effective components in a fresh session. CLI discovery alone is supporting evidence, not proof of Desktop behavior.
- Applying the change to acm-website must preserve its existing uncommitted work. Any commands that modify the user's real Codex home still require the approval specified in the original work order.

## Evidence and implementation checks

Official documentation describes project config, project agent profiles, project hooks, and project plugin enablement:

- https://learn.chatgpt.com/docs/config-file/config-basic
- https://learn.chatgpt.com/docs/agent-configuration/subagents
- https://learn.chatgpt.com/docs/hooks
- https://developers.openai.com/plugins/build/plugins

An offline experiment on the installed Codex CLI used a temporary user home and trusted project. `codex mcp list --json` discovered an MCP declaration in `.codex/config.toml`. A declared Git marketplace initially lacked its cached snapshot; `codex plugin marketplace upgrade team --json` populated the snapshot through a local Git URL rewrite. Evidence: `/tmp/loadouts-native-discovery-yp_oa099/`. Its plugin listing was insufficient evidence of fresh plugin installation.

A separate fresh-home experiment confirmed that marketplace refresh plus plugin listing does not populate plugin contents, even for a trusted project. Native installation in a disposable staging home followed by importing its returned `plugins/cache/team/review/1.0.0` directory made native listing report the plugin as installed. The destination user home had no config or trust entries. Command-line marketplace/plugin declarations also allowed discovery in an untrusted project without granting trust. Evidence: `/tmp/loadouts-native-untrusted-zjag_e8p/`.

Before finalizing implementation, verify targeted cache preparation for untrusted/new projects, preservation of user environment overrides, and the supported Desktop client's discovery behavior. These checks must not silently grant project or hook trust. If native support cannot satisfy the selected behavior, report the limitation instead of reintroducing a hidden launcher requirement.
