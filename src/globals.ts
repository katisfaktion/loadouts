import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { home } from "./paths";
import { codexUserHome } from "./codex";
import { listSkills } from "./skills";
import { CliError } from "./errors";

export interface GlobalState {
  claudePlugins: string[]; claudeSkills: string[]; claudeMcp: string[];
  codexMcp: string[]; codexSkills: string[]; codexPlugins: string[]; npxSkills: {name: string; source: string | null}[];
}
export function readJson(file: string): Record<string, any> {
  if (!existsSync(file)) return {};
  try {
    const data = JSON.parse(readFileSync(file, "utf8"));
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error();
    return data;
  } catch { throw new CliError(`invalid JSON in ${file}`, 1, `repair ${file}, then rerun`); }
}
export async function scanGlobals(): Promise<GlobalState> {
  const settings = readJson(join(home(), ".claude/settings.json")), claude = readJson(join(home(), ".claude.json"));
  const file = join(codexUserHome(), "config.toml");
  let codex: any = {};
  try { if (existsSync(file)) codex = Bun.TOML.parse(readFileSync(file, "utf8")); }
  catch { throw new CliError(`invalid TOML in ${file}`, 1, `repair ${file}, then rerun`); }
  const dirs = (path: string) => existsSync(path) ? readdirSync(path).filter(n => statSync(join(path, n), {throwIfNoEntry: false})?.isDirectory()) : [];
  const claudeSkills = join(home(), ".claude/skills");
  return {
    claudePlugins: Object.keys(settings.enabledPlugins ?? {}).filter(k => settings.enabledPlugins[k] === true),
    claudeSkills: dirs(claudeSkills).filter(n => existsSync(join(claudeSkills, n, "SKILL.md")) && settings.skillOverrides?.[n] !== "off"),
    claudeMcp: Object.keys(claude.mcpServers ?? {}),
    codexMcp: Object.keys(codex.mcp_servers ?? {}).filter(n => codex.mcp_servers[n].enabled !== false),
    codexSkills: dirs(join(codexUserHome(), "skills")).filter(n => n !== ".system"),
    codexPlugins: Object.keys(codex.plugins ?? {}).filter(n => codex.plugins[n]?.enabled === true),
    npxSkills: await listSkills({global: true, cwd: home()}),
  };
}
