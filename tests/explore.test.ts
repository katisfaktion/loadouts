import { test, expect } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tempEnv, repo, run } from "./helpers";

test("root help gives agents a discovery path before changing project state", async () => {
  const t = tempEnv(), options = {cwd: t.project, env: {...t.env, PATH: ""}};
  const help = await run(["help"], options);
  expect(help.code).toBe(0);
  expect(help.stdout).toMatch(/\n  agents\s+\[GUIDE\]\s+List workflow guides for agents\./);
  expect(help.stdout).not.toContain("For agents:");
  const index = await run(["agents"], options);
  expect(index.code).toBe(0);
  expect(index.stdout).toContain("loadouts agents explore");
  const inspect = await run(["inspect", "--json"], options);
  expect(inspect.code).toBe(0);
  expect(JSON.parse(inspect.stdout).initialized).toBe(false);
  const explore = await run(["explore"], options);
  expect(explore.code).toBe(0);
  for (const command of ["loadouts inspect --json", "loadouts help create", "loadouts create"]) expect(explore.stdout).toContain(command);
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
    "loadouts agents apply",
    "loadouts agents publish",
    "only the selected active closure",
  ]) expect(r.stdout).toContain(guidance);
  expect(readdirSync(t.project)).toEqual([]);
  expect(readdirSync(t.home)).toEqual([]);
});

test("agents lists offline guides and prints only the selected Markdown", async () => {
  const t = tempEnv(), opts = {cwd: t.project, env: {...t.env, PATH: "", FORCE_COLOR: "1"}};
  const index = await run(["agents"], opts);
  expect(index.code).toBe(0);
  for (const topic of ["explore", "apply", "diagnose", "publish"]) {
    expect(index.stdout).toContain(`loadouts agents ${topic}`);
    const guide = await run(["agents", topic], opts);
    expect(guide.code).toBe(0);
    expect(guide.stderr).toBe("");
    expect(guide.stdout.trim()).toBe(readFileSync(join(repo, `skills/loadouts-${topic}/SKILL.md`), "utf8").trim());
    if (topic === "apply") {
      for (const decision of ["loadouts install", "loadouts update", "loadouts switch testing/languages/python/framework unittest", "parent removes explicit descendant requests", "old and new sources"]) expect(guide.stdout).toContain(decision);
    } else if (topic === "diagnose") {
      for (const decision of ["loadouts inspect --json", "loadouts status --json", "loadouts doctor --json", "frozen", "loadouts global prune"]) expect(guide.stdout).toContain(decision);
    } else if (topic === "publish") {
      expect(guide.stdout).toContain("inactive targets were checked for source portability only");
      expect(guide.stdout).toContain("loadouts publish");
      expect(guide.stdout).toContain("explicit publication approval");
    } else expect(guide.stdout).toBe((await run(["explore"], opts)).stdout);
  }
  for (const args of [["unknown"], ["publish", "--yes"], ["explore", "extra"]]) {
    const error = await run(["agents", ...args], opts);
    expect(error.code).toBe(2);
    expect(error.stderr).toContain("loadouts help agents");
    expect(error.stdout).toBe("");
  }
  expect(readdirSync(t.project)).toEqual([]);
  expect(readdirSync(t.home)).toEqual([]);
});
