import { test, expect } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spliceSection, renderSection, ensureClaudeImport } from "../src/agentsmd";
import { parseLoadout } from "../src/loadout";
import { tempEnv, baseYaml } from "./helpers";

const begin = "<!-- loadouts:begin -->", end = "<!-- loadouts:end -->";
test("splicing preserves every byte surrounding an existing section", () => {
  const before = "# User\r\n  spaces\n\n", after = "\n\nFooter  \r\n";
  expect(spliceSection(before + begin + "old" + end + after, begin + "new" + end)).toBe(before + begin + "new" + end + after);
});
test("append inserts exactly one blank line and removal restores user text", () => {
  const section = begin + "\ntext\n" + end;
  expect(spliceSection("user", section)).toBe("user\n\n" + section);
  expect(spliceSection("user\n", section)).toBe("user\n\n" + section);
  expect(spliceSection("user\n\n", section)).toBe("user\n\n" + section);
  expect(spliceSection("user\n\n" + section, "")).toBe("user\n");
});
test.each([begin, end, end + begin, begin + begin + end])("unbalanced markers refuse destructive edits: %s", text => {
  try { spliceSection(text, "replacement"); throw new Error("accepted broken markers"); }
  catch (e: any) { expect(e.code).toBe(1); expect(e.message).toContain(begin); expect(e.message).toContain(end); }
});
test("routing reflects chosen members and installed skill names", () => {
  const section = renderSection([{ loadout: parseLoadout(baseYaml, "base.yml"), choices: {methodology: ["agent-skills"]} }], ["claude-code", "codex"], {"skill:codex:DietrichGebert/ponytail": ["ponytail", "ponytail-audit"]});
  expect(section).toContain("agent-skills"); expect(section).not.toContain("superpowers");
  expect(section).toContain("plugin `ponytail` (Claude Code); skills `ponytail`, `ponytail-audit` (Codex)");
  expect(section).toContain("**base/ponytail:** Terse code");
  expect(renderSection([], ["codex"], {})).toBe("");
});
test("typed routing only labels the requested source", () => {
  const l = parseLoadout('name: frontend\nitems: {ui: {skills: [shadcn/ui@shadcn], mcp: {shadcn: {command: bun}}}}\nrouting: [{when: UI, use: [skill:shadcn, mcp:shadcn]}]', "frontend.yml");
  const text = renderSection([{loadout: l, choices: {}}], ["claude-code", "codex"], {});
  expect(text.match(/MCP server `shadcn`/g)).toHaveLength(1);
  expect(text).not.toContain("(Codex)");
});
test("Claude import is appended only once", () => {
  const {project} = tempEnv();
  writeFileSync(join(project, "CLAUDE.md"), "my rules");
  expect(ensureClaudeImport(project)).toBe(true);
  expect(ensureClaudeImport(project)).toBe(false);
  expect(readFileSync(join(project, "CLAUDE.md"), "utf8")).toBe("my rules\n@AGENTS.md\n");
});

test.each([false, true])("routing omits empty any_of targets (explicit selection: %s)", explicit => {
  const loadout = parseLoadout(`name: content
items:
  imports:
    any_of:
      cms: {skills: [acme/content@import]}
    default: ${explicit ? "[cms]" : "[]"}
  editing: {skills: [acme/content@edit]}
routing:
  - when: Importing content from another CMS into Payload
    use: [imports]
  - when: Importing through a skill reference
    use: [skill:import]
  - when: Working with content
    use: [imports, editing]
`, "content.yml");
  const choices = explicit ? {imports: []} : {};
  const empty = renderSection([{loadout, choices}], ["claude-code", "codex"], {});
  expect(empty).not.toContain("| Importing");
  expect(empty).toContain("| Working with content | skills `acme/content@edit` |");
  const selected = renderSection([{loadout, choices: {imports: ["cms"]}}], ["codex"], {});
  expect(selected).toContain("| Importing content from another CMS into Payload | skills `acme/content@import` |");
});

test("nested routing expands active descendants by segments and attributes container conventions once", () => {
  const loadout = parseLoadout(JSON.stringify({name: "testing", items: {
    languages: {any_of: {
      py: {skills: ["acme/container@container"], conventions: "Container rules", items: {
        framework: {one_of: {pytest: {skills: ["acme/tests@pytest"], conventions: "Pytest rules"}, unittest: {skills: ["acme/tests@unittest"]}}, default: "pytest"},
      }},
      python: {skills: ["acme/python@python"]},
    }, default: ["py", "python"]},
  }, routing: [
    {when: "Python tests", use: ["languages/py"]},
    {when: "Selected framework", use: ["languages/py/framework/pytest"]},
    {when: "Inactive framework", use: ["languages/py/framework/unittest"]},
    {when: "Typed tests", use: ["skill:pytest"]},
  ]}), "testing.yml");
  const text = renderSection([{loadout, choices: {}}], ["codex"], {});
  expect(text).toContain("| Python tests | skills `acme/container@container`; skills `acme/tests@pytest` | testing/languages/py |");
  expect(text).toContain("| Selected framework | skills `acme/tests@pytest` |");
  expect(text).toContain("| Typed tests | skills `acme/tests@pytest` |");
  expect(text).not.toContain("| Inactive framework"); expect(text).not.toContain("acme/python@python");
  expect(text.match(/\*\*testing\/languages\/py:\*\* Container rules/g)).toHaveLength(1);
  expect(text).toContain("**testing/languages/py/framework/pytest:** Pytest rules");
});
