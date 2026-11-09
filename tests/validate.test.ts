import { test, expect } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tempEnv, run } from "./helpers";

test("validate checks a draft before init without changing project or home", async () => {
  const t = tempEnv(); mkdirSync(join(t.project, ".loadouts/catalog"), {recursive: true});
  const file = join(t.project, ".loadouts/catalog/backend.yml"), yaml = "name: backend\nitems: {runtime: {skills: [acme/runtime@bun]}}\nrouting: [{when: Working on scripts, use: [runtime]}]\n";
  writeFileSync(file, yaml);
  const r = await run(["validate", ".loadouts/catalog/backend.yml"], {cwd: t.project, env: {...t.env, PATH: ""}});
  expect(r.code).toBe(0); expect(r.stdout).toContain("Valid loadout: backend");
  expect(readdirSync(t.project)).toEqual([".loadouts"]); expect(readdirSync(t.home)).toEqual([]);
  expect(readFileSync(file, "utf8")).toBe(yaml);
});

test.each([
  ["name: other\nitems: {}", "name"],
  ["name: draft\nitems: [wrong]", "items"],
  ["name: draft\nitems: {x: {skills: [missing-owner]}}", "identifier"],
  ["name: draft\nitems: {x: {codex: {plugin: example@market}}}", "marketplace"],
  ["name: draft\nitems: {}\nrouting: [{when: Coding, use: [unknown]}]", "routing"],
  ["name: draft\nitems: [", "YAML"],
])("validate refuses invalid draft %s", async (yaml, error) => {
  const t = tempEnv(), file = join(t.project, "draft.yml"); writeFileSync(file, yaml);
  const r = await run(["validate", file], {cwd: t.project, env: t.env});
  expect(r.code).toBe(1); expect(r.stderr).toContain(error); expect(readFileSync(file, "utf8")).toBe(yaml);
});

test("validate reports missing files and wrong argument counts", async () => {
  const missing = await run(["validate", "missing.yml"]);
  expect(missing.code).toBe(1); expect(missing.stderr).toContain("missing.yml");
  for (const args of [["validate"], ["validate", "a.yml", "b.yml"]]) {
    const r = await run(args); expect(r.code).toBe(2); expect(r.stderr).toContain("loadouts help validate");
  }
});

test("validate accepts unresolved includes offline without Git or installers", async () => {
  const t = tempEnv(), file = join(t.project, "draft.yml");
  const yaml = 'name: draft\nincludes: {testing: {source: "github:nonexistent/catalog/testing@v1.0.0", choices: {tools: []}}}\n';
  writeFileSync(file, yaml);
  const result = await run(["validate", file], {cwd: t.project, env: {...t.env, PATH: ""}});
  expect(result.code).toBe(0); expect(result.stdout).toContain("Valid loadout: draft");
  expect(readdirSync(t.project)).toEqual(["draft.yml"]); expect(readdirSync(t.home)).toEqual([]);
  expect(readFileSync(file, "utf8")).toBe(yaml);
});

test("validate accepts nested member includes offline", async () => {
  const t = tempEnv(), file = join(t.project, "draft.yml");
  const yaml = 'name: draft\nitems: {framework: {one_of: {react: {includes: {react: {source: "github:missing/catalog/react", choices: {"tools/testing": []}}}}}, default: react}}\n';
  writeFileSync(file, yaml);
  const result = await run(["validate", file], {cwd: t.project, env: {...t.env, PATH: ""}});
  expect(result.code).toBe(0); expect(readdirSync(t.home)).toEqual([]);
  expect(readFileSync(file, "utf8")).toBe(yaml);
});
