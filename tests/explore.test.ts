import { test, expect } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tempEnv, repo, run } from "./helpers";

test("root help gives agents a discovery path before changing project state", async () => {
  const t = tempEnv(), options = {cwd: t.project, env: {...t.env, PATH: ""}};
  const help = await run(["help"], options);
  expect(help.code).toBe(0);
  expect(help.stdout).toContain("For agents:");
  for (const command of ["loadouts explore", "loadouts inspect --json", "loadouts help <command>"]) expect(help.stdout).toContain(command);
  const inspect = await run(["inspect", "--json"], options);
  expect(inspect.code).toBe(0);
  expect(JSON.parse(inspect.stdout).initialized).toBe(false);
  const explore = await run(["explore"], options);
  expect(explore.code).toBe(0);
  expect(explore.stdout).toContain("loadouts create");
  expect(explore.stdout).toContain("loadouts validate");
  expect(readdirSync(t.project)).toEqual([]);
  expect(readdirSync(t.home)).toEqual([]);
});

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
