import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { scanGlobals, readJson } from "./globals";
import { home, writeIfChanged } from "./paths";
import { codexUserHome } from "./codex";
import { CliError } from "./errors";

export async function prune(yes: boolean): Promise<string[]> {
  const global = await scanGlobals(), changes: string[] = [];
  const settingsFile = join(home(), ".claude/settings.json"), configFile = join(codexUserHome(), "config.toml");
  const settings = readJson(settingsFile);
  for (const plugin of global.claudePlugins) { changes.push(`${yes ? "Disabled" : "Disable"} Claude plugin ${plugin}`); settings.enabledPlugins[plugin] = false; }
  for (const skill of global.claudeSkills) {
    changes.push(`${yes ? "Disabled" : "Disable"} Claude skill ${skill}`);
    settings.skillOverrides ??= {};
    Object.defineProperty(settings.skillOverrides, skill, {value: "off", enumerable: true, configurable: true, writable: true});
  }
  let config: string | undefined;
  if (global.codexMcp.length) {
    const original = readFileSync(configFile, "utf8"), expected = Bun.TOML.parse(original) as any;
    for (const name of global.codexMcp) { changes.push(`${yes ? "Disabled" : "Disable"} Codex MCP server ${name}`); expected.mcp_servers[name].enabled = false; }
    // ponytail: Bun has no TOML writer; preserve text and verify only enabled flags changed.
    config = original.replace(/(^[ \t]*\[[^\r\n]+\][ \t]*(?:#[^\r\n]*)?\r?\n)([\s\S]*?)(?=^[ \t]*\[|(?![\s\S]))/gm, (block, header: string, body: string) => {
      let table: any;
      try { table = Bun.TOML.parse(header + "__loadouts_probe = true\n"); } catch { return block; }
      const name = Object.keys(table.mcp_servers ?? {})[0];
      if (!name || !global.codexMcp.includes(name) || table.mcp_servers[name].__loadouts_probe !== true) return block;
      const enabled = /^([ \t]*(?:enabled|"enabled"|'enabled')[ \t]*=[ \t]*)(?:true|false)([ \t]*(?:#[^\r\n]*)?)(\r?$)/m;
      return header + (enabled.test(body) ? body.replace(enabled, "$1false$2$3") : `enabled = false${header.endsWith("\r\n") ? "\r\n" : "\n"}` + body);
    });
    let valid = false;
    try { valid = isDeepStrictEqual(Bun.TOML.parse(config), expected); } catch { /* Refuse unsupported layouts before writing any files. */ }
    if (!valid) throw new CliError("cannot safely edit the Codex MCP table layout", 1, `set enabled = false in the MCP server tables in ${configFile}, then rerun`);
  }
  const quote = (s: string) => /^[\w@./-]+$/.test(s) ? s : "'" + s.replaceAll("'", "'\\''") + "'";
  for (const name of global.claudeMcp) changes.push(`Run manually: claude mcp remove -s user ${quote(name)}`);
  for (const skill of global.npxSkills) changes.push(`Run manually: npx skills remove -g ${quote(skill.name)}`);
  for (const name of global.codexSkills) changes.push(`Run manually: rm -r ${quote(join(codexUserHome(), "skills", name))}`);
  if (yes) {
    if (global.claudePlugins.length || global.claudeSkills.length) writeIfChanged(settingsFile, JSON.stringify(settings, null, 2) + "\n");
    if (config !== undefined) writeIfChanged(configFile, config);
  }
  return changes;
}
