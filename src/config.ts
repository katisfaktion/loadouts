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
function updateGuide(notes: string): string {
  const pointer = "When asked to set up, restore, change, troubleshoot or share project loadouts, run `loadouts agents` and read the matching guide.";
  const previousHints = ["Agent setups are managed by `loadouts`; see `loadouts help`.", "Read bundled workflow guides with `loadouts agents`."];
  const newline = notes.includes("\r\n") ? "\r\n" : "\n";
  let hasPointer = false;
  let updated = "";
  for (const line of notes.split(/(?<=\n)/)) {
    const content = line.replace(/\r?\n$/, "");
    if (content !== pointer && !previousHints.includes(content)) updated += line;
    else if (!hasPointer) {
      updated += pointer + line.slice(content.length);
      hasPointer = true;
    }
  }
  if (!hasPointer) updated += (updated && !updated.endsWith("\n") ? newline : "") + pointer + newline;
  return updated;
}

export function setupInstructions(harnesses: Harness[]) {
  return harnesses.flatMap(harness => {
    const dir = join(home(), harness === "codex" ? ".codex" : ".claude");
    const guide = join(dir, "LOADOUTS.md");
    const reference = harness === "codex" ? `@${guide}` : "@LOADOUTS.md";
    return [
      {file: guide, description: "loadouts agents workflow guidance", update: updateGuide},
      {file: join(dir, harness === "codex" ? "AGENTS.md" : "CLAUDE.md"), description: reference,
        update: (text: string) => text.split(/\r?\n/).includes(reference) ? text : text + (text && !text.endsWith("\n") ? "\n" : "") + reference + "\n"},
    ];
  });
}

export function setup(config: UserConfig): string[] {
  const changed: string[] = [];
  if (writeIfChanged(configFile(), `catalog = ${JSON.stringify(config.catalog)}\nharnesses = ${JSON.stringify(config.harnesses)}\n`)) changed.push(configFile());
  for (const {file, update} of setupInstructions(config.harnesses)) {
    const text = existsSync(file) ? readFileSync(file, "utf8") : "";
    if (writeIfChanged(file, update(text))) changed.push(file);
  }
  return changed;
}
