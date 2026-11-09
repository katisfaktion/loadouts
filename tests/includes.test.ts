import { test, expect } from "bun:test";
import { mkdirSync, writeFileSync, readFileSync, symlinkSync, rmSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tempEnv, fixtureCatalog, git, withEnv, run } from "./helpers";
import { resolveManifest, manifestMatchesLock, type Manifest } from "../src/manifest";
import { fileSource, catalogSource, type LoadoutSelection } from "../src/sources";
import * as locks from "../src/lock";
import { loadedLoadouts, desired, install } from "../src/sync";

function setup() {
  const t = tempEnv(); mkdirSync(join(t.project, ".loadouts/catalog"), {recursive: true});
  const put = (name: string, includes: Record<string, LoadoutSelection> = {}, items: object = {}, extra = {}) => writeFileSync(join(t.project, `.loadouts/catalog/${name}.yml`), JSON.stringify({name, includes, items, ...extra}));
  const select = (name: string, choices?: Record<string, string[]>) => ({source: fileSource(name), ...(choices ? {choices} : {})});
  const manifest = (names: string[]): Manifest => ({harnesses: [], loadouts: Object.fromEntries(names.map(n => [n, select(n)]))});
  return {...t, put, select, manifest};
}
const groups = {tools: {any_of: {a: {}, b: {}}, default: ["a"]}, runner: {one_of: {a: {}, b: {}}, default: "a"}};

test("nested CLI choices clean only deselected descendant requests and restore defaults", async () => {
  const t = setup();
  const branch = {items: {framework: {one_of: {a: {conventions: "A"}, b: {conventions: "B"}}, default: "a"}, extras: {any_of: {coverage: {}}, default: []}}};
  t.put("testing", {}, {languages: {any_of: {py: branch, python: branch, ["__proto__"]: branch}, default: []}});
  const call = (args: string[]) => run(args, {cwd: t.project, env: t.env});
  writeFileSync(join(t.project, "loadouts.json"), JSON.stringify(t.manifest([])));
  const added = await call(["add", fileSource("testing"), "--with", "testing/languages=py,python,__proto__", "--with", "testing/languages/py/framework=b", "--with", "testing/languages/python/framework=b", "--with", "testing/languages/__proto__/framework=b"]);
  expect(added.code, added.stderr).toBe(0);
  expect((await call(["switch", "testing/languages/py/framework", "a"])).code).toBe(0);
  expect((await call(["switch", "testing/languages/py/framework", "b"])).code).toBe(0);
  const enabled = await call(["enable", "testing/languages/py/extras", "coverage"]);
  expect(enabled.code, enabled.stderr).toBe(0);
  const disabled = await call(["disable", "testing/languages", "py"]);
  expect(disabled.code, disabled.stderr).toBe(0);
  expect(disabled.stdout).toContain("testing/languages/py/framework"); expect(disabled.stdout).toContain("testing/languages/py/extras");
  const choices = JSON.parse(readFileSync(join(t.project, "loadouts.json"), "utf8")).loadouts.testing.choices;
  expect(choices).toEqual({languages: ["__proto__", "python"], "languages/python/framework": ["b"], "languages/__proto__/framework": ["b"]});
  const before = snapshot(t.project), inactive = await call(["switch", "testing/languages/py/framework", "a"]);
  expect(inactive.code).toBe(2); expect(inactive.stderr).toContain("inactive"); expect(inactive.stderr).toContain("languages"); expect(snapshot(t.project)).toEqual(before);
  expect((await call(["enable", "testing/languages", "py"])).code).toBe(0);
  expect(locks.readLock(t.project).loadouts.testing!["languages/py/framework"]).toEqual(["a"]);
  const switched = await call(["switch", "testing/languages/py/framework", "b"]); expect(switched.code, switched.stderr).toBe(0);
  for (const args of [["enable", "testing/languages/py/framework", "a"], ["switch", "testing/languages/py/extras", "coverage"], ["switch", "testing/languages/py/framework", "a,b"]]) {
    const state = snapshot(t.project), invalid = await call(args); expect(invalid.code).toBe(2); expect(snapshot(t.project)).toEqual(state);
  }
  const state = snapshot(t.project), stale = await call(["add", "testing", "--with", "testing/languages=python", "--with", "testing/languages/py/framework=a"]);
  expect(stale.code).toBe(2); expect(stale.stderr).toContain("inactive"); expect(snapshot(t.project)).toEqual(state);
  for (const [choice, code] of [["", 2], ["a,b", 2], ["b,b", 1]] as const) {
    const invalid = await call(["add", "testing", "--with", `testing/languages/py/framework=${choice}`]);
    expect(invalid.code, invalid.stderr).toBe(code); expect(snapshot(t.project)).toEqual(state);
  }
  const file = join(t.project, "loadouts.json"), manuallyEdited = JSON.parse(readFileSync(file, "utf8"));
  manuallyEdited.loadouts.testing.choices.languages = ["python"];
  writeFileSync(file, JSON.stringify(manuallyEdited));
  const editedState = snapshot(t.project), installStale = await call(["install"]);
  expect(installStale.code).toBe(2); expect(installStale.stderr).toContain("inactive"); expect(snapshot(t.project)).toEqual(editedState);
});

test("conditional shared children emit nested routing once within their own namespace", async () => {
  const t = setup();
  t.put("child", {}, {container: {conventions: "Child container", items: {leaf: {skills: ["acme/child@review"], conventions: "Child leaf"}}}}, {routing: [{when: "Child review", use: ["container/leaf"]}]});
  t.put("root", {}, {container: {skills: ["acme/root@root"]}, branch: {any_of: {
    a: {includes: {child: t.select("child")}}, b: {includes: {child: t.select("child")}},
  }, default: ["a", "b"]}}, {routing: [{when: "Root review", use: ["container"]}]});
  writeFileSync(join(t.project, "loadouts.json"), JSON.stringify({...t.manifest(["root"]), harnesses: ["codex"]}));
  const opts = {cwd: t.project, env: t.env}, applied = await run(["install"], opts);
  expect(applied.code, applied.stderr).toBe(0);
  const agents = readFileSync(join(t.project, "AGENTS.md"), "utf8");
  expect(agents.match(/\| Child review \|/g)).toHaveLength(1);
  expect(agents).toContain("| Child review | skills `review` | child/container/leaf |");
  expect(agents).toContain("| Root review | skills `root` | root/container |");
  expect(agents.match(/\*\*child\/container:\*\*/g)).toHaveLength(1); expect(agents.match(/\*\*child\/container\/leaf:\*\*/g)).toHaveLength(1);
  const before = snapshot(t.project), repeated = await run(["install"], opts);
  expect(repeated.code, repeated.stderr).toBe(0); expect(snapshot(t.project)).toEqual(before);
});

test("parent switches clean their direct entry but preserve conflicting include requests atomically", async () => {
  const t = setup(); t.put("child", {}, {branch: {one_of: {a: {items: {nested: groups.runner}}, b: {}}, default: "a"}});
  t.put("root", {child: t.select("child", {branch: ["a"], "branch/a/nested": ["b"]})});
  const manifest = t.manifest(["root", "child"]); manifest.loadouts.child!.choices = {"branch/a/nested": ["b"]};
  await withEnv(t.env, () => install(t.project, {manifest}));
  const before = snapshot(t.project), conflict = await run(["switch", "child/branch", "b"], {cwd: t.project, env: t.env});
  expect(conflict.code).toBe(1); expect(conflict.stderr).toContain("conflicting choices"); expect(snapshot(t.project)).toEqual(before);
  const direct = t.manifest(["child"]); direct.loadouts.child!.choices = {"branch/a/nested": ["b"]};
  await withEnv(t.env, () => install(t.project, {manifest: direct}));
  const switched = await run(["switch", "child/branch", "b"], {cwd: t.project, env: t.env});
  expect(switched.code, switched.stderr).toBe(0); expect(switched.stdout).toContain("child/branch/a/nested");
  expect(JSON.parse(readFileSync(join(t.project, "loadouts.json"), "utf8")).loadouts.child.choices).toEqual({branch: ["b"]});
});

test("included-only nested choices identify the declaring member YAML location", async () => {
  const t = setup(); t.put("child", {}, {outer: {items: {runner: groups.runner}}});
  t.put("root", {}, {framework: {one_of: {react: {includes: {child: t.select("child")}}, vue: {}}, default: "react"}});
  await withEnv(t.env, () => install(t.project, {manifest: t.manifest(["root"])}));
  const before = snapshot(t.project), result = await run(["switch", "child/outer/runner", "b"], {cwd: t.project, env: t.env});
  expect(result.code).toBe(2); expect(result.stderr).toContain("root → child"); expect(result.stderr).toContain("items.framework.one_of.react.includes.child.choices"); expect(snapshot(t.project)).toEqual(before);
});

test("conditional nested includes merge compatible occurrences and skip nonexistent inactive targets", async () => {
  const t = setup(); t.put("child", {}, groups);
  t.put("root", {}, {languages: {any_of: {
    python: {items: {framework: {one_of: {
      pytest: {includes: {child: t.select("child", {runner: ["b"]})}},
      unittest: {includes: {missing: t.select("missing")}},
    }, default: "pytest"}}},
    typescript: {includes: {child: t.select("child", {tools: []})}},
  }, default: ["python", "typescript"]}});
  const lock = await resolveManifest(t.project, t.manifest(["root"]));
  expect(lock.version).toBe(1);
  expect(lock.loadouts).toEqual({root: {languages: ["python", "typescript"], "languages/python/framework": ["pytest"]}, child: {runner: ["b"], tools: []}});
  expect(lock.includes!.root).toEqual({child: t.select("child", {runner: ["b"], tools: []})});
  expect(locks.loadoutPaths(lock, "child")).toEqual([["root", "child"]]);
  expect(locks.loadoutClosure(lock, "root")).toEqual(["child", "root"]);
  locks.writeLock(t.project, lock); expect(locks.readLock(t.project)).toEqual(lock);
  expect(desired(lock, await loadedLoadouts(lock))).toEqual(new Map());
  for (const mutate of [
    (l: locks.Lock) => { delete l.includes!.root!.child; },
    (l: locks.Lock) => { l.loadouts.root!["languages/python/framework"] = ["unittest"]; },
    (l: locks.Lock) => { l.loadouts.root!.languages = ["typescript"]; },
    (l: locks.Lock) => { l.includes!.root!.child!.choices = {tools: [], runner: ["a"]}; l.loadouts.child!.runner = ["a"]; },
  ]) {
    const bad = structuredClone(lock); mutate(bad); locks.writeLock(t.project, bad);
    expect(() => locks.readLock(t.project)).toThrow("invalid lock");
  }
});

test.each([["a", "z"], ["z", "a"]])("conditional rounds discard provisional missing edges and requests for roots %j", async (...names) => {
  const t = setup(); t.put("shared", {}, groups);
  t.put("a", {}, {branch: {one_of: {
    old: {includes: {missing: t.select("missing"), shared: t.select("shared", {runner: ["a"]})}},
    final: {includes: {shared: t.select("shared", {runner: ["b"]})}},
  }, default: "old"}});
  t.put("z", {later: t.select("later")}); t.put("later", {a: t.select("a", {branch: ["final"]})});
  const lock = await resolveManifest(t.project, t.manifest(names));
  expect(Object.keys(lock.loadouts).sort()).toEqual(["a", "later", "shared", "z"]);
  expect(lock.loadouts.a).toEqual({branch: ["final"]}); expect(lock.loadouts.shared!.runner).toEqual(["b"]);
  expect(lock.includes!.a).toEqual({shared: t.select("shared", {runner: ["b"]})});
  locks.writeLock(t.project, lock); expect(locks.readLock(t.project)).toEqual(lock);
});

test("a discarded source conflict cannot poison the final definition cache", async () => {
  const t = setup(); t.put("shared", {}, groups);
  t.put("a", {}, {branch: {one_of: {
    old: {includes: {shared: {source: catalogSource(join(t.home, "absent-catalog"), "shared")}}},
    final: {includes: {shared: t.select("shared")}},
  }, default: "old"}});
  t.put("z", {later: t.select("later")}); t.put("later", {a: t.select("a", {branch: ["final"]}), shared: t.select("shared", {runner: ["b"]})});
  await withEnv(t.env, async () => {
    const lock = await resolveManifest(t.project, t.manifest(["z", "a"]));
    expect(lock.resolved!.shared).toEqual(t.select("shared")); expect(lock.loadouts.shared!.runner).toEqual(["b"]);
    locks.writeLock(t.project, lock); expect(locks.readLock(t.project)).toEqual(lock);
  });
});

test.each(["members", "sources", "cycle", "feedback"])("conditional %s failure preserves the complete project and process log", async kind => {
  const t = setup(), log = join(t.home, "skills.log"); t.put("existing", {}, {review: {skills: ["acme/review@review"]}});
  await withEnv({...t.env, FAKE_SKILLS_LOG: log}, () => install(t.project, {manifest: {...t.manifest(["existing"]), harnesses: ["codex"]}}));
  t.put("child", {}, groups);
  const target = kind === "sources" ? {source: catalogSource(join(t.home, "absent-catalog"), "child")} : t.select("child", {runner: ["b"]});
  t.put("root", {}, {branch: {any_of: {
    left: {includes: {child: t.select("child", {runner: ["a"]})}}, right: {includes: {child: target}},
  }, default: ["left", "right"]}});
  if (kind === "cycle" || kind === "feedback") {
    t.put("root", {}, {branch: {one_of: {on: {includes: {child: t.select("child")}}, off: {}}, default: "on"}});
    t.put("child", {root: t.select("root", kind === "feedback" ? {branch: ["off"]} : undefined)});
  }
  const before = snapshot(t.project), calls = readFileSync(log, "utf8");
  await withEnv({...t.env, FAKE_SKILLS_LOG: log}, async () => {
    await expect(install(t.project, {manifest: {...t.manifest(["root"]), harnesses: ["codex"]}})).rejects.toThrow(kind === "feedback" ? /conditional.*converge.*root → child.*branch/ : kind === "cycle" ? /root → child → root/ : /left.*right/);
  });
  expect(snapshot(t.project)).toEqual(before); expect(readFileSync(log, "utf8")).toBe(calls);
});

test("dormant conditional cycles do not enter the lock", async () => {
  const t = setup(); t.put("root", {}, {branch: {one_of: {off: {}, on: {includes: {child: t.select("child")}}}, default: "off"}});
  t.put("child", {root: t.select("root")});
  const lock = await resolveManifest(t.project, t.manifest(["root"]));
  expect(lock.loadouts).toEqual({root: {branch: ["off"]}}); expect(lock.includes).toEqual({root: {}});
});

test("inactive catalog declarations still reject consumer-local sources", async () => {
  const t = setup(), catalog = fixtureCatalog();
  writeFileSync(join(catalog, "loadouts/root.yml"), JSON.stringify({name: "root", items: {branch: {any_of: {off: {includes: {private: t.select("private")}}}, default: []}}}));
  git(catalog, "add", "."); git(catalog, "commit", "-m", "Dormant local include"); git(catalog, "tag", "v1.1.0");
  await withEnv(t.env, () => expect(resolveManifest(t.project, {harnesses: [], loadouts: {root: {source: catalogSource(catalog, "root")}}})).rejects.toThrow(/consumer-local.*branch.*off/));
});

test("conditional branches release transitive skills only after the final active owner disappears", async () => {
  const t = setup(), log = join(t.home, "skills.log");
  t.put("leaf", {}, {review: {skills: ["acme/review@review"]}}); t.put("child", {leaf: t.select("leaf")});
  t.put("root", {}, {branch: {any_of: {left: {includes: {child: t.select("child")}}, right: {includes: {leaf: t.select("leaf")}}}, default: ["left", "right"]}});
  const apply = (members: string[]) => install(t.project, {manifest: {harnesses: ["codex"], loadouts: {root: t.select("root", {branch: members})}}});
  await withEnv({...t.env, FAKE_SKILLS_LOG: log}, async () => {
    await apply(["left", "right"]); expect(Object.keys(locks.readLock(t.project).loadouts).sort()).toEqual(["child", "leaf", "root"]);
    await apply(["right"]); expect(Object.keys(locks.readLock(t.project).loadouts).sort()).toEqual(["leaf", "root"]);
    expect(existsSync(join(t.project, ".agents/skills/review/SKILL.md"))).toBe(true);
    const before = snapshot(t.project), calls = readFileSync(log, "utf8");
    await apply(["right"]); expect(snapshot(t.project)).toEqual(before); expect(readFileSync(log, "utf8")).toBe(calls);
    await apply([]); expect(locks.readLock(t.project).loadouts).toEqual({root: {branch: []}});
    expect(existsSync(join(t.project, ".agents/skills/review"))).toBe(false);
  });
});

test("conditional catalog branches fetch only the active target and follow its pin", async () => {
  const t = setup(), catalog = fixtureCatalog();
  writeFileSync(join(catalog, "loadouts/root.yml"), JSON.stringify({name: "root", items: {branch: {one_of: {
    on: {includes: {backend: {source: catalogSource(catalog, "backend")}}},
    off: {includes: {missing: {source: catalogSource(catalog, "missing")}}},
  }, default: "on"}}}));
  git(catalog, "add", "."); git(catalog, "commit", "-m", "Conditional catalog"); git(catalog, "tag", "v1.1.0");
  const manifest: Manifest = {harnesses: [], loadouts: {root: {source: catalogSource(catalog, "root")}}};
  await withEnv(t.env, async () => {
    const lock = await resolveManifest(t.project, manifest);
    expect(Object.keys(lock.loadouts)).toEqual(["backend", "root"]); expect(lock.resolved!.backend!.catalog!.ref).toBe("v1.1.0");
    locks.writeLock(t.project, lock); expect(locks.readLock(t.project)).toEqual(lock);
    const before = readFileSync(join(t.project, "loadouts.lock.json"), "utf8");
    locks.writeLock(t.project, await resolveManifest(t.project, manifest, lock));
    expect(readFileSync(join(t.project, "loadouts.lock.json"), "utf8")).toBe(before);
  });
});


test("include-only roots resolve nested diamonds once and retain both provenance paths", async () => {
  const t = setup(); t.put("shared"); t.put("frontend", {shared: t.select("shared")}); t.put("testing", {shared: t.select("shared")});
  writeFileSync(join(t.project, ".loadouts/catalog/website.yml"), JSON.stringify({name: "website", includes: {frontend: t.select("frontend"), testing: t.select("testing")}}));
  const manifest = t.manifest(["website"]), lock = await resolveManifest(t.project, manifest);
  expect(lock.version).toBe(1); expect(Object.keys(lock.roots!)).toEqual(["website"]);
  for (const field of [lock.resolved, lock.loadouts, lock.includes]) expect(Object.keys(field!).sort()).toEqual(["frontend", "shared", "testing", "website"]);
  expect(locks.loadoutPaths(lock, "shared")).toEqual([["website", "frontend", "shared"], ["website", "testing", "shared"]]);
  expect(locks.loadoutClosure(lock, "frontend")).toEqual(["frontend", "shared"]);
  expect(manifestMatchesLock(manifest, lock)).toBe(true);
  locks.writeLock(t.project, lock); expect(locks.readLock(t.project)).toEqual(lock);
});

test("declaration order and repeated resolution serialize identically", async () => {
  const t = setup(); t.put("shared", {}, groups); t.put("a", {shared: t.select("shared", {tools: ["b", "a"]})}); t.put("b", {shared: t.select("shared", {tools: ["a", "b"]})});
  const first = await resolveManifest(t.project, t.manifest(["b", "a"])); locks.writeLock(t.project, first);
  const before = readFileSync(join(t.project, "loadouts.lock.json"), "utf8");
  locks.writeLock(t.project, await resolveManifest(t.project, t.manifest(["a", "b"]), first));
  expect(readFileSync(join(t.project, "loadouts.lock.json"), "utf8")).toBe(before);
});

test("explicit requests across the whole graph precede defaults without becoming future explicit requests", async () => {
  const t = setup(); t.put("shared", {}, groups); t.put("a", {shared: t.select("shared")}); t.put("z", {shared: t.select("shared", {tools: [], runner: ["b"]})});
  const lock = await resolveManifest(t.project, t.manifest(["a", "z"]));
  expect(lock.loadouts.shared).toEqual({tools: [], runner: ["b"]});
  expect((await resolveManifest(t.project, t.manifest(["a"]), lock)).loadouts.shared).toEqual({tools: ["a"], runner: ["a"]});
});

test.each([{tools: []}, {runner: ["b"]}])("conflicting explicit choices include both paths: %j", async choices => {
  const t = setup(); t.put("shared", {}, groups); t.put("a", {shared: t.select("shared", {tools: ["a"], runner: ["a"]})}); t.put("z", {shared: t.select("shared", choices)});
  await expect(resolveManifest(t.project, t.manifest(["a", "z"]))).rejects.toThrow(/a → shared.*z → shared/);
});

test.each([{missing: []}, {tools: ["missing"]}, {runner: []}])("invalid descendant choice reports its path: %j", async choices => {
  const t = setup(); t.put("shared", {}, groups); t.put("website", {shared: t.select("shared", choices)});
  await expect(resolveManifest(t.project, t.manifest(["website"]))).rejects.toThrow("website → shared");
});

test("cycles, missing nodes, traversal and symlinks report the root-to-owner path", async () => {
  const t = setup(); t.put("a", {b: t.select("b")}); t.put("b", {a: t.select("a")});
  await expect(resolveManifest(t.project, t.manifest(["a"]))).rejects.toThrow("a → b → a");
  t.put("b", {missing: t.select("missing")});
  await expect(resolveManifest(t.project, t.manifest(["a"]))).rejects.toThrow("a → b → missing");
  t.put("b", {missing: {source: "file:./.loadouts/catalog/../missing.yml"}});
  await expect(resolveManifest(t.project, t.manifest(["a"]))).rejects.toThrow("a → b");
  t.put("b", {missing: t.select("missing")}); writeFileSync(join(t.home, "missing.yml"), "name: missing\nitems: {}\n"); symlinkSync(join(t.home, "missing.yml"), join(t.project, ".loadouts/catalog/missing.yml"));
  await expect(resolveManifest(t.project, t.manifest(["a"]))).rejects.toThrow("a → b → missing");
});

test("different full source strings conflict even when refs share a commit", async () => {
  const t = setup(), catalog = fixtureCatalog(); git(catalog, "tag", "v1.0.1");
  t.put("a", {backend: {source: catalogSource(catalog, "backend", "v1.0.0")}}); t.put("z", {backend: {source: catalogSource(catalog, "backend", "v1.0.1")}});
  await withEnv(t.env, async () => { await expect(resolveManifest(t.project, t.manifest(["a", "z"]))).rejects.toThrow(/a → backend.*z → backend/); });
});

test("shared catalogs cannot request consumer-local definitions", async () => {
  const t = setup(), catalog = fixtureCatalog(); t.put("private");
  writeFileSync(join(catalog, "loadouts/website.yml"), JSON.stringify({name: "website", includes: {private: t.select("private")}}));
  git(catalog, "add", "."); git(catalog, "commit", "-m", "Composition"); git(catalog, "tag", "v1.1.0");
  await withEnv(t.env, async () => { await expect(resolveManifest(t.project, {harnesses: [], loadouts: {website: {source: catalogSource(catalog, "website")}}})).rejects.toThrow("website → private"); });
});

test("local descendant snapshots refresh on install and remain applied on update and convenience selections", async () => {
  const t = setup(); t.put("child", {}, {}, {conventions: "applied"}); t.put("root", {child: t.select("child")});
  const m = t.manifest(["root"]), first = await resolveManifest(t.project, m);
  t.put("child", {new: t.select("new")}, {}, {conventions: "edited"}); t.put("new");
  expect((await resolveManifest(t.project, m, first, {update: true})).local).toEqual(first.local);
  expect((await resolveManifest(t.project, m, first, {refreshLocal: ["root"]})).local).toEqual(first.local);
  const installed = await resolveManifest(t.project, m, first); expect(installed.local!.child).toContain("edited"); expect(installed.loadouts.new).toEqual({});
  t.put("root"); expect(Object.keys((await resolveManifest(t.project, m, installed)).loadouts)).toEqual(["root"]);
});

test("transitive catalog pins refresh only on update and add/remove reachable children", async () => {
  const t = setup(), catalog = fixtureCatalog();
  const put = (name: string, includes = {}, conventions = "first") => writeFileSync(join(catalog, `loadouts/${name}.yml`), JSON.stringify({name, includes, items: {}, conventions}));
  put("child"); put("website", {child: {source: catalogSource(catalog, "child")}}); git(catalog, "add", "."); git(catalog, "commit", "-m", "Graph"); git(catalog, "tag", "v1.1.0");
  const m: Manifest = {harnesses: [], loadouts: {website: {source: catalogSource(catalog, "website")}}};
  await withEnv(t.env, async () => {
    const first = await resolveManifest(t.project, m); put("child", {}, "second"); put("new"); put("website", {child: {source: catalogSource(catalog, "child")}, new: {source: catalogSource(catalog, "new")}});
    git(catalog, "add", "."); git(catalog, "commit", "-m", "Advance"); git(catalog, "tag", "v1.2.0");
    expect((await resolveManifest(t.project, m, first)).resolved).toEqual(first.resolved);
    const updated = await resolveManifest(t.project, m, first, {update: true}); expect(updated.resolved!.child.catalog!.ref).toBe("v1.2.0"); expect(updated.loadouts.new).toEqual({});
    expect((await loadedLoadouts(updated)).child.conventions).toBe("second");
    put("website", {new: {source: catalogSource(catalog, "new")}}); git(catalog, "add", "."); git(catalog, "commit", "-m", "Drop child"); git(catalog, "tag", "v1.3.0");
    expect(Object.keys((await resolveManifest(t.project, m, updated, {update: true})).loadouts).sort()).toEqual(["new", "website"]);
  });
});

test("format 1 validates graph records offline", async () => {
  const t = setup(); t.put("child", {}, groups); t.put("root", {child: t.select("child", {tools: []})});
  const valid = await resolveManifest(t.project, t.manifest(["root"]));
  const invalid = [
    (l: any) => { delete l.roots; }, (l: any) => { delete l.includes; },
    (l: any) => { delete l.includes.child; }, (l: any) => { l.includes.root.absent = t.select("absent"); },
    (l: any) => { l.roots = {}; }, (l: any) => { l.includes.child.root = t.select("root"); },
    (l: any) => { l.includes.root.child.source = "github:other/repo/child"; },
    (l: any) => { l.roots.root.choices = {missing: []}; },
    (l: any) => { l.includes.root.child.choices = {tools: ["a"]}; },
    (l: any) => { l.loadouts.child.tools = ["a"]; },
    (l: any) => { l.local.root = JSON.stringify({name: "root", items: {}}); },
    (l: any) => { l.loadouts.child.runner = []; },
  ];
  for (const mutate of invalid) {
    const lock = structuredClone(valid); mutate(lock); writeFileSync(join(t.project, "loadouts.lock.json"), JSON.stringify(lock));
    expect(() => locks.readLock(t.project)).toThrow("invalid lock");
  }
  locks.writeLock(t.project, valid); rmSync(join(t.project, ".loadouts"), {recursive: true});
  expect(locks.readLock(t.project)).toEqual(valid);
});


test("remote lock reading stays offline and loading pinned definitions checks saved edges and defaults", async () => {
  const t = setup(), catalog = fixtureCatalog();
  writeFileSync(join(catalog, "loadouts/website.yml"), JSON.stringify({name: "website", includes: {backend: {source: catalogSource(catalog, "backend")}}}));
  git(catalog, "add", "."); git(catalog, "commit", "-m", "Composition"); git(catalog, "tag", "v1.1.0");
  await withEnv(t.env, async () => {
    const lock = await resolveManifest(t.project, {harnesses: [], loadouts: {website: {source: catalogSource(catalog, "website")}}});
    const badDefault = structuredClone(lock); badDefault.loadouts.backend!.runtime = ["python"];
    await expect(loadedLoadouts(badDefault)).rejects.toThrow("website → backend");
    const badEdge = structuredClone(lock); badEdge.includes!.website!.backend!.choices = {runtime: ["bun"]};
    await expect(loadedLoadouts(badEdge)).rejects.toThrow("locked graph disagrees with website");
    locks.writeLock(t.project, lock); rmSync(catalog, {recursive: true}); rmSync(t.env.LOADOUTS_CACHE!, {recursive: true});
    expect(locks.readLock(t.project)).toEqual(lock);
  });
});

test("root readiness compares explicit declarations, including removal of a choice", async () => {
  const t = setup(); t.put("child", {}, groups); t.put("root", {child: t.select("child")});
  const m = t.manifest(["root", "child"]); m.loadouts.child!.choices = {tools: ["b", "a"]};
  const lock = await resolveManifest(t.project, m);
  m.loadouts.child!.choices.tools = ["a", "b"]; expect(manifestMatchesLock(m, lock)).toBe(true);
  delete m.loadouts.child!.choices; expect(manifestMatchesLock(m, lock)).toBe(false);
  expect(manifestMatchesLock(t.manifest(["root"]), lock)).toBe(false);
});

test("a direct selection agrees with include choices as sets and cannot override them", async () => {
  const t = setup(); t.put("shared", {}, groups); t.put("website", {shared: t.select("shared", {tools: ["b", "a"]})});
  const m = t.manifest(["website", "shared"]); m.loadouts.shared!.choices = {tools: ["a", "b"]};
  const lock = await resolveManifest(t.project, m); expect(lock.loadouts.shared!.tools).toEqual(["a", "b"]);
  expect(locks.loadoutPaths(lock, "shared")).toEqual([["shared"], ["website", "shared"]]);
  m.loadouts.shared!.choices = {tools: []};
  await expect(resolveManifest(t.project, m)).rejects.toThrow(/conflicting choices.*shared.*website → shared/);
});

test("prototype-like descendant and group names stay ordinary graph keys", async () => {
  const t = setup(); t.put("__proto__", {}, {["__proto__"]: {any_of: {constructor: {}}, default: ["constructor"]}});
  t.put("root", {["__proto__"]: t.select("__proto__", {["__proto__"]: []})});
  const lock = await resolveManifest(t.project, t.manifest(["root"]));
  expect(lock.loadouts.__proto__).toEqual({["__proto__"]: []});
  locks.writeLock(t.project, lock); expect(locks.readLock(t.project)).toEqual(lock);
  expect(locks.loadoutPaths(lock, "__proto__")).toEqual([["root", "__proto__"]]);
});

test("update follows a changed pinned default when no selection explicitly requests a member", async () => {
  const t = setup(), catalog = fixtureCatalog(), m: Manifest = {harnesses: [], loadouts: {backend: {source: catalogSource(catalog, "backend")}}};
  await withEnv(t.env, async () => {
    const first = await resolveManifest(t.project, m); expect(first.loadouts.backend!.runtime).toEqual(["bun"]);
    const file = join(catalog, "loadouts/backend.yml"); writeFileSync(file, readFileSync(file, "utf8").replace("default: [bun]", "default: [python]"));
    git(catalog, "add", "."); git(catalog, "commit", "-m", "New default"); git(catalog, "tag", "v1.1.0");
    expect((await resolveManifest(t.project, m, first)).loadouts.backend!.runtime).toEqual(["bun"]);
    const updated = await resolveManifest(t.project, m, first, {update: true});
    expect(updated.loadouts.backend!.runtime).toEqual(["python"]); expect(updated.roots!.backend!.choices).toBeUndefined();
  });
});

function snapshot(root: string): Record<string, string> {
  const result: Record<string, string> = {};
  const visit = (dir: string, prefix = "") => { for (const entry of readdirSync(dir, {withFileTypes: true})) {
    const relative = prefix + entry.name;
    if (entry.isDirectory()) visit(join(dir, entry.name), relative + "/");
    else if (entry.isFile()) result[relative] = readFileSync(join(dir, entry.name), "utf8");
  }};
  visit(root); return result;
}

test.each(["command", "args", "env", "marketplace", "codex-marketplace", "skill", "package"])("graph-known %s conflicts preserve setup before every external process", async kind => {
  const t = setup(); t.put("existing", {}, {}, {conventions: "Applied"});
  await withEnv(t.env, () => install(t.project, {manifest: t.manifest(["existing"])}));
  const server = {command: "never-start-this", args: ["one"], env: {A: "one"}};
  const left = kind.endsWith("marketplace") ? {[kind === "marketplace" ? "claude" : "codex"]: {plugin: "one@shared", marketplace: "acme/one"}}
    : kind === "skill" ? {skills: ["acme/one@same"]}
    : kind === "package" ? {packageSkills: {include: ["one#same"]}}
    : {mcp: {same: server}};
  const right = kind.endsWith("marketplace") ? {[kind === "marketplace" ? "claude" : "codex"]: {plugin: "two@shared", marketplace: "acme/two"}}
    : kind === "skill" ? {skills: ["acme/two@same"]}
    : kind === "package" ? {packageSkills: {include: ["two#same"]}}
    : {mcp: {same: {...server, [kind]: kind === "command" ? "other-never-start" : kind === "args" ? ["two"] : {A: "two"}}}};
  t.put("left", {}, {tool: left}); t.put("right", {}, {tool: right});
  t.put("a", {left: t.select("left")}); t.put("z", {right: t.select("right")});
  mkdirSync(join(t.project, ".codex"), {recursive: true}); mkdirSync(join(t.project, ".claude"), {recursive: true});
  writeFileSync(join(t.project, ".codex/config.toml"), 'model = "personal"\n');
  writeFileSync(join(t.project, ".claude/settings.json"), '{"personal":true}');
  writeFileSync(join(t.project, ".mcp.json"), '{"mcpServers":{"personal":{"command":"personal"}}}');
  writeFileSync(join(t.project, "skills-lock.json"), '{"version":1,"skills":{}}');
  const before = snapshot(t.project), log = join(t.home, "process.log");
  await withEnv({...t.env, FAKE_SKILLS_LOG: log}, async () => {
    const manifest = {...t.manifest(["a", "z"]), harnesses: ["claude-code", "codex"] as const};
    await expect(install(t.project, {manifest: {...manifest, harnesses: [...manifest.harnesses]}})).rejects.toThrow(/a → left.*z → right/);
  });
  expect(snapshot(t.project)).toEqual(before); expect(existsSync(log)).toBe(false);
});

test("identical structural MCP definitions deduplicate with a stable owner", async () => {
  const t = setup();
  t.put("a", {}, {tool: {mcp: {same: {command: "bun", args: ["one", "two"], env: {B: "b", A: "a"}}}}});
  t.put("z", {}, {tool: {mcp: {same: {env: {A: "a", B: "b"}, args: ["one", "two"], command: "bun"}}}});
  const lock = await resolveManifest(t.project, {...t.manifest(["z", "a"]), harnesses: ["codex"]});
  const loaded = await loadedLoadouts(lock), want = desired(lock, loaded);
  expect([...want.keys()]).toEqual(["mcp:codex:same"]); expect(want.get("mcp:codex:same")!.itemId).toBe("a/tool");
  expect(desired({...lock, loadouts: Object.fromEntries(Object.entries(lock.loadouts).reverse())}, loaded)).toEqual(want);
});

test("diamond skills, routing and contradictory conventions survive until the last root is removed", async () => {
  const t = setup(), log = join(t.home, "skills.log");
  t.put("child", {}, {review: {skills: ["acme/review@review"], conventions: "Always use tabs."}}, {conventions: "Always use spaces.", routing: [{when: "Reviewing", use: ["review"]}]});
  t.put("a", {child: t.select("child")}, {same: {skills: ["acme/review@review"]}}); t.put("z", {child: t.select("child")});
  writeFileSync(join(t.project, "AGENTS.md"), "Personal rules.\n");
  mkdirSync(join(t.project, ".agents/skills/unmanaged"), {recursive: true}); writeFileSync(join(t.project, ".agents/skills/unmanaged/SKILL.md"), "Personal skill");
  const apply = (names: string[]) => install(t.project, {manifest: {...t.manifest(names), harnesses: ["codex"]}});
  await withEnv({...t.env, FAKE_SKILLS_LOG: log}, async () => {
    await apply(["a", "z"]);
    const agents = readFileSync(join(t.project, "AGENTS.md"), "utf8");
    expect(agents.match(/Always use spaces/g)).toHaveLength(1); expect(agents.match(/Always use tabs/g)).toHaveLength(1);
    expect(agents).toContain("**child/review:**"); expect(agents).toContain("child/review"); expect(agents.match(/Reviewing/g)).toHaveLength(1);
    await apply(["z"]); expect(existsSync(join(t.project, ".agents/skills/review/SKILL.md"))).toBe(true);
    expect(readFileSync(join(t.project, "AGENTS.md"), "utf8")).toContain("Always use tabs");
    await apply(["z"]);
    expect(readFileSync(log, "utf8").trim().split("\n").map(s => JSON.parse(s)).filter(a => a[0] === "add")).toHaveLength(1);
    await apply([]); expect(existsSync(join(t.project, ".agents/skills/review"))).toBe(false);
    expect(readFileSync(join(t.project, "AGENTS.md"), "utf8")).toBe("Personal rules.\n");
    expect(readFileSync(join(t.project, ".agents/skills/unmanaged/SKILL.md"), "utf8")).toBe("Personal skill");
  });
});


test("CLI explains included selections, guards edits and keeps shared dependencies", async () => {
  const t = setup(); t.put("child", {}, groups); t.put("root", {child: t.select("child", {tools: ["a"]})});
  await withEnv(t.env, () => install(t.project, {manifest: t.manifest(["root"])}));
  const call = (args: string[]) => run(args, {cwd: t.project, env: t.env});
  const status = await call(["status"]); expect(status.stdout).toContain("included"); expect(status.stdout).toContain("required by: root"); expect(status.stdout).not.toContain("not declared");
  const json = JSON.parse((await call(["status", "--json"])).stdout); expect(json.roots).toEqual(t.manifest(["root"]).loadouts); expect(json.includes.root.child).toEqual(t.select("child", {tools: ["a"]}));
  for (const args of [["remove", "child"], ["switch", "child/runner", "b"], ["enable", "child/tools", "b"], ["disable", "child/tools", "a"]]) {
    const before = snapshot(t.project), result = await call(args); expect(result.code).toBe(2); expect(result.stderr).toContain("root → child"); expect(result.stderr).toContain("includes.child.choices"); expect(snapshot(t.project)).toEqual(before);
  }
  expect((await call(["add", fileSource("child"), "--with", "child/tools=a"])).code).toBe(0);
  const before = snapshot(t.project), conflict = await call(["enable", "child/tools", "b"]); expect(conflict.code).toBe(1); expect(conflict.stderr).toContain("conflicting choices"); expect(snapshot(t.project)).toEqual(before);
  expect((await call(["remove", "child"])).code).toBe(0); expect(locks.readLock(t.project).loadouts.child).toBeDefined();
});

test.each(["__proto__", "constructor"])("CLI inspects included-only %s without changing the project", async name => {
  const t = setup(); t.put(name); t.put("root", {[name]: t.select(name)});
  writeFileSync(join(t.project, "loadouts.json"), JSON.stringify(t.manifest(["root"])));
  const call = (args: string[]) => run(args, {cwd: t.project, env: t.env});
  const installed = await call(["install"]); expect(installed.code, installed.stderr).toBe(0);
  const before = snapshot(t.project);
  const shown = await call(["show", name, "--json"]); expect(shown.code, shown.stderr).toBe(0);
  const status = await call(["status"]); expect(status.code, status.stderr).toBe(0);
  expect(status.stdout).toContain(`${name}  ${fileSource(name)} [included]\n    required by: root`);
  const json = await call(["status", "--json"]); expect(json.code, json.stderr).toBe(0);
  const report = JSON.parse(json.stdout);
  expect(report.roots).toEqual(t.manifest(["root"]).loadouts);
  expect(report.includes.root[name]).toEqual(t.select(name));
  expect(JSON.parse(shown.stdout)).toMatchObject({name, source: {kind: "local", path: `.loadouts/catalog/${name}.yml`}});
  expect(snapshot(t.project)).toEqual(before);
});

test("show uses the included catalog pin before a same-name local draft", async () => {
  const t = setup(), catalog = fixtureCatalog(); t.put("root", {backend: {source: catalogSource(catalog, "backend")}}); t.put("backend", {}, {}, {conventions: "LOCAL DRAFT"});
  await withEnv(t.env, () => install(t.project, {manifest: t.manifest(["root"])}));
  const result = await run(["show", "backend", "--json"], {cwd: t.project, env: {...t.env, LOADOUTS_CATALOG: "/missing/catalog"}});
  expect(result.code, result.stderr).toBe(0); expect(JSON.parse(result.stdout).source.kind).toBe("catalog"); expect(result.stdout).not.toContain("LOCAL DRAFT");
});


test("doctor reports local descendant paths and pending graph failures without losing other diagnostics", async () => {
  const t = setup(); t.put("child"); t.put("root", {child: t.select("child")});
  await withEnv(t.env, () => install(t.project, {manifest: t.manifest(["root"])}));
  t.put("child", {missing: t.select("missing")});
  let result = await run(["doctor", "--json"], {cwd: t.project, env: t.env});
  let findings = JSON.parse(result.stdout).findings; expect(findings.some((f: any) => f.message.includes("root → child") && f.message.includes("differs"))).toBe(true);
  expect(findings.some((f: any) => f.message.includes("root → child → missing") && f.fix.includes("install"))).toBe(true);
  rmSync(join(t.project, ".loadouts/catalog/child.yml")); rmSync(join(t.project, "AGENTS.md"));
  result = await run(["doctor", "--json"], {cwd: t.project, env: t.env}); findings = JSON.parse(result.stdout).findings;
  expect(findings.some((f: any) => f.message.includes("root → child") && f.message.includes("missing") && f.fix.includes("restore"))).toBe(true);
  expect(findings.some((f: any) => f.message.includes("AGENTS.md"))).toBe(true);
});
