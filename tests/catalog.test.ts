import { test, expect } from "bun:test";
import { openCatalog, listLoadouts, readLoadout } from "../src/catalog";
import { fixtureCatalog, tempEnv, withEnv, run } from "./helpers";

test("catalog resolves tags, lists files and explains unknown names", async () => {
  const t = tempEnv(), path = fixtureCatalog();
  await withEnv(t.env, async () => {
    const c = await openCatalog(path);
    expect(c.ref).toBe("v1.0.0"); expect(c.commit).toMatch(/^[a-f0-9]{40}$/);
    expect(await listLoadouts(c)).toEqual(["backend", "base", "frontend"]);
    expect((await readLoadout(c, "base")).name).toBe("base");
    try { await readLoadout(c, "nope"); throw new Error("accepted missing name"); }
    catch (e: any) { expect(e.code).toBe(2); expect(e.fix).toContain("base"); }
  });
});
test("list and show expose catalog contents", async () => {
  const t = tempEnv(), path = fixtureCatalog();
  const opts = {cwd: t.project, env: t.env};
  const l = await run(["list", "--catalog", path], opts);
  expect(l.code).toBe(0); expect(l.stdout).toContain("frontend");
  const s = await run(["show", "base", "--catalog", path, "--json"], opts);
  expect(s.code).toBe(0); expect(JSON.parse(s.stdout).items.methodology.kind).toBe("one_of");
});

test("checked-in locks rebuild missing caches without changing pinned commits", async () => {
  const t = tempEnv(), path = fixtureCatalog(), opts = {cwd: t.project, env: t.env};
  await run(["init", "--harness", "claude-code"], opts);
  expect((await run(["add", "base", "--catalog", path], opts)).code).toBe(0);
  const {readFileSync, writeFileSync} = await import("node:fs"); const {join} = await import("node:path"); const {git} = await import("./helpers");
  const before = readFileSync(join(t.project, "loadouts.lock.json"), "utf8");
  const file = join(path, "loadouts/base.yml"); writeFileSync(file, readFileSync(file, "utf8").replace("Terse code", "New catalog text"));
  git(path, "add", "."); git(path, "commit", "-m", "New catalog"); git(path, "tag", "v1.1.0");
  const r = await run(["show", "base", "--json"], {...opts, env: {...t.env, LOADOUTS_CACHE: join(t.home, "fresh-cache")}});
  expect(r.code).toBe(0); expect(r.stdout).toContain("Terse code"); expect(r.stdout).not.toContain("New catalog text");
  expect(readFileSync(join(t.project, "loadouts.lock.json"), "utf8")).toBe(before);
});
