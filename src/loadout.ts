import { basename } from "node:path";
import { CliError } from "./errors";
import { validateSelection, type LoadoutSelection } from "./sources";

export type Harness = "claude-code" | "codex";
export interface McpServer { command?: string; args?: string[]; env?: Record<string, string>; url?: string }
export interface PackageSkills { include: string[]; exclude?: string[] }
export const packageSelector = /^(?:@[a-z0-9_-][a-z0-9_.-]*\/)?[a-z0-9_-][a-z0-9_.-]*(?:#[A-Za-z0-9_-][A-Za-z0-9_.-]*)?$/;
export interface Source { installer?: "codebase-memory"; skills?: string[]; packageSkills?: PackageSkills; plugin?: string; marketplace?: string; mcp?: Record<string, McpServer> }
export interface Item extends Source { claude?: Source; codex?: Source; conventions?: string; items?: Record<string, Item | Group>; includes?: Record<string, LoadoutSelection> }
export interface Group { kind: "one_of" | "any_of"; members: Record<string, Item>; default: string[] }
export interface Loadout { name: string; includes?: Record<string, LoadoutSelection>; conventions?: string; items: Record<string, Item | Group>; routing: { when: string; use: string[] }[] }
export type Choices = Record<string, string[]>;
export interface ActiveItem { id: string; item: Item }

export function sourceFor(item: Item, h: Harness): Source {
  const { claude, codex, conventions, items, includes, ...common } = item;
  return { ...common, ...(h === "codex" ? codex : claude) };
}
export function artifactsFor(a: ActiveItem, h: Harness): Map<string, McpServer | null> {
  const source = sourceFor(a.item, h), artifacts = new Map<string, McpServer | null>();
  if (source.installer) {
    artifacts.set(`installer:${h}:${source.installer}`, null);
    artifacts.set(`mcp:${h}:codebase-memory-mcp`, {command: "codebase-memory-mcp", args: []});
  }
  for (const skill of source.skills ?? []) artifacts.set(`skill:${h}:${skill}`, null);
  if (h === "claude-code" && source.plugin) {
    artifacts.set(`plugin:${source.plugin}`, null);
    if (source.marketplace) artifacts.set(`marketplace:${source.plugin.split("@")[1]}:${source.marketplace}`, null);
  }
  if (h === "codex" && source.plugin) {
    artifacts.set(`codex-plugin:${source.plugin}`, null);
    artifacts.set(`codex-marketplace:${source.plugin.split("@")[1]}:${source.marketplace}`, null);
  }
  for (const [name, server] of Object.entries(source.mcp ?? {})) artifacts.set(`mcp:${h}:${name}`, server);
  return artifacts;
}
export function declaredItems(l: Loadout): Record<string, Item | Group> {
  const result: Record<string, Item | Group> = Object.create(null);
  const visit = (items: Loadout["items"], prefix = "") => {
    for (const [key, value] of Object.entries(items)) {
      const path = prefix + key; result[path] = value;
      if ("kind" in value) visit(value.members, path + "/");
      else if (value.items) visit(value.items, path + "/");
    }
  };
  visit(l.items); return result;
}
export function resolveChoices(l: Loadout, requests: Choices = {}): Choices {
  const declared = declaredItems(l), result: Choices = Object.create(null);
  for (const [path, members] of Object.entries(requests)) {
    const group = Object.hasOwn(declared, path) ? declared[path] : undefined;
    if (!group || !("kind" in group)) throw new CliError(`${l.name}/${path}: unknown group`, 2);
    if (!Array.isArray(members) || members.some(member => typeof member !== "string") || new Set(members).size !== members.length || group.kind === "one_of" && members.length !== 1) throw new CliError(`${l.name}/${path}: invalid ${group.kind} selection`, 2);
    for (const member of members) if (!Object.hasOwn(group.members, member)) throw new CliError(`${l.name}/${path}: unknown member ${member}`, 2);
  }
  const visit = (items: Loadout["items"], prefix = "") => {
    for (const [key, value] of Object.entries(items)) {
      const path = prefix + key;
      if ("kind" in value) {
        result[path] = [...(Object.hasOwn(requests, path) ? requests[path]! : value.default)];
        for (const member of result[path]!) visit({[member]: value.members[member]!}, path + "/");
      } else if (value.items) visit(value.items, path + "/");
    }
  };
  visit(l.items);
  for (const path of Object.keys(requests)) if (!Object.hasOwn(result, path)) {
    const ancestor = Object.keys(result).find(group => {
      const value = declared[group] as Group;
      return Object.keys(value.members).some(member => path.startsWith(`${group}/${member}/`) && !result[group]!.includes(member));
    });
    throw new CliError(`${l.name}/${path}: inactive group; select its ancestor ${ancestor ?? path} first`, 2);
  }
  return result;
}
export function defaultChoices(l: Loadout): Choices { return resolveChoices(l); }
export function activeItems(l: Loadout, choices: Choices): ActiveItem[] {
  const effective = resolveChoices(l, choices), result: ActiveItem[] = [];
  const visit = (items: Loadout["items"], prefix = "") => {
    for (const [key, value] of Object.entries(items)) {
      const path = prefix + key;
      if ("kind" in value) for (const member of effective[path]!) visit({[member]: value.members[member]!}, path + "/");
      else { result.push({id: `${l.name}/${path}`, item: value}); if (value.items) visit(value.items, path + "/"); }
    }
  };
  visit(l.items); return result;
}
export function includeDeclarations(l: Loadout, choices?: Choices): {name: string; selection: LoadoutSelection; path: string}[] {
  const result: {name: string; selection: LoadoutSelection; path: string}[] = [];
  const effective = choices === undefined ? undefined : resolveChoices(l, choices);
  const add = (includes: Loadout["includes"], path: string) => {
    for (const [name, selection] of Object.entries(includes ?? {})) result.push({name, selection, path: path + name});
  };
  const visit = (items: Loadout["items"], yaml: string, prefix = "") => {
    for (const [key, value] of Object.entries(items)) {
      const path = prefix + key, location = yaml + key;
      if ("kind" in value) {
        const members = effective ? effective[path]! : Object.keys(value.members);
        for (const member of members) visit({[member]: value.members[member]!}, location + "." + value.kind + ".", path + "/");
      } else { add(value.includes, location + ".includes."); if (value.items) visit(value.items, location + ".items.", path + "/"); }
    }
  };
  add(l.includes, "includes."); visit(l.items, "items."); return result;
}
export function activeIncludes(l: Loadout, choices: Choices): Record<string, LoadoutSelection> {
  const result: Record<string, LoadoutSelection> = Object.create(null), origins: Record<string, string> = Object.create(null), choiceOrigins: Record<string, Record<string, string>> = Object.create(null);
  for (const {name, selection, path} of includeDeclarations(l, choices)) {
    const conflict = (previous: string): never => { throw new CliError(`${l.name}: conflicting include ${name} at ${previous} and ${path}`, 1); };
    if (!Object.hasOwn(result, name)) { result[name] = {source: selection.source}; origins[name] = path; choiceOrigins[name] = Object.create(null); }
    const previous = result[name]!;
    if (previous.source !== selection.source) conflict(origins[name]!);
    for (const [group, members] of Object.entries(selection.choices ?? {})) {
      previous.choices ??= Object.create(null);
      if (Object.hasOwn(previous.choices!, group) && (previous.choices![group]!.length !== members.length || members.some(m => !previous.choices![group]!.includes(m)))) conflict(choiceOrigins[name]![group]!);
      previous.choices![group] = [...members]; choiceOrigins[name]![group] ??= path;
    }
  }
  return result;
}
export function parseLoadout(yamlText: string, file: string): Loadout {
  const fail = (field: string, message: string): never => { throw new CliError(`${file}: ${field}${message ? ": " + message : ""}`, 1, `correct ${field} in ${file}`); };
  const object = (value: any, field: string): Record<string, any> => {
    if (!value || typeof value !== "object" || Array.isArray(value)) fail(field, "expected a mapping");
    return value;
  };
  const strings = (value: any, field: string): string[] => {
    if (!Array.isArray(value) || value.some(v => typeof v !== "string" || !v)) fail(field, "expected a list of strings");
    return value;
  };
  const text = (value: any, field: string) => { if (typeof value !== "string" || !value) fail(field, "expected a nonempty string"); };
  const source = (value: any, field: string, extra: string[] = []) => {
    object(value, field);
    for (const key of Object.keys(value)) if (!["installer", "skills", "packageSkills", "plugin", "marketplace", "mcp", ...extra].includes(key)) fail(field + "." + key, "unknown field");
    if (value.installer !== undefined && value.installer !== "codebase-memory") fail(field + ".installer", "supported installer: codebase-memory");
    if (value.skills !== undefined) {
      for (const id of strings(value.skills, field + ".skills")) if (!/^[\w.-]+\/[\w.-]+(?:@[\w.-]+)?$/.test(id)) fail(field + ".skills", `invalid identifier ${id}`);
    }
    if (value.packageSkills !== undefined) {
      const fieldName = field + ".packageSkills", policy = object(value.packageSkills, fieldName);
      if (Object.keys(policy).some(k => !["include", "exclude"].includes(k))) fail(fieldName, "expected include and optional exclude");
      for (const key of ["include", ...(policy.exclude !== undefined ? ["exclude"] : [])]) {
        const selectors = strings(policy[key], fieldName + "." + key);
        if (new Set(selectors).size !== selectors.length || selectors.some(s => !packageSelector.test(s))) fail(fieldName + "." + key, "use distinct package or package#skill selectors without versions, paths or wildcards");
      }
    }
    if (value.plugin !== undefined && !/^[\w.-]+@[\w.-]+$/.test(value.plugin)) fail(field + ".plugin", "expected plugin@marketplace");
    if (value.marketplace !== undefined && (!/^[\w.-]+\/[\w.-]+$/.test(value.marketplace) || !value.plugin)) fail(field + ".marketplace", "requires owner/repo and plugin@marketplace");
    if (value.mcp !== undefined) for (const [name, s] of Object.entries(object(value.mcp, field + ".mcp"))) {
      if (!/^[\w.-]+$/.test(name)) fail(field + ".mcp", "invalid server name");
      object(s, field + ".mcp." + name);
      if (!!s.command === !!s.url) fail(field + ".mcp." + name, "specify command or url");
      if (s.command !== undefined) text(s.command, field + ".command");
      if (s.url !== undefined) { text(s.url, field + ".url"); if (!/^https?:\/\//.test(s.url)) fail(field + ".url", "expected an HTTP URL"); }
      if (s.args !== undefined) strings(s.args, field + ".args");
      if (s.env !== undefined) for (const v of Object.values(object(s.env, field + ".env"))) if (typeof v !== "string") fail(field + ".env", "values must be strings");
    }
  };
  const item = (value: any, field: string): Item => {
    source(value, field, ["claude", "codex", "conventions", "items", "includes"]);
    if (value.claude !== undefined) source(value.claude, field + ".claude");
    if (value.codex !== undefined) source(value.codex, field + ".codex");
    for (const h of ["claude-code", "codex"] as Harness[]) {
      const effective = sourceFor(value, h);
      if (effective.installer && ["skills", "packageSkills", "plugin", "marketplace", "mcp"].some(k => Object.hasOwn(effective, k))) fail(field + ".installer", "declare other components in separate items");
    }
    if (value.plugin !== undefined || value.marketplace !== undefined) fail(field + ".plugin", "plugins must be harness-specific; move plugin and marketplace under claude: or codex:");
    if (value.codex?.plugin && !value.codex.marketplace) fail(field + ".codex.marketplace", "Codex plugins require an owner/repo marketplace");
    if (value.conventions !== undefined) text(value.conventions, field + ".conventions");
    return {...value, ...(value.items !== undefined ? {items: parseItems(value.items, field + ".items")} : {}), ...(value.includes !== undefined ? {includes: parseIncludes(value.includes, field + ".includes")} : {})};
  };
  const parseIncludes = (value: any, field: string): NonNullable<Loadout["includes"]> => {
    const result: NonNullable<Loadout["includes"]> = Object.create(null);
    for (const [name, selection] of Object.entries(object(value, field))) {
      try { result[name] = validateSelection(name, selection); } catch (error) { fail(`${field}.${name}`, (error as Error).message); }
    }
    return result;
  };
  const parseItems = (input: any, field: string): Loadout["items"] => {
    object(input, field);
    const items: Loadout["items"] = Object.create(null);
    for (const [key, value] of Object.entries(input) as [string, any][]) {
      if (!/^[\w.-]+$/.test(key)) fail(field, `invalid item name ${key}`);
      const location = `${field}.${key}`; object(value, location);
      if ("one_of" in value || "any_of" in value) {
        if ("one_of" in value && "any_of" in value) fail(location, "choose one group kind");
        const kind = "one_of" in value ? "one_of" : "any_of";
        for (const k of Object.keys(value)) if (![kind, "default"].includes(k)) fail(location + "." + k, "unknown group field");
        const members: Record<string, Item> = Object.create(null);
        for (const [name, member] of Object.entries(object(value[kind], location + "." + kind))) {
          if (!/^[\w.-]+$/.test(name)) fail(location, "invalid member name");
          members[name] = item(member, location + "." + kind + "." + name);
        }
        if (kind === "one_of") text(value.default, location + ".default");
        const defaults = kind === "one_of" ? [value.default] : strings(value.default, location + ".default");
        if (defaults.some(n => !Object.hasOwn(members, n)) || new Set(defaults).size !== defaults.length) fail(location + ".default", "must name distinct members");
        items[key] = {kind, members, default: defaults};
      } else items[key] = item(value, location);
    }
    return items;
  };
  let data: any;
  try { data = Bun.YAML.parse(yamlText); } catch { return fail("YAML", "invalid syntax"); }
  try { JSON.stringify(data); } catch { return fail("YAML", "cyclic YAML alias"); }
  object(data, "loadout");
  if (data.name !== basename(file, ".yml")) fail("name", "must equal the file name");
  for (const key of Object.keys(data)) if (!["name", "includes", "items", "conventions", "routing"].includes(key)) fail(key, "unknown field");
  const includes = data.includes === undefined ? undefined : parseIncludes(data.includes, "includes");
  const items = parseItems(data.items === undefined && includes && Object.keys(includes).length ? {} : data.items, "items");
  if (data.conventions !== undefined) text(data.conventions, "conventions");
  const routing = data.routing ?? [];
  if (!Array.isArray(routing)) fail("routing", "expected a list");
  const declared = declaredItems({name: data.name, items, routing: []});
  const allItems = Object.values(declared).filter((i): i is Item => !("kind" in i));
  for (const row of routing) {
    object(row, "routing"); text(row.when, "routing.when"); strings(row.use, "routing.use");
    for (const ref of row.use) {
      const [type, name, extra] = ref.split(":");
      const valid = !name ? Object.hasOwn(declared, ref) : !extra && allItems.some(i => (["claude-code", "codex"] as Harness[]).some(h => {
        const s = sourceFor(i, h);
        if (type === "skill") return s.skills?.some(id => id.split("@")[1] === name || id.split("/")[1]?.split("@")[0] === name);
        if (type === "mcp") return Object.hasOwn(s.mcp ?? {}, name) || !!s.installer && name === "codebase-memory-mcp";
        if (type === "plugin") return s.plugin?.split("@")[0] === name;
        return false;
      }));
      if (!valid) fail(`routing reference "${ref}" points to nothing declared in this loadout`, "");
    }
  }
  return { name: data.name, ...(includes ? {includes} : {}), ...(data.conventions ? { conventions: data.conventions } : {}), items, routing };
}
