# Codex plugins

The user approved native Codex plugin support, using Ponytail as the acceptance case, and will test the real plugin afterwards. Exploration stays a draft-only workflow.

## Behavior and approach

Allow `codex: {plugin: ponytail@ponytail, marketplace: DietrichGebert/ponytail}`. Keep plugin declarations harness-specific; common plugin declarations remain invalid. Codex marketplace is required so a loadout is portable to an empty project home. Claude behavior and existing lock keys stay unchanged.

Use the native `codex plugin marketplace add/remove` and `codex plugin add/remove` commands with `--json`, cwd set to the project, and CODEX_HOME set to `.loadouts/codex-home`. Native installation preserves bundled skills and hooks. Reimplementing hook installation would duplicate Codex behavior; skill-only installation loses hooks. The user chose native plugins. Do not trust hooks or bypass their trust review. Show the `/hooks` next step after installation and in help.

New artifact keys are `codex-plugin:<plugin>@<marketplace>` and `codex-marketplace:<marketplace>:<owner>/<repo>`. Keep lock version 2 and string-array installed values. Extend pending artifacts to these keys for retry/cancellation after partial failure. Reject conflicting marketplace sources and collisions with unmanaged entries before installation. Remove plugins before their marketplaces, add marketplaces before plugins, preserve shared resources, and reinstall retained plugin IDs when their marketplace source changes. Repeated application is a no-op.

Preserve native plugin and marketplace configuration, including nested policy settings, when writing the generated Codex home on apply or launch. Invalid TOML must fail without overwriting it. Doctor recognizes Codex plugin declarations in both global and isolated project config, reports global leftovers and missing/disabled selected plugins, and checks non-selected plugin conflicts without confusing Claude and Codex. Inspection derives GitHub marketplace provenance when available.

Exploration should choose a supported native plugin when bundled hooks or MCP capabilities matter, disclose skills-only losses, avoid duplicate installs of bundled skills, and write validated proposals. Update the schema, help, README and minor changeset together.

## Constraints and verification

Bun 1.3.14, Bun.YAML/Bun.TOML, node:util parseArgs; no new dependencies. All text is English. Tests use temporary homes, local catalogs and fake CLI executables; no network or real npx skills. No real project/home changes or publication. Full bun test before every commit. Work stays on feat/cli.

Verified locally with Codex 0.162.1 in `/tmp/loadouts-codex-plugins-wz4_v6p2`: marketplace add returns marketplaceName/installedRoot/alreadyAdded; plugin add returns pluginId/name/marketplaceName/version/installedPath/authPolicy; repeated add/remove succeeds. Native config uses [marketplaces.NAME] source_type/source and [plugins."NAME@MARKETPLACE"] enabled. Runtime acceptance uses offline fixtures; the user will verify Ponytail hooks live. Installed plugin versions remain managed by Codex, as Claude versions are managed by Claude.

Sources: https://developers.openai.com/plugins/build/plugins and the installed Codex command help. Hook trust remains a user action in Codex `/hooks`.
