#!/usr/bin/env bun
import { prune } from "./prune";
import { launch } from "./launch";
import { doctor } from "./doctor";
import { printChanges, projectCommand, update, install } from "./sync";
import { existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { readConfig, parseHarnesses, setup } from "./config";
import { readLock, requireProject } from "./lock";
import { findProject } from "./paths";
import { parseCommand, type ParsedCommand } from "./commands";
import { openCatalog, listLoadouts, readLoadout, splitCatalogSpec } from "./catalog";
import { CliError } from "./errors";
import { helpText } from "./help";
import { jsonNotes, paint } from "./output";
import { createLocal, localNames, readLocal, ensureLocalCatalog } from "./local";
import { parseLoadout } from "./loadout";
import { readManifest, writeManifest, parseSource, catalogSource, fileSource, readSourceFile } from "./manifest";
import { ensureGitignore } from "./codex";
import { publish } from "./publish";
import { inspectProject, inspectionRoot } from "./inspect";
import { guides, guideIndex } from "./guides";

export const COMMANDS: Record<string, { brief: string; hint?: string; summary: string; examples: string[]; run: (args: ParsedCommand) => Promise<number> }> = {
  agents: {brief: "List workflow guides for agents.", hint: "[GUIDE]",
    summary: "List the workflow guides. Give a guide name to read it offline as Markdown.",
    examples: ["loadouts agents explore"],
    run: async ({positionals: [topic]}) => {
      console.log(topic ? guides[topic]!.body : guideIndex);
      return 0;
    },
  },
  validate: {brief: "Validate a loadout YAML file.", hint: "FILE",
    summary: "Check a loadout YAML file before installing it. This offline check covers the file itself, including its routing and include declarations.",
    examples: ["loadouts validate .loadouts/catalog/testing.yml"],
    run: async args => {
      const {positionals} = args;
      const file = positionals[0]!;
      let yaml: string;
      try { yaml = readFileSync(file, "utf8"); }
      catch { throw new CliError(`cannot read ${file}`, 1, "check that the YAML file exists and is readable"); }
      console.log(`${paint("Valid loadout:", "green")} ${parseLoadout(yaml, basename(file)).name}`); return 0;
    },
  },
  inspect: {brief: "List tools and instructions in project and user settings.",
    summary: "Read project and user settings without starting any tools. Works before project setup. Returns exit code 1 if the inventory has warnings.",
    examples: ["loadouts inspect --json"],
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
  init: {brief: "Create the project manifest and local catalog.",
    summary: "Create loadouts.json and .loadouts/catalog/ in the current directory. Use loadouts add to install your first loadout.", examples: ["loadouts init --harness codex"],
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
  install: {brief: "Install the loadouts listed in loadouts.json.",
    summary: "Apply loadouts.json and local YAML edits. Restore missing tools from loadouts.lock.json and skills-lock.json. To refresh upstream versions, use loadouts update. For checkout instructions, see loadouts agents apply.",
    examples: ["loadouts install --json"],
    run: async args => { printChanges(await install(requireProject(process.cwd()))); return 0; },
  },
  create: {brief: "Create a local loadout draft.", hint: "NAME",
    summary: "Write a new YAML file in .loadouts/catalog/. Run loadouts add with the file source to use the draft in this project.",
    examples: ["loadouts create testing", "loadouts create team-testing --from testing"],
    run: async args => {
      const {values, positionals} = args;
      console.log(`${paint("wrote", "green")} ${await createLocal(inspectionRoot(process.cwd()), positionals[0]!, values.from)}`); return 0;
    },
  },
  publish: {brief: "Preview or open a catalog pull request.", hint: "NAME",
    summary: "Preview the YAML and PR description for an applied local loadout. For the catalog review workflow, see loadouts agents publish.",
    examples: ["loadouts publish testing --summary 'Verified with the browser test suite'"],
    run: async args => {
      const {values, positionals} = args;
      console.log(await publish(requireProject(process.cwd()), positionals[0]!, {summary: values.summary ?? "", catalog: values.catalog, yes: values.yes})); return 0;
    },
  },
  status: {brief: "Show project loadouts, their sources and installation state.",
    summary: "Show the loadouts in loadouts.json, the loadouts they include, their active choices and whether you need to run install.", examples: ["loadouts status --json"],
    run: args => projectCommand("status", args),
  },
  remove: {brief: "Remove a loadout from loadouts.json and clean up its project setup.", hint: "NAME", summary: "Remove the named entry from loadouts.json and clean up the project tools and instructions it alone provided. Other loadouts keep the tools they still need. The catalog YAML stays available for reuse.", examples: ["loadouts remove testing"], run: args => projectCommand("remove", args) },
  switch: {brief: "Switch to another choice in a group.", hint: "LOADOUT/PATH ALTERNATIVE", summary: "Select one alternative in an active one_of group and apply it. Switching clears explicit choices under the previous alternative.", examples: ["loadouts switch testing/languages/python/framework pytest"], run: args => projectCommand("switch", args) },
  enable: {brief: "Enable an optional choice.", hint: "LOADOUT/PATH MEMBER", summary: "Add a member to an active any_of group and apply the change. For nested groups, select the parent first.", examples: ["loadouts enable testing/languages python"], run: args => projectCommand("enable", args) },
  disable: {brief: "Disable an optional choice.", hint: "LOADOUT/PATH MEMBER", summary: "Remove a member from an active any_of group and apply the change. This also clears explicit choices nested under that member.", examples: ["loadouts disable testing/languages python"], run: args => projectCommand("disable", args) },
  harness: {brief: "Add or remove a project harness.", hint: "add|remove HARNESS", summary: "Select or remove claude-code or codex for this project and apply the change immediately. Removing a harness preserves tools another harness uses.", examples: ["loadouts harness remove claude-code --json"], run: args => projectCommand("harness", args) },
  update: {brief: "Refresh shared sources and selected skill contents.",
    summary: "Refresh shared loadouts within their declared refs and record current skill hashes. Use loadouts install to apply edits to local YAML.", examples: ["loadouts update --json"],
    run: async args => { printChanges(await update(requireProject(process.cwd()))); return 0; },
  },
  doctor: {brief: "Check setup and explain how to fix problems.",
    summary: "Check machine configuration and report fixes. Inside a project, also check selected tools and MCP reachability. These checks can start MCP servers.", examples: ["loadouts doctor --json"],
    run: async args => {
      const {values} = args;
      const findings = await doctor(process.cwd());
      console.log(values.json ? JSON.stringify({findings}, null, 2) : findings.length ? findings.map(f => `${paint("warning:", "yellow")} ${f.message}\n  ${paint("fix:", "cyan")} ${f.fix}`).join("\n\n") : paint("No problems found.", "green"));
      return findings.length ? 1 : 0;
    },
  },
  claude: {brief: "Check setup, then start Claude Code.", hint: "[args...]",summary: "Run a read-only setup check, then start Claude Code with its usual project and user settings. Run loadouts install if the setup needs repair.", examples: ["loadouts claude -p 'Review this project'"], run: args => launch("claude", requireProject(process.cwd()), args.positionals)},
  codex: {brief: "Check setup, then start Codex.", hint: "[args...]",summary: "Run a read-only setup check, then start Codex with its usual project and user settings. Run loadouts install if the setup needs repair.", examples: ["loadouts codex"], run: args => launch("codex", requireProject(process.cwd()), args.positionals)},
  global: {brief: "Configure machine defaults or prune global tools.", hint: "configure|prune",
    summary: "Use configure to set defaults for this machine. Use prune to preview which global tools would be disabled.",
    examples: ["loadouts global configure --catalog katisfaktion/agent-loadouts --harness claude-code,codex", "loadouts global prune"],
    run: async ({positionals: [action], values}) => {
      if (action === "configure") {
        const defaults = values.catalog && values.harness ? undefined : readConfig();
        const files = setup({catalog: values.catalog ?? defaults!.catalog, harnesses: values.harness ? parseHarnesses(values.harness) : defaults!.harnesses});
        console.log(files.length ? files.map(f => `${paint("wrote", "green")} ${f}`).join("\n") : paint("Nothing changed.", "dim")); return 0;
      }
      const changes = await prune(values.yes ?? false);
      console.log(paint("These changes affect all projects:", "yellow"));
      console.log(changes.map(change => paint(change, "yellow")).join("\n") || paint("Nothing changed.", "dim"));
      if (!values.yes) console.log(paint("Run again with --yes to apply.", "dim"));
      return 0;
    },
  },
  list: {brief: "List local and shared loadouts.",
    summary: "List names from the project and shared catalogs. Use --sources to see each source when names overlap.", examples: ["loadouts list --sources --json"],
    run: args => catalogCommand("list", args),
  },
  show: {brief: "Show a loadout definition and its source.", hint: "NAME-OR-SOURCE",
    summary: "Read a loadout's definition, choices and source. Pass a source from loadouts list --sources to inspect a specific local or catalog entry.", examples: ["loadouts show sdlc --json"],
    run: args => catalogCommand("show", args),
  },
  help: {brief: "Show command usage, flags and examples.", hint: "[command]",
    summary: "List commands by task, or give a command name to see its usage and flags.",
    examples: ["loadouts help add", "loadouts help global configure"],
    run: async args => { console.log(helpText(args.positionals[0], args.positionals[1])); return 0; },
  },
  add: {brief: "Add loadouts to loadouts.json and install them.", hint: "SOURCE...",
    summary: "Save each loadout's source in loadouts.json and install it for this project. With a name alone, add uses the source already in loadouts.json or looks up a new name in the shared catalog. Replacing a source requires confirmation. With --json, check stderr for confirmation_required.",
    examples: ["loadouts add sdlc", "loadouts add file:./.loadouts/catalog/testing.yml --with testing/languages=python"],
    run: args => projectCommand("add", args),
  },
};

async function catalogCommand(command: "list" | "show", args: ParsedCommand): Promise<number> {
  const {values, positionals} = args;

  const project = findProject(process.cwd());
  const lock = project && existsSync(join(project, "loadouts.lock.json")) ? readLock(project) : null;
  const locked = lock?.catalog ?? null;
  const root = project ?? inspectionRoot(process.cwd());
  const input = positionals[0];
  const explicit = input?.includes(":") ? parseSource(input) : undefined;
  if (explicit && values.catalog) throw new CliError("an explicit source already identifies its catalog", 2, "omit --catalog when passing a full source");
  if (command === "show" && (project || explicit) && !values.catalog) {
    const name = explicit?.name ?? input!;
    const declared = !explicit && project && existsSync(join(project, "loadouts.json")) ? readManifest(project).loadouts : {};
    const selected = explicit ? {source: input!} : Object.hasOwn(declared, name) ? declared[name] : lock?.resolved?.[name];
    if (selected) {
      const parsed = parseSource(selected.source);
      if (parsed.kind === "catalog") {
        const pinned = lock?.resolved?.[name];
        const catalog = pinned?.source === selected.source ? pinned.catalog! : await openCatalog(parsed.repo, parsed.ref);
        console.log(JSON.stringify({...await readLoadout(catalog, name), source: {kind: "catalog", ...catalog}}, null, 2)); return 0;
      }
      console.log(JSON.stringify({...parseLoadout(readSourceFile(root, selected.source), name + ".yml"), source: {kind: "local", path: parsed.path}}, null, 2)); return 0;
    }
    const yaml = readLocal(root, positionals[0]!);
    if (yaml !== null) {
      console.log(JSON.stringify({...parseLoadout(yaml, positionals[0] + ".yml"), source: {kind: "local", path: `.loadouts/catalog/${positionals[0]}.yml`}}, null, 2)); return 0;
    }
    if (Object.hasOwn(lock?.local ?? {}, positionals[0]!)) throw new CliError(`local definition .loadouts/catalog/${positionals[0]}.yml is missing`, 1, `restore .loadouts/catalog/${positionals[0]}.yml or remove the local selection with loadouts remove ${positionals[0]}`);
  }
  const catalog = values.catalog ? await openCatalog(...splitCatalogSpec(values.catalog)) : locked ?? await openCatalog(readConfig().catalog);
  if (command === "show") {
    console.log(JSON.stringify({...await readLoadout(catalog, input!), source: {kind: "catalog", ...catalog}}, null, 2));
    return 0;
  }
  const shared = await listLoadouts(catalog);
  const locals = !values.catalog && (project || values.sources) ? localNames(root) : [];
  const names = [...new Set([...locals, ...shared])].sort();
  if (values.sources) {
    const candidates = names.flatMap(name => [
      ...(locals.includes(name) ? [{name, kind: "local", source: fileSource(name)}] : []),
      ...(shared.includes(name) ? [{name, kind: "catalog", source: catalogSource(catalog.repo, name, catalog.ref)}] : []),
    ]);
    console.log(values.json ? JSON.stringify(candidates, null, 2) : candidates.map(item => item.source).join("\n"));
  } else {
    console.log(values.json ? JSON.stringify(names, null, 2) : names.map(name => `${paint(name, "blue")} (${locals.includes(name) ? shared.includes(name) ? "local + catalog; choose an explicit source" : "local" : "catalog"})`).join("\n"));
  }
  return 0;
}

export async function main(argv: string[]): Promise<number> {
  if (argv.length === 1 && (argv[0] === "--help" || argv[0] === "-h")) argv = ["help"];
  const [name = "help", ...args] = argv;
  const forwarded = name === "claude" || name === "codex";
  const flags = forwarded ? [] : args.slice(0, args.includes("--") ? args.indexOf("--") : undefined);
  const json = flags.includes("--json");
  const notes: string[] = [];
  try {
    const command = COMMANDS[name];
    if (name === "setup") throw new CliError("setup has moved", 2, "run loadouts global configure");
    if (!Object.hasOwn(COMMANDS, name)) throw new CliError(`unknown command "${name}"`, 2);
    if (flags.some(arg => arg === "--help" || arg === "-h")) {
      console.log(helpText(name, name === "global" && args[0] && !args[0].startsWith("-") ? args[0] : undefined));
      return 0;
    }
    const parsed = parseCommand(argv);
    return await (parsed.values.json ? jsonNotes.run(notes, () => command.run(parsed)) : command.run(parsed));
  } catch (error) {
    const e = error instanceof CliError ? error : new CliError(error instanceof Error ? error.message : String(error), 1);
    if (json) {
      const detail = {code: e.id, message: e.message, fix: e.fix, ...(e.replacements ? {replacements: e.replacements} : {})};
      await Bun.write(Bun.stderr, JSON.stringify({error: detail, ...(notes.length ? {notes} : {})}) + "\n");
    } else await Bun.write(Bun.stderr, `${paint("error:", "red", "stderr")} ${e.message}\n${paint("fix:", "cyan", "stderr")} ${e.fix}\n`);
    return e.code;
  }
}

if (import.meta.main) process.exit(await main(Bun.argv.slice(2)));
