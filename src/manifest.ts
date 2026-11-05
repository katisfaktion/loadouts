import { existsSync, lstatSync, readFileSync, readdirSync, mkdirSync, copyFileSync, unlinkSync, constants } from "node:fs";
import { join } from "node:path";
import { CliError } from "./errors";
import { writeIfChanged } from "./paths";
import { openCatalog, readLoadout, type CatalogRef } from "./catalog";
import { defaultChoices, parseLoadout, type Choices, type Harness } from "./loadout";
import { readLock, writeLock, type Lock } from "./lock";

export interface Manifest { harnesses: Harness[]; loadouts: Record<string, {source: string; choices?: Choices}> }
type ParsedSource = {kind: "file"; name: string; path: string} | {kind: "catalog"; name: string; repo: string; ref?: string};
const namePattern = /^[A-Za-z0-9_-][A-Za-z0-9_.-]*$/;
const object = (v: any): v is Record<string, any> => v !== null && typeof v === "object" && !Array.isArray(v);
export function fileSource(name: string): string { return `file:./.loadouts/catalog/${name}.yml`; }
export function catalogSource(repo: string, name: string, ref?: string): string {
  const source = repo.startsWith("/") ? `file:${repo}#${name}` : `github:${repo}/${name}`;
  const result = source + (ref ? `@${ref}` : ""); parseSource(result); return result;
}
export function parseSource(source: string): ParsedSource {
  if (typeof source === "string") {
    const file = /^file:\.\/\.loadouts\/catalog\/([A-Za-z0-9_-][A-Za-z0-9_.-]*)\.yml$/.exec(source);
    if (file) return {kind: "file", name: file[1]!, path: source.slice(7)};
    const github = /^github:([A-Za-z0-9_-][\w.-]*\/[A-Za-z0-9_-][\w.-]*)\/([A-Za-z0-9_-][\w.-]*)(?:@([^\s@#]+))?$/.exec(source);
    const localGit = /^file:(\/[^#@]+)#([A-Za-z0-9_-][\w.-]*)(?:@([^\s@#]+))?$/.exec(source);
    const match = github ?? localGit;
    if (match) return {kind: "catalog", repo: match[1]!, name: match[2]!, ...(match[3] ? {ref: match[3]} : {})};
  }
  throw new CliError(`invalid loadout source ${source}`, 2, "use file:./.loadouts/catalog/<name>.yml or github:owner/repo/<name>[@ref]");
}
export function validateManifest(value: unknown): Manifest {
  if (!object(value) || Object.keys(value).some(k => !["$schema", "harnesses", "loadouts"].includes(k)) || (value.$schema !== undefined && typeof value.$schema !== "string") || !Array.isArray(value.harnesses) || value.harnesses.some(h => !["claude-code", "codex"].includes(h)) || new Set(value.harnesses).size !== value.harnesses.length || !object(value.loadouts)) throw new CliError("invalid loadouts.json", 1, "declare harnesses and a loadouts object with explicit sources; run loadouts help install");
  for (const [name, entry] of Object.entries(value.loadouts)) {
    if (!namePattern.test(name) || !object(entry) || Object.keys(entry).some(k => !["source", "choices"].includes(k)) || parseSource(entry.source).name !== name || (entry.choices !== undefined && (!object(entry.choices) || Object.entries(entry.choices).some(([g, members]) => !namePattern.test(g) || !Array.isArray(members) || members.some(m => typeof m !== "string" || !namePattern.test(m)) || new Set(members).size !== members.length)))) throw new CliError(`invalid loadouts.json entry ${name}`, 1, "match the source name to its key and use choices as group-to-member arrays");
  }
  return value as unknown as Manifest;
}
export function readManifest(project: string): Manifest {
  const file = join(project, "loadouts.json");
  if (!existsSync(file)) throw new CliError("no loadouts.json here", 2, "run loadouts init to initialize or migrate this project");
  let value: unknown;
  try { value = JSON.parse(readFileSync(file, "utf8")); }
  catch { throw new CliError(`invalid JSON in ${file}`, 1, "repair loadouts.json, then run loadouts install"); }
  return validateManifest(value);
}
export function writeManifest(project: string, manifest: Manifest): boolean {
  validateManifest(manifest);
  const sort = (key: string, value: any) => {
    if (key === "choices" && object(value) && !Object.keys(value).length) return undefined;
    return object(value) ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))) : value;
  };
  return writeIfChanged(join(project, "loadouts.json"), JSON.stringify(manifest, sort, 2) + "\n");
}
export function readSourceFile(project: string, source: string): string {
  const parsed = parseSource(source);
  if (parsed.kind !== "file") throw new CliError(`${source} is not a local definition`, 2, "select a file:./.loadouts/catalog/<name>.yml source");
  let path = project;
  for (const part of parsed.path.split("/")) {
    path = join(path, part);
    if (lstatSync(path, {throwIfNoEntry: false})?.isSymbolicLink()) throw new CliError(`symlink in local definition path ${parsed.path}`, 1, "use ordinary committed files and directories inside .loadouts/catalog");
  }
  try { return readFileSync(path, "utf8"); }
  catch { throw new CliError(`local definition ${parsed.path} is missing or unreadable`, 1, `restore ${parsed.path} or remove its selection from loadouts.json`); }
}
export async function resolveManifest(project: string, manifest: Manifest, previous?: Lock, opts?: {update?: boolean; refreshLocal?: string[] | true}): Promise<Lock> {
  validateManifest(manifest);
  const lock: Lock = {version: 3, harnesses: [...manifest.harnesses], catalog: null, loadouts: Object.create(null), installed: structuredClone(previous?.installed ?? {}), resolved: Object.create(null), ...(previous?.pending ? {pending: [...previous.pending]} : {}), ...(previous?.incomplete ? {incomplete: true} : {})};
  if (previous?.packageSkills) { lock.version = 4; lock.packageSkills = structuredClone(previous.packageSkills); }
  if (previous?.installers) { lock.version = 5; lock.installers = structuredClone(previous.installers); }
  if (previous?.version === 6) lock.version = 6;
  const catalogs = new Map<string, Promise<CatalogRef>>();
  for (const [name, entry] of Object.entries(manifest.loadouts)) {
    const parsed = parseSource(entry.source), old = previous?.resolved?.[name];
    const same = old?.source === entry.source;
    let loadout;
    if (parsed.kind === "file") {
      const current = readSourceFile(project, entry.source);
      const refresh = opts?.refreshLocal === undefined || opts.refreshLocal === true || opts.refreshLocal.includes(name);
      const yaml = same && !refresh && previous?.local?.[name] !== undefined ? previous.local[name]! : current;
      loadout = parseLoadout(yaml, name + ".yml"); lock.local = {...lock.local, [name]: yaml};
      lock.resolved![name] = {source: entry.source};
    } else {
      let catalog = same && !opts?.update ? old.catalog : undefined;
      if (!catalog) {
        const key = `${parsed.repo}@${parsed.ref ?? ""}`;
        // Reuse an existing resolution when adding another entry from the same catalog.
        catalog = !opts?.update ? Object.values(previous?.resolved ?? {}).find(r => r.catalog?.repo === parsed.repo && parseSource(r.source).kind === "catalog" && (parseSource(r.source) as Extract<ParsedSource, {kind: "catalog"}>).ref === parsed.ref)?.catalog : undefined;
        if (!catalog) { if (!catalogs.has(key)) catalogs.set(key, openCatalog(parsed.repo, parsed.ref)); catalog = await catalogs.get(key)!; }
      }
      loadout = await readLoadout(catalog, name); lock.catalog ??= catalog;
      lock.resolved![name] = {source: entry.source, catalog};
    }
    const defaults = defaultChoices(loadout); let choices = {...defaults};
    if (same) for (const [g, members] of Object.entries(previous!.loadouts[name] ?? {})) if (Object.hasOwn(defaults, g)) choices[g] = members;
    choices = {...choices, ...entry.choices};
    for (const [g, members] of Object.entries(choices)) {
      const group = loadout.items[g];
      if (!group || !("kind" in group)) throw new CliError(`unknown group ${name}/${g}`, 2, `correct choices in loadouts.json; run loadouts show ${name}`);
      const missing = members.find(m => !Object.hasOwn(group.members, m));
      if (missing) throw new CliError(`${name}/${g}: alternative ${missing} no longer exists`, previous?.loadouts[name]?.[g]?.includes(missing) ? 1 : 2, `choose from ${Object.keys(group.members).join(", ")} in loadouts.json`);
      if ((group.kind === "one_of" && members.length !== 1) || new Set(members).size !== members.length) throw new CliError(`invalid choices for ${name}/${g}`, 2, `choose ${group.kind === "one_of" ? "exactly one of" : "from"}: ${Object.keys(group.members).join(", ")}`);
    }
    lock.loadouts[name] = choices;
  }
  lock.catalog = Object.values(lock.resolved!).find(r => r.catalog)?.catalog ?? previous?.catalog ?? null;
  return lock;
}

export function migrateProject(project: string, opts?: {dryRun?: boolean}): Manifest {
  if (existsSync(join(project, "loadouts.json"))) return readManifest(project);
  const lock = readLock(project);
  const manifest: Manifest = {harnesses: [...lock.harnesses], loadouts: Object.create(null)};
  const resolved: NonNullable<Lock["resolved"]> = Object.create(null);
  for (const [name, choices] of Object.entries(lock.loadouts)) {
    const source = lock.resolved?.[name]?.source ?? (Object.hasOwn(lock.local ?? {}, name) ? fileSource(name) : catalogSource(lock.catalog!.repo, name));
    manifest.loadouts[name] = {source, choices};
    resolved[name] = lock.resolved?.[name] ?? {source, ...(!Object.hasOwn(lock.local ?? {}, name) ? {catalog: lock.catalog!} : {})};
  }
  validateManifest(manifest);
  if (opts?.dryRun) return manifest;
  const root = join(project, ".loadouts"), destination = join(root, "catalog");
  for (const path of [root, destination]) {
    const stat = lstatSync(path, {throwIfNoEntry: false});
    if (stat && (!stat.isDirectory() || stat.isSymbolicLink())) throw new CliError(`unsafe migration directory ${path}`, 1, "use ordinary directories for .loadouts and .loadouts/catalog");
  }
  const files = existsSync(root) ? readdirSync(root).filter(f => /^[\w.-]+\.yml$/.test(f)) : [];
  for (const file of files) {
    const from = join(root, file), to = join(destination, file), a = lstatSync(from), b = lstatSync(to, {throwIfNoEntry: false});
    if (!a.isFile() || (b && (!b.isFile() || readFileSync(from, "utf8") !== readFileSync(to, "utf8")))) throw new CliError(`cannot migrate ${file}: unsafe file or conflicting destination`, 1, `resolve .loadouts/${file} and .loadouts/catalog/${file} without losing your edits, then rerun loadouts init`);
  }
  mkdirSync(destination, {recursive: true});
  for (const file of files) {
    const from = join(root, file), to = join(destination, file);
    if (!existsSync(to)) copyFileSync(from, to, constants.COPYFILE_EXCL);
    unlinkSync(from);
  }
  writeLock(project, {...lock, version: lock.version === 6 ? 6 : 3, resolved});
  writeManifest(project, manifest);
  return manifest;
}

export function manifestMatchesLock(manifest: Manifest, lock: Lock): boolean {
  const equal = (a: string[], b: string[]) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
  return equal(manifest.harnesses, lock.harnesses) && equal(Object.keys(manifest.loadouts), Object.keys(lock.loadouts)) &&
    Object.entries(manifest.loadouts).every(([name, entry]) => entry.source === lock.resolved?.[name]?.source &&
      Object.entries(entry.choices ?? {}).every(([group, members]) => Object.hasOwn(lock.loadouts[name]!, group) && equal(members, lock.loadouts[name]![group]!)));
}
