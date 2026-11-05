import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { readManifest, manifestMatchesLock } from "./manifest";
import { readLock } from "./lock";
import { loadedLoadouts, desired, missingArtifacts } from "./sync";
import { scanGlobals, readJson } from "./globals";
import { artifactsFor, parseLoadout } from "./loadout";
import { localNames, readLocal } from "./local";
import { listLoadouts, openCatalog } from "./catalog";
import { readConfig } from "./config";
import { listSkills } from "./skills";
import { checkMcp } from "./mcpcheck";
import { codexConfigPath, codexUserHome, expandProject } from "./codex";

import { home } from "./paths";

import { packageSkillStatus } from "./package-skills";

export interface Finding { kind: "global" | "conflict" | "mcp" | "auth" | "local"; message: string; fix: string }
export async function doctor(project: string): Promise<Finding[]> {
  const manifest = existsSync(join(project, "loadouts.json")) ? readManifest(project) : null;
  const applied = existsSync(join(project, "loadouts.lock.json")) ? readLock(project) : null;
  const lock = applied ? applied : {harnesses: readManifest(project).harnesses, catalog: null, loadouts: {}, installed: {}} as import("./lock").Lock;
  const findings: Finding[] = [];
  if (!applied) findings.push({kind: "local", message: "loadouts.json is declared but not installed", fix: "loadouts install"});
  else if (!manifest || !manifestMatchesLock(manifest, applied)) findings.push({kind: "local", message: "loadouts.json does not match the applied setup", fix: "loadouts install"});
  const locals = [...new Set([...localNames(project), ...Object.keys(lock.local ?? {})])];
  if (lock.incomplete || lock.pending?.length) findings.push({kind: "local", message: "Project reconciliation is incomplete; the saved definitions are not fully applied", fix: "loadouts install"});
  const catalogs = [...new Map([lock.catalog, ...Object.values(lock.resolved ?? {}).map(r => r.catalog)].filter(c => c != null).map(c => [c.repo + "@" + c.commit, c])).values()];
  const shared = new Map<string, string[]>();
  if (locals.length) {
    try { if (!catalogs.length) catalogs.push(await openCatalog(readConfig().catalog)); }
    catch (error) { findings.push({kind: "local", message: `Cannot check shared catalog collisions: ${String(error)}`, fix: "check the configured catalog and Git access, then rerun loadouts doctor"}); }
    for (const catalog of catalogs) {
      try { for (const name of await listLoadouts(catalog)) shared.set(name, [...shared.get(name) ?? [], `${catalog.repo}@${catalog.ref}`]); }
      catch (error) { findings.push({kind: "local", message: `Cannot check shared catalog collisions: ${String(error)}`, fix: "restore access to the pinned catalog, then rerun loadouts doctor"}); }
    }
  }
  for (const name of locals) {
    const file = `.loadouts/catalog/${name}.yml`, snapshot = Object.hasOwn(lock.local ?? {}, name) ? lock.local![name] : undefined;
    let yaml: string | null;
    try { yaml = readLocal(project, name); }
    catch (error) { findings.push({kind: "local", message: `Cannot read ${file}: ${String(error)}`, fix: `repair ${file}`}); continue; }
    if (yaml === null) {
      findings.push({kind: "local", message: `${file} is missing; the saved local definition remains selected`, fix: `restore ${file} or run loadouts remove ${name}`}); continue;
    }
    if (shared.has(name)) findings.push({kind: "local", message: `${name} exists in ${file} and ${shared.get(name)!.join(", ")}. The manifest selects an explicit source; local files do not override it. Declared source: ${manifest?.loadouts[name]?.source ?? "none"}. ${Object.hasOwn(lock.loadouts, name) ? `Applied source: ${snapshot !== undefined ? "local" : "catalog"}.` : "Not applied."}`, fix: `select file:./${file} explicitly with loadouts add, or keep the shared source`});
    try { parseLoadout(yaml, name + ".yml"); }
    catch (error) { findings.push({kind: "local", message: `${file} is invalid: ${String(error)}`, fix: `correct ${file}, then run loadouts install`}); continue; }
    if (snapshot !== undefined && yaml !== snapshot) findings.push({kind: "local", message: `${file} differs from its last-applied definition`, fix: "loadouts install"});
  }
  if (!applied) return findings;
  for (const name of packageSkillStatus(project, applied).missing) findings.push({kind: "local", message: `Package ${name} is not installed; its companion skills are unavailable`, fix: "install project dependencies, then run loadouts install"});
  for (const artifact of missingArtifacts(project, applied)) findings.push({kind: "local", message: `Installed artifact is missing, disabled or unreadable: ${artifact}`, fix: "loadouts install"});
  let loaded: Awaited<ReturnType<typeof loadedLoadouts>>, want: ReturnType<typeof desired>;
  try { loaded = await loadedLoadouts(lock); want = desired(lock, loaded); }
  catch (error) {
    findings.push({kind: "local", message: `Cannot check applied definitions; artifact, conflict and MCP checks were skipped: ${String(error)}`, fix: "restore access to the pinned catalog and check the lock selections, then rerun loadouts doctor"});
    return findings;
  }
  const [global, skills] = await Promise.all([scanGlobals(), listSkills({global: false, cwd: project})]);
  const plugins = {...readJson(join(project, ".claude/settings.json")).enabledPlugins, ...readJson(join(project, ".claude/settings.local.json")).enabledPlugins};
  const codexFile = codexConfigPath(project);
  let codexPlugins: Record<string, any> = {}, codexMcp: Record<string, any> = {};
  try { if (existsSync(codexFile)) { const config = Bun.TOML.parse(readFileSync(codexFile, "utf8")) as any; codexPlugins = config.plugins ?? {}; codexMcp = config.mcp_servers ?? {}; } }
  catch { findings.push({kind: "local", message: `Invalid TOML in ${codexFile}`, fix: "repair the generated Codex config, then rerun loadouts doctor"}); }
  for (const [key, value] of want) if (key.startsWith("codex-plugin:") && codexPlugins[key.slice(13)]?.enabled !== true) findings.push({kind: "local", message: `Codex plugin ${key.slice(13)} is missing or disabled in project configuration`, fix: `loadouts add ${value.itemId.split("/")[0]}`});
  const claudeMcp = {...readJson(join(project, ".mcp.json")).mcpServers, ...readJson(join(home(), ".claude.json")).projects?.[project]?.mcpServers};
  for (const [name, l] of Object.entries(loaded)) for (const [groupName, group] of Object.entries(l.items)) if ("kind" in group && group.kind === "one_of") {
    const chosen = lock.loadouts[name]![groupName] ?? group.default;
    for (const [member, item] of Object.entries(group.members)) {
      if (chosen.includes(member)) continue;
      const keys = lock.harnesses.flatMap(h => [...artifactsFor({id: `${name}/${groupName}/${member}`, item}, h).keys()]);
      const present = keys.some(key => {
        if (key.startsWith("codex-plugin:")) return (codexPlugins[key.slice(13)]?.enabled ?? global.codexPlugins.includes(key.slice(13))) === true;
        if (key.startsWith("plugin:")) return (plugins[key.slice(7)] ?? global.claudePlugins.includes(key.slice(7))) === true;
        if (key.startsWith("mcp:")) {
          const [, h, server] = key.split(":");
          const config = h === "codex" ? codexMcp : claudeMcp, inherited = h === "codex" ? global.codexMcp : global.claudeMcp;
          return Object.hasOwn(config, server!) ? config[server!]?.enabled !== false : inherited.includes(server!);
        }
        if (key.startsWith("skill:")) {
          const [repo, skill] = key.split(":")[2]!.split("@");
          return [...skills, ...global.npxSkills].some(s => s.source === repo && (!skill || s.name === skill));
        }
        return false;
      });
      if (present) findings.push({kind: "conflict", message: `${name}/${groupName}: non-selected alternative ${member} is installed`, fix: `loadouts switch ${name}/${groupName} ${member}, or remove the non-selected installation`});
    }
  }
  for (const h of lock.harnesses) {
    const user = h === "codex" ? join(codexUserHome(), "hooks.json") : join(process.env.CLAUDE_CONFIG_DIR || join(home(), ".claude"), "settings.json");
    const projects = h === "codex" ? [join(project, ".codex/hooks.json")] : [join(project, ".claude/settings.json"), join(project, ".claude/settings.local.json")];
    const events = (file: string) => Object.entries(readJson(file).hooks ?? {}).filter(([, entries]) => Array.isArray(entries) && entries.some(entry => Array.isArray(entry?.hooks) && entry.hooks.some((hook: any) => hook.type === "command" && typeof hook.command === "string" && /(?:^|[\s/])codebase-memory-mcp(?:[\s"']|$)/.test(hook.command)))).map(([event]) => event);
    const inherited = events(user);
    for (const file of projects) if (events(file).some(event => inherited.includes(event))) findings.push({kind: "conflict", message: `codebase-memory hooks in ${user} and ${file} may run twice under ${h} native inheritance`, fix: "review both hook scopes and choose which should run; loadouts does not change personal hooks or grant hook trust"});
  }
  const mcpFindings = await Promise.all([...want].filter(([k]) => k.startsWith("mcp:")).map(async ([key, value]): Promise<Finding | null> => {
    const result = await checkMcp(expandProject(value.mcp!, project));
    return result.ok ? null : {kind: "mcp", message: `${key}: ${result.reason}`, fix: "repair the MCP server definition or disable the item, then rerun loadouts doctor"};
  }));
  findings.push(...mcpFindings.filter((f): f is Finding => f !== null));
  return findings;
}
