import { test, expect } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tempEnv, repo, run } from "./helpers";

test("explore delivers the complete bundled skill before init without changing state", async () => {
  const t = tempEnv();
  const r = await run(["explore"], {cwd: t.project, env: {...t.env, PATH: ""}});
  expect(r.code).toBe(0);
  expect(r.stdout.trim()).toBe(readFileSync(join(repo, "skills/loadouts-explore/SKILL.md"), "utf8").trim());
  expect(readdirSync(t.project)).toEqual([]); expect(readdirSync(t.home)).toEqual([]);
});

test("explore rejects positional arguments instead of starting an agent", async () => {
  const r = await run(["explore", "backend"]);
  expect(r.code).toBe(2); expect(r.stderr).toContain("loadouts help explore");
});

test("explore explains nested choices, conditional includes and selected-only verification", async () => {
  const t = tempEnv();
  const r = await run(["explore"], {cwd: t.project, env: {...t.env, PATH: ""}});
  expect(r.code).toBe(0);
  for (const guidance of [
    "member `items`", "member `includes`", "languages/python/framework",
    "loadouts switch testing/languages/python/framework unittest",
    "inactive targets were checked for source portability only",
    "only the selected active closure", "parent removes explicit descendant requests",
  ]) expect(r.stdout).toContain(guidance);
  expect(readdirSync(t.project)).toEqual([]);
  expect(readdirSync(t.home)).toEqual([]);
});
