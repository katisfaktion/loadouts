import { CliError } from "./errors";
import type { Choices } from "./loadout";

export interface LoadoutSelection { source: string; choices?: Choices }
export type ParsedSource = {kind: "file"; name: string; path: string} | {kind: "catalog"; name: string; repo: string; ref?: string};
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
export function validateSelection(name: string, value: unknown): LoadoutSelection {
  if (!namePattern.test(name) || !object(value) || Object.keys(value).some(k => !["source", "choices"].includes(k)) || parseSource(value.source).name !== name || (value.choices !== undefined && (!object(value.choices) || Object.entries(value.choices).some(([g, members]) => !/^[\w.-]+(?:\/[\w.-]+)*$/.test(g) || !Array.isArray(members) || members.some(m => typeof m !== "string" || !namePattern.test(m)) || new Set(members).size !== members.length)))) throw new CliError(`invalid loadout selection ${name}`, 1, "match the source name to its key and use choices as group-to-member arrays");
  return value as LoadoutSelection;
}
