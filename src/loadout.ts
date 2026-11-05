import { basename } from "node:path";
import { CliError } from "./errors";

export type Harness = "claude-code" | "codex";
export interface McpServer { command?: string; args?: string[]; env?: Record<string, string>; url?: string }
export interface PackageSkills { include: string[]; exclude?: string[] }
export const packageSelector = /^(?:@[a-z0-9_-][a-z0-9_.-]*\/)?[a-z0-9_-][a-z0-9_.-]*(?:#[A-Za-z0-9_-][A-Za-z0-9_.-]*)?$/;
export interface Source { installer?: "codebase-memory"; skills?: string[]; packageSkills?: PackageSkills; plugin?: string; marketplace?: string; mcp?: Record<string, McpServer> }
export interface Item extends Source { claude?: Source; codex?: Source; conventions?: string }
export interface Group { kind: "one_of" | "any_of"; members: Record<string, Item>; default: string[] }
export interface Loadout { name: string; conventions?: string; items: Record<string, Item | Group>; routing: { when: string; use: string[] }[] }
export type Choices = Record<string, string[]>;
export interface ActiveItem { id: string; item: Item }

export function sourceFor(item: Item, h: Harness): Source {
  const { claude, codex, conventions, ...common } = item;
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
export function defaultChoices(l: Loadout): Choices {
  return Object.fromEntries(Object.entries(l.items).filter(([, item]) => "kind" in item).map(([key, item]) => [key, [...(item as Group).default]]));
}
export function activeItems(l: Loadout, choices: Choices): ActiveItem[] {
  return Object.entries(l.items).flatMap(([key, item]) => "kind" in item
    ? (choices[key] ?? item.default).map(member => {
      if (!Object.hasOwn(item.members, member)) throw new CliError(`${l.name}/${key}: unknown member ${member}`, 2, `choose one of: ${Object.keys(item.members).join(", ")}`);
      return { id: `${l.name}/${key}/${member}`, item: item.members[member]! };
    }) : [{ id: `${l.name}/${key}`, item }]);
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
  const source = (value: any, field: string) => {
    object(value, field);
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
    source(value, field);
    if (value.claude !== undefined) source(value.claude, field + ".claude");
    if (value.codex !== undefined) source(value.codex, field + ".codex");
    for (const h of ["claude-code", "codex"] as Harness[]) {
      const effective = sourceFor(value, h);
      if (effective.installer && ["skills", "packageSkills", "plugin", "marketplace", "mcp"].some(k => Object.hasOwn(effective, k))) fail(field + ".installer", "declare other components in separate items");
    }
    if (value.plugin !== undefined || value.marketplace !== undefined) fail(field + ".plugin", "plugins must be harness-specific; move plugin and marketplace under claude: or codex:");
    if (value.codex?.plugin && !value.codex.marketplace) fail(field + ".codex.marketplace", "Codex plugins require an owner/repo marketplace");
    if (value.conventions !== undefined) text(value.conventions, field + ".conventions");
    return value;
  };
  let data: any;
  try { data = Bun.YAML.parse(yamlText); } catch { return fail("YAML", "invalid syntax"); }
  object(data, "loadout");
  if (data.name !== basename(file, ".yml")) fail("name", "must equal the file name");
  const items: Loadout["items"] = Object.create(null);
  for (const [key, value] of Object.entries(object(data.items, "items"))) {
    if (!/^[\w.-]+$/.test(key)) fail("items", `invalid item name ${key}`);
    object(value, `items.${key}`);
    if ("one_of" in value || "any_of" in value) {
      if ("one_of" in value && "any_of" in value) fail(`items.${key}`, "choose one group kind");
      const kind = "one_of" in value ? "one_of" : "any_of";
      const members: Record<string, Item> = Object.create(null);
      for (const [name, v] of Object.entries(object(value[kind], `items.${key}.${kind}`))) {
        if (!/^[\w.-]+$/.test(name)) fail(`items.${key}`, "invalid member name");
        members[name] = item(v, `items.${key}.${name}`);
      }
      if (kind === "one_of") text(value.default, `items.${key}.default`);
      const defaults = kind === "one_of" ? [value.default] : strings(value.default, `items.${key}.default`);
      if (defaults.some(n => !Object.hasOwn(members, n)) || new Set(defaults).size !== defaults.length) fail(`items.${key}.default`, "must name distinct members");
      items[key] = { kind, members, default: defaults };
    } else items[key] = item(value, `items.${key}`);
  }
  if (data.conventions !== undefined) text(data.conventions, "conventions");
  const routing = data.routing ?? [];
  if (!Array.isArray(routing)) fail("routing", "expected a list");
  const allItems = Object.values(items).flatMap(i => "kind" in i ? Object.values(i.members) : [i]);
  for (const row of routing) {
    object(row, "routing"); text(row.when, "routing.when"); strings(row.use, "routing.use");
    for (const ref of row.use) {
      const [type, name, extra] = ref.split(":");
      const valid = !name ? Object.hasOwn(items, ref) : !extra && allItems.some(i => (["claude-code", "codex"] as Harness[]).some(h => {
        const s = sourceFor(i, h);
        if (type === "skill") return s.skills?.some(id => id.split("@")[1] === name || id.split("/")[1]?.split("@")[0] === name);
        if (type === "mcp") return Object.hasOwn(s.mcp ?? {}, name) || !!s.installer && name === "codebase-memory-mcp";
        if (type === "plugin") return s.plugin?.split("@")[0] === name;
        return false;
      }));
      if (!valid) fail(`routing reference "${ref}" points to nothing declared in this loadout`, "");
    }
  }
  return { name: data.name, ...(data.conventions ? { conventions: data.conventions } : {}), items, routing };
}
