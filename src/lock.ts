import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { CliError } from "./errors";
import { findProject, writeIfChanged } from "./paths";
import type { Harness, Choices } from "./loadout";
import type { CatalogRef } from "./catalog";
import { parseSource } from "./manifest";
import { parseLoadout, packageSelector } from "./loadout";

export interface Lock { version: 1 | 2 | 3 | 4 | 5 | 6; installers?: Record<string, {version: string}>; resolved?: Record<string, {source: string; catalog?: CatalogRef}>; harnesses: Harness[]; catalog: CatalogRef | null; loadouts: Record<string, Choices>; installed: Record<string, string[]>; pending?: string[]; local?: Record<string, string>; incomplete?: boolean; packageSkills?: Record<string, {version: string | null; skills: string[]; requiredBy: string[]}> }
export function requireProject(cwd: string): string {
  const project = findProject(cwd);
  if (!project) throw new CliError("no loadouts project here", 2, "run loadouts init");
  return project;
}
export function readLock(project: string): Lock {
  const file = join(project, "loadouts.lock.json");
  if (!existsSync(file)) throw new CliError("no loadouts.lock.json here", 1, "run loadouts install");
  try {
    const lock = JSON.parse(readFileSync(file, "utf8"));
    const map = (v: any) => v && typeof v === "object" && !Array.isArray(v);
    const strings = (v: any) => Array.isArray(v) && v.every(x => typeof x === "string");
    if (![1, 2, 3, 4, 5, 6].includes(lock.version) || !strings(lock.harnesses) || lock.harnesses.some((h: string) => !["codex", "claude-code"].includes(h)) || !map(lock.loadouts) || !map(lock.installed)) throw new Error();
    if (lock.catalog !== null && (!map(lock.catalog) || !["repo", "ref", "commit"].every(k => typeof lock.catalog[k] === "string") || !/^[a-f0-9]{40}$/.test(lock.catalog.commit))) throw new Error();
    if (Object.values(lock.loadouts).some(c => !map(c) || Object.values(c as object).some(v => !strings(v))) || Object.values(lock.installed).some(v => !strings(v))) throw new Error();
    if (lock.pending !== undefined && (!strings(lock.pending) || lock.pending.some((k: string) => !["skill:", "codex-plugin:", "codex-marketplace:"].some(prefix => k.startsWith(prefix))))) throw new Error();
    if (lock.incomplete !== undefined && typeof lock.incomplete !== "boolean") throw new Error();
    if (lock.local !== undefined) {
      if (lock.version < 2 || !map(lock.local)) throw new Error();
      for (const [name, yaml] of Object.entries(lock.local)) {
        if (!/^[\w.-]+$/.test(name) || !Object.hasOwn(lock.loadouts, name) || typeof yaml !== "string") throw new Error();
        parseLoadout(yaml, name + ".yml");
      }
    }
    if (lock.version === 5 || lock.version === 6 && lock.installers !== undefined) {
      if (!map(lock.installers) || Object.entries(lock.installers).some(([name, value]: [string, any]) => name !== "codebase-memory" || !map(value) || typeof value.version !== "string" || !value.version)) throw new Error();
    } else if (lock.installers !== undefined) throw new Error();
    if (lock.version === 4 || lock.version >= 5 && lock.packageSkills !== undefined) {
      if (!map(lock.packageSkills)) throw new Error();
      for (const [name, entry] of Object.entries(lock.packageSkills) as [string, any][]) {
        if (!packageSelector.test(name) || name.includes("#") || !map(entry) || !(entry.version === null || typeof entry.version === "string" && entry.version) || !strings(entry.skills) || entry.skills.some((s: string) => !/^[A-Za-z0-9_-][\w.-]*$/.test(s)) || !strings(entry.requiredBy) || entry.requiredBy.some((id: string) => !/^[\w.-]+\/[\w.-]+(?:\/[\w.-]+)?$/.test(id) || (!lock.incomplete && !Object.hasOwn(lock.loadouts, id.split("/")[0]!)))) throw new Error();
      }
      for (const [key, names] of Object.entries(lock.installed) as [string, string[]][]) if (key.startsWith("package-skill:")) {
        const [, h, selector, extra] = key.split(":"), [pkg, skill] = selector?.split("#") ?? [];
        if (extra || !["codex", "claude-code"].includes(h!) || !packageSelector.test(selector!) || !skill || names.length !== 1 || names[0] !== skill || !Object.hasOwn(lock.packageSkills, pkg!)) throw new Error();
      }
    } else if (lock.packageSkills !== undefined || Object.keys(lock.installed).some(k => k.startsWith("package-skill:"))) throw new Error();
    if (lock.version >= 3) {
      if (!map(lock.resolved) || Object.keys(lock.resolved).length !== Object.keys(lock.loadouts).length) throw new Error();
      for (const [name, entry] of Object.entries(lock.resolved) as [string, any][]) {
        if (!Object.hasOwn(lock.loadouts, name) || !map(entry)) throw new Error();
        const parsed = parseSource(entry.source);
        if (parsed.name !== name) throw new Error();
        if (parsed.kind === "file") { if (!Object.hasOwn(lock.local ?? {}, name) || entry.catalog !== undefined) throw new Error(); }
        else if (Object.hasOwn(lock.local ?? {}, name) || !map(entry.catalog) || entry.catalog.repo !== parsed.repo || typeof entry.catalog.ref !== "string" || (parsed.ref && entry.catalog.ref !== parsed.ref) || !/^[a-f0-9]{40}$/.test(entry.catalog.commit)) throw new Error();
      }
    } else if (lock.resolved !== undefined) throw new Error();
    if (Object.keys(lock.loadouts).some(name => !Object.hasOwn(lock.local ?? {}, name)) && !lock.catalog) throw new Error();
    return lock;
  } catch { throw new CliError(`invalid lock file ${file}`, 1, "restore loadouts.lock.json from version control or correct its fields"); }
}
export function writeLock(project: string, lock: Lock): boolean {
  const sorted = (_key: string, value: any) => value && typeof value === "object" && !Array.isArray(value) ? Object.fromEntries(Object.keys(value).sort().map(k => [k, value[k]])) : value;
  return writeIfChanged(join(project, "loadouts.lock.json"), JSON.stringify({...lock, version: lock.version === 6 ? 6 : lock.installers ? 5 : lock.packageSkills ? 4 : lock.resolved ? 3 : 2}, sorted, 2) + "\n");
}
