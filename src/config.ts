import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { CliError } from "./errors";
import { home, configFile, writeIfChanged } from "./paths";
import type { Harness } from "./loadout";

export interface UserConfig { catalog: string; harnesses: Harness[] }
export function parseHarnesses(value: string): Harness[] {
  const harnesses = value.split(",");
  if (harnesses.some(h => h !== "claude-code" && h !== "codex")) throw new CliError(`unknown harness in "${value}"`, 2, "use claude-code,codex");
  return [...new Set(harnesses)] as Harness[];
}
export function readConfig(): UserConfig {
  const file = configFile();
  if (!existsSync(file)) return { catalog: "katisfaktion/agent-loadouts", harnesses: ["claude-code", "codex"] };
  try {
    const c = Bun.TOML.parse(readFileSync(file, "utf8")) as unknown as UserConfig;
    if (typeof c.catalog !== "string" || !c.catalog || !Array.isArray(c.harnesses)) throw new Error("invalid fields");
    return { catalog: c.catalog, harnesses: parseHarnesses(c.harnesses.join(",")) };
  } catch { throw new CliError(`invalid config ${file}`, 1, "run loadouts setup --catalog <repo> --harness claude-code,codex"); }
}
export function setup(config: UserConfig): string[] {
  const changed: string[] = [];
  if (writeIfChanged(configFile(), `catalog = ${JSON.stringify(config.catalog)}\nharnesses = ${JSON.stringify(config.harnesses)}\n`)) changed.push(configFile());
  const hints = ["Agent setups are managed by `loadouts`; see `loadouts help`.", "Read bundled workflow guides with `loadouts agents`."];
  for (const h of config.harnesses) {
    const dir = join(home(), h === "codex" ? ".codex" : ".claude");
    const guide = join(dir, "LOADOUTS.md");
    const notes = existsSync(guide) ? readFileSync(guide, "utf8") : "";
    const missing = hints.filter(line => !notes.includes(line));
    const newline = notes.includes("\r\n") ? "\r\n" : "\n";
    if (missing.length && writeIfChanged(guide, notes + (notes && !notes.endsWith("\n") ? newline : "") + missing.join(newline) + newline)) changed.push(guide);
    const reference = h === "codex" ? `@${guide}` : "@LOADOUTS.md";
    const file = join(dir, h === "codex" ? "AGENTS.md" : "CLAUDE.md");
    const text = existsSync(file) ? readFileSync(file, "utf8") : "";
    if (!text.split(/\r?\n/).includes(reference) && writeIfChanged(file, text + (text && !text.endsWith("\n") ? "\n" : "") + reference + "\n")) changed.push(file);
  }
  return changed;
}
