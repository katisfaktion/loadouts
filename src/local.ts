import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CliError } from "./errors";
import { readConfig } from "./config";
import { readLock } from "./lock";
import { openCatalog, readLoadoutYaml } from "./catalog";
import { fileSource, readSourceFile } from "./manifest";
import { parseLoadout } from "./loadout";
import { version } from "../package.json";

export function ensureLocalCatalog(project: string, marker = true): boolean {
  for (const dir of [".loadouts", ".loadouts/catalog"]) {
    const path = join(project, dir), stat = lstatSync(path, {throwIfNoEntry: false});
    if (stat && (!stat.isDirectory() || stat.isSymbolicLink())) throw new CliError(`unsafe local catalog directory ${dir}`, 1, "use ordinary directories for .loadouts/catalog");
    mkdirSync(path, {recursive: true});
  }
  if (!marker) return false;
  const file = join(project, ".loadouts/.gitkeep");
  if (existsSync(file)) return false;
  mkdirSync(join(project, ".loadouts"), {recursive: true});
  writeFileSync(file, "", {flag: "wx"});
  return true;
}
export function localFile(project: string, name: string): string {
  if (!/^[\w.-]+$/.test(name)) throw new CliError(`invalid loadout name ${name}`, 2, "use letters, digits, dots, underscores or hyphens");
  return join(project, ".loadouts/catalog", name + ".yml");
}
export function localNames(project: string): string[] {
  const dir = join(project, ".loadouts/catalog");
  return existsSync(dir) ? readdirSync(dir).filter(f => /^[\w.-]+\.yml$/.test(f)).map(f => f.slice(0, -4)).sort() : [];
}
export function readLocal(project: string, name: string): string | null {
  const file = localFile(project, name);
  return lstatSync(file, {throwIfNoEntry: false}) ? readSourceFile(project, fileSource(name)) : null;
}
export async function createLocal(project: string, name: string, from?: string): Promise<string> {
  const file = localFile(project, name);
  if (existsSync(file)) throw new CliError(`${file} already exists`, 1, "edit the existing definition or choose a different name");
  let data: any = {name, items: {}};
  if (from) {
    const catalog = (existsSync(join(project, "loadouts.lock.json")) ? readLock(project).catalog : null) ?? await openCatalog(readConfig().catalog);
    const yaml = await readLoadoutYaml(catalog, from);
    try { data = Bun.YAML.parse(yaml); }
    catch { throw new CliError(`${from}.yml: YAML: invalid syntax`, 1); }
    try { JSON.stringify(data); }
    catch { throw new CliError(`${from}.yml: cyclic YAML alias`, 1); }
    const mapping = (value: any) => value !== null && typeof value === "object" && !Array.isArray(value);
    const authorItems = (items: any): any => mapping(items) ? Object.fromEntries(Object.entries(items).map(([key, value]) => [key, authorItem(value)])) : items;
    const authorItem = (value: any): any => {
      if (!mapping(value)) return value;
      let item = value;
      if (value.kind === "one_of" || value.kind === "any_of") {
        const {kind, members, default: defaults, ...rest} = value;
        item = {...rest, [kind]: members, default: kind === "one_of" && Array.isArray(defaults) && defaults.length === 1 ? defaults[0] : defaults};
      }
      for (const key of ["items", "one_of", "any_of"]) if (Object.hasOwn(item, key)) item[key] = authorItems(item[key]);
      return item;
    };
    if (mapping(data) && Object.hasOwn(data, "items")) data.items = authorItems(data.items);
    parseLoadout(Bun.YAML.stringify(data), from + ".yml");
    data = {...data, name};
  }
  const yaml = `# yaml-language-server: $schema=https://raw.githubusercontent.com/katisfaktion/loadouts/v${version}/schemas/v1/loadout.schema.json\n` + Bun.YAML.stringify(data, null, 2) + "\n";
  parseLoadout(yaml, name + ".yml");
  ensureLocalCatalog(project, false);
  writeFileSync(file, yaml, {flag: "wx"});
  return file;
}
