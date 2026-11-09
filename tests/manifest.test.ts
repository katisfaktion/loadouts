import { test, expect } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync, symlinkSync, statSync } from "node:fs";
import { join } from "node:path";
import { tempEnv, fixtureCatalog, git, withEnv } from "./helpers";
import { readManifest, writeManifest, parseSource, catalogSource, resolveManifest, readSourceFile } from "../src/manifest";
import { findProject } from "../src/paths";
import { readLock, writeLock } from "../src/lock";
import { loadedLoadouts } from "../src/sync";

const manifest = {harnesses: ["codex"] as const, loadouts: {backend: {source: "file:./.loadouts/catalog/backend.yml"}}};
function local() {
  const t = tempEnv(); mkdirSync(join(t.project, ".loadouts/catalog"), {recursive: true});
  writeFileSync(join(t.project, ".loadouts/catalog/backend.yml"), "name: backend\nitems: {runtime: {any_of: {bun: {skills: [acme/bun]}}, default: [bun]}}\n");
  writeFileSync(join(t.project, "loadouts.json"), JSON.stringify(manifest)); return t;
}
test("manifest locates projects and preserves stable human configuration", () => {
  const t = local(), file = join(t.project, "loadouts.json"), m = readManifest(t.project);
  expect(findProject(join(t.project, "nested"))).toBe(t.project);
  writeManifest(t.project, m); const before = statSync(file).mtimeMs;
  expect(writeManifest(t.project, m)).toBe(false); expect(statSync(file).mtimeMs).toBe(before);
});
test.each([
  {...manifest, harnesses: ["vim"]}, {...manifest, harnesses: ["codex", "codex"]}, {...manifest, typo: true},
  {...manifest, loadouts: {backend: {source: "github:acme/catalog/frontend"}}},
  {...manifest, loadouts: {backend: {source: "file:../backend.yml"}}},
  {...manifest, loadouts: {backend: {source: "file:./.loadouts/catalog/../backend.yml"}}},
  {...manifest, loadouts: {backend: {source: "https://example.com/backend.yml"}}},
  {...manifest, loadouts: {backend: {source: "file:./.loadouts/catalog/backend.yml", choices: {runtime: "bun"}}}},
])("invalid manifest fails instead of discarding intent: %j", value => {
  const t = tempEnv(); writeFileSync(join(t.project, "loadouts.json"), JSON.stringify(value));
  expect(() => readManifest(t.project)).toThrow();
});
test("explicit sources parse names, tags and branch refs", () => {
  expect(parseSource("github:acme/catalog/backend@feature/new")).toEqual({kind: "catalog", repo: "acme/catalog", name: "backend", ref: "feature/new"});
  expect(parseSource("file:./.loadouts/catalog/backend.yml")).toEqual({kind: "file", name: "backend", path: ".loadouts/catalog/backend.yml"});
  expect(parseSource("file:/tmp/catalog#backend@v1.0.0")).toEqual({kind: "catalog", repo: "/tmp/catalog", name: "backend", ref: "v1.0.0"});
});
test("local source cannot follow a symlink outside the committed catalog", () => {
  const t = tempEnv(); mkdirSync(join(t.project, ".loadouts")); symlinkSync(t.home, join(t.project, ".loadouts/catalog"));
  writeFileSync(join(t.home, "backend.yml"), "name: backend\nitems: {}\n");
  expect(() => readSourceFile(t.project, manifest.loadouts.backend.source)).toThrow();
});
test("resolution reads selected local edits and derives group defaults without writes", async () => {
  const t = local(), m = readManifest(t.project);
  const lock = await resolveManifest(t.project, m);
  expect(lock.version).toBe(1); expect(lock.loadouts.backend).toEqual({runtime: ["bun"]});
  expect(lock.local?.backend).toContain("acme/bun");
  writeLock(t.project, lock); expect(readLock(t.project).resolved?.backend.source).toBe(manifest.loadouts.backend.source);
});
test("shared source wins explicitly, remains pinned until update, and resolves multiple catalogs", async () => {
  const t = local(), a = fixtureCatalog(), b = fixtureCatalog();
  const m = {harnesses: ["codex"] as ("codex")[], loadouts: {backend: {source: catalogSource(a, "backend")}, base: {source: catalogSource(b, "base", "v1.0.0")}}};
  await withEnv(t.env, async () => {
    const first = await resolveManifest(t.project, m);
    expect(first.local).toBeUndefined(); expect(first.resolved?.backend.catalog?.repo).toBe(a); expect(first.resolved?.base.catalog?.repo).toBe(b);
    const file = join(a, "loadouts/backend.yml"); writeFileSync(file, readFileSync(file, "utf8") + "conventions: new revision\n");
    git(a, "add", "."); git(a, "commit", "-m", "Advance"); git(a, "tag", "v1.1.0");
    const pinned = await resolveManifest(t.project, m, first);
    expect(pinned.resolved?.backend.catalog?.commit).toBe(first.resolved?.backend.catalog?.commit);
    const updated = await resolveManifest(t.project, m, first, {update: true});
    expect(updated.resolved?.backend.catalog?.ref).toBe("v1.1.0"); expect(updated.resolved?.base.catalog?.ref).toBe("v1.0.0");
    expect((await loadedLoadouts(updated)).backend.conventions).toBe("new revision");
    writeLock(t.project, updated); expect(readLock(t.project).resolved).toEqual(updated.resolved);
    const bad = {...updated, resolved: {...updated.resolved, backend: {source: "github:wrong/repo/backend", catalog: updated.resolved!.backend.catalog}}};
    writeFileSync(join(t.project, "loadouts.lock.json"), JSON.stringify(bad)); expect(() => readLock(t.project)).toThrow();
  });
});

test("prototype-like names remain ordinary loadout selections and unknown choices fail", async () => {
  const t = local();
  writeFileSync(join(t.project, ".loadouts/catalog/__proto__.yml"), "name: __proto__\nitems: {}\n");
  const m = {harnesses: [], loadouts: {["__proto__"]: {source: "file:./.loadouts/catalog/__proto__.yml"}}};
  const lock = await resolveManifest(t.project, m); expect(Object.keys(lock.loadouts)).toEqual(["__proto__"]);
  writeLock(t.project, lock); expect(readLock(t.project).resolved!["__proto__"].source).toBe(m.loadouts["__proto__"].source);
  await expect(resolveManifest(t.project, {...m, loadouts: {["__proto__"]: {...m.loadouts["__proto__"], choices: {["__proto__"]: []}}}})).rejects.toThrow("unknown group");
});

test("manifest writing omits empty choices but retains explicitly empty group selections", () => {
  const t = tempEnv();
  const manifest = {harnesses: [], loadouts: {
    docs: {source: "file:./.loadouts/catalog/docs.yml", choices: {}},
    payload: {source: "file:./.loadouts/catalog/payload.yml", choices: {"content-import": []}},
  }};
  expect(writeManifest(t.project, manifest)).toBe(true);
  const saved = JSON.parse(readFileSync(join(t.project, "loadouts.json"), "utf8"));
  expect(saved.loadouts.docs).toEqual({source: manifest.loadouts.docs.source});
  expect(saved.loadouts.payload.choices).toEqual({"content-import": []});
  expect(manifest.loadouts.docs.choices).toEqual({});
  expect(writeManifest(t.project, manifest)).toBe(false);
});

test("release lock v1 retains optional sections and survives manifest resolution", async () => {
  const t = local(), lock = await resolveManifest(t.project, readManifest(t.project));
  writeLock(t.project, lock); expect(readLock(t.project).version).toBe(1);
  expect(JSON.parse(readFileSync(join(t.project, "loadouts.lock.json"), "utf8")).version).toBe(1);
  expect((await resolveManifest(t.project, readManifest(t.project), readLock(t.project))).version).toBe(1);
  for (const sections of [{}, {installers: {}}, {packageSkills: {}}, {installers: {}, packageSkills: {}}]) {
    writeFileSync(join(t.project, "loadouts.lock.json"), JSON.stringify({...lock, ...sections}));
    expect(readLock(t.project)).toMatchObject({version: 1, ...sections});
  }
  for (const sections of [{installers: []}, {packageSkills: []}, {installers: {foreign: {version: "1"}}}, {packageSkills: {"ui": {version: "1", skills: "bad", requiredBy: []}}}]) {
    writeFileSync(join(t.project, "loadouts.lock.json"), JSON.stringify({...lock, ...sections}));
    expect(() => readLock(t.project)).toThrow("invalid lock");
  }
});

test("release locks reject development formats and require the complete graph", async () => {
  const t = local(), lock = await resolveManifest(t.project, readManifest(t.project));
  const file = join(t.project, "loadouts.lock.json");
  for (const version of [2, 3, 4, 5, 6, 7, 8, 9]) {
    const text = JSON.stringify({...lock, version});
    writeFileSync(file, text);
    expect(() => readLock(t.project)).toThrow("invalid lock");
    expect(readFileSync(file, "utf8")).toBe(text);
  }
  for (const field of ["roots", "includes", "resolved"]) {
    const incomplete: Record<string, unknown> = {...lock, version: 1};
    delete incomplete[field];
    writeFileSync(file, JSON.stringify(incomplete));
    expect(() => readLock(t.project)).toThrow("invalid lock");
  }
  writeFileSync(file, JSON.stringify({version: 1, harnesses: [], catalog: null, loadouts: {}, installed: {}}));
  expect(() => readLock(t.project)).toThrow("invalid lock");
});

test("manifest selections retain include-compatible explicit empty choices", () => {
  const t = tempEnv(), value = {harnesses: [], loadouts: {testing: {source: "github:acme/catalog/testing@v1.0.0", choices: {tools: []}}}};
  writeFileSync(join(t.project, "loadouts.json"), JSON.stringify(value));
  expect(readManifest(t.project)).toEqual(value);
});
test.each([
  {source: "github:acme/catalog/testing", typo: true},
  {source: "github:acme/catalog/testing", choices: {tools: ["a", "a"]}},
  {source: "invalid"},
])("selection failures retain manifest entry context: %j", entry => {
  const t = tempEnv(); writeFileSync(join(t.project, "loadouts.json"), JSON.stringify({harnesses: [], loadouts: {testing: entry}}));
  expect(() => readManifest(t.project)).toThrow("invalid loadouts.json entry testing");
});

test("manifest accepts nested choice paths while preserving member and source identifiers", () => {
  const t = tempEnv(), value = {harnesses: [], loadouts: {testing: {source: "github:acme/catalog/testing", choices: {"languages/python/framework": ["pytest"]}}}};
  writeFileSync(join(t.project, "loadouts.json"), JSON.stringify(value));
  expect(readManifest(t.project)).toEqual(value);
  for (const path of ["/languages", "languages/", "languages//framework"]) {
    writeFileSync(join(t.project, "loadouts.json"), JSON.stringify({...value, loadouts: {testing: {...value.loadouts.testing, choices: {[path]: []}}}}));
    expect(() => readManifest(t.project)).toThrow();
  }
});

test("manifest retains dot-prefixed nested choice path segments", () => {
  const t = tempEnv(), value = {harnesses: [], loadouts: {nested: {source: "github:acme/catalog/nested", choices: {"parent/.child": ["x"]}}}};
  writeFileSync(join(t.project, "loadouts.json"), JSON.stringify(value));
  expect(readManifest(t.project)).toEqual(value);
});
