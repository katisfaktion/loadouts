import { validateSelection } from "../src/sources";
import { test, expect } from "bun:test";
import { parseLoadout, defaultChoices, activeItems, artifactsFor, sourceFor, declaredItems, resolveChoices, includeDeclarations, activeIncludes } from "../src/loadout";
import { baseYaml } from "./helpers";
import { CliError } from "../src/errors";

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

const includes = {testing: {source: "github:acme/catalog/testing@v1.0.0", choices: {tools: []}}};
test("includes retain selections and allow composition without items", () => {
  const parsed = parseLoadout(JSON.stringify({name: "work", includes}), "work.yml");
  expect(parsed).toEqual({name: "work", includes, items: {}, routing: []});
  expect(parseLoadout(JSON.stringify({name: "work", includes, items: {own: {conventions: "Local guidance"}}}), "work.yml").includes).toEqual(includes);
  expect(parseLoadout('name: work\nitems: {}', "work.yml")).toEqual({name: "work", items: {}, routing: []});
});
test.each([
  {testing: {source: "github:acme/catalog/other"}},
  {testing: {source: "testing"}},
  {testing: {...includes.testing, typo: true}},
  {testing: {...includes.testing, choices: "tools"}},
  {testing: {...includes.testing, choices: {tools: ["a", "a"]}}},
  {testing: {...includes.testing, choices: {"bad//group": []}}},
  {testing: {...includes.testing, choices: {tools: ["../bad"]}}},
  null, [], "testing",
].map(value => [value]))("invalid includes are contextualized: %j", includes => {
  expect(() => parseLoadout(JSON.stringify({name: "work", items: {}, includes}), "work.yml")).toThrow("work.yml: includes");
});
test.each([{name: "work"}, {name: "work", includes: {}}])("items remain required without nonempty includes: %j", value => {
  expect(() => parseLoadout(JSON.stringify(value), "work.yml")).toThrow("items");
});
test("parent routing cannot reach included namespaces", () => {
  expect(() => parseLoadout(JSON.stringify({name: "work", includes, items: {}, routing: [{when: "Testing", use: ["testing/tools"]}]}), "work.yml")).toThrow("routing reference");
});
test("editor schema permits includes-only compositions with strict selection fields", async () => {
  const schema = await Bun.file(new URL("../schemas/v1/loadout.schema.json", import.meta.url)).json();
  expect(schema.required).toEqual(["name"]);
  expect(schema.anyOf).toEqual([{required: ["items"]}, {required: ["includes"], properties: {includes: {minProperties: 1}}}]);
  expect(schema.properties.includes.additionalProperties).toEqual({$ref: "#/definitions/selection"});
  expect(schema.definitions.selection.additionalProperties).toBe(false);
  expect(schema.definitions.selection.required).toEqual(["source"]);
  expect(schema.definitions.selection.properties.choices.additionalProperties.uniqueItems).toBe(true);
});

const nestedYaml = `name: nested
items:
  languages:
    one_of:
      python:
        conventions: Python container
        skills: [acme/python]
        items:
          framework:
            one_of:
              pytest:
                includes: {testing: {source: "github:acme/catalog/testing", choices: {tools: []}}}
                items: {deep: {conventions: Deep leaf}}
              unittest: {}
            default: pytest
          extras:
            any_of: {coverage: {skills: [acme/coverage]}}
            default: []
      javascript: {}
    default: python
`;
test("nested choices resolve containers and leaves with full paths", () => {
  const l = parseLoadout(nestedYaml, "nested.yml");
  expect(defaultChoices(l)).toEqual({languages: ["python"], "languages/python/framework": ["pytest"], "languages/python/extras": []});
  expect(activeItems(l, {}).map(a => a.id)).toEqual(["nested/languages/python", "nested/languages/python/framework/pytest", "nested/languages/python/framework/pytest/deep"]);
  expect(Object.keys(declaredItems(l))).toContain("languages/python/framework/unittest");
  expect(sourceFor(activeItems(l, {})[0]!.item, "codex")).toEqual({skills: ["acme/python"]});
  expect(resolveChoices(l, {languages: ["javascript"]})).toEqual({languages: ["javascript"]});
  expect(() => resolveChoices(l, {languages: ["javascript"], "languages/python/extras": []})).toThrow("inactive");
  expect(() => resolveChoices(l, {languages: []})).toThrow();
  expect(() => resolveChoices(l, {"languages//python": []})).toThrow("unknown group");
});
test("include declarations preserve inactive occurrences and aggregate compatible requests", () => {
  const l = parseLoadout(nestedYaml, "nested.yml");
  expect(includeDeclarations(l).map(d => d.path)).toEqual(["items.languages.one_of.python.items.framework.one_of.pytest.includes.testing"]);
  expect(includeDeclarations(l, {languages: ["javascript"]})).toEqual([]);
  expect(activeIncludes(l, {})).toEqual({testing: {source: "github:acme/catalog/testing", choices: {tools: []}}});
  const shared = parseLoadout(`name: shared
includes: {testing: {source: "github:acme/catalog/testing", choices: {a: [x]}}}
items: {more: {includes: {testing: {source: "github:acme/catalog/testing", choices: {b: []}}}}}`, "shared.yml");
  expect(activeIncludes(shared, {})).toEqual({testing: {source: "github:acme/catalog/testing", choices: {a: ["x"], b: []}}});
  (shared.items.more as any).includes.testing.choices = {a: []};
  expect(() => activeIncludes(shared, {})).toThrow("items.more.includes.testing");
  expect(() => activeIncludes(shared, {})).toThrow("includes.testing");
});
test("empty parent choices suppress descendant defaults and prototype names are safe", () => {
  const l = parseLoadout(`name: nested
items: {__proto__: {any_of: {constructor: {items: {toString: {any_of: {x: {}}, default: [x]}}}}, default: [constructor]}}`, "nested.yml");
  expect(defaultChoices(l)).toEqual({["__proto__"]: ["constructor"], "__proto__/constructor/toString": ["x"]});
  expect(resolveChoices(l, {["__proto__"]: []})).toEqual({["__proto__"]: []});
});
test.each([
  'items: {x: {codex: {items: {bad: {}}}}}',
  'items: {x: {one_of: {a: {}}, default: a, skills: [a/b]}}',
  'items: {x: {items: {nested: {kind: one_of}}}}',
  'items: {x: &loop {items: {again: *loop}}}',
  'items: {x: {items: {g: {one_of: {a: {}}, default: missing}}}}',
])("recursive invalid declarations fail safely: %s", body => {
  expect(() => parseLoadout("name: nested\n" + body, "nested.yml")).toThrow();
});
test("routing accepts declared nested paths and recursive components", () => {
  expect(parseLoadout(nestedYaml + "routing: [{when: Testing, use: [languages/python/framework/pytest/deep, skill:python]}]", "nested.yml").routing).toHaveLength(1);
});

test.each([
  ["inactive MCP configuration", `items:
  dormant:
    any_of:
      x:
        mcp:
          loop: &loop
            command: echo
            extra: *loop
    default: []`],
  ["routing properties", `items: {}
routing:
  - &loop
    when: Coding
    use: []
    extra: *loop`],
])("rejects cyclic YAML aliases in %s", (_, body) => {
  try { parseLoadout("name: probe\n" + body, "probe.yml"); throw new Error("accepted cyclic loadout"); }
  catch (error: any) {
    expect(error).toBeInstanceOf(CliError);
    expect(error.code).toBe(1);
    expect(error.message).toContain("probe.yml");
    expect(error.message).toContain("cyclic YAML alias");
  }
});
test("noncyclic shared YAML aliases remain serializable", () => {
  const parsed = parseLoadout(`name: shared
items:
  first: &item
    mcp: {server: {command: echo, args: [shared]}}
  second: *item
routing:
  - &row {when: Coding, use: [first, second]}
  - *row`, "shared.yml");
  const shown = JSON.parse(JSON.stringify(parsed));
  expect(shown.items.first.mcp.server).toEqual({command: "echo", args: ["shared"]});
  expect(shown.items.second).toEqual(shown.items.first);
  expect(shown.routing).toEqual([{when: "Coding", use: ["first", "second"]}, {when: "Coding", use: ["first", "second"]}]);
});

// Interpret the schema keywords used by these fixtures without adding a validator dependency.
function matchesSchema(value: any, schema: any, root = schema): boolean {
  if (schema.$ref) return matchesSchema(value, schema.$ref.slice(2).split("/").reduce((node: any, key: string) => node[key], root), root);
  const match = (s: any, v = value) => matchesSchema(v, s, root);
  if (schema.type && ({object: () => value !== null && typeof value === "object" && !Array.isArray(value), array: () => Array.isArray(value), string: () => typeof value === "string"} as any)[schema.type]?.() === false) return false;
  if (schema.enum && !schema.enum.includes(value)) return false;
  if (schema.pattern && !new RegExp(schema.pattern).test(value)) return false;
  if (schema.minLength && value.length < schema.minLength) return false;
  if (schema.oneOf && schema.oneOf.filter((s: any) => match(s)).length !== 1) return false;
  if (schema.anyOf && !schema.anyOf.some((s: any) => match(s))) return false;
  if (Array.isArray(value)) {
    if (schema.uniqueItems && new Set(value.map(v => JSON.stringify(v))).size !== value.length) return false;
    if (schema.items && !value.every(v => match(schema.items, v))) return false;
  } else if (value !== null && typeof value === "object") {
    if (schema.required?.some((k: string) => !Object.hasOwn(value, k))) return false;
    if (schema.minProperties && Object.keys(value).length < schema.minProperties) return false;
    for (const [key, v] of Object.entries(value)) {
      if (schema.propertyNames && !match(schema.propertyNames, key)) return false;
      if (Object.hasOwn(schema.properties ?? {}, key)) { if (!match(schema.properties[key], v)) return false; }
      else if (schema.additionalProperties === false || typeof schema.additionalProperties === "object" && !match(schema.additionalProperties, v)) return false;
    }
  }
  return true;
}
test("recursive editor schema agrees with parser for nested structures and selection paths", async () => {
  const schema = await Bun.file(new URL("../schemas/v1/loadout.schema.json", import.meta.url)).json();
  for (const [yaml, valid] of [
    [nestedYaml, true],
    [nestedYaml.replace("tools: []", 'languages/python/framework: [pytest]'), true],
    [nestedYaml.replace("skills: [acme/python]", "codex: {items: {bad: {}}}"), false],
    [nestedYaml.replace("items: {deep: {conventions: Deep leaf}}", "items: {deep: {kind: one_of}}"), false],
    [nestedYaml.replace("tools: []", 'languages//framework: []'), false],
    [nestedYaml.replace("default: pytest", "default: [pytest]"), false],
  ] as const) {
    expect(matchesSchema(Bun.YAML.parse(yaml), schema)).toBe(valid);
    if (valid) expect(() => parseLoadout(yaml, "nested.yml")).not.toThrow();
    else expect(() => parseLoadout(yaml, "nested.yml")).toThrow();
  }
  const manifestSchema = await Bun.file(new URL("../schemas/v1/manifest.schema.json", import.meta.url)).json();
  for (const [path, valid] of [["languages/python/framework", true], ["languages//framework", false], ["/languages", false], ["languages/", false]] as const) {
    expect(matchesSchema({harnesses: [], loadouts: {nested: {source: "github:acme/catalog/nested", choices: {[path]: []}}}}, manifestSchema)).toBe(valid);
  }
});

test("explicit choices enforce cardinality and reject malformed or inactive descendants", () => {
  const l = parseLoadout(nestedYaml, "nested.yml");
  for (const members of [["python", "javascript"], ["python", "python"], ["missing"], [null], "python"]) {
    expect(() => resolveChoices(l, {languages: members} as any)).toThrow();
  }
  expect(() => resolveChoices(l, {languages: ["javascript"], "languages/python/extras": []})).toThrow("languages/python");
  const numeric = parseLoadout('name: numeric\nitems: {g: {any_of: {"1": {}}, default: []}}', "numeric.yml");
  expect(() => resolveChoices(numeric, {g: [1]} as any)).toThrow();
  const l2 = parseLoadout('name: nested\nitems: {plain: {items: {outer: {any_of: {a: {items: {inner: {one_of: {b: {}}, default: b}}}}, default: [a]}}}}', "nested.yml");
  expect(defaultChoices(l2)).toEqual({"plain/outer": ["a"], "plain/outer/a/inner": ["b"]});
  expect(resolveChoices(l2, {"plain/outer": []})).toEqual({"plain/outer": []});
});
test("include source conflicts identify both locations and equal sets combine", () => {
  const l = parseLoadout('name: shared\nincludes: {testing: {source: "github:acme/catalog/testing", choices: {tools: [a, b]}}}\nitems: {more: {includes: {testing: {source: "github:acme/catalog/testing", choices: {tools: [b, a]}}}}}', "shared.yml");
  expect(activeIncludes(l, {}).testing!.choices).toEqual({tools: ["b", "a"]});
  (l.items.more as any).includes.testing.source = "github:other/catalog/testing";
  expect(() => activeIncludes(l, {})).toThrow("includes.testing and items.more.includes.testing");
});

test.each([".child", "parent/.child", ".parent/..child"])("choice paths retain the item identifier alphabet: %s", async path => {
  const parts = path.split("/"), group = {any_of: {x: {}}, default: []};
  const items = parts.length === 1 ? {[parts[0]!]: group} : {[parts[0]!]: {items: {[parts[1]!]: group}}};
  const declaration = {name: "nested", items};
  expect(resolveChoices(parseLoadout(JSON.stringify(declaration), "nested.yml"), {[path]: ["x"]})).toEqual({[path]: ["x"]});
  const selection = {source: "github:acme/catalog/nested", choices: {[path]: ["x"]}};
  expect(validateSelection("nested", selection)).toEqual(selection);
  expect(parseLoadout(JSON.stringify({name: "wrapper", includes: {nested: selection}}), "wrapper.yml").includes).toEqual({nested: selection});
});
test.each([".child", "parent/.child", ".parent/..child"])("editor schemas accept item-alphabet choice segments: %s", async path => {
  const selection = {source: "github:acme/catalog/nested", choices: {[path]: ["x"]}};
  const loadoutSchema = await Bun.file(new URL("../schemas/v1/loadout.schema.json", import.meta.url)).json();
  const manifestSchema = await Bun.file(new URL("../schemas/v1/manifest.schema.json", import.meta.url)).json();
  expect(matchesSchema({name: "wrapper", includes: {nested: selection}}, loadoutSchema)).toBe(true);
  expect(matchesSchema({harnesses: [], loadouts: {nested: selection}}, manifestSchema)).toBe(true);
  for (const invalid of [{...selection, choices: {[path]: [".member"]}}, {source: "github:acme/catalog/.nested", choices: {[path]: []}}]) {
    expect(matchesSchema({name: "wrapper", includes: {nested: invalid}}, loadoutSchema)).toBe(false);
    expect(matchesSchema({harnesses: [], loadouts: {nested: invalid}}, manifestSchema)).toBe(false);
    expect(() => validateSelection("nested", invalid)).toThrow();
  }
});
