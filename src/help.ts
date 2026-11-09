import { COMMANDS } from "./cli";
import { CliError } from "./errors";
import { commandParsers } from "./commands";
import { colorsEnabled, paint, type Tone } from "./output";
import { getDocPageSync } from "@optique/core/parser";
import { formatDocPage } from "@optique/core/doc";
import { option } from "@optique/core/primitives";
import { message } from "@optique/core/message";
import type { TerminalTheme } from "@optique/core/terminal";
import { version } from "../package.json";

const theme: TerminalTheme = {
  optionName: (_term, {text}) => ({type: "style", style: {foreground: "cyan"}, children: [{type: "text", text}]}),
  metavar: (_term, {text}) => ({type: "style", style: {dim: true}, children: [{type: "text", text}]}),
  programName: (_term, {text}) => ({type: "text", text}),
  label: (_term, {text}) => ({type: "text", text}),
};
const helpOption = option("-h", "--help", {description: message`Show usage, flags and examples.`});
const helpEntry = getDocPageSync(helpOption)!.sections.flatMap(section => section.entries)[0]!;

export function helpText(command?: string): string {
  if (command) {
    if (!Object.hasOwn(COMMANDS, command)) throw new CliError(`unknown command "${command}"`, 2);
    const c = COMMANDS[command]!;
    const page = getDocPageSync(commandParsers[command as keyof typeof commandParsers], command === "global" ? ["prune"] : [])!;
    const entries = page.sections.flatMap(section => section.entries);
    const forwarded = command === "claude" || command === "codex";
    const flags = entries.filter(entry => entry.term.type === "option");
    const arguments_ = entries.filter(entry => entry.term.type !== "option");
    if (!forwarded) flags.push(helpEntry);
    const text = formatDocPage(`loadouts ${command}`, {
      ...page,
      usage: [...page.usage ?? [], ...forwarded ? [] : [{type: "optional" as const, terms: [helpEntry.term]}]],
      sections: [...arguments_.length ? [{title: "Arguments", entries: arguments_}] : [], ...flags.length ? [{title: "Flags", entries: flags}] : []],
    }, {colors: colorsEnabled(), theme, termWidth: "auto", showChoices: true, maxWidth: process.stdout.columns || 100});
    return `${c.summary}\n\n${text}\nExamples:\n${c.examples.map(example => "  " + paint(example, "dim")).join("\n")}${command === "claude" || command === "codex" ? "\n\nThe read-only preflight checks the manifest, lock and installed artifacts, then forwards arguments and environment unchanged. Run loadouts install to repair missing setup. Ordinary launches and Codex Desktop use the same native project files without this check. Personal configuration still loads; Codex project configuration and hooks require native trust. Neither launcher installs, writes configuration, or changes CODEX_HOME." : ""}${command === "install" ? `\n\nCommit loadouts.json, loadouts.lock.json, skills-lock.json and .loadouts/catalog/*.yml. Commit .codex/config.toml, .codex/agents/ and .codex/hooks.json. Keep .loadouts/codex-home/ ignored as preserved session history; new sessions use the normal Codex home.\nExample loadouts.json:\n${JSON.stringify({harnesses: ["claude-code", "codex"], loadouts: {base: {source: "github:katisfaktion/agent-loadouts/base"}, backend: {source: "file:./.loadouts/catalog/backend.yml", choices: {runtime: ["bun"]}}}}, null, 2)}\n\nFile sources must use file:./.loadouts/catalog/<name>.yml, with a matching YAML name.\nGitHub sources use github:owner/repo/<name>[@ref]; refs may be tags, branches or commits.\nFor existing local Git catalogs only: file:/absolute/catalog#<name>[@ref] (machine-specific; paths cannot contain @ or #).\nInstall keeps existing Git resolutions, applies selected local YAML edits and restores missing components.\nMissing locked Git skills use npx skills experimental_install --frozen-lockfile; mismatches fail without accepting newer contents. Existing skill folders are not rehashed. Harness links are repaired locally.\nPackage companions: add packageSkills: {include: ["@acme/ui"], exclude: ["@acme/ui#experimental"]} to a loadout item. Use package#skill to select one; no versions, paths or wildcards. Alternatives and harness overrides are supported; exclusions apply per item.\nInstall project dependencies first. loadouts install syncs selected companions from their installed versions, including dependency upgrades, using staged skills experimental_sync --copy --no-remote. It never installs application libraries. Missing packages retain conventions and produce diagnostics; a missing explicitly named skill is an error.\nSupported package layouts: SKILL.md, skills/<name>/SKILL.md, dist/skills/<name>/SKILL.md. pnpm/workspace package links work; Yarn PnP without node_modules does not. Standard Intent package skills work independently of Intent permissions and hooks. No package remote redirects are fetched.\nPackage selections stay in YAML; loadouts.lock.json records package versions, skill names and requiring items, and skills-lock.json records hashes. Commit the application package lock too. Git skills retain frozen restoration.\nInstaller integrations: declare installer: codebase-memory on an item (or harness override), with other components in separate items. This requires codebase-memory-mcp on PATH and reuses your existing global installation without upgrading or reconfiguring it.\nThe native CLI generates project skills, agent profiles and hooks in a temporary HOME. Install imports them, declares the MCP server, and indexes this project once in the shared service. Reinstall repairs missing assets and retries failed indexing; removal retains the global service and index. No arbitrary installer commands are accepted.\nKeep .loadouts/installers/, generated Claude assets and .claude/settings.local.json ignored. The lock records observed installer versions, not a globally enforced version. Modified assets are preserved with an error. Native Codex installer skills go in .agents/skills/, profiles in .codex/agents/, hooks in .codex/hooks.json and guidance in the root managed AGENTS.md section. Review Codex hooks with /hooks; installation does not grant trust.\nCLI indexing does not register a watcher. MCP sessions handle watching under CBM settings; codebase-memory-mcp daemon start --open keeps the dashboard available.\nUse loadouts update to refresh shared resolutions within declared refs and accept new selected skill contents/hashes.\nIf historical contents are unavailable, recover complete verified skill folders from a trusted checkout or backup, or explicitly update and review the changed skills-lock.json. Keep verified folders in Git or durable artifacts when future availability matters.\nDownloaded .agents/skills/ and .claude/skills/ may be ignored; retain project-authored skills. Plugin versions remain best effort.\nLock format 1 records active choices, include edges, pinned sources and artifact ownership. Development lock formats are not supported. Keep loadouts.json alongside its lock. Conflicting unmanaged native entries stop installation. Plugin contents use the normal shared Codex cache (CODEX_HOME when explicitly set); source updates can affect other projects using the same cached identity. Personal enablement and trust are never changed.\nEditor schemas: schemas/v1/manifest.schema.json and schemas/v1/loadout.schema.json in the matching published CLI release.` : ""}\n\nExit codes: 0 success; 1 check failed; 2 usage error; 3 environment missing.`;
  }
  const groups: [Tone, string[]][] = [
    ["magenta", ["claude", "codex"]],
    ["blue", ["install", "add", "remove", "update", "switch", "enable", "disable", "harness"]],
    ["yellow", ["list", "show", "status", "doctor", "inspect"]],
    ["cyan", ["init", "setup", "explore", "create", "validate", "publish", "global", "help"]],
  ];
  const rows = groups.map(([tone, names]) => names.map(name => {
    const c = COMMANDS[name]!;
    return `  ${paint(name.padEnd(10), tone)}${paint((c.hint ?? "").padEnd(25), "dim")}${c.brief}`;
  }).join("\n")).join("\n\n");
  return `${paint("loadouts", "magenta")} manages project agent setups. ${paint(`(${version})`, "dim")}\n\nUsage: loadouts <command> ${paint("[...flags]", "cyan")} [...args]\n\nCommands:\n${rows}\n\nFlags:\n  ${paint("-h, --help", "cyan")}                         Show usage, flags and examples.\n\n${paint("<command>", "dim")} ${paint("--help", "cyan")} for command details. Use loadouts help claude|codex for launcher help.\n\nFor agents:\n  Start with loadouts explore for the proposal workflow.\n  Inspect existing setup with loadouts inspect --json.\n  Read loadouts help <command> before acting; use --json where available.\n  Create and validate drafts through the CLI; apply approved selections with add/switch/enable/disable/remove.\n  Use publish to preview a contribution; --yes opens a PR after approval.\n\nTypical flow:\n  loadouts setup --catalog katisfaktion/agent-loadouts --harness claude-code,codex\n  loadouts init\n  loadouts add base frontend backend\n  loadouts status\n  loadouts doctor\n\nAfter cloning a configured project:\n  loadouts install`;
}
