import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { CliError } from "./errors";
import { writeIfChanged } from "./paths";
import { expandProject } from "./codex";
import type { McpServer } from "./loadout";

export function applyClaude(project: string, add: Map<string, McpServer | null>, remove: string[]): boolean {
  const updates = new Map<string, Record<string, any>>();
  for (const key of new Set([...remove, ...add.keys()])) {
    let file: string, field: string, name: string, value: any;
    if (key.startsWith("plugin:")) {
      file = ".claude/settings.json"; field = "enabledPlugins"; name = key.slice(7); value = true;
    } else if (key.startsWith("marketplace:")) {
      const [, n, repo] = key.split(":");
      file = ".claude/settings.json"; field = "extraKnownMarketplaces"; name = n!; value = {source: {source: "github", repo}};
    } else if (key.startsWith("mcp:claude-code:")) {
      file = ".mcp.json"; field = "mcpServers"; name = key.slice(16);
      const server = add.get(key);
      if (server) { const s = expandProject(server, project); value = s.url ? {type: "http", url: s.url} : s; }
    } else continue;
    if (!updates.has(file)) {
      const path = join(project, file);
      let data: any;
      try {
        data = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : {};
        if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error();
      } catch { throw new CliError(`invalid JSON object in ${file}`, 1, `repair ${file}, then rerun`); }
      updates.set(file, data);
    }
    const data = updates.get(file)!;
    if (data[field] !== undefined && (!data[field] || typeof data[field] !== "object" || Array.isArray(data[field]))) throw new CliError(`invalid ${field} in ${file}`, 1, `make ${field} a JSON object, then rerun`);
    data[field] ??= {};
    if (add.has(key)) Object.defineProperty(data[field], name, {value, enumerable: true, configurable: true, writable: true});
    else delete data[field][name];
  }
  let changed = false;
  for (const [file, data] of updates) changed = writeIfChanged(join(project, file), JSON.stringify(data, null, 2) + "\n") || changed;
  return changed;
}
