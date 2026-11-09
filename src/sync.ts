import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import type { ParsedCommand } from "./commands";
import { CliError } from "./errors";
import { paint } from "./output";
import { readLock, writeLock, requireProject, loadoutPaths, validateLockedLoadout, type Lock } from "./lock";
import { readConfig, parseHarnesses } from "./config";
import { readLoadout, openCatalog } from "./catalog";
import { activeItems, artifactsFor, declaredItems, includeDeclarations, resolveChoices, sourceFor, parseLoadout, type Loadout, type McpServer, type Group, type Harness } from "./loadout";
import { ensureLocalCatalog } from "./local";
import { installSkills, removeSkills, removeSkillLinks, missingSkills } from "./skills";
import { checkMcp } from "./mcpcheck";
import { readJson } from "./globals";
import { applyClaude } from "./claude";
import { prepareCodexConfig, codexConfigPath, expandProject, ensureGitignore } from "./codex";
import { renderSection, spliceSection, ensureClaudeImport } from "./agentsmd";
import { writeIfChanged } from "./paths";
import { readManifest, writeManifest, resolveManifest, catalogSource, parseSource, manifestMatchesLock, type Manifest } from "./manifest";
import { syncPackageSkills, packageSkillStatus, selectsPackageSkill } from "./package-skills";
import { syncCodexPlugins, codexPluginCachePresent } from "./codex-plugins";
import { prepareInstallers, missingInstallerArtifacts, checkInstallerPrerequisites } from "./installers";

export async function loadedLoadouts(lock: Lock): Promise<Record<string, Loadout>> {
  return Object.fromEntries(await Promise.all(Object.keys(lock.loadouts).sort().map(async name => {
    const loadout = Object.hasOwn(lock.local ?? {}, name) ? parseLoadout(lock.local![name]!, name + ".yml") : await readLoadout(lock.resolved?.[name]?.catalog ?? lock.catalog!, name);
    validateLockedLoadout(lock, name, loadout);
    return [name, loadout];
  })));
}
function validateChoice(name: string, group: Group, members: string[]): void {
  if ((group.kind === "one_of" && members.length !== 1) || new Set(members).size !== members.length || members.some(m => !Object.hasOwn(group.members, m))) {
    throw new CliError(`invalid choices for ${name}`, 2, `choose ${group.kind === "one_of" ? "exactly one of" : "from"}: ${Object.keys(group.members).join(", ")}`);
  }
}
export function desired(lock: Lock, loadouts: Record<string, Loadout>): Map<string, {itemId: string; mcp: McpServer | null}> {
  const result = new Map<string, {itemId: string; mcp: McpServer | null}>();
  const stable = (v: unknown): string => JSON.stringify(v, (_k, x) => x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map(k => [k, x[k]])) : x);
  const origin = (itemId: string) => {
    const name = itemId.split("/")[0]!;
    return `${itemId} (${loadoutPaths(lock, name).map(path => path.join(" → ")).join("; ")})`;
  };
  const conflict = (key: string, left: {itemId: string; value: unknown}, right: {itemId: string; value: unknown}) => {
    throw new CliError(`conflicting ${key} definitions from ${origin(left.itemId)}: ${stable(left.value)} and ${origin(right.itemId)}: ${stable(right.value)}`, 1, "use identical definitions or distinct component names in the loadouts");
  };
  const claims = new Map<string, {itemId: string; value: string}>();
  const claim = (key: string, itemId: string, value: string) => {
    const previous = claims.get(key);
    if (previous && previous.value !== value) conflict(key, previous, {itemId, value});
    if (!previous) claims.set(key, {itemId, value});
  };
  for (const name of Object.keys(lock.loadouts).sort()) {
    const choices = lock.loadouts[name]!, l = loadouts[name]!;
    for (const a of activeItems(l, choices).sort((a, b) => a.id.localeCompare(b.id))) for (const h of lock.harnesses) {
      const source = sourceFor(a.item, h);
      // Skill folders are shared across harnesses; only explicit names are knowable before discovery.
      for (const identifier of source.skills ?? []) {
        const [repo, skill] = identifier.split("@");
        if (skill) claim(`skill:${skill}`, a.id, `github:${repo}`);
      }
      for (const selector of source.packageSkills?.include ?? []) {
        const [pkg, skill] = selector.split("#");
        if (skill && selectsPackageSkill(source.packageSkills!, pkg!, skill)) claim(`skill:${skill}`, a.id, `package:${pkg}`);
      }
      if (source.installer) claim("skill:codebase-memory", a.id, "installer:codebase-memory");
      for (const [key, mcp] of artifactsFor(a, h)) {
        if (key.startsWith("marketplace:") || key.startsWith("codex-marketplace:")) {
          const [kind, namespace, repo] = key.split(":");
          claim(`${kind}:${namespace}`, a.id, repo!);
        }
        const previous = result.get(key);
        if (previous && stable(previous.mcp) !== stable(mcp)) conflict(key, {itemId: previous.itemId, value: previous.mcp}, {itemId: a.id, value: mcp});
        if (!previous) result.set(key, {itemId: a.id, mcp});
      }
    }
  }
  return result;
}
export function missingArtifacts(project: string, lock: Lock): string[] {
  const missing = new Set<string>(), configs = new Map<string, any>();
  const config = (file: string) => {
    if (!configs.has(file)) {
      try {
        const text = readFileSync(join(project, file), "utf8"), value = file.endsWith(".toml") ? Bun.TOML.parse(text) : JSON.parse(text);
        if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
        configs.set(file, value);
      } catch { missing.add(file); configs.set(file, {}); }
    }
    return configs.get(file);
  };
  const codex = ".codex/config.toml";
  if (lock.harnesses.includes("codex")) config(codex);
  for (const file of [...(Object.keys(lock.loadouts).length ? ["AGENTS.md"] : []), ...(lock.harnesses.includes("claude-code") ? ["CLAUDE.md"] : [])]) {
    try { if (!statSync(join(project, file)).isFile()) missing.add(file); }
    catch { missing.add(file); }
  }
  for (const [key, names] of Object.entries(lock.installed)) {
    const [kind, name, identifier] = key.split(":");
    let absent = false;
    if (kind === "skill" || kind === "package-skill") absent = missingSkills(project, names, name as Harness);
    else if (kind === "plugin") absent = config(".claude/settings.json").enabledPlugins?.[name!] !== true;
    else if (kind === "marketplace") absent = !Object.hasOwn(config(".claude/settings.json").extraKnownMarketplaces ?? {}, name!);
    else if (kind === "codex-plugin") absent = config(codex).plugins?.[name!]?.enabled !== true || !codexPluginCachePresent(name!);
    else if (kind === "codex-marketplace") absent = !Object.hasOwn(config(codex).marketplaces ?? {}, name!);
    else if (kind === "mcp") absent = !Object.hasOwn(name === "codex" ? config(codex).mcp_servers ?? {} : config(".mcp.json").mcpServers ?? {}, identifier!);
    if (absent) missing.add(key);
  }
  return [...missing, ...missingInstallerArtifacts(project, lock), ...packageSkillStatus(project, lock).changed.map(p => `package skills need synchronization: ${p}`)];
}
export async function sync(project: string, lock: Lock, opts?: {check?: boolean; beforeApply?: () => string | void; repair?: boolean; updateSkills?: boolean}): Promise<{added: string[]; removed: string[]; files: string[]}> {
  const loaded = await loadedLoadouts(lock), want = desired(lock, loaded);
  checkInstallerPrerequisites([...want.keys()]);
  const added = [...want.keys()].filter(k => !Object.hasOwn(lock.installed, k) || lock.pending?.includes(k) || (k.startsWith("skill:") && (opts?.updateSkills || (opts?.repair && (lock.incomplete || missingSkills(project, lock.installed[k] ?? [], k.split(":")[1] as Harness))))));
  const removed = [...new Set([...Object.keys(lock.installed), ...(lock.pending ?? [])])].filter(k => !want.has(k) && !k.startsWith("package-skill:"));
  const agentsFile = join(project, "AGENTS.md"), existing = existsSync(agentsFile) ? readFileSync(agentsFile, "utf8") : "";
  spliceSection(existing, ""); // Validate markers before any external installer can change the project.
  const userFiles = new Map<string, Record<string, any>>();
  for (const key of want.keys()) {
    let file: string, field: string, name: string, owned = Object.hasOwn(lock.installed, key);
    if (key.startsWith("plugin:")) { file = ".claude/settings.json"; field = "enabledPlugins"; name = key.slice(7); }
    else if (key.startsWith("marketplace:")) {
      file = ".claude/settings.json"; field = "extraKnownMarketplaces"; name = key.split(":")[1]!;
      owned = Object.keys(lock.installed).some(k => k.startsWith(`marketplace:${name}:`));
    } else if (key.startsWith("mcp:claude-code:")) { file = ".mcp.json"; field = "mcpServers"; name = key.slice(16); }
    else continue;
    if (!userFiles.has(file)) userFiles.set(file, readJson(join(project, file)));
    const entries = userFiles.get(file)![field];
    if (entries !== undefined && (!entries || typeof entries !== "object" || Array.isArray(entries))) throw new CliError(`invalid ${field} in ${file}`, 1, `make ${field} a JSON object, then rerun`);
    if (!owned && Object.hasOwn(entries ?? {}, name)) throw new CliError(`${name} already exists in ${file} and is not managed by loadouts`, 1, `rename or remove the conflicting entry in ${file}, then rerun`);
  }
  const previousLock = existsSync(join(project, "loadouts.lock.json")) ? readLock(project) : null;
  const nativeConfig = lock.harnesses.includes("codex") || existsSync(codexConfigPath(project)) ? prepareCodexConfig(project, lock, want) : null;
  const applyInstallers = await prepareInstallers(project, lock, [...want.keys()]);
  let previous: ReturnType<typeof desired> | null = null, checkRetained = false;
  const changed = previousLock && (JSON.stringify(previousLock.resolved) !== JSON.stringify(lock.resolved) || previousLock.catalog?.commit !== lock.catalog?.commit || JSON.stringify(previousLock.local) !== JSON.stringify(lock.local));
  if (changed && [...want.keys()].some(k => k.startsWith("mcp:") && !added.includes(k))) {
    try { previous = desired(previousLock, await loadedLoadouts(previousLock)); }
    catch { checkRetained = true; } // Missing history requires checking the desired servers, not blocking removal.
  }
  const mcpChecks = [...want].filter(([key, value]) => key.startsWith("mcp:") && (added.includes(key) || checkRetained || (previous && JSON.stringify(previous.get(key)?.mcp) !== JSON.stringify(value.mcp)))).map(([key]) => key);
  const files: string[] = [];
  if (ensureLocalCatalog(project)) files.push(".loadouts/.gitkeep");
  if (opts?.check !== false) for (const key of mcpChecks) {
    const {mcp, itemId} = want.get(key)!;
    const check = await checkMcp(expandProject(mcp!, project));
    if (!check.ok) throw new CliError(`MCP server ${key.split(":")[2]} (${itemId}) is not reachable: ${check.reason}`, 1, "fix the server definition in the catalog or pick another alternative with --with");
  }
  const clearPending = (key: string) => { if (lock.pending) { lock.pending = lock.pending.filter(k => k !== key); if (!lock.pending.length) delete lock.pending; } };
  const written = opts?.beforeApply?.();
  if (written) files.push(written);
  try {
    lock.incomplete = true;
    const configChanged = nativeConfig !== null && (!existsSync(codexConfigPath(project)) || readFileSync(codexConfigPath(project), "utf8") !== nativeConfig);
    if (configChanged) {
      for (const key of want.keys()) {
        if (key.startsWith("mcp:codex:")) lock.installed[key] = [];
        else if (key.startsWith("codex-") && !Object.hasOwn(lock.installed, key)) lock.pending = [...new Set([...lock.pending ?? [], key])];
      }
      writeLock(project, lock);
      if (writeIfChanged(codexConfigPath(project), nativeConfig!)) files.push(".codex/config.toml");
    }
    await syncCodexPlugins(project, lock, [...want.keys()], {update: opts?.updateSkills});
    const nativeLockFile = join(project, "skills-lock.json"), nativeBefore = existsSync(nativeLockFile) ? readFileSync(nativeLockFile, "utf8") : "";
    const missingCompanions = Object.entries(lock.installed).some(([key, names]) => key.startsWith("package-skill:") && missingSkills(project, names, key.split(":")[1] as Harness));
    // Discover and transfer companions while retiring Git ownership is still available.
    await syncPackageSkills(project, lock, loaded);
    if (existsSync(nativeLockFile) && nativeBefore !== readFileSync(nativeLockFile, "utf8")) files.push("skills-lock.json");
    if (missingCompanions) files.push(".agents/skills/");
    for (const key of removed.filter(k => k.startsWith("skill:"))) {
      const h = key.split(":")[1] as Harness;
      const retained = new Set(Object.entries(lock.installed).filter(([k]) => k !== key && k.startsWith(`skill:${h}:`) && want.has(k)).flatMap(([, names]) => names));
      const shared = new Set(Object.entries(lock.installed).filter(([k]) => k !== key && k.startsWith("skill:") && want.has(k)).flatMap(([, names]) => names));
      const names = (lock.installed[key] ?? []).filter(n => !retained.has(n));
      if (h === "claude-code") removeSkillLinks(project, names.filter(n => shared.has(n)));
      await removeSkills(project, names.filter(n => !shared.has(n)), h);
      delete lock.installed[key]; clearPending(key);
    }
    const updated = new Map<string, string[]>();
    for (const key of added.filter(k => k.startsWith("skill:"))) {
      const [, h, identifier] = key.split(":");
      try {
        const installed = await installSkills(project, identifier!, h as Harness, {names: updated.get(identifier!) ?? lock.installed[key], pending: lock.pending?.includes(key), update: opts?.updateSkills && !updated.has(identifier!)});
        updated.set(identifier!, installed);
        lock.installed[key] = [...new Set([...(lock.installed[key] ?? []), ...installed])];
        clearPending(key);
      } catch (e) {
        if (e instanceof CliError && e.installed) lock.installed[key] = [...new Set([...(lock.installed[key] ?? []), ...e.installed])];
        if (e instanceof CliError && e.skillDiscoveryPending) lock.pending = [...new Set([...(lock.pending ?? []), key])];
        else if (e instanceof CliError && e.skillDiscoveryPending === false) clearPending(key);
        throw e;
      }
    }
    for (const key of removed.filter(k => !k.startsWith("skill:") && !k.startsWith("codex-"))) {
      if (applyClaude(project, new Map(), [key])) files.push(key.startsWith("mcp:") ? ".mcp.json" : ".claude/settings.json");
      delete lock.installed[key];
    }
    for (const [key, {mcp}] of want) if (!key.startsWith("installer:") && !key.startsWith("skill:") && !key.startsWith("mcp:codex:") && !key.startsWith("codex-")) {
      if (applyClaude(project, new Map([[key, mcp]]), [])) files.push(key.startsWith("mcp:") ? ".mcp.json" : ".claude/settings.json");
      lock.installed[key] = [];
    }
    if (lock.harnesses.includes("codex") && ensureGitignore(project)) files.push(".gitignore");
    for (const key of want.keys()) if (key.startsWith("mcp:codex:")) lock.installed[key] = [];
    const repairInstallers = missingInstallerArtifacts(project, lock).length > 0;
    await applyInstallers();
    if (repairInstallers) files.push(".loadouts/installers/");
    const guidance = join(project, ".loadouts/installers/codebase-memory.md");
    const section = renderSection(Object.entries(loaded).map(([name, loadout]) => ({loadout, choices: lock.loadouts[name]!})), lock.harnesses, lock.installed, existsSync(guidance) ? readFileSync(guidance, "utf8") : "");
    if ((existing || section) && writeIfChanged(agentsFile, spliceSection(existing, section))) files.push("AGENTS.md");
    if (lock.harnesses.includes("claude-code") && ensureClaudeImport(project)) files.push("CLAUDE.md");
    delete lock.incomplete;
  } finally { if (writeLock(project, lock)) files.push("loadouts.lock.json"); }
  const uniqueFiles = [...new Set(files)];
  const lines = [...added.map(k => paint(`+ ${k}`, "green")), ...removed.map(k => paint(`- ${k}`, "yellow")), ...uniqueFiles.map(f => `${paint("wrote", "green")} ${f}`)];
  console.log(lines.length ? `${lines.join("\n")}\n\n${paint(`${added.length} added, ${removed.length} removed, ${uniqueFiles.length} files written.`, "green")}` : paint("Nothing changed.", "dim"));
  return {added, removed, files: uniqueFiles};
}
export async function install(project: string, opts?: {manifest?: Manifest; update?: boolean; refreshLocal?: string[] | true}): Promise<void> {
  const manifest = opts?.manifest ?? readManifest(project);
  const previous = existsSync(join(project, "loadouts.lock.json")) ? readLock(project) : undefined;
  const lock = await resolveManifest(project, manifest, previous, opts);
  if (opts?.update) for (const [name, entry] of Object.entries(lock.resolved ?? {})) {
    const old = previous?.resolved?.[name]?.catalog;
    if (old && entry.catalog && old.commit !== entry.catalog.commit) console.log(`${paint(name, "blue")}: ${paint(old.ref, "dim")} → ${entry.catalog.ref}`);
  }
  await sync(project, lock, {repair: true, updateSkills: opts?.update, beforeApply: () => { if (opts?.manifest && writeManifest(project, manifest)) return "loadouts.json"; }});
}
export async function projectCommand(command: string, args: ParsedCommand): Promise<number> {
  const {values, positionals} = args;
  const project = requireProject(process.cwd());
  const previous = existsSync(join(project, "loadouts.lock.json")) ? readLock(project) : undefined;
  if (command === "status") {
    const manifest = existsSync(join(project, "loadouts.json")) ? readManifest(project) : null;
    const {harnesses, catalog, loadouts, installed} = previous ?? {harnesses: manifest!.harnesses, catalog: null, loadouts: {}, installed: {}};
    const needsInstall = !previous || !!previous.incomplete || !!previous.pending?.length || !manifest || !manifestMatchesLock(manifest, previous) || missingArtifacts(project, previous).length > 0;
    const sources = Object.fromEntries(Object.keys(loadouts).map(name => [name, Object.hasOwn(previous?.local ?? {}, name) ? "local" : "catalog"]));
    if (values.json) console.log(JSON.stringify({harnesses, catalog, loadouts, installed, sources, manifest, ...(previous?.roots ? {roots: previous.roots, includes: previous.includes} : {}), ...(previous?.packageSkills ? {packageSkills: previous.packageSkills, missingPackages: packageSkillStatus(project, previous).missing} : {}), ...(previous?.incomplete ? {incomplete: true} : {}), ...(needsInstall ? {needsInstall: true} : {})}, null, 2));
    else {
      const names = [...new Set([...Object.keys(manifest?.loadouts ?? {}), ...Object.keys(loadouts)])].sort();
      const rows = names.flatMap(name => {
        const declared = manifest && Object.hasOwn(manifest.loadouts, name) ? manifest.loadouts[name] : undefined, applied = previous?.resolved?.[name];
        const parents = Object.entries(previous?.includes ?? {}).filter(([, edges]) => Object.hasOwn(edges, name)).map(([parent]) => parent);
        return [
          `  ${paint(name, "blue")}  ${paint(declared?.source ?? (parents.length ? applied?.source ?? sources[name]! : "not declared"), "dim")}${previous?.roots ? ` [${declared ? "direct" : parents.length ? "included" : "not declared"}]` : ""}`,
          ...(parents.length ? [`    required by: ${parents.join(", ")}`] : []),
          ...Object.hasOwn(loadouts, name) ? [
            ...(applied?.source !== declared?.source ? [`    applied source: ${applied?.source ?? sources[name]}`] : []),
            ...Object.entries(loadouts[name]!).map(([group, members]) => `    ${group}: ${members.join(", ") || "none"}`),
          ] : [paint("    not installed", "yellow")],
          ...Object.entries(declared?.choices ?? {}).filter(([group, members]) => JSON.stringify(members) !== JSON.stringify(loadouts[name]?.[group])).map(([group, members]) => `    requested ${group}: ${members.join(", ") || "none"}`),
        ];
      });
      console.log([
        `${paint("Harnesses:", "cyan")} ${harnesses.join(", ")}`,
        `${paint("Catalog:", "cyan")} ${catalog ? `${catalog.repo}@${catalog.ref} (${catalog.commit.slice(0, 7)})` : "none"}`,
        ...(manifest && JSON.stringify(manifest.harnesses) !== JSON.stringify(harnesses) ? [`Requested harnesses: ${manifest.harnesses.join(", ")}`] : []),
        "", "Loadouts:", ...rows.length ? rows : ["  none"],
        ...(previous?.incomplete ? [paint("Reconciliation incomplete; run loadouts install.", "yellow")] : []),
        ...(needsInstall ? [paint("Setup needs installation; run loadouts install.", "yellow")] : []),
        ...(previous?.packageSkills ? ["", "Package skills:", ...Object.entries(previous.packageSkills).map(([name, pkg]) => `  ${paint(name, "blue")} ${pkg.version ?? "not installed"} — ${pkg.skills.join(", ") || "none"}\n    required by: ${pkg.requiredBy.join(", ")}`), `Missing packages: ${packageSkillStatus(project, previous).missing.join(", ") || "none"}`] : []),
        "", `Installed: ${Object.keys(installed).length} artifacts`, ...Object.keys(installed).map(key => `  ${paint(key, "dim")}`),
      ].join("\n"));
    }
    return 0;
  }
  const manifest = readManifest(project);
  const refreshLocal: string[] = [];
  const removedChoices: string[] = [];
  const guardIncluded = async (name: string) => {
    if (!Object.hasOwn(manifest.loadouts, name) && previous?.includes && Object.values(previous.includes).some(edges => Object.hasOwn(edges, name))) {
      const paths = loadoutPaths(previous!, name).map(path => path.join(" → ")).join("; ");
      const loaded = await loadedLoadouts(previous!);
      const locations = Object.entries(loaded).flatMap(([owner, definition]) => {
        const declarations = includeDeclarations(definition, previous!.loadouts[owner]!);
        return declarations.filter(declaration => declaration.name === name).map(declaration => `${owner}: ${declaration.path}.choices`);
      });
      throw new CliError(`${name} is included and required by ${paths}`, 2, `edit the declaring parent ${locations.join("; ")}, or add the same source directly: loadouts add ${previous!.resolved![name]!.source}; remove the parent include to release this node`);
    }
  };
  if (command === "add") {
    const original = manifest.loadouts;
    const spec = values.catalog as string | undefined;
    const at = spec?.lastIndexOf("@") ?? -1;
    const repo = spec ? at > 0 ? spec.slice(0, at) : spec : undefined;
    const ref = spec && at > 0 ? spec.slice(at + 1) : undefined;
    for (const input of positionals) {
      const explicit = input.includes(":");
      const name = explicit ? parseSource(input).name : input;
      const source = explicit ? input : !spec && Object.hasOwn(manifest.loadouts, name) ? manifest.loadouts[name]!.source : catalogSource(repo ?? previous?.catalog?.repo ?? readConfig().catalog, name, ref);
      const entry = Object.hasOwn(manifest.loadouts, name) ? manifest.loadouts[name] : undefined;
      manifest.loadouts = {...manifest.loadouts, [name]: {source, ...(entry?.choices ? {choices: entry.choices} : {})}}; refreshLocal.push(name);
    }
    for (const spec of (values.with ?? []) as string[]) {
      const match = /^([^/]+)\/([^=]+)=(.*)$/.exec(spec);
      if (!match) throw new CliError(`invalid --with ${spec}`, 2, "use --with loadout/path/to/group=member[,member]");
      const [, name, group, chosen] = match;
      if (!Object.hasOwn(manifest.loadouts, name!)) throw new CliError(`loadout ${name} is not selected`, 2, `run loadouts add ${name}`);
      const entry = manifest.loadouts[name!]!; entry.choices = {...entry.choices, [group!]: chosen ? chosen.split(",") : []};
    }
    const replacements = Object.entries(manifest.loadouts).filter(([name, entry]) => Object.hasOwn(original, name) && original[name]!.source !== entry.source);
    if (replacements.length) {
      console.error(paint("Warning: replacing selected loadout sources:", "yellow", "stderr"));
      for (const [name, entry] of replacements) console.error(`  ${name}\n    old: ${original[name]!.source}\n    new: ${entry.source}`);
      if (!values.yes) {
        if (!process.stdin.isTTY || !process.stderr.isTTY) throw new CliError("source replacement requires confirmation", 1, "rerun in a terminal to confirm, or pass --yes to approve these replacements");
        const input = createInterface({input: process.stdin, output: process.stderr});
        let confirmed: boolean;
        try {
          confirmed = await new Promise<boolean>(resolve => {
            input.once("close", () => resolve(false));
            input.once("SIGINT", () => resolve(false));
            input.question("Replace these sources? [y/N] ", answer => resolve(/^(y|yes)$/i.test(answer.trim())));
          });
        } finally { input.close(); }
        if (!confirmed) throw new CliError("source replacement cancelled", 1);
      }
    }
  } else if (command === "remove") {
    await guardIncluded(positionals[0]!);
    delete manifest.loadouts[positionals[0]!];
  } else if (command === "harness") {
    const [action, name] = positionals, hs = parseHarnesses(name!);
    if (hs.length !== 1 || !["add", "remove"].includes(action!)) throw new CliError("invalid harness operation", 2, "use loadouts harness add|remove <harness>");
    manifest.harnesses = action === "add" ? [...new Set([...manifest.harnesses, hs[0]!])] : manifest.harnesses.filter(h => h !== hs[0]);
  } else {
    const [path, member] = positionals, slash = path!.indexOf("/");
    const name = path!.slice(0, slash), g = path!.slice(slash + 1);
    if (slash > 0 && g) await guardIncluded(name);
    if (slash < 1 || !g || !Object.hasOwn(manifest.loadouts, name)) throw new CliError(`unknown loaded group ${path}`, 2, "run loadouts status");
    const lock = await resolveManifest(project, manifest, previous, {refreshLocal: []});
    const definition = (await loadedLoadouts(lock))[name]!;
    const group = declaredItems(definition)[g];
    if (!group || !("kind" in group)) throw new CliError(`unknown group ${path}`, 2, `run loadouts show ${name}`);
    if (!Object.hasOwn(lock.loadouts[name]!, g)) resolveChoices(definition, {...lock.loadouts[name]!, [g]: [member!]});
    if ((command === "switch") !== (group.kind === "one_of")) throw new CliError(`wrong command for ${group.kind} group ${path}`, 2, group.kind === "one_of" ? "use loadouts switch" : "use loadouts enable|disable");
    if (!Object.hasOwn(group.members, member!)) throw new CliError(`unknown member ${member}`, 2, `choose one of: ${Object.keys(group.members).join(", ")}`);
    const current = lock.loadouts[name!]![g] ?? group.default;
    const members = command === "switch" ? [member!] : command === "enable" ? [...new Set([...current, member!])] : current.filter(m => m !== member);
    validateChoice(path!, group, members);
    const choices = {...manifest.loadouts[name]!.choices, [g]: members};
    const deselected = current.filter(member => !members.includes(member));
    for (const key of Object.keys(choices)) if (deselected.some(member => key.startsWith(`${g}/${member}/`))) {
      delete choices[key]; removedChoices.push(`${name}/${key}`);
    }
    manifest.loadouts[name]!.choices = choices;
  }
  await install(project, {manifest, refreshLocal});
  if (removedChoices.length) console.log(`Removed inactive descendant requests: ${removedChoices.join(", ")}.`);
  return 0;
}

export async function update(project: string): Promise<void> {
  await install(project, {manifest: readManifest(project), update: true, refreshLocal: []});
}
