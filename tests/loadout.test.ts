import { test, expect } from "bun:test";
import { parseLoadout, defaultChoices, activeItems, artifactsFor, sourceFor } from "../src/loadout";
import { baseYaml } from "./helpers";

test("defaults and selections resolve stable item ids", () => {
  const base = parseLoadout(baseYaml, "base.yml");
  expect(defaultChoices(base)).toEqual({ methodology: ["superpowers"] });
  expect(activeItems(base, { methodology: ["agent-skills"] }).map(a => a.id)).toEqual(["base/methodology/agent-skills", "base/ponytail"]);
});
test("artifact keys preserve harness and marketplace identities", () => {
  const base = parseLoadout(baseYaml, "base.yml");
  const a = activeItems(base, defaultChoices(base))[0]!;
  expect([...artifactsFor(a, "claude-code").keys()]).toEqual(["plugin:superpowers@superpowers-dev", "marketplace:superpowers-dev:obra/superpowers"]);
  expect([...artifactsFor(a, "codex").keys()]).toEqual(["skill:codex:obra/superpowers"]);
  expect([...artifactsFor(activeItems(base, { methodology: ["agent-skills"] })[0]!, "claude-code").keys()]).toEqual(["skill:claude-code:addyosmani/agent-skills"]);
});
test("Codex plugins have distinct artifact identities and typed routing", () => {
  const l = parseLoadout('name: base\nitems: {ponytail: {codex: {plugin: ponytail@ponytail, marketplace: DietrichGebert/ponytail}, claude: {plugin: ponytail@ponytail, marketplace: DietrichGebert/ponytail}}}\nrouting: [{when: Coding, use: [plugin:ponytail]}]', "base.yml");
  const item = activeItems(l, {})[0]!;
  expect([...artifactsFor(item, "codex").keys()]).toEqual(["codex-plugin:ponytail@ponytail", "codex-marketplace:ponytail:DietrichGebert/ponytail"]);
  expect([...artifactsFor(item, "claude-code").keys()]).toEqual(["plugin:ponytail@ponytail", "marketplace:ponytail:DietrichGebert/ponytail"]);
});
test.each([
  ["one_of default must be a string", baseYaml.replace("default: superpowers", "default: [superpowers]"), "default"],
  ["any_of default must be a list", "name: base\nitems: {g: {any_of: {a: {skills: [a/b]}}, default: a}}", "default"],
  ["default must name a member", baseYaml.replace("default: superpowers", "default: nope"), "default"],
  ["routing must resolve", baseYaml.replace("use: [methodology]", "use: [nope]"), 'routing reference "nope" points to nothing declared in this loadout'],
  ["codex plugins require a marketplace", baseYaml.replace("codex: { skills: [obra/superpowers] }", "codex: { plugin: x@y }"), "marketplace"],
  ["common plugins are rejected", "name: base\nitems: {x: {plugin: x@y}}", "harness-specific"],
  ["name must match file", baseYaml.replace("name: base", "name: other"), "name"],
])("%s", (_, yaml, message) => {
  try { parseLoadout(yaml, "base.yml"); throw new Error("accepted invalid loadout"); }
  catch (e: any) { expect(e.code).toBe(1); expect(e.message).toContain("base.yml"); expect(e.message).toContain(message); }
});
test("typed routing references resolve all source forms", () => {
  expect(parseLoadout(`name: base
items:
  x:
    skills: [a/repo@skill]
    claude: {plugin: plug@market}
    mcp: {server: {command: bun}}
routing:
  - when: work
    use: [skill:skill, skill:repo, plugin:plug, mcp:server, x]
`, "base.yml").routing).toHaveLength(1);
  expect(sourceFor({ skills: ["a/b"], mcp: { s: {command: "bun"} }, codex: { skills: ["c/d"] } }, "codex")).toEqual({ skills: ["c/d"], mcp: { s: { command: "bun" } } });
});

test("a Claude override cannot hide an unsupported common Codex plugin", () => {
  expect(() => parseLoadout('name: base\nitems: {x: {plugin: plug@market, claude: {skills: [a/b]}}}', "base.yml")).toThrow("harness-specific");
});

test.each([
  null, [], {}, {include: "@acme/ui"}, {include: ["../escape"]},
  {include: ["@acme/ui@3"]}, {include: ["*"]}, {include: ["@acme/ui#../bad"]},
  {include: ["@acme/ui"], exclude: "bad"}, {include: ["@acme/ui"], typo: []},
].map(value => [value]))("invalid package skill selection is rejected: %j", packageSkills => {
  expect(() => parseLoadout(JSON.stringify({name: "work", items: {ui: {packageSkills}}}), "work.yml")).toThrow("packageSkills");
});

test("package selections survive alternatives and harness overrides", () => {
  const loadout = parseLoadout(`name: work\nitems:\n  ui:\n    one_of:\n      library:\n        packageSkills: {include: ['@acme/ui'], exclude: ['@acme/ui#experimental']}\n        codex: {packageSkills: {include: ['@acme/ui#forms']}}\n    default: library\nrouting: [{when: Building forms, use: [ui]}]\n`, "work.yml");
  const item = activeItems(loadout, {})[0]!;
  expect(sourceFor(item.item, "claude-code").packageSkills).toEqual({include: ["@acme/ui"], exclude: ["@acme/ui#experimental"]});
  expect(sourceFor(item.item, "codex").packageSkills).toEqual({include: ["@acme/ui#forms"]});
});

test("installer selections produce shared service MCP and per-harness integration artifacts", () => {
  const loadout = parseLoadout('name: memory\nitems: {graph: {installer: codebase-memory}}\nrouting: [{when: Exploring code, use: [graph, mcp:codebase-memory-mcp]}]', "memory.yml");
  for (const h of ["claude-code", "codex"] as const) {
    expect([...artifactsFor(activeItems(loadout, {})[0]!, h)]).toEqual([
      [`installer:${h}:codebase-memory`, null],
      [`mcp:${h}:codebase-memory-mcp`, {command: "codebase-memory-mcp", args: []}],
    ]);
  }
  const scoped = parseLoadout('name: memory\nitems: {graph: {codex: {installer: codebase-memory}}}', "memory.yml");
  expect([...artifactsFor(activeItems(scoped, {})[0]!, "claude-code")]).toEqual([]);
});

test.each([null, "unknown", {command: "sh", args: ["evil"]}, ["codebase-memory"]].map(value => [value]))("rejects unsupported installer %j", installer => {
  expect(() => parseLoadout(JSON.stringify({name: "memory", items: {graph: {installer}}}), "memory.yml")).toThrow("installer");
});

test.each([
  {skills: ["a/b"]}, {mcp: {other: {command: "bun"}}},
  {codex: {skills: ["a/b"]}}, {claude: {plugin: "x@y"}},
])("rejects ambiguous installer and component sources %j", extra => {
  expect(() => parseLoadout(JSON.stringify({name: "memory", items: {graph: {installer: "codebase-memory", ...extra}}}), "memory.yml")).toThrow("installer");
});
