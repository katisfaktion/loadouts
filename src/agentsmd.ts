import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { CliError } from "./errors";
import { writeIfChanged } from "./paths";
import { activeItems, sourceFor, type Loadout, type Choices, type Harness } from "./loadout";

import { selectsPackageSkill } from "./package-skills";

const begin = "<!-- loadouts:begin -->", end = "<!-- loadouts:end -->";
export function spliceSection(existing: string, section: string): string {
  const start = existing.indexOf(begin), finish = existing.indexOf(end);
  if (start < 0 && finish < 0) {
    if (!section) return existing;
    return existing + (existing ? existing.endsWith("\n\n") ? "" : existing.endsWith("\n") ? "\n" : "\n\n" : "") + section;
  }
  if (start < 0 || finish < start || existing.indexOf(begin, start + begin.length) >= 0 || existing.indexOf(end, finish + end.length) >= 0) {
    throw new CliError(`AGENTS.md must contain one ordered pair of ${begin} and ${end}`, 1, "repair the loadouts markers without deleting your own text, then rerun");
  }
  let prefix = existing.slice(0, start);
  if (!section && prefix.endsWith("\n\n")) prefix = prefix.slice(0, -1);
  return prefix + section + existing.slice(finish + end.length);
}
export function ensureClaudeImport(project: string): boolean {
  const file = join(project, "CLAUDE.md"), existing = existsSync(file) ? readFileSync(file, "utf8") : "";
  if (existing.split(/\r?\n/).some(line => line.trim() === "@AGENTS.md")) return false;
  return writeIfChanged(file, existing + (existing && !existing.endsWith("\n") ? "\n" : "") + "@AGENTS.md\n");
}
export function renderSection(loaded: { loadout: Loadout; choices: Choices }[], harnesses: Harness[], installed: Record<string, string[]>, installerInstructions = ""): string {
  if (!loaded.length) return "";
  const lines = [begin, "## Agent loadouts", "", `Managed by \`loadouts\` (${loaded.map(x => x.loadout.name).join(", ")}). Change with \`loadouts help\`, not by editing this section.`, "", "### When to use what", "", "| When | Use |", "| --- | --- |"];
  const conventions: string[] = [];
  const escape = (s: string) => s.replaceAll("|", "\\|").replaceAll("\n", "<br>");
  for (const { loadout, choices } of loaded) {
    const active = activeItems(loadout, choices);
    for (const row of loadout.routing) {
      const labels = new Map<string, Harness[]>();
      for (const h of harnesses) for (const ref of row.use) {
        const [type, name] = ref.split(":");
        for (const a of active) {
          if (!name && a.id.split("/")[1] !== ref) continue;
          const s = sourceFor(a.item, h), found: string[] = [];
          if (s.installer && (!name || type === "mcp" && name === "codebase-memory-mcp")) found.push("MCP server `codebase-memory-mcp`");
          if (s.plugin && (!name || (type === "plugin" && s.plugin.split("@")[0] === name))) found.push(`plugin \`${s.plugin.split("@")[0]}\``);
          const skills = (s.skills ?? []).filter(id => !name || (type === "skill" && (id.split("@")[1] === name || id.split("/")[1]?.split("@")[0] === name)));
          if (skills.length) found.push("skills " + [...new Set(skills.flatMap(id => installed[`skill:${h}:${id}`] ?? [id]))].map(n => `\`${n}\``).join(", "));
          if (!name && s.packageSkills) {
            const companions = Object.keys(installed).filter(k => k.startsWith(`package-skill:${h}:`)).flatMap(k => {
              const [pkg, skill] = k.split(":")[2]!.split("#");
              return selectsPackageSkill(s.packageSkills!, pkg!, skill!) ? [skill!] : [];
            });
            if (companions.length) found.push("skills " + [...new Set(companions)].sort().map(n => `\`${n}\``).join(", "));
          }
          for (const server of Object.keys(s.mcp ?? {})) if (!name || (type === "mcp" && server === name)) found.push(`MCP server \`${server}\``);
          for (const label of found) {
            const hs = labels.get(label) ?? [];
            if (!hs.includes(h)) hs.push(h);
            labels.set(label, hs);
          }
        }
      }
      const text = [...labels].map(([label, hs]) => label + (harnesses.length > 1 && hs.length !== harnesses.length ? ` (${hs[0] === "codex" ? "Codex" : "Claude Code"})` : ""));
      if (text.length) lines.push(`| ${escape(row.when)} | ${text.map(escape).join("; ")} |`);
    }
    if (loadout.conventions) conventions.push(`- **${loadout.name}:** ${loadout.conventions}`);
    for (const a of active) if (a.item.conventions) conventions.push(`- **${a.id.split("/").at(-1)}:** ${a.item.conventions}`);
  }
  if (conventions.length) lines.push("", "### Conventions", "", ...conventions);
  if (installerInstructions.trim()) lines.push("", installerInstructions.trim());
  lines.push(end);
  return lines.join("\n");
}
