#!/usr/bin/env bun
import { prune } from "./prune";
import { launch } from "./launch";
import { doctor } from "./doctor";
import { projectCommand, update, install } from "./sync";
import { existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { readConfig, parseHarnesses, setup } from "./config";
import { readLock, requireProject } from "./lock";
import { findProject } from "./paths";
import { parseCommand, type ParsedCommand } from "./commands";
import { openCatalog, listLoadouts, readLoadout } from "./catalog";
import { CliError } from "./errors";
import { helpText } from "./help";
import { paint } from "./output";
import { createLocal, localNames, readLocal, ensureLocalCatalog } from "./local";
import { parseLoadout } from "./loadout";
import { readManifest, writeManifest, parseSource, readSourceFile } from "./manifest";
import { ensureGitignore } from "./codex";
import { publish } from "./publish";
import { inspectProject, inspectionRoot } from "./inspect";
import explorationSkill from "../skills/loadouts-explore/SKILL.md" with {type: "text"};
import publicationSkill from "../skills/loadouts-publish/SKILL.md" with {type: "text"};

const guideIndex = `# Agent workflow guides

- \`loadouts agents explore\` — Inspect a project and propose reusable loadouts.
- \`loadouts agents publish\` — Compare a verified local loadout with its catalog and prepare a pull request.`;

export const COMMANDS: Record<string, { brief: string; hint?: string; summary: string; examples: string[]; run: (args: ParsedCommand) => Promise<number> }> = {
  agents: {brief: "Read bundled workflow guides.", hint: "[explore|publish]",
    summary: "List the available guides or print one in Markdown. Works offline before project setup.",
    examples: ["loadouts agents", "loadouts agents explore", "loadouts agents publish"],
    run: async ({positionals: [topic]}) => {
      const guides: Record<string, string> = {explore: explorationSkill, publish: publicationSkill};
      console.log(topic ? guides[topic] : guideIndex);
      return 0;
    },
  },
  explore: {brief: "Alias for loadouts agents explore.",
    summary: "Print agent guidance to reuse suitable catalog entries, search remaining gaps with npx skills find, and create focused drafts. Default to direct manifest selections; use composition YAML for reusable bundles. Review included instructions and conventions for conflicts. Does not launch an agent or install anything.",
    examples: ["loadouts agents explore", "loadouts explore"],
    run: async args => {
      console.log(explorationSkill); return 0;
    },
  },
  validate: {brief: "Validate a loadout YAML file.", hint: "backend.yml",
    summary: "Validate one YAML file offline, including include entry shape and local routing references, without initializing or installing. Does not fetch descendants, resolve graph conflicts or certify semantic compatibility.",
    examples: ["loadouts validate .loadouts/catalog/backend.yml"],
    run: async args => {
      const {positionals} = args;
      const file = positionals[0]!;
      let yaml: string;
      try { yaml = readFileSync(file, "utf8"); }
      catch { throw new CliError(`cannot read ${file}`, 1, "check that the YAML file exists and is readable"); }
      console.log(`${paint("Valid loadout:", "green")} ${parseLoadout(yaml, basename(file)).name}`); return 0;
    },
  },
  inspect: {brief: "Inventory project and user agent setups.",
    summary: "Read project and user agent setup metadata without running tools or changing files.",
    examples: ["loadouts inspect", "loadouts inspect --json"],
    run: async args => {
      const {values} = args;
      const report = inspectProject(process.cwd());
      console.log(values.json ? JSON.stringify(report, null, 2) : [
        `${paint("Project:", "cyan")} ${report.project}${report.initialized ? " (initialized)" : " (not initialized)"}`,
        paint("Declarations and installed files are evidence of availability, not effective activation or verified use.", "dim"),
        ...report.manifests.map(path => `${paint("Manifest:", "cyan")} ${path}`), ...report.instructions.map(path => `${paint("Instructions:", "cyan")} ${path}`),
        ...report.plugins.map(p => `${paint("Plugin:", "cyan")} ${p.id} [${p.scope}, ${p.harness}, ${p.enabled === null ? "installed only" : p.enabled ? "enabled" : "disabled"}] source: ${p.source ?? "unknown"}\n  ${p.path}${p.installPath ? `\n  installed: ${p.installPath}` : ""}`),
        ...report.skills.map(s => `${paint("Skill:", "cyan")} ${s.name} [${s.scope}, ${s.harness}] source: ${s.source ?? "unknown"}\n  ${s.path}`),
        ...report.mcp.map(m => `${paint("MCP:", "cyan")} ${m.name} [${m.scope}, ${m.harness}, ${m.transport}, ${m.enabled ? "enabled" : "disabled"}]\n  ${m.path}`),
        ...report.warnings.map(w => paint(`Warning: ${w}`, "yellow")),
      ].join("\n"));
      return report.warnings.length ? 1 : 0;
    },
  },
  setup: {brief: "Set machine defaults and agent help references.",
    summary: "Set machine defaults and reference LOADOUTS.md in global agent instructions.", examples: ["loadouts setup --catalog katisfaktion/agent-loadouts --harness claude-code,codex"],
    run: async args => {
      const {values} = args;
      const defaults = values.catalog && values.harness ? undefined : readConfig();
      const files = setup({catalog: values.catalog ?? defaults!.catalog, harnesses: values.harness ? parseHarnesses(values.harness) : defaults!.harnesses});
      console.log(files.length ? files.map(f => `${paint("wrote", "green")} ${f}`).join("\n") : paint("Nothing changed.", "dim")); return 0;
    },
  },
  init: {brief: "Initialize the project manifest and local catalog.",
    summary: "Create loadouts.json and the local catalog; no components are installed.", examples: ["loadouts init --harness codex"],
    run: async args => {
      const {values} = args;
      const project = process.cwd();
      const existing = existsSync(join(project, "loadouts.json")) ? readManifest(project) : null;
      if (!existing && existsSync(join(project, "loadouts.lock.json"))) throw new CliError("loadouts.lock.json exists without loadouts.json", 1, "restore loadouts.json from version control before initializing this project");
      const harnesses = values.harness ? parseHarnesses(values.harness) : existing?.harnesses ?? readConfig().harnesses;
      if (existing && JSON.stringify([...existing.harnesses].sort()) !== JSON.stringify([...harnesses].sort())) throw new CliError("project already uses different harnesses", 2, "use loadouts harness add|remove");
      const files: string[] = [];
      if (!existing && writeManifest(project, {harnesses, loadouts: {}})) files.push("loadouts.json");
      if (ensureLocalCatalog(project)) files.push(".loadouts/.gitkeep");
      if (ensureGitignore(project)) files.push(".gitignore");
      console.log(files.length ? files.map(f => `${paint("wrote", "green")} ${f}`).join("\n") : paint("Nothing changed.", "dim")); return 0;
    },
  },
  install: {brief: "Install declared loadouts and restore missing setup.",
    summary: "Resolve direct selections and their active include closure, apply reachable local edits, and restore missing skills from skills-lock.json with frozen hashes. New skills locks use v2. Existing v1 locks retain their format. Loadouts selects the pinned installer automatically. Includes map actual names to {source, choices?}; use full explicit sources and group-path-to-member arrays. Member includes activate only with their containing branch. Different sources or explicit choices for the same name conflict; include order provides no overrides. Plugin versions remain best effort.",
    examples: ["loadouts install"],
    run: async args => { await install(requireProject(process.cwd())); return 0; },
  },
  create: {brief: "Create a local loadout draft.", hint: "backend",
    summary: "Create a local draft in .loadouts/catalog/ with the CLI release's schema reference, without selecting or installing it. Works before init at the nearest project or Git root (otherwise the current directory). Existing drafts are never overwritten.",
    examples: ["loadouts create pipeline", "loadouts create backend --from backend"],
    run: async args => {
      const {values, positionals} = args;
      console.log(`${paint("wrote", "green")} ${await createLocal(inspectionRoot(process.cwd()), positionals[0]!, values.from)}`); return 0;
    },
  },
  publish: {brief: "Preview a catalog contribution; --yes opens a PR.", hint: "backend",
    summary: "Preview an applied, verified local loadout contribution, including an included-only local node. Every include declaration in the chosen YAML and inspected active closure, including dormant branches, must use portable GitHub sources. Publish local dependencies first, update their sources, install and verify the selected composition. Offline preview checks active pinned descendants in the existing Git cache and refuses missing cache objects without fetching. Inactive targets receive source portability checks only; they are not fetched or tested. Copies only the chosen YAML, preserving includes; --yes pushes a branch and opens a PR.",
    examples: ["loadouts publish pipeline --summary 'Verified in my data project'", "loadouts publish pipeline --summary 'Verified in my data project' --yes"],
    run: async args => {
      const {values, positionals} = args;
      console.log(await publish(requireProject(process.cwd()), positionals[0]!, {summary: values.summary ?? "", catalog: values.catalog, yes: values.yes})); return 0;
    },
  },
  status: {brief: "Show sources, selections and installation state.",
    summary: "Show direct roots, included descendants and their parent edges, declared sources, applied selections and whether installation is needed.", examples: ["loadouts status --json"],
    run: args => projectCommand("status", args),
  },
  remove: {brief: "Remove a declared loadout and its setup.", hint: "frontend", summary: "Remove a direct selection, retaining descendants still required by another root. Included-only nodes must be removed through their parents.", examples: ["loadouts remove frontend"], run: args => projectCommand("remove", args) },
  switch: {brief: "Choose a one_of alternative.", hint: "LOADOUT/PATH ALTERNATIVE", summary: "Choose a one_of alternative on a direct selection using its slash-separated group path. Enable containing ancestors first. Switching removes explicit descendant requests under deselected members from this direct entry and reports them; re-enabling uses defaults. For an included-only node, edit the declaring member's includes.<name>.choices or add the same source directly first. Direct choices cannot override conflicting include choices.", examples: ["loadouts switch base/methodology agent-skills", "loadouts switch testing/languages/python/framework unittest", "loadouts switch frontend/framework vue"], run: args => projectCommand("switch", args) },
  enable: {brief: "Enable an any_of member.", hint: "LOADOUT/PATH MEMBER", summary: "Enable an any_of member on a direct selection using its slash-separated group path. Enable containing ancestors first; a child request never enables them implicitly. For an included-only node, edit the declaring member's includes.<name>.choices or add the same source directly first. Direct choices cannot override conflicting include choices.", examples: ["loadouts enable backend/runtime go", "loadouts enable testing/languages python", "loadouts enable testing/languages/python/extras coverage"], run: args => projectCommand("enable", args) },
  disable: {brief: "Disable an any_of member.", hint: "LOADOUT/PATH MEMBER", summary: "Disable an any_of member on a direct selection using its slash-separated group path. Disabling a parent removes and reports explicit descendant requests under its deselected member from this direct entry; re-enabling uses defaults. For an included-only node, edit the declaring member's includes.<name>.choices or add the same source directly first. Direct choices cannot override conflicting include choices.", examples: ["loadouts disable backend/runtime go", "loadouts disable testing/languages python", "loadouts disable testing/languages/python/extras coverage"], run: args => projectCommand("disable", args) },
  harness: {brief: "Add or remove a project harness.", hint: "add codex", summary: "Change project harnesses.", examples: ["loadouts harness add codex"], run: args => projectCommand("harness", args) },
  update: {brief: "Refresh shared sources and selected skill contents.",
    summary: "Refresh shared resolutions throughout the include closure within declared refs and selected skill contents/hashes, keeping choices and applied local snapshots. Review and commit skills-lock.json; use install to apply local edits.", examples: ["loadouts update"],
    run: async args => { await update(requireProject(process.cwd())); return 0; },
  },
  doctor: {brief: "Check setup and explain how to fix problems.",
    summary: "Check manifest drift, local/shared name collisions, effective inherited conflicts, missing artifacts and MCP reachability without applying changes.", examples: ["loadouts doctor --json"],
    run: async args => {
      const {values} = args;
      const findings = await doctor(requireProject(process.cwd()));
      console.log(values.json ? JSON.stringify({findings}, null, 2) : findings.length ? findings.map(f => `${paint("warning:", "yellow")} ${f.message}\n  ${paint("fix:", "cyan")} ${f.fix}`).join("\n\n") : paint("No problems found.", "green"));
      return findings.length ? 1 : 0;
    },
  },
  claude: {brief: "Check setup, then start Claude Code.", hint: "[args...]",summary: "Check installation, then start Claude Code with normal configuration inheritance.", examples: ["loadouts claude -p 'Review this project'"], run: args => launch("claude", requireProject(process.cwd()), args.positionals)},
  codex: {brief: "Check setup, then start Codex.", hint: "[args...]",summary: "Check installation, then start Codex with normal configuration inheritance.", examples: ["loadouts codex"], run: args => launch("codex", requireProject(process.cwd()), args.positionals)},
  global: {brief: "Preview or disable global leftovers.", hint: "prune",
    summary: "Preview or disable global leftovers.", examples: ["loadouts global prune", "loadouts global prune --yes"],
    run: async args => {
      const {values} = args;
      const changes = await prune(values.yes ?? false);
      console.log(paint("These changes affect all projects:", "yellow"));
      console.log(changes.map(change => paint(change, "yellow")).join("\n") || paint("Nothing changed.", "dim"));
      if (!values.yes) console.log(paint("Run again with --yes to apply.", "dim"));
      return 0;
    },
  },
  list: {brief: "List local and shared loadouts.",
    summary: "List available loadouts.", examples: ["loadouts list --json"],
    run: args => catalogCommand("list", args),
  },
  show: {brief: "Show a loadout definition and its source.", hint: "backend",
    summary: "Show the full declared tree of items, nested groups, defaults, conditional includes and routing. Installed descendants follow their pinned source.", examples: ["loadouts show base --json"],
    run: args => catalogCommand("show", args),
  },
  help: {brief: "Show command usage, flags and examples.", hint: "[command]",
    summary: "Show usage and examples.",
    examples: ["loadouts help add"],
    run: async args => { console.log(helpText(args.positionals[0])); return 0; },
  },
  add: {brief: "Declare and install loadouts.", hint: "base frontend",
    summary: "Declare direct roots and apply their active include closure. Encode nested requests with --with LOADOUT/PATH=MEMBER[,MEMBER], repeating the option for other groups. All requests are validated together; select ancestors explicitly and omit literal items/one_of/any_of from paths. An empty value clears an any_of group. Inactive requests fail instead of being discarded. Explicit choices must agree across roots and include edges; they never override one another. New bare names use the shared catalog; an existing name keeps its selected source. Replacing a selected source shows the old and new sources and asks for confirmation (default: no). Use --yes to approve replacements in scripts. Local files never implicitly override shared definitions.",
    examples: ["loadouts add base frontend backend", "loadouts add file:./.loadouts/catalog/backend.yml", "loadouts add github:katisfaktion/agent-loadouts/backend@v0.1.0", "loadouts add testing --with testing/languages=python --with testing/languages/python/framework=unittest"],
    run: args => projectCommand("add", args),
  },
};

async function catalogCommand(command: "list" | "show", args: ParsedCommand): Promise<number> {
  const {values, positionals} = args;

  const project = findProject(process.cwd());
  const lock = project && existsSync(join(project, "loadouts.lock.json")) ? readLock(project) : null;
  const locked = lock?.catalog ?? null;
  const locals = project && !values.catalog ? localNames(project) : [];
  if (command === "show" && project && !values.catalog) {
    const name = positionals[0]!;
    const declared = existsSync(join(project, "loadouts.json")) ? readManifest(project).loadouts : {};
    const selected = Object.hasOwn(declared, name) ? declared[name] : lock?.resolved?.[name];
    if (selected) {
      const parsed = parseSource(selected.source);
      if (parsed.kind === "catalog") {
        const pinned = lock?.resolved?.[name];
        const catalog = pinned?.source === selected.source ? pinned.catalog! : await openCatalog(parsed.repo, parsed.ref);
        console.log(JSON.stringify({...await readLoadout(catalog, name), source: {kind: "catalog", ...catalog}}, null, 2)); return 0;
      }
      console.log(JSON.stringify({...parseLoadout(readSourceFile(project, selected.source), name + ".yml"), source: {kind: "local", path: parsed.path}}, null, 2)); return 0;
    }
    const yaml = readLocal(project, positionals[0]!);
    if (yaml !== null) {
      console.log(JSON.stringify({...parseLoadout(yaml, positionals[0] + ".yml"), source: {kind: "local", path: `.loadouts/catalog/${positionals[0]}.yml`}}, null, 2)); return 0;
    }
    if (Object.hasOwn(lock?.local ?? {}, positionals[0]!)) throw new CliError(`local definition .loadouts/catalog/${positionals[0]}.yml is missing`, 1, `restore .loadouts/catalog/${positionals[0]}.yml or remove the local selection with loadouts remove ${positionals[0]}`);
  }
  const catalog = values.catalog ? await openCatalog(values.catalog) : locked ?? await openCatalog(readConfig().catalog);
  const shared = command === "list" ? await listLoadouts(catalog) : [];
  const result = command === "list" ? [...new Set([...locals, ...shared])].sort() : {...await readLoadout(catalog, positionals[0]!), source: {kind: "catalog", ...catalog}};
  console.log(values.json || command === "show" ? JSON.stringify(result, null, 2) : (result as string[]).map(name => `${paint(name, "blue")} (${locals.includes(name) ? shared.includes(name) ? "local + catalog; choose an explicit source" : "local" : "catalog"})`).join("\n"));
  return 0;
}

export async function main(argv: string[]): Promise<number> {
  try {
    if (argv.length === 1 && (argv[0] === "--help" || argv[0] === "-h")) argv = ["help"];
    const [name = "help", ...args] = argv;
    const command = COMMANDS[name];
    if (!Object.hasOwn(COMMANDS, name)) throw new CliError(`unknown command "${name}"`, 2);
    if (name !== "claude" && name !== "codex" && (args.slice(0, args.includes("--") ? args.indexOf("--") : undefined).some(arg => arg === "--help" || arg === "-h"))) {
      console.log(helpText(name));
      return 0;
    }
    return await command.run(parseCommand(argv));
  } catch (error) {
    const e = error instanceof CliError ? error : new CliError(error instanceof Error ? error.message : String(error), 1);
    await Bun.write(Bun.stderr, `${paint("error:", "red", "stderr")} ${e.message}\n${paint("fix:", "cyan", "stderr")} ${e.fix}\n`);
    return e.code;
  }
}

if (import.meta.main) process.exit(await main(Bun.argv.slice(2)));
