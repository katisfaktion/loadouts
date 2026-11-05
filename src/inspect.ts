import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { home } from "./paths";
import { codexUserHome } from "./codex";

type Scope = "user" | "project" | "project-local";
type Harness = "claude-code" | "codex" | "shared";
interface Evidence { scope: Scope; harness: Harness; path: string }
interface PluginRecord extends Evidence { id: string; enabled: boolean | null; source: string | null; installPath?: string }
interface SkillRecord extends Evidence { name: string; source: string | null }
interface McpRecord extends Evidence { name: string; transport: "stdio" | "http" | "unknown"; enabled: boolean }
export interface Inspection {
  project: string; initialized: boolean; manifests: string[]; instructions: string[];
  plugins: PluginRecord[]; skills: SkillRecord[]; mcp: McpRecord[]; warnings: string[];
}

export function inspectionRoot(cwd: string): string {
  for (let dir = resolve(cwd);; dir = dirname(dir)) {
    if (existsSync(join(dir, "loadouts.json")) || existsSync(join(dir, "loadouts.lock.json")) || existsSync(join(dir, ".git"))) return dir;
    if (dirname(dir) === dir) return resolve(cwd);
  }
}

export function inspectProject(cwd: string): Inspection {
  const project = inspectionRoot(cwd), user = home();
  const report: Inspection = {project, initialized: existsSync(join(project, "loadouts.json")) || existsSync(join(project, "loadouts.lock.json")), manifests: [], instructions: [], plugins: [], skills: [], mcp: [], warnings: []};
  const warning = (path: string, message: string) => report.warnings.push(`${path}: ${message}`);
  const object = (v: any): v is Record<string, any> => v !== null && typeof v === "object" && !Array.isArray(v);
  const read = (path: string): Record<string, any> => {
    try {
      const text = readFileSync(path, "utf8"), value = path.endsWith(".toml") ? Bun.TOML.parse(text) : JSON.parse(text);
      if (!object(value)) throw new Error();
      return value;
    } catch (error) {
      if ((error as {code?: string}).code !== "ENOENT") warning(path, "cannot read valid configuration; repair the file and rerun inspect");
      return {};
    }
  };
  const map = (data: Record<string, any>, key: string, path: string): Record<string, any> => {
    if (data[key] === undefined) return {};
    if (object(data[key])) return data[key];
    warning(path, `invalid ${key}; expected an object`); return {};
  };
  const github = (value: unknown): string | null => typeof value === "string" && /^[A-Za-z0-9][\w-]*\/[\w.-]+$/.test(value) ? value : null;
  const fileExists = (path: string): boolean => {
    try { return statSync(path, {throwIfNoEntry: false})?.isFile() ?? false; }
    catch { warning(path, "cannot inspect file metadata"); return false; }
  };
  const files = (root: string, names: string[]) => names.map(name => join(root, name)).filter(fileExists);
  report.manifests = files(project, ["loadouts.json", "package.json", "bun.lock", "bun.lockb", "pyproject.toml", "requirements.txt", "go.mod", "Cargo.toml", "composer.json", "Gemfile", "pom.xml", "build.gradle"]);
  const instructions = ["AGENTS.md", "CLAUDE.md", "LOADOUTS.md", ".claude/CLAUDE.md", ".claude/LOADOUTS.md", ".codex/AGENTS.md", ".codex/LOADOUTS.md"];
  report.instructions = [...new Set([...files(project, instructions), ...files(user, instructions.filter(p => !p.startsWith(".codex/"))), ...files(codexUserHome(), ["AGENTS.md", "LOADOUTS.md"])])];

  const registryPath = join(user, ".claude/plugins/installed_plugins.json"), registry = map(read(registryPath), "plugins", registryPath);
  const knownPath = join(user, ".claude/plugins/known_marketplaces.json"), known = read(knownPath);
  const layers = [
    {scope: "user" as const, path: join(user, ".claude/settings.json")},
    {scope: "project" as const, path: join(project, ".claude/settings.json")},
    {scope: "project-local" as const, path: join(project, ".claude/settings.local.json")},
  ];
  const marketplaces = new Map<Scope, Record<string, any>>();
  let inherited = known;
  for (const {scope, path} of layers) {
    const data = read(path);
    inherited = {...inherited, ...map(data, "extraKnownMarketplaces", path)};
    marketplaces.set(scope, inherited);
    for (const [id, enabled] of Object.entries(map(data, "enabledPlugins", path))) {
      if (typeof enabled !== "boolean") { warning(path, "invalid plugin enabled flag"); continue; }
      const source = inherited[id.split("@").at(-1)!]?.source;
      report.plugins.push({id, scope, harness: "claude-code", enabled, path, source: source?.source === "github" ? github(source.repo) : null});
    }
  }
  for (const [id, installs] of Object.entries(registry)) {
    if (!Array.isArray(installs)) { warning(registryPath, "invalid plugin installation list"); continue; }
    for (const install of installs) {
      if (!object(install)) { warning(registryPath, "invalid plugin installation"); continue; }
      const scope: Scope | null = install.scope === "user" ? "user" : install.scope === "project" ? "project" : install.scope === "local" ? "project-local" : null;
      if (!scope || (scope !== "user" && (typeof install.projectPath !== "string" || resolve(install.projectPath) !== project))) continue;
      const existing = report.plugins.find(p => p.id === id && p.scope === scope && p.harness === "claude-code");
      const source = marketplaces.get(scope)?.[id.split("@").at(-1)!]?.source;
      const record = existing ?? {id, scope, harness: "claude-code" as const, enabled: null, path: registryPath, source: source?.source === "github" ? github(source.repo) : null};
      if (typeof install.installPath === "string") record.installPath = install.installPath;
      if (!existing) report.plugins.push(record);
    }
  }

  const mcp = (servers: Record<string, any>, harness: Harness, scope: Scope, path: string) => {
    for (const [name, server] of Object.entries(servers)) {
      if (!object(server) || (server.enabled !== undefined && typeof server.enabled !== "boolean")) { warning(path, "invalid MCP server definition"); continue; }
      report.mcp.push({name, harness, scope, path, transport: typeof server.command === "string" ? "stdio" : typeof server.url === "string" ? "http" : "unknown", enabled: server.enabled !== false});
    }
  };
  const claudePath = join(user, ".claude.json"), claude = read(claudePath);
  mcp(map(claude, "mcpServers", claudePath), "claude-code", "user", claudePath);
  for (const [path, data] of Object.entries(map(claude, "projects", claudePath))) if (resolve(path) === project) {
    if (object(data)) mcp(map(data, "mcpServers", claudePath), "claude-code", "project-local", claudePath);
    else warning(claudePath, "invalid project configuration");
  }
  const projectMcp = join(project, ".mcp.json");
  mcp(map(read(projectMcp), "mcpServers", projectMcp), "claude-code", "project", projectMcp);
  for (const [path, scope] of [[join(codexUserHome(), "config.toml"), "user"], [join(project, ".codex/config.toml"), "project"]] as const) {
    const config = read(path);
    mcp(map(config, "mcp_servers", path), "codex", scope, path);
    for (const [id, plugin] of Object.entries(map(config, "plugins", path))) {
      if (!object(plugin) || typeof plugin.enabled !== "boolean") { warning(path, "invalid plugin enabled flag"); continue; }
      const marketplace = config.marketplaces?.[id.split("@").at(-1)!];
      const source = marketplace?.source_type === "git" && typeof marketplace.source === "string" ? github(marketplace.source.replace(/^https:\/\/github\.com\//, "").replace(/\.git$/, "")) : null;
      report.plugins.push({id, harness: "codex", scope, path, enabled: plugin.enabled, source});
    }
  }

  const appliedPath = join(project, "loadouts.lock.json"), installed = map(read(appliedPath), "installed", appliedPath);
  for (const [root, scope] of [[user, "user"], [project, "project"]] as const) {
    const lockPath = join(root, scope === "user" ? ".agents/.skill-lock.json" : "skills-lock.json"), sources = map(read(lockPath), "skills", lockPath);
    for (const [directory, harness] of [[".claude/skills", "claude-code"], [".codex/skills", "codex"], [".codex/skills/.system", "codex"], [".agents/skills", "shared"]] as const) {
      const dir = scope === "user" && directory.startsWith(".codex/") ? join(codexUserHome(), directory.slice(7)) : join(root, directory);
      let names: string[];
      try { names = readdirSync(dir).sort(); }
      catch (error) {
        if ((error as {code?: string}).code !== "ENOENT") warning(dir, "cannot read skill directory");
        continue;
      }
      for (const name of names) {
        try { if (!statSync(join(dir, name), {throwIfNoEntry: false})?.isDirectory()) continue; }
        catch { warning(join(dir, name), "cannot inspect skill directory"); continue; }
        const path = join(dir, name, "SKILL.md");
        if (!fileExists(path)) continue;
        const metadata = sources[name];
        if (metadata !== undefined && !object(metadata)) warning(lockPath, "invalid skill source metadata");
        let source = metadata && (!metadata.sourceType || metadata.sourceType === "github") ? github(metadata.source) : null;
        if (!source && scope === "project") {
          const candidates = Object.entries(installed).filter(([key, value]) => key.startsWith("skill:") && (harness === "shared" || key.startsWith(`skill:${harness}:`)) && Array.isArray(value) && value.includes(name)).map(([key]) => github(key.split(":")[2]?.split("@")[0]));
          const unique = new Set(candidates);
          if (unique.size === 1) source = candidates[0] ?? null;
        }
        report.skills.push({name, harness, scope, path, source});
      }
    }
  }
  report.manifests.sort(); report.instructions.sort(); report.warnings = [...new Set(report.warnings)].sort();
  for (const records of [report.plugins, report.skills, report.mcp]) records.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return report;
}
