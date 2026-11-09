import { existsSync, lstatSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { home, writeIfChanged } from "./paths";
import type { McpServer } from "./loadout";
import type {Lock} from "./lock";
import { CliError } from "./errors";

export function codexConfigPath(project: string): string { return join(resolve(project), ".codex/config.toml"); }
export function codexUserHome(): string { return resolve(process.env.CODEX_HOME || join(home(), ".codex")); }
export function expandProject(s: McpServer, project: string): McpServer {
  const expand = (v: string) => v.replaceAll("{project}", resolve(project));
  const expanded: McpServer = {
    ...(s.command !== undefined ? {command: expand(s.command)} : {}),
    ...(s.args !== undefined ? {args: s.args.map(expand)} : {}),
    ...(s.env !== undefined ? {env: Object.fromEntries(Object.entries(s.env).map(([k, v]) => [k, expand(v)]))} : {}),
    ...(s.url !== undefined ? {url: expand(s.url)} : {}),
  };
  // Isolate npm project checks while preserving the MCP server's working directory.
  if (/(^|[\\/])npx(?:\.cmd)?$/i.test(expanded.command ?? "") && !expanded.url) expanded.args = ["--prefix", ".loadouts", ...(expanded.args ?? [])];
  return expanded;
}
export function ensureGitignore(project: string): boolean {
  const file = join(project, ".gitignore"), text = existsSync(file) ? readFileSync(file, "utf8") : "";
  let updated = text.replace(/^\/?\.loadouts\/(?=\r?$)/gm, ".loadouts/codex-home/");
  if (!updated.split(/\r?\n/).some(line => line === ".loadouts/codex-home/" || line === "/.loadouts/codex-home/")) updated += (updated && !updated.endsWith("\n") ? "\n" : "") + ".loadouts/codex-home/\n";
  return writeIfChanged(file, updated);
}
export function stringifyCodexValue(v: any): string {
  return Array.isArray(v) ? `[${v.map(stringifyCodexValue).join(", ")}]` : v !== null && typeof v === "object" ? `{ ${Object.entries(v).map(([k, value]) => `${JSON.stringify(k)} = ${stringifyCodexValue(value)}`).join(", ")} }` : JSON.stringify(v);
}
export function stringifyCodexConfig(config: Record<string, any>): string {
  const table = (value: any) => value !== null && typeof value === "object" && !Array.isArray(value);
  const lines: string[] = [];
  const emit = (entries: Record<string, any>, path: string[]) => {
    if (path.length) lines.push(`[${path.map(k => JSON.stringify(k)).join(".")}]`);
    for (const [k, v] of Object.entries(entries)) if (!table(v)) lines.push(`${JSON.stringify(k)} = ${stringifyCodexValue(v)}`);
    for (const [k, v] of Object.entries(entries)) if (table(v)) emit(v, [...path, k]);
  };
  // Native Codex edits require real tables; editing inline tables drops siblings.
  emit(config, []);
  return lines.join("\n") + "\n";
}
export function prepareCodexConfig(project: string, lock: Lock, artifacts: Map<string, {itemId: string; mcp: McpServer | null}>): string {
  const file = codexConfigPath(project);
  for (const path of [join(project, ".codex"), file]) if (lstatSync(path, {throwIfNoEntry: false})?.isSymbolicLink()) throw new CliError(`Codex configuration path is a symlink: ${path}`, 1, "use ordinary project files before running loadouts install");
  const read = (path: string): Record<string, any> => {
    try { return existsSync(path) ? Bun.TOML.parse(readFileSync(path, "utf8")) : {}; }
    catch { throw new CliError(`invalid TOML in ${path}`, 1, "repair the Codex configuration, then rerun"); }
  };
  const config = read(file), original = stringifyCodexConfig(config);
  const object = (value: any) => value !== null && typeof value === "object" && !Array.isArray(value);
  for (const field of ["mcp_servers", "marketplaces", "plugins"]) if (config[field] !== undefined && (!object(config[field]) || Object.values(config[field]).some(v => !object(v)))) throw new CliError(`invalid ${field} in ${file}`, 1, "use TOML tables for Codex entries, then rerun");
  const owned = [...new Set([...Object.keys(lock.installed), ...lock.pending ?? []])];
  const entry = (key: string): [string, string] | null => key.startsWith("mcp:codex:") ? ["mcp_servers", key.slice(10)] : key.startsWith("codex-plugin:") ? ["plugins", key.slice(13)] : key.startsWith("codex-marketplace:") ? ["marketplaces", key.split(":")[1]!] : null;
  const wanted = new Map<string, any>();
  for (const [key, artifact] of artifacts) {
    const target = entry(key); if (!target) continue;
    const [field, name] = target, current = Object.hasOwn(config[field] ?? {}, name) ? config[field][name] : undefined;
    const isOwned = owned.some(k => { const e = entry(k); return e?.[0] === field && e[1] === name; });
    let value: any;
    if (field === "mcp_servers") value = {...(isOwned ? Object.fromEntries(Object.entries(current ?? {}).filter(([k]) => !["command", "args", "env", "url"].includes(k))) : {}), ...expandProject(artifact.mcp!, project)};
    else if (field === "plugins") value = {...(isOwned ? current : {}), enabled: true};
    else value = {...(isOwned ? current : {}), source_type: "git", source: `https://github.com/${key.split(":")[2]}.git`};
    const id = `${field}:${name}`;
    if (wanted.has(id) && JSON.stringify(wanted.get(id)) !== JSON.stringify(value)) throw new CliError(`conflicting Codex marketplace sources for ${name}`, 1, "use one repository per marketplace name");
    const stable = (v: any) => JSON.stringify(v, (_k, x) => object(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b))) : x);
    if (current !== undefined && !isOwned && stable(current) !== stable(value)) throw new CliError(`${name} already exists in ${file} and is not managed by loadouts`, 1, "resolve the conflicting entry without losing your settings, then rerun");
    wanted.set(id, value);
  }
  for (const key of owned) {
    const target = entry(key); if (!target) continue;
    const [field, name] = target;
    if (!wanted.has(`${field}:${name}`) && config[field]) delete config[field][name];
  }
  for (const [id, value] of wanted) {
    const [field, name] = id.split(":");
    config[field!] = {...config[field!], [name!]: value};
  }
  const result = stringifyCodexConfig(config);
  return result === original && existsSync(file) ? readFileSync(file, "utf8") : result;
}
