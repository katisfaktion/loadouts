import { existsSync, lstatSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { CliError } from "./errors";
import { writeIfChanged } from "./paths";
import { openCatalog, readLoadout, type CatalogRef } from "./catalog";
import { resolveChoices, activeIncludes, includeDeclarations, declaredItems, parseLoadout, type Choices, type Harness, type Loadout } from "./loadout";
import type { Lock } from "./lock";

import { parseSource, validateSelection, type ParsedSource, type LoadoutSelection } from "./sources";
export { parseSource, fileSource, catalogSource } from "./sources";

export interface Manifest { harnesses: Harness[]; loadouts: Record<string, LoadoutSelection> }
const object = (v: any): v is Record<string, any> => v !== null && typeof v === "object" && !Array.isArray(v);
export function validateManifest(value: unknown): Manifest {
  if (!object(value) || Object.keys(value).some(k => !["$schema", "harnesses", "loadouts"].includes(k)) || (value.$schema !== undefined && typeof value.$schema !== "string") || !Array.isArray(value.harnesses) || value.harnesses.some(h => !["claude-code", "codex"].includes(h)) || new Set(value.harnesses).size !== value.harnesses.length || !object(value.loadouts)) throw new CliError("invalid loadouts.json", 1, "declare harnesses and a loadouts object with explicit sources; run loadouts help install");
  for (const [name, entry] of Object.entries(value.loadouts)) {
    try { validateSelection(name, entry); }
    catch { throw new CliError(`invalid loadouts.json entry ${name}`, 1, "match the source name to its key and use choices as group-to-member arrays"); }
  }
  return value as unknown as Manifest;
}
export function readManifest(project: string): Manifest {
  const file = join(project, "loadouts.json");
  if (!existsSync(file)) throw new CliError("no loadouts.json here", 2, "run loadouts init to initialize this project");
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
  const lock: Lock = {version: 1, harnesses: [...manifest.harnesses], catalog: null, loadouts: Object.create(null), installed: structuredClone(previous?.installed ?? {}), resolved: Object.create(null), roots: Object.create(null), includes: Object.create(null), ...(previous?.pending ? {pending: [...previous.pending]} : {}), ...(previous?.incomplete ? {incomplete: true} : {})};
  if (previous?.packageSkills) lock.packageSkills = structuredClone(previous.packageSkills);
  if (previous?.installers) lock.installers = structuredClone(previous.installers);
  const catalogs = new Map<string, Promise<CatalogRef>>();
  const selections = (entries: Record<string, LoadoutSelection>): Record<string, LoadoutSelection> => Object.fromEntries(Object.keys(entries).sort().map(name => {
    const entry = entries[name]!;
    return [name, {source: entry.source, ...(entry.choices && Object.keys(entry.choices).length ? {choices: Object.fromEntries(Object.keys(entry.choices).sort().map(g => [g, [...entry.choices![g]!].sort()]))} : {})}];
  }));
  lock.roots = selections(manifest.loadouts);
  type Definition = {loadout: Loadout; resolved: NonNullable<Lock["resolved"]>[string]; yaml?: string};
  const reads = new Map<string, Promise<Definition>>();
  const read = (name: string, entry: LoadoutSelection): Promise<Definition> => {
    if (!reads.has(entry.source)) reads.set(entry.source, (async () => {
      const parsed = parseSource(entry.source);
      const old = previous?.resolved[name];
      const same = old?.source === entry.source;
      let loadout: Loadout;
      if (parsed.kind === "file") {
        const current = readSourceFile(project, entry.source);
        const refresh = opts?.refreshLocal === true || (Array.isArray(opts?.refreshLocal) ? opts.refreshLocal.includes(name) : !opts?.update);
        const yaml = same && !refresh && previous?.local?.[name] !== undefined ? previous.local[name]! : current;
        loadout = parseLoadout(yaml, name + ".yml");
        return {loadout, resolved: {source: entry.source}, yaml};
      } else {
        let catalog = same && !opts?.update ? old.catalog : undefined;
        if (!catalog) {
          const key = `${parsed.repo}@${parsed.ref ?? ""}`;
          // Reuse an existing resolution when adding another entry from the same catalog.
          catalog = !opts?.update ? Object.values(previous?.resolved ?? {}).find(r => r.catalog?.repo === parsed.repo && parseSource(r.source).kind === "catalog" && (parseSource(r.source) as Extract<ParsedSource, {kind: "catalog"}>).ref === parsed.ref)?.catalog : undefined;
          if (!catalog) { if (!catalogs.has(key)) catalogs.set(key, openCatalog(parsed.repo, parsed.ref)); catalog = await catalogs.get(key)!; }
        }
        loadout = await readLoadout(catalog, name);
        return {loadout, resolved: {source: entry.source, catalog}};
      }
    })());
    return reads.get(entry.source)!;
  };
  type Occurrence = {selection: LoadoutSelection; path: string[]; locations: string[]};
  type Node = {definition: Definition; choices: Choices; includes: Record<string, LoadoutSelection>; edges: ReturnType<typeof includeDeclarations>};
  const canonical = (value: unknown): string => JSON.stringify(value, (_k, v) => object(v) ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]])) : v);
  const where = (entry: Occurrence) => entry.path.join(" → ") + (entry.locations.length ? ` (${entry.locations.join(" → ")})` : "");
  let prior = new Map<string, Node>(), previousState: string | undefined;
  const seen = new Set<string>(), paths = new Set<string>();
  for (;;) {
    const incoming = new Map<string, Occurrence[]>(), cycles: string[] = [];
    const gather = (name: string, occurrence: Occurrence, ancestry: string[]) => {
      if (!incoming.has(name)) incoming.set(name, []);
      incoming.get(name)!.push(occurrence);
      paths.add(where(occurrence));
      const key = occurrence.selection.source;
      if (ancestry.includes(key)) { cycles.push(where(occurrence)); return; }
      const node = prior.get(name);
      if (node?.definition.resolved.source !== key) return;
      for (const edge of node.edges) gather(edge.name, {selection: edge.selection, path: [...occurrence.path, edge.name], locations: [...occurrence.locations, `${name}.${edge.path}`]}, [...ancestry, key]);
    };
    for (const [name, selection] of Object.entries(lock.roots!)) gather(name, {selection, path: [name], locations: []}, []);
    const next = new Map<string, Node>(), diagnostics: CliError[] = [];
    for (const name of [...incoming.keys()].sort()) {
      const occurrences = incoming.get(name)!.sort((a, b) => canonical(a).localeCompare(canonical(b)));
      const first = occurrences[0]!;
      try {
        const different = occurrences.find(o => o.selection.source !== first.selection.source);
        if (different) throw new CliError(`conflicting sources for ${name}: ${first.selection.source} (${where(first)}) and ${different.selection.source} (${where(different)})`, 1, "use the same full source for every declaration");
        const requests: Choices = Object.create(null), origins = new Map<string, Occurrence>();
        for (const occurrence of occurrences) for (const [group, members] of Object.entries(occurrence.selection.choices ?? {}).sort(([a], [b]) => a.localeCompare(b))) {
          const sorted = [...members].sort(), earlier = origins.get(group);
          if (earlier && canonical(requests[group]) !== canonical(sorted)) throw new CliError(`conflicting choices for ${name}/${group}: [${requests[group]!.join(", ")}] (${where(earlier)}) and [${sorted.join(", ")}] (${where(occurrence)})`, 1, "use the same explicit choices for every declaration");
          requests[group] = sorted; origins.set(group, occurrence);
        }
        const definition = await read(name, first.selection), loadout = definition.loadout;
        if (parseSource(first.selection.source).kind === "catalog") for (const edge of includeDeclarations(loadout)) {
          if (parseSource(edge.selection.source).kind === "file") throw new CliError(`shared catalog cannot include consumer-local source ${edge.selection.source} (${first.path.concat(edge.name).join(" → ")}; ${name}.${edge.path})`, 1, "use an explicit shared catalog source");
        }
        // Distinguish removed selections from invalid new requests.
        const declared = declaredItems(loadout);
        for (const [group, members] of Object.entries(requests)) {
          const item = declared[group];
          if (item && "kind" in item) {
            const missing = members.find(m => !Object.hasOwn(item.members, m));
            if (missing) throw new CliError(`${name}/${group}: alternative ${missing} no longer exists`, previous?.loadouts[name]?.[group]?.includes(missing) ? 1 : 2, `choose from ${Object.keys(item.members).join(", ")}`);
          }
        }
        const choices = Object.fromEntries(Object.entries(resolveChoices(loadout, requests)).sort(([a], [b]) => a.localeCompare(b)).map(([group, members]) => [group, [...members].sort()]));
        next.set(name, {definition, choices, includes: selections(activeIncludes(loadout, choices)), edges: includeDeclarations(loadout, choices).sort((a, b) => a.path.localeCompare(b.path))});
      } catch (error) {
        diagnostics.push(new CliError(`${(error as Error).message} (${occurrences.map(where).join("; ")})`, error instanceof CliError ? error.code : 1, error instanceof CliError ? error.fix : "correct the included loadout"));
      }
    }
    const state = canonical({incoming: Object.fromEntries(incoming), nodes: Object.fromEntries([...next].map(([name, node]) => [name, {choices: node.choices, includes: node.includes, edges: node.edges}])), diagnostics: diagnostics.map(d => [d.message, d.code]).sort(), cycles: cycles.sort()});
    if (state === previousState) {
      if (diagnostics.length) throw diagnostics[0];
      if (cycles.length) throw new CliError(`loadout include cycle: ${cycles[0]}`, 1, "remove the cyclic include");
      for (const [name, node] of next) {
        for (const [child, selection] of Object.entries(node.includes)) if (next.get(child)?.definition.resolved.source !== selection.source) throw new CliError(`unresolved include ${name} → ${child}`, 1);
        lock.loadouts[name] = node.choices; lock.includes![name] = node.includes; lock.resolved![name] = node.definition.resolved;
        if (node.definition.yaml !== undefined) { lock.local ??= Object.create(null); lock.local![name] = node.definition.yaml; }
      }
      break;
    }
    if (seen.has(state)) throw new CliError(`conditional includes did not converge: ${[...paths].sort().join("; ")}`, 1, "remove self-invalidating conditional includes");
    seen.add(state); previousState = state; prior = next;
  }
  lock.catalog = Object.values(lock.resolved!).find(r => r.catalog)?.catalog ?? previous?.catalog ?? null;
  return lock;
}

export function manifestMatchesLock(manifest: Manifest, lock: Lock): boolean {
  const equal = (a: string[], b: string[]) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
  return equal(manifest.harnesses, lock.harnesses) && equal(Object.keys(manifest.loadouts), Object.keys(lock.roots!)) &&
    Object.entries(manifest.loadouts).every(([name, entry]) => {
      const applied = lock.roots![name]!;
      return entry.source === applied.source && equal(Object.keys(entry.choices ?? {}), Object.keys(applied.choices ?? {})) &&
        Object.entries(entry.choices ?? {}).every(([group, members]) => equal(members, applied.choices![group]!));
    });
}
