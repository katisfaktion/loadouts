import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { CliError } from "./errors";
import type { Harness } from "./loadout";
import type { Lock } from "./lock";
import { writeIfChanged } from "./paths";
import { stringifyCodexConfig } from "./codex";

const id = "codebase-memory", command = "codebase-memory-mcp";
const receiptPath = ".loadouts/installers/codebase-memory.json";
const hookFiles = {"claude-code": ".claude/settings.local.json", codex: ".codex/hooks.json"};
const archived = (path: string) => path.startsWith(".loadouts/codex-home/");
const instructionsPath = ".loadouts/installers/codebase-memory.md";
type Hooks = Record<string, any[]>;
interface Receipt { version: string; binary: string; identity: string; harnesses: Harness[]; files: Record<string, string>; hooks: Record<string, Hooks>; indexedRoot?: string; pending?: boolean; previousFiles?: Record<string, string>; previousHooks?: Record<string, Hooks> }
const hash = (text: string) => new Bun.CryptoHasher("sha256").update(text).digest("hex");
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const object = (v: any) => v && typeof v === "object" && !Array.isArray(v);
function failure(message: string): never { throw new CliError(message, 1, "restore or move the conflicting project file, then run loadouts install"); }
function safePath(project: string, relative: string): string {
  if (relative.startsWith("/") || relative.split(/[\\/]/).some(p => !p || p === "." || p === "..")) failure(`unsafe installer path ${relative}`);
  let path = project;
  for (const part of relative.split("/")) {
    path = join(path, part);
    if (lstatSync(path, {throwIfNoEntry: false})?.isSymbolicLink()) failure(`installer path is a symlink: ${relative}`);
  }
  return path;
}
function assetPath(path: string): boolean {
  return /^(?:\.claude|\.codex|\.agents|\.loadouts\/codex-home)\/(?:skills\/codebase-memory\/.+|agents\/codebase-memory(?:-scout|-auditor)?\.(?:md|toml))$/.test(path) || path === ".loadouts/codex-home/AGENTS.md" || path === instructionsPath;
}
function receipt(project: string): Receipt | null {
  const file = safePath(project, receiptPath);
  if (!existsSync(file)) return null;
  try {
    const r = JSON.parse(readFileSync(file, "utf8"));
    if (!object(r) || !["version", "binary", "identity"].every(k => typeof r[k] === "string") || !Array.isArray(r.harnesses) || r.harnesses.some((h: string) => !["claude-code", "codex"].includes(h)) || !object(r.files) || !object(r.hooks) || (r.indexedRoot !== undefined && typeof r.indexedRoot !== "string")) throw new Error();
    if (r.pending !== undefined && r.pending !== true || r.previousFiles !== undefined && !object(r.previousFiles) || r.previousHooks !== undefined && !object(r.previousHooks)) throw new Error();
    for (const entries of [r.files, r.previousFiles ?? {}]) for (const [path, digest] of Object.entries(entries)) if (!assetPath(path) || !/^[a-f0-9]{64}$/.test(String(digest))) throw new Error();
    for (const entries of [r.hooks, r.previousHooks ?? {}]) for (const [path, hooks] of Object.entries(entries)) if (![...Object.values(hookFiles), ".loadouts/codex-home/hooks.json"].includes(path) || !object(hooks) || Object.values(hooks as object).some(v => !Array.isArray(v))) throw new Error();
    return r;
  } catch { return failure(`invalid installer receipt ${receiptPath}`); }
}
function readHooks(project: string, path: string): Record<string, any> {
  const file = safePath(project, path);
  try {
    const value = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
    if (!object(value) || (value.hooks !== undefined && (!object(value.hooks) || Object.values(value.hooks).some(v => !Array.isArray(v))))) throw new Error();
    return value;
  } catch { return failure(`invalid hooks in ${path}`); }
}
export function checkInstallerPrerequisites(keys: string[]): void {
  if (keys.some(k => k.startsWith("installer:")) && !Bun.which(command)) throw new CliError(`${command} not found on PATH`, 3, "install codebase-memory-mcp using https://github.com/DeusData/codebase-memory-mcp#quick-start, then rerun loadouts install; an existing installation is reused");
}
async function run(binary: string, args: string[], project: string, env = process.env): Promise<string> {
  const p = Bun.spawn([binary, ...args], {cwd: project, env, stdin: "ignore", stdout: "pipe", stderr: "pipe"});
  const [code, stdout, stderr] = await Promise.all([p.exited, new Response(p.stdout).text(), new Response(p.stderr).text()]);
  if (code) throw new CliError(`${command} ${args[0]} failed: ${stderr.trim() || stdout.trim()}`, 1, "check the existing codebase-memory installation, then rerun loadouts install; shared services and indexes are retained");
  return stdout.trim();
}
function normalizedHooks(value: any): Hooks {
  if (!object(value) || !Object.keys(value).length) throw new CliError("codebase-memory installer did not produce hooks", 1, "use a supported codebase-memory-mcp release and rerun loadouts install");
  for (const entries of Object.values(value) as any[]) {
    if (!Array.isArray(entries)) failure("invalid native installer hooks");
    for (const entry of entries) {
      if (!Array.isArray(entry.hooks)) failure("invalid native installer hook entry");
      for (const hook of entry.hooks) {
        if (hook.type !== "command" || !(String(hook.command).includes("hook-augment") || equal(hook.args, ["hook-augment"]))) failure("unsupported codebase-memory hook command");
        hook.command = `${command} hook-augment`;
        if (hook.command_windows) hook.command_windows = `${command} hook-augment`;
        delete hook.args;
      }
    }
  }
  return value;
}
async function generate(project: string, binary: string, harnesses: Harness[]): Promise<{files: Record<string, string>; hooks: Record<string, Hooks>}> {
  const stage = mkdtempSync(join(tmpdir(), "loadouts-installer-")), files: Record<string, string> = {}, hooks: Record<string, Hooks> = {};
  try {
    const env: Record<string, string> = {};
    for (const key of ["PATH", "SystemRoot", "SYSTEMROOT", "WINDIR", "TEMP", "TMP", "TMPDIR"]) if (process.env[key]) env[key] = process.env[key]!;
    Object.assign(env, {HOME: stage, USERPROFILE: stage, CODEX_HOME: join(stage, ".codex"), CLAUDE_CONFIG_DIR: join(stage, ".claude"), XDG_CONFIG_HOME: join(stage, ".config"), XDG_CACHE_HOME: join(stage, ".cache"), CBM_CACHE_DIR: join(stage, ".cache/codebase-memory-mcp"), CBM_RUNTIME_DIR: join(stage, "runtime")});
    mkdirSync(env.CBM_RUNTIME_DIR!);
    for (const h of harnesses) mkdirSync(join(stage, h === "codex" ? ".codex" : ".claude"));
    await run(binary, ["install", "--skip-binary", `--dir=${dirname(binary)}`, `--clients=${harnesses.map(h => h === "codex" ? "codex" : "claude").join(",")}`, "-n"], project, env);
    const collect = (from: string, to: string) => {
      if (!lstatSync(from).isDirectory()) failure(`unsupported native installer directory ${from}`);
      for (const entry of readdirSync(from, {withFileTypes: true})) {
        const path = join(from, entry.name), destination = `${to}/${entry.name}`;
        if (entry.isDirectory()) collect(path, destination);
        else if (entry.isFile()) files[destination] = readFileSync(path, "utf8");
        else failure(`unsupported native installer asset ${path}`);
      }
    };
    for (const h of harnesses) {
      const from = join(stage, h === "codex" ? ".codex" : ".claude"), to = h === "codex" ? ".codex" : ".claude";
      // Newer upstream versions use the shared user skill root even with CODEX_HOME.
      const skill = [join(from, "skills", id), join(stage, ".agents/skills", id)].find(p => existsSync(join(p, "SKILL.md")));
      if (!skill) throw new CliError(`codebase-memory installer did not produce its ${h} skill`, 1, "check upstream installer compatibility, then rerun loadouts install");
      collect(skill, `${h === "codex" ? ".agents" : to}/skills/${id}`);
      for (const name of [id, `${id}-scout`, `${id}-auditor`]) {
        const nameWithExtension = `${name}.${h === "codex" ? "toml" : "md"}`, path = join(from, "agents", nameWithExtension);
        if (!lstatSync(path, {throwIfNoEntry: false})?.isFile()) failure(`installer did not produce ${h} agent ${name}`);
        let text = readFileSync(path, "utf8");
        if (h === "codex") {
          const profile = Bun.TOML.parse(text) as any;
          if (!object(profile.mcp_servers?.[command])) failure(`installer agent ${name} is missing its MCP server`);
          profile.mcp_servers[command].command = command;
          text = stringifyCodexConfig(profile);
        }
        files[`${to}/agents/${nameWithExtension}`] = text;
      }
      if (h === "codex") {
        const config = Bun.TOML.parse(readFileSync(join(from, "config.toml"), "utf8")) as any;
        const hookFile = join(from, "hooks.json");
        hooks[hookFiles[h]] = normalizedHooks(existsSync(hookFile) ? JSON.parse(readFileSync(hookFile, "utf8")).hooks : config.hooks);
        if (existsSync(join(from, "AGENTS.md"))) files[instructionsPath] = readFileSync(join(from, "AGENTS.md"), "utf8");
      } else hooks[hookFiles[h]] = normalizedHooks(JSON.parse(readFileSync(join(from, "settings.json"), "utf8")).hooks);
    }
    return {files, hooks};
  } finally { rmSync(stage, {recursive: true, force: true}); }
}
function hookUpdates(project: string, previous: Record<string, Hooks>, desired: Record<string, Hooks>): Map<string, string> {
  const updates = new Map<string, string>();
  for (const path of new Set([...Object.keys(previous), ...Object.keys(desired)])) {
    const data = readHooks(project, path);
    data.hooks ??= {};
    for (const event of new Set([...Object.keys(previous[path] ?? {}), ...Object.keys(desired[path] ?? {})])) {
      const next = desired[path]?.[event] ?? [], old = previous[path]?.[event] ?? next, current: any[] = data.hooks[event] ?? [];
      const retained = current.filter(entry => !old.some(owned => equal(owned, entry)));
      if (retained.some(entry => JSON.stringify(entry).includes(command))) failure(`unmanaged or modified codebase-memory hooks in ${path}`);
      const entries = [...retained, ...next];
      if (entries.length) data.hooks[event] = entries; else delete data.hooks[event];
    }
    updates.set(path, JSON.stringify(data, null, 2) + "\n");
  }
  return updates;
}
export function missingInstallerArtifacts(project: string, lock: Lock): string[] {
  if (!Object.keys(lock.installed).some(k => k.startsWith("installer:"))) return [];
  try {
    const r = receipt(project);
    if (!r || [...Object.keys(r.files), ...Object.keys(r.hooks)].some(archived) || r.pending || r.indexedRoot !== resolve(project) || !Bun.which(command)) return ["installer:codebase-memory (run loadouts install)"];
    const missing = Object.entries(r.files).filter(([path, digest]) => { const file = safePath(project, path); return !existsSync(file) || hash(readFileSync(file, "utf8")) !== digest; }).map(([path]) => path);
    for (const [path, hooks] of Object.entries(r.hooks)) {
      const actual = readHooks(project, path).hooks ?? {};
      if (Object.entries(hooks).some(([event, entries]) => entries.some(entry => !(actual[event] ?? []).some((v: any) => equal(v, entry))))) missing.push(path);
    }
    return missing;
  } catch (error) { return [String(error)]; }
}
export async function syncInstallers(project: string, lock: Lock, keys: string[]): Promise<void> {
  await (await prepareInstallers(project, lock, keys))();
}
export async function prepareInstallers(project: string, lock: Lock, keys: string[]): Promise<() => Promise<void>> {
  const harnesses = (["claude-code", "codex"] as Harness[]).filter(h => keys.includes(`installer:${h}:${id}`));
  const previous = receipt(project);
  if (!harnesses.length && !previous) return async () => {};
  const legacy = previous && [...Object.keys(previous.files), ...Object.keys(previous.hooks)].some(archived);
  checkInstallerPrerequisites(keys);
  const binary = harnesses.length ? Bun.which(command)! : "";
  const version = harnesses.length ? (await run(binary, ["--version"], project)).match(/^codebase-memory-mcp\s+(\S+)$/)?.[1] : undefined;
  if (harnesses.length && !version) throw new CliError("cannot identify codebase-memory-mcp version", 1, "check codebase-memory-mcp --version, then rerun loadouts install");
  const identity = binary ? `${binary}:${realpathSync(binary)}:${statSync(binary).size}:${statSync(binary).mtimeMs}` : "";
  const owned = (path: string, digest: string) => previous?.files[path] === digest || previous?.pending && previous.previousFiles?.[path] === digest;
  const checkSkillOwners = () => {
    if (!harnesses.length) return;
    if (keys.some(k => k.startsWith("skill:") && (k.split(":")[2]?.split("@")[1] === id || lock.installed[k]?.includes(id))) || Object.entries(lock.installed).some(([k, names]) => k.startsWith("package-skill:") && names.includes(id))) {
      throw new CliError("codebase-memory installer conflicts with a separately selected codebase-memory skill", 1, "select either the installer or the standalone skill in your loadouts, then run loadouts install");
    }
  };
  checkSkillOwners();
  const intact = previous && Object.entries(previous.files).every(([path, digest]) => {
    const file = safePath(project, path);
    if (!existsSync(file)) return false;
    if (!owned(path, hash(readFileSync(file, "utf8")))) failure(`modified installer asset ${path}`);
    return true;
  });
  let next = {files: {} as Record<string, string>, hooks: {} as Record<string, Hooks>};
  if (harnesses.length) next = intact && !legacy && !previous!.pending && previous!.identity === identity && previous!.version === version && equal(previous!.harnesses, harnesses)
    ? {files: Object.fromEntries(Object.keys(previous!.files).map(path => [path, readFileSync(safePath(project, path), "utf8")])), hooks: previous!.hooks}
    : await generate(project, binary, harnesses);
  const checkFiles = () => {
    for (const path of new Set([...Object.keys(previous?.files ?? {}), ...Object.keys(previous?.previousFiles ?? {}), ...Object.keys(next.files)])) {
      const file = safePath(project, path);
      if (existsSync(file) && !owned(path, hash(readFileSync(file, "utf8"))) && readFileSync(file, "utf8") !== next.files[path]) failure(`unmanaged or modified installer asset ${path}`);
    }
  };
  checkFiles();
  const oldHooks = structuredClone(previous?.hooks ?? {});
  if (previous?.pending) for (const [path, events] of Object.entries(previous.previousHooks ?? {})) for (const [event, entries] of Object.entries(events)) {
    oldHooks[path] ??= {}; oldHooks[path]![event] = [...oldHooks[path]![event] ?? [], ...entries];
  }
  for (const path of Object.keys(oldHooks)) if (archived(path)) delete oldHooks[path];
  const hooks = hookUpdates(project, oldHooks, next.hooks);
  const file = safePath(project, receiptPath);
  const current: Receipt = {version: version ?? previous!.version, binary, identity, harnesses, files: Object.fromEntries(Object.entries(next.files).map(([path, text]) => [path, hash(text)])), hooks: next.hooks, ...(previous?.indexedRoot ? {indexedRoot: previous.indexedRoot} : {})};
  // Keep ownership before writes so interrupted reconciliation can safely retry.
  const applying = Object.entries(next.files).some(([path, text]) => !existsSync(safePath(project, path)) || readFileSync(safePath(project, path), "utf8") !== text) ||
    [...hooks].some(([path, text]) => !existsSync(safePath(project, path)) || readFileSync(safePath(project, path), "utf8") !== text) ||
    Object.keys(previous?.files ?? {}).some(path => !Object.hasOwn(next.files, path));
  return async () => {
    checkSkillOwners();
    checkFiles();
    const currentHooks = hookUpdates(project, oldHooks, next.hooks);
    if (applying) writeIfChanged(file, JSON.stringify({...current, pending: true, previousFiles: {...previous?.files, ...previous?.previousFiles}, previousHooks: oldHooks, files: {...previous?.files, ...current.files}}, null, 2) + "\n");
    for (const [path, text] of Object.entries(next.files)) writeIfChanged(safePath(project, path), text);
    for (const [path, text] of currentHooks) writeIfChanged(safePath(project, path), text);
    for (const path of new Set([...Object.keys(previous?.files ?? {}), ...Object.keys(previous?.previousFiles ?? {})])) if (!archived(path) && !Object.hasOwn(next.files, path) && existsSync(safePath(project, path))) unlinkSync(safePath(project, path));
    if (!harnesses.length) {
      unlinkSync(file); if (lock.installers) delete lock.installers[id];
      return;
    }
    writeIfChanged(file, JSON.stringify(current, null, 2) + "\n");
    lock.installers = {...lock.installers, [id]: {version: version!}};
    for (const h of harnesses) lock.installed[`installer:${h}:${id}`] = [];
    if (current.indexedRoot !== resolve(project)) {
      await run(binary, ["cli", "index_repository", "--repo-path", resolve(project)], project);
      current.indexedRoot = resolve(project);
      writeIfChanged(file, JSON.stringify(current, null, 2) + "\n");
    }
    const ignored = [".loadouts/installers/", ".claude/settings.local.json", ".claude/skills/codebase-memory/", ".claude/agents/codebase-memory*.md"];
    const ignore = safePath(project, ".gitignore"), text = existsSync(ignore) ? readFileSync(ignore, "utf8") : "";
    const extra = ignored.filter(line => !text.split(/\r?\n/).includes(line));
    if (extra.length) writeIfChanged(ignore, text + (text && !text.endsWith("\n") ? "\n" : "") + extra.join("\n") + "\n");
  };
}
