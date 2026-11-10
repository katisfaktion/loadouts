import { test, expect } from "bun:test";
import { cpSync, lstatSync, readFileSync, existsSync, mkdirSync, rmSync, writeFileSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { addSkills, installSkills, removeSkills, listSkills } from "../src/skills";
import { repo, tempEnv, withEnv } from "./helpers";

test.each([1, 2])("the default installer requests the exact package compatible with lock v%i", async version => {
  const t = tempEnv(), bin = join(t.home, "bin");
  const pkg = version === 1 ? "skills@1.7.6" : "skills@1.8.0";
  mkdirSync(bin);
  writeFileSync(join(bin, "npx"), `#!/bin/sh
test "$4" = "${pkg}" || { echo "Unexpected installer: $4" >&2; exit 1; }
shift 4
exec bun "${join(repo, "tests/fixtures/fake-skills.ts")}" "$@"
`, {mode: 0o755});
  if (version === 1) writeFileSync(join(t.project, "skills-lock.json"), '{"version":1,"skills":{}}');
  await withEnv({...t.env, PATH: bin + ":" + process.env.PATH, FAKE_SKILLS_LOCK_VERSION: String(version)}, async () => {
    delete process.env.LOADOUTS_SKILLS_CMD;
    await installSkills(t.project, "acme/tools@review", "codex", {});
    rmSync(join(t.project, ".agents/skills"), {recursive: true});
    expect(await installSkills(t.project, "acme/tools@review", "codex", {})).toEqual(["review"]);
    await removeSkills(t.project, ["review"], "codex");
    expect(existsSync(join(t.project, ".agents/skills/review"))).toBe(false);
  });
});

test("restoring a managed Git skill replaces only identical legacy Claude copies with links", async () => {
  for (const kind of ["identical", "edited", "extra", "symlink"]) {
    const t = tempEnv();
    await withEnv(t.env, async () => {
      await installSkills(t.project, "acme/tools@review", "codex", {});
      const canonical = join(t.project, ".agents/skills/review"), copy = join(t.project, ".claude/skills/review");
      cpSync(canonical, copy, {recursive: true});
      if (kind === "edited") writeFileSync(join(copy, "SKILL.md"), "User changes");
      if (kind === "extra") writeFileSync(join(copy, "notes.md"), "User notes");
      if (kind === "symlink") { symlinkSync(t.home, join(copy, "nested")); symlinkSync(t.home, join(canonical, "nested")); }
      const restore = installSkills(t.project, "acme/tools@review", "claude-code", {names: ["review"]});
      if (kind === "identical") {
        expect(await restore).toEqual(["review"]);
        expect(lstatSync(copy).isSymbolicLink()).toBe(true);
        expect(readFileSync(join(copy, "SKILL.md"), "utf8")).toBe("# review\n");
      } else {
        await expect(restore).rejects.toThrow("cannot replace skill directory");
        expect(lstatSync(copy).isDirectory()).toBe(true);
      }
    });
  }
});

test("skill lists retain unknown sources in project and global scopes", async () => {
  const t = tempEnv();
  for (const root of [t.project, t.home]) {
    const dir = join(root, ".agents/skills/local-helper");
    mkdirSync(dir, {recursive: true}); writeFileSync(join(dir, "SKILL.md"), "# Local helper\n");
  }
  await withEnv(t.env, async () => {
    expect(await listSkills({global: false, cwd: t.project})).toEqual([{name: "local-helper", source: null}]);
    expect(await listSkills({global: true, cwd: t.home})).toEqual([{name: "local-helper", source: null}]);
  });
});
test("skill lists still reject malformed rows and source values", async () => {
  const t = tempEnv(), script = join(t.project, "invalid-list.ts");
  for (const rows of [{}, [null], [{source: null}], [{name: "bad"}], [{name: "bad", source: 42}], [{name: "bad", source: {repo: "acme/skills"}}]]) {
    writeFileSync(script, `console.log(${JSON.stringify(JSON.stringify(rows))});\n`);
    await withEnv({...t.env, LOADOUTS_SKILLS_CMD: `bun ${script}`}, async () => {
      await expect(listSkills({global: false, cwd: t.project})).rejects.toThrow("invalid skill list");
    });
  }
});

test("default npx runner works in pnpm projects and keeps skills in the requested scope", async () => {
  const t = tempEnv();
  const manifest = JSON.stringify({name: "pnpm-project", devEngines: {packageManager: {name: "pnpm", version: "^10.11.0"}}});
  writeFileSync(join(t.project, "package.json"), manifest);
  const bin = join(t.env.LOADOUTS_CACHE!, "npm/node_modules/.bin");
  mkdirSync(bin, {recursive: true});
  const pkg = join(bin, "../skills");
  mkdirSync(pkg);
  writeFileSync(join(pkg, "package.json"), JSON.stringify({name: "skills", version: "1.8.0", bin: {skills: "cli.ts"}}));
  writeFileSync(join(pkg, "cli.ts"), `#!${process.execPath}\nimport ${JSON.stringify(join(repo, "tests/fixtures/fake-skills.ts"))};\n`, {mode: 0o755});
  symlinkSync("../skills/cli.ts", join(bin, "skills"));
  // npx resolves the pinned package in the isolated prefix but executes it in the project.
  await withEnv({...t.env, PATH: bin + ":" + process.env.PATH, npm_config_offline: "true", npm_config_cache: join(t.home, ".npm"), npm_config_userconfig: join(t.home, ".npmrc"), npm_config_update_notifier: "false"}, async () => {
    delete process.env.LOADOUTS_SKILLS_CMD;
    expect(await addSkills(t.project, "acme/bun-skills@bun", "codex")).toEqual(["bun"]);
    expect(existsSync(join(t.project, ".agents/skills/bun/SKILL.md"))).toBe(true);
    expect(await listSkills({global: false, cwd: t.project})).toEqual([{name: "bun", source: "acme/bun-skills"}]);
    expect(await listSkills({global: true, cwd: t.home})).toEqual([]);
    await removeSkills(t.project, ["bun"], "codex");
    expect(existsSync(join(t.project, ".agents/skills/bun/SKILL.md"))).toBe(false);
    expect(readFileSync(join(t.project, "package.json"), "utf8")).toBe(manifest);
    expect(existsSync(join(t.project, "package-lock.json"))).toBe(false);
    expect(existsSync(join(t.project, "node_modules"))).toBe(false);
  });
});

test("skills install uses the harness and records names, list and remove work", async () => {
  const t = tempEnv(), log = join(t.project, "calls.jsonl");
  await withEnv({...t.env, FAKE_SKILLS_LOG: log, FAKE_SKILLS: JSON.stringify({"acme/bun-skills": ["bun"]})}, async () => {
    expect(await addSkills(t.project, "acme/bun-skills", "codex")).toEqual(["bun"]);
    expect(JSON.parse(readFileSync(log, "utf8").trim())).toEqual(["add", "acme/bun-skills", "-s", "*", "-a", "codex", "-y", "--json"]);
    expect(await listSkills({global: false, cwd: t.project})).toEqual([{name: "bun", source: "acme/bun-skills"}]);
    await removeSkills(t.project, ["bun"], "codex");
    expect(existsSync(join(t.project, ".agents/skills/bun/SKILL.md"))).toBe(false);
  });
});
test("failed installs expose successful names for recovery", async () => {
  const t = tempEnv();
  await withEnv({...t.env, FAKE_SKILLS: JSON.stringify({"acme/bun-skills": ["bun", "extra"]}), FAKE_SKILLS_PARTIAL: "acme/bun-skills"}, async () => {
    try { await addSkills(t.project, "acme/bun-skills", "codex"); throw new Error("accepted failure"); }
    catch (e: any) { expect(e.code).toBe(1); expect(e.installed).toEqual(["bun"]); }
    expect(existsSync(join(t.project, ".agents/skills/bun/SKILL.md"))).toBe(true);
  });
});
test("failed and missing binaries have actionable error codes", async () => {
  const t = tempEnv();
  await withEnv({...t.env, FAKE_SKILLS_FAIL: "acme/bun-skills"}, async () => {
    try { await addSkills(t.project, "acme/bun-skills", "codex"); throw new Error("accepted failure"); }
    catch (e: any) { expect(e.code).toBe(1); expect(e.fix).toContain("--list"); }
  });
  await withEnv({...t.env, LOADOUTS_SKILLS_CMD: "missing-loadouts-test-command"}, async () => {
    try { await addSkills(t.project, "acme/bun-skills", "codex"); throw new Error("accepted missing binary"); }
    catch (e: any) { expect(e.code).toBe(3); }
  });
});
