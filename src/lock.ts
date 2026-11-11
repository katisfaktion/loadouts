import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { CliError } from "./errors";
import { findProject, writeIfChanged } from "./paths";
import type { Harness, Choices, Loadout } from "./loadout";
import type { CatalogRef } from "./catalog";
import { parseSource, validateSelection, type LoadoutSelection } from "./sources";
import { parseLoadout, packageSelector, resolveChoices, activeIncludes, includeDeclarations } from "./loadout";

export interface Lock { version: 1; roots: Record<string, LoadoutSelection>; includes: Record<string, Record<string, LoadoutSelection>>; installers?: Record<string, {version: string}>; resolved: Record<string, {source: string; catalog?: CatalogRef}>; harnesses: Harness[]; catalog: CatalogRef | null; loadouts: Record<string, Choices>; installed: Record<string, string[]>; pending?: string[]; local?: Record<string, string>; incomplete?: boolean; packageSkills?: Record<string, {version: string | null; skills: string[]; requiredBy: string[]}> }
export function requireProject(cwd: string): string {
  const project = findProject(cwd);
  if (!project) throw new CliError("no loadouts project here", 2, "run loadouts init", "project_not_found");
  return project;
}
export function readLock(project: string): Lock {
  const file = join(project, "loadouts.lock.json");
  if (!existsSync(file)) throw new CliError("no loadouts.lock.json here", 1, "run loadouts install");
  try {
    const lock = JSON.parse(readFileSync(file, "utf8"));
    const map = (v: any) => v && typeof v === "object" && !Array.isArray(v);
    const strings = (v: any) => Array.isArray(v) && v.every(x => typeof x === "string");
    if (lock.version !== 1 || !strings(lock.harnesses) || lock.harnesses.some((h: string) => !["codex", "claude-code"].includes(h)) || !map(lock.loadouts) || !map(lock.installed)) throw new Error();
    if (lock.catalog !== null && (!map(lock.catalog) || !["repo", "ref", "commit"].every(k => typeof lock.catalog[k] === "string") || !/^[a-f0-9]{40}$/.test(lock.catalog.commit))) throw new Error();
    if (Object.values(lock.loadouts).some(c => !map(c) || Object.values(c as object).some(v => !strings(v))) || Object.values(lock.installed).some(v => !strings(v))) throw new Error();
    if (lock.pending !== undefined && (!strings(lock.pending) || lock.pending.some((k: string) => !["skill:", "codex-plugin:", "codex-marketplace:"].some(prefix => k.startsWith(prefix))))) throw new Error();
    if (lock.incomplete !== undefined && typeof lock.incomplete !== "boolean") throw new Error();
    if (lock.local !== undefined) {
      if (!map(lock.local)) throw new Error();
      for (const [name, yaml] of Object.entries(lock.local)) {
        if (!/^[\w.-]+$/.test(name) || !Object.hasOwn(lock.loadouts, name) || typeof yaml !== "string") throw new Error();
        parseLoadout(yaml, name + ".yml");
      }
    }
    if (lock.installers !== undefined) {
      if (!map(lock.installers) || Object.entries(lock.installers).some(([name, value]: [string, any]) => name !== "codebase-memory" || !map(value) || typeof value.version !== "string" || !value.version)) throw new Error();
    }
    if (lock.packageSkills !== undefined) {
      if (!map(lock.packageSkills)) throw new Error();
      for (const [name, entry] of Object.entries(lock.packageSkills) as [string, any][]) {
        if (!packageSelector.test(name) || name.includes("#") || !map(entry) || !(entry.version === null || typeof entry.version === "string" && entry.version) || !strings(entry.skills) || entry.skills.some((s: string) => !/^[A-Za-z0-9_-][\w.-]*$/.test(s)) || !strings(entry.requiredBy) || entry.requiredBy.some((id: string) => !/^[\w.-]+(?:\/[\w.-]+)+$/.test(id) || (!lock.incomplete && !Object.hasOwn(lock.loadouts, id.split("/")[0]!)))) throw new Error();
      }
      for (const [key, names] of Object.entries(lock.installed) as [string, string[]][]) if (key.startsWith("package-skill:")) {
        const [, h, selector, extra] = key.split(":"), [pkg, skill] = selector?.split("#") ?? [];
        if (extra || !["codex", "claude-code"].includes(h!) || !packageSelector.test(selector!) || !skill || names.length !== 1 || names[0] !== skill || !Object.hasOwn(lock.packageSkills, pkg!)) throw new Error();
      }
    } else if (Object.keys(lock.installed).some(k => k.startsWith("package-skill:"))) throw new Error();
    if (!map(lock.resolved) || Object.keys(lock.resolved).length !== Object.keys(lock.loadouts).length) throw new Error();
    for (const [name, entry] of Object.entries(lock.resolved) as [string, any][]) {
      if (!Object.hasOwn(lock.loadouts, name) || !map(entry)) throw new Error();
      const parsed = parseSource(entry.source);
      if (parsed.name !== name) throw new Error();
      if (parsed.kind === "file") { if (!Object.hasOwn(lock.local ?? {}, name) || entry.catalog !== undefined) throw new Error(); }
      else if (Object.hasOwn(lock.local ?? {}, name) || !map(entry.catalog) || entry.catalog.repo !== parsed.repo || typeof entry.catalog.ref !== "string" || (parsed.ref && entry.catalog.ref !== parsed.ref) || !/^[a-f0-9]{40}$/.test(entry.catalog.commit)) throw new Error();
    }
    if (Object.keys(lock.loadouts).some(name => !Object.hasOwn(lock.local ?? {}, name)) && !lock.catalog) throw new Error();
    if (!map(lock.roots) || !map(lock.includes) || !sameNames(lock.includes, lock.loadouts)) throw new Error();
    const selection = (name: string, entry: unknown) => {
      const value = validateSelection(name, entry);
      if (!Object.hasOwn(lock.loadouts, name) || value.source !== lock.resolved[name].source) throw new Error();
      for (const [group, members] of Object.entries(value.choices ?? {})) if (!Object.hasOwn(lock.loadouts[name], group) || !sameMembers(members, lock.loadouts[name][group])) throw new Error();
    };
    for (const [name, entry] of Object.entries(lock.roots)) selection(name, entry);
    for (const [owner, edges] of Object.entries(lock.includes)) {
      if (!map(edges)) throw new Error();
      for (const [name, entry] of Object.entries(edges as object)) {
        selection(name, entry);
        if (parseSource(lock.resolved[owner].source).kind === "catalog" && parseSource(lock.resolved[name].source).kind === "file") throw new Error();
      }
    }
    const reached = new Set<string>(), active = new Set<string>();
    const visit = (name: string) => {
      if (active.has(name)) throw new Error();
      if (reached.has(name)) return;
      active.add(name);
      for (const child of Object.keys(lock.includes[name])) visit(child);
      active.delete(name); reached.add(name);
    };
    for (const name of Object.keys(lock.roots)) visit(name);
    if (reached.size !== Object.keys(lock.loadouts).length) throw new Error();
    for (const [name, yaml] of Object.entries(lock.local ?? {})) validateLockedLoadout(lock, name, parseLoadout(yaml as string, name + ".yml"));
    return lock;
  } catch { throw new CliError(`invalid lock file ${file}`, 1, "restore loadouts.lock.json from version control or correct its fields"); }
}
export function writeLock(project: string, lock: Lock): boolean {
  const sorted = (_key: string, value: any) => value && typeof value === "object" && !Array.isArray(value) ? Object.fromEntries(Object.keys(value).sort().map(k => [k, value[k]])) : value;
  return writeIfChanged(join(project, "loadouts.lock.json"), JSON.stringify(lock, sorted, 2) + "\n");
}

const sameMembers = (a: string[], b: string[]) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
const sameNames = (a: object, b: object) => sameMembers(Object.keys(a), Object.keys(b));

// Verify pinned definitions only when available; reading a lock never fetches catalogs.
export function validateLockedLoadout(lock: Lock, name: string, loadout: Loadout): void {
  const fail = (): never => { throw new CliError(`locked graph disagrees with ${name} (${loadoutPaths(lock, name).map(p => p.join(" → ")).join(", ")})`, 1, "restore the lock or run loadouts install"); };
  try {
    const requests: Choices = Object.create(null);
    for (const entries of [lock.roots!, ...Object.values(lock.includes!)]) if (Object.hasOwn(entries, name)) {
      if (entries[name]!.source !== lock.resolved![name]!.source) fail();
      for (const [group, members] of Object.entries(entries[name]!.choices ?? {})) {
        if (Object.hasOwn(requests, group) && !sameMembers(requests[group]!, members)) fail();
        requests[group] = members;
      }
    }
    const choices = resolveChoices(loadout, requests), effective = lock.loadouts[name]!;
    if (!sameNames(choices, effective) || Object.entries(choices).some(([group, members]) => !sameMembers(members, effective[group]!))) fail();
    if (parseSource(lock.resolved![name]!.source).kind === "catalog" && includeDeclarations(loadout).some(edge => parseSource(edge.selection.source).kind === "file")) fail();
  } catch { fail(); }
  let actual: Record<string, LoadoutSelection>;
  try { actual = activeIncludes(loadout, lock.loadouts[name]!); }
  catch { fail(); }
  const saved = lock.includes![name]!;
  if (!sameNames(saved, actual)) fail();
  for (const [child, selection] of Object.entries(actual)) {
    const edge = saved[child]!;
    if (edge.source !== selection.source || !sameNames(edge.choices ?? {}, selection.choices ?? {}) || Object.entries(selection.choices ?? {}).some(([g, members]) => !sameMembers(members, edge.choices![g]!))) fail();
  }
}

export function loadoutPaths(lock: Lock, name: string): string[][] {
  if (!Object.hasOwn(lock.loadouts, name)) return [];
  const paths: string[][] = [];
  const visit = (node: string, path: string[]) => {
    if (path.includes(node)) return;
    const next = [...path, node];
    if (node === name) { paths.push(next); return; }
    for (const child of Object.keys(lock.includes![node] ?? {}).sort()) visit(child, next);
  };
  for (const root of Object.keys(lock.roots!).sort()) visit(root, []);
  return paths;
}

export function loadoutClosure(lock: Lock, name: string): string[] {
  if (!Object.hasOwn(lock.loadouts, name)) return [];
  const names = new Set<string>();
  const visit = (node: string) => {
    if (names.has(node)) return;
    names.add(node);
    for (const child of Object.keys(lock.includes![node] ?? {})) visit(child);
  };
  visit(name);
  return [...names].sort();
}
