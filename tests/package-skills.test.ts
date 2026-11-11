import { test, expect, spyOn } from "bun:test";
import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as fs from "node:fs";
import { sync } from "../src/sync";
import { readLock } from "../src/lock";
import { tempEnv, run, fixtureCatalog, withEnv } from "./helpers";

function setup(items: any = {ui: {packageSkills: {include: ["@acme/ui"], exclude: ["@acme/ui#experimental"]}, conventions: "Use @acme/ui for components."}}) {
  const t = tempEnv(), opts = {cwd: t.project, env: {...t.env, FAKE_SKILLS_LOG: join(t.home, "calls")}};
  mkdirSync(join(t.project, ".loadouts/catalog"), {recursive: true});
  const file = join(t.project, ".loadouts/catalog/frontend.yml");
  writeFileSync(file, JSON.stringify({name: "frontend", items, routing: [{when: "Building interfaces", use: [Object.keys(items)[0]]}]}));
  writeFileSync(join(t.project, "loadouts.json"), JSON.stringify({harnesses: ["claude-code", "codex"], loadouts: {frontend: {source: "file:./.loadouts/catalog/frontend.yml"}}}));
  const lock = () => JSON.parse(readFileSync(join(t.project, "loadouts.lock.json"), "utf8"));
  const native = () => JSON.parse(readFileSync(join(t.project, "skills-lock.json"), "utf8"));
  const text = (path: string) => readFileSync(join(t.project, path), "utf8");
  return {...t, opts, file, lock, native, text};
}
function pkg(project: string, name = "@acme/ui", version = "2.0.0", skills = ["components", "experimental"], layout = "skills") {
  const dir = join(project, "node_modules", name); rmSync(dir, {recursive: true, force: true}); mkdirSync(dir, {recursive: true});
  writeFileSync(join(dir, "package.json"), JSON.stringify({name, version, keywords: ["tanstack-intent"], skills: ["acme/remote-must-not-fetch"]}));
  for (const skill of skills) { const path = join(dir, layout, skill); mkdirSync(path, {recursive: true}); writeFileSync(join(path, "SKILL.md"), `---\nname: ${skill}\ndescription: Package guidance\n---\n${name} ${version}\n`); writeFileSync(join(path, "reference.md"), "Companion reference"); }
  return dir;
}
test("switching an owned Git skill to a package companion transfers ownership without native cleanup", async () => {
  for (const harnesses of [["codex"], ["claude-code", "codex"]]) {
    const t = setup({ui: {skills: ["acme/tools@components"]}}); pkg(t.project);
    const manifest = JSON.parse(t.text("loadouts.json")); manifest.harnesses = harnesses;
    writeFileSync(join(t.project, "loadouts.json"), JSON.stringify(manifest));
    expect((await run(["install"], t.opts)).code).toBe(0);
    if (harnesses.includes("claude-code")) {
      rmSync(join(t.project, ".claude/skills/components"));
      cpSync(join(t.project, ".agents/skills/components"), join(t.project, ".claude/skills/components"), {recursive: true});
    }
    writeFileSync(t.file, JSON.stringify({name: "frontend", items: {ui: {packageSkills: {include: ["@acme/ui#components"]}}}}));
    const opts = {...t.opts, env: {...t.opts.env, FAKE_SKILLS_RETAIN_CANONICAL: "1"}};
    const result = await run(["install"], opts); expect(result.code, result.stderr).toBe(0);
    expect(t.native().skills.components).toMatchObject({sourceType: "node_modules", source: "@acme/ui", version: "2.0.0"});
    for (const h of harnesses) {
      expect(t.lock().installed[`skill:${h}:acme/tools@components`]).toBeUndefined();
      expect(t.lock().installed[`package-skill:${h}:@acme/ui#components`]).toEqual(["components"]);
    }
    expect(t.text(".agents/skills/components/reference.md")).toBe("Companion reference");
    if (harnesses.includes("claude-code")) expect(lstatSync(join(t.project, ".claude/skills/components")).isSymbolicLink()).toBe(true);
    expect((await run(["install"], opts)).stdout.trim()).toBe("Nothing changed.");
  }
});
test("failed package discovery preserves Git ownership and contents for a later migration retry", async () => {
  const t = setup({ui: {skills: ["acme/tools@components"]}}); pkg(t.project);
  expect((await run(["install"], t.opts)).code).toBe(0);
  const native = t.text("skills-lock.json"), installed = t.lock().installed;
  writeFileSync(t.file, JSON.stringify({name: "frontend", items: {ui: {packageSkills: {include: ["@acme/ui"]}}}}));
  expect((await run(["install"], {...t.opts, env: {...t.opts.env, FAKE_PACKAGE_FAIL: "1"}})).code).toBe(1);
  expect(t.text("skills-lock.json")).toBe(native); expect(t.lock().installed).toEqual(installed);
  expect(t.text(".claude/skills/components/SKILL.md")).toBe("# components\n");
  const retry = await run(["install"], t.opts); expect(retry.code, retry.stderr).toBe(0);
  expect(t.lock().incomplete).toBeUndefined(); expect(t.native().skills.components.sourceType).toBe("node_modules");
});
test("Git-to-package handoff removes a retired harness link and recovers a partial copy", async () => {
  const t = setup({ui: {skills: ["acme/tools@components"]}}); pkg(t.project);
  expect((await run(["install"], t.opts)).code).toBe(0);
  const yaml = JSON.stringify({name: "frontend", items: {ui: {packageSkills: {include: ["@acme/ui#components"]}}}});
  writeFileSync(t.file, yaml);
  const manifest = JSON.parse(t.text("loadouts.json")); manifest.harnesses = ["codex"];
  writeFileSync(join(t.project, "loadouts.json"), JSON.stringify(manifest));
  const lock = t.lock(); lock.local.frontend = yaml; lock.harnesses = ["codex"];
  const copy = fs.cpSync;
  const failure = spyOn(fs, "cpSync").mockImplementation((source, dest) => {
    mkdirSync(String(dest), {recursive: true}); copy(join(String(source), "SKILL.md"), join(String(dest), "SKILL.md"));
    throw new Error("fixture partial migration copy");
  });
  try { await expect(withEnv(t.env, () => sync(t.project, lock, {repair: true}))).rejects.toThrow("partial migration copy"); }
  finally { failure.mockRestore(); }
  const retry = await run(["install"], t.opts); expect(retry.code, retry.stderr).toBe(0);
  expect(existsSync(join(t.project, ".claude/skills/components"))).toBe(false);
  expect(t.text(".agents/skills/components/reference.md")).toBe("Companion reference");
  expect(t.lock().incomplete).toBeUndefined();
  expect(Object.keys(t.lock().installed)).toEqual(["package-skill:codex:@acme/ui#components"]);
});
test("Git-to-package handoff retries when removing the old directory fails", async () => {
  const t = setup({ui: {skills: ["acme/tools@components"]}}); pkg(t.project);
  expect((await run(["install"], t.opts)).code).toBe(0);
  const yaml = JSON.stringify({name: "frontend", items: {ui: {packageSkills: {include: ["@acme/ui#components"]}}}});
  writeFileSync(t.file, yaml); const lock = t.lock(); lock.local.frontend = yaml;
  const remove = fs.rmSync, dest = join(t.project, ".agents/skills/components");
  const failure = spyOn(fs, "rmSync").mockImplementation((path, opts) => {
    if (String(path) === dest) throw new Error("fixture locked directory");
    remove(path, opts);
  });
  try { await expect(withEnv(t.env, () => sync(t.project, lock, {repair: true}))).rejects.toThrow("locked directory"); }
  finally { failure.mockRestore(); }
  expect(t.text(".agents/skills/components/SKILL.md")).toBe("# components\n");
  const retry = await run(["install"], t.opts); expect(retry.code, retry.stderr).toBe(0);
  expect(t.text(".claude/skills/components/reference.md")).toBe("Companion reference");
  expect(t.lock().incomplete).toBeUndefined();
});
test("a failed Git-to-package copy can be cancelled by removing the loadout", async () => {
  const t = setup({ui: {skills: ["acme/tools@components"]}}); pkg(t.project);
  expect((await run(["install"], t.opts)).code).toBe(0);
  const yaml = JSON.stringify({name: "frontend", items: {ui: {packageSkills: {include: ["@acme/ui#components"]}}}});
  writeFileSync(t.file, yaml); const lock = t.lock(); lock.local.frontend = yaml;
  const copy = fs.cpSync;
  const failure = spyOn(fs, "cpSync").mockImplementation((source, dest) => {
    mkdirSync(String(dest), {recursive: true}); copy(join(String(source), "SKILL.md"), join(String(dest), "SKILL.md"));
    throw new Error("fixture cancelled migration");
  });
  try { await expect(withEnv(t.env, () => sync(t.project, lock, {repair: true}))).rejects.toThrow("cancelled migration"); }
  finally { failure.mockRestore(); }
  const result = await run(["remove", "frontend"], t.opts); expect(result.code, result.stderr).toBe(0);
  expect(t.lock().installed).toEqual({}); expect(t.lock().incomplete).toBeUndefined();
  expect(t.native().skills.components).toBeUndefined();
  expect(existsSync(join(t.project, ".agents/skills/components"))).toBe(false);
  expect(lstatSync(join(t.project, ".claude/skills/components"), {throwIfNoEntry: false})).toBeUndefined();
});
test("Git-to-package migration refuses replaced native provenance and differing Claude copies", async () => {
  for (const conflict of ["source", "copy", "symlink"]) {
    const t = setup({ui: {skills: ["acme/tools@components"]}}); pkg(t.project);
    expect((await run(["install"], t.opts)).code).toBe(0);
    if (conflict === "source") {
      const native = t.native(); native.skills.components.source = "other/tools";
      writeFileSync(join(t.project, "skills-lock.json"), JSON.stringify(native));
    } else {
      rmSync(join(t.project, ".claude/skills/components"));
      if (conflict === "symlink") symlinkSync(t.home, join(t.project, ".claude/skills/components"));
      else { mkdirSync(join(t.project, ".claude/skills/components")); writeFileSync(join(t.project, ".claude/skills/components/SKILL.md"), "User changes"); }
    }
    const before = t.text("skills-lock.json");
    writeFileSync(t.file, JSON.stringify({name: "frontend", items: {ui: {packageSkills: {include: ["@acme/ui"]}}}}));
    const result = await run(["install"], t.opts); expect(result.code).toBe(1);
    expect(t.text("skills-lock.json")).toBe(before);
    expect(t.text(".agents/skills/components/SKILL.md")).toBe("# components\n");
    if (conflict === "copy") expect(t.text(".claude/skills/components/SKILL.md")).toBe("User changes");
  }
});
test("install syncs selected companions, records portable ownership, and leaves the manifest unchanged", async () => {
  const t = setup(); pkg(t.project); const manifest = t.text("loadouts.json");
  const r = await run(["install"], t.opts); expect(r.code, r.stderr).toBe(0);
  expect(t.lock().version).toBe(1);
  expect(t.lock().packageSkills).toEqual({"@acme/ui": {version: "2.0.0", skills: ["components"], requiredBy: ["frontend/ui"]}});
  expect(t.lock().installed["package-skill:claude-code:@acme/ui#components"]).toEqual(["components"]);
  expect(t.text(".claude/skills/components/SKILL.md")).toContain("2.0.0"); expect(t.text(".agents/skills/components/reference.md")).toBe("Companion reference");
  expect(existsSync(join(t.project, ".agents/skills/experimental"))).toBe(false);
  expect(t.text("AGENTS.md")).toContain("components"); expect(t.text("AGENTS.md")).toContain("Use @acme/ui");
  expect(t.native().skills.components).toMatchObject({source: "@acme/ui", sourceType: "node_modules", version: "2.0.0"});
  expect(t.text("loadouts.json")).toBe(manifest); expect(t.text("loadouts.lock.json")).not.toContain(t.project); expect(t.text("skills-lock.json")).not.toContain(t.project);
  const before = t.text("skills-lock.json"), mtime = statSync(join(t.project, ".agents/skills/components/SKILL.md")).mtimeMs;
  expect((await run(["install"], t.opts)).stdout.trim()).toBe("Nothing changed."); expect(t.text("skills-lock.json")).toBe(before); expect(statSync(join(t.project, ".agents/skills/components/SKILL.md")).mtimeMs).toBe(mtime);
  expect(readFileSync(t.opts.env.FAKE_SKILLS_LOG, "utf8")).not.toContain('"add"');
});
test("nested package owners round-trip through lock validation and release their companions", async () => {
  const t = setup({languages: {any_of: {typescript: {items: {framework: {one_of: {react: {items: {ui: {packageSkills: {include: ["@acme/ui#components"]}}}}}, default: "react"}}}}, default: ["typescript"]}});
  pkg(t.project);
  const first = await run(["install"], t.opts); expect(first.code, first.stderr).toBe(0);
  expect(readLock(t.project).packageSkills!["@acme/ui"]!.requiredBy).toEqual(["frontend/languages/typescript/framework/react/ui"]);
  const before = t.text("loadouts.lock.json"), second = await run(["install"], t.opts);
  expect(second.code, second.stderr).toBe(0); expect(t.text("loadouts.lock.json")).toBe(before);
  const manifest = JSON.parse(t.text("loadouts.json")); manifest.loadouts.frontend.choices = {languages: []};
  writeFileSync(join(t.project, "loadouts.json"), JSON.stringify(manifest));
  const removed = await run(["install"], t.opts); expect(removed.code, removed.stderr).toBe(0);
  expect(readLock(t.project).packageSkills).toEqual({}); expect(existsSync(join(t.project, ".agents/skills/components"))).toBe(false);
});
test("install follows dependency upgrades and removals without loadouts update", async () => {
  const t = setup(); pkg(t.project); await run(["install"], t.opts);
  pkg(t.project, "@acme/ui", "3.0.0", ["forms"]);
  expect(JSON.parse((await run(["status", "--json"], t.opts)).stdout).needsInstall).toBe(true);
  const r = await run(["install"], t.opts); expect(r.code, r.stderr).toBe(0);
  expect(t.lock().packageSkills["@acme/ui"].skills).toEqual(["forms"]); expect(t.text(".claude/skills/forms/SKILL.md")).toContain("3.0.0");
  expect(existsSync(join(t.project, ".agents/skills/components"))).toBe(false); expect(t.native().skills.components).toBeUndefined();
  rmSync(join(t.project, "node_modules"), {recursive: true}); expect((await run(["install"], t.opts)).code).toBe(0);
  expect(t.lock().packageSkills["@acme/ui"].version).toBeNull(); expect(existsSync(join(t.project, ".agents/skills/forms"))).toBe(false);
});
test("missing packages preserve conventions and diagnostics notice when packages become available", async () => {
  const t = setup(); const r = await run(["install"], t.opts); expect(r.code, r.stderr).toBe(0); expect(r.stdout).toContain("@acme/ui");
  expect(t.lock().packageSkills["@acme/ui"].version).toBeNull(); expect(t.text("AGENTS.md")).toContain("Use @acme/ui"); expect(t.text("AGENTS.md")).not.toContain("| Building interfaces |  |");
  expect(JSON.parse((await run(["status", "--json"], t.opts)).stdout).needsInstall).toBeUndefined();
  await run(["global", "configure", "--catalog", fixtureCatalog(), "--harness", "claude-code"], t.opts);
  expect((await run(["doctor"], t.opts)).stdout).toContain("@acme/ui");
  pkg(t.project); expect(JSON.parse((await run(["status", "--json"], t.opts)).stdout).needsInstall).toBe(true);
  expect((await run(["install"], t.opts)).code).toBe(0); expect(t.text(".agents/skills/components/SKILL.md")).toContain("2.0.0");
});
test("alternatives and harness overrides select companions without activating unrelated packages", async () => {
  const t = setup({ui: {any_of: {library: {packageSkills: {include: ["@acme/ui"]}, codex: {packageSkills: {include: ["@acme/ui#components"]}}}}, default: []}});
  pkg(t.project); pkg(t.project, "other", "1.0.0", ["unrelated"]);
  expect((await run(["install"], t.opts)).code).toBe(0); expect(existsSync(join(t.project, ".agents/skills/components"))).toBe(false);
  expect((await run(["enable", "frontend/ui", "library"], t.opts)).code).toBe(0);
  expect(t.lock().installed["package-skill:codex:@acme/ui#experimental"]).toBeUndefined(); expect(t.text(".claude/skills/experimental/SKILL.md")).toContain("2.0.0");
  expect(existsSync(join(t.project, ".agents/skills/unrelated"))).toBe(false);
  expect((await run(["disable", "frontend/ui", "library"], t.opts)).code).toBe(0); expect(existsSync(join(t.project, ".agents/skills/components"))).toBe(false);
});
test("another selected item can retain a companion excluded or removed by the first", async () => {
  const t = setup({ui: {packageSkills: {include: ["@acme/ui"], exclude: ["@acme/ui#experimental"]}}, second: {any_of: {extra: {packageSkills: {include: ["@acme/ui#experimental"]}}}, default: ["extra"]}});
  pkg(t.project); expect((await run(["install"], t.opts)).code).toBe(0);
  expect(t.lock().packageSkills["@acme/ui"].skills).toEqual(["components", "experimental"]);
  expect((await run(["harness", "remove", "claude-code"], t.opts)).code).toBe(0); expect(t.text(".agents/skills/experimental/SKILL.md")).toContain("2.0.0"); expect(existsSync(join(t.project, ".claude/skills/experimental"))).toBe(false);
  expect((await run(["disable", "frontend/second", "extra"], t.opts)).code).toBe(0); expect(existsSync(join(t.project, ".agents/skills/experimental"))).toBe(false);
  expect(t.lock().packageSkills["@acme/ui"].requiredBy).toEqual(["frontend/ui"]);
});
test("fresh checkout restores packaged skills from pnpm-style dependency symlinks", async () => {
  const t = setup(); pkg(t.project); await run(["install"], t.opts);
  const other = tempEnv(); for (const file of ["loadouts.json", "loadouts.lock.json", "skills-lock.json", ".loadouts/catalog"]) cpSync(join(t.project, file), join(other.project, file), {recursive: true});
  const store = tempEnv(), dir = pkg(store.project); mkdirSync(join(other.project, "node_modules/@acme"), {recursive: true}); symlinkSync(dir, join(other.project, "node_modules/@acme/ui"));
  const r = await run(["install"], {cwd: other.project, env: other.env}); expect(r.code, r.stderr).toBe(0);
  expect(readFileSync(join(other.project, ".claude/skills/components/SKILL.md"), "utf8")).toContain("2.0.0");
  expect(readFileSync(join(other.project, "loadouts.lock.json"), "utf8")).toBe(t.text("loadouts.lock.json"));
});
test("package sync preserves unrelated Git skills and refuses same-name collisions", async () => {
  const t = setup({ui: {packageSkills: {include: ["@acme/ui"]}, skills: ["acme/tools@review"]}}); pkg(t.project);
  expect((await run(["install"], t.opts)).code).toBe(0); const before = t.native().skills.review;
  pkg(t.project, "@acme/ui", "3.0.0", ["review"]);
  const r = await run(["install"], t.opts); expect(r.code).toBe(1); expect(r.stderr).toContain("review");
  expect(t.native().skills.review).toEqual(before); expect(t.text(".agents/skills/review/SKILL.md")).toBe("# review\n");
  expect(t.text(".agents/skills/components/SKILL.md")).toContain("2.0.0");
});
test("failed or unsafe package installer results preserve existing setup and support retry", async () => {
  const t = setup(); pkg(t.project); expect((await run(["install"], t.opts)).code).toBe(0); const before = t.text("skills-lock.json");
  pkg(t.project, "@acme/ui", "3.0.0");
  for (const flag of ["FAKE_PACKAGE_FAIL", "FAKE_PACKAGE_UNSAFE"]) {
    const r = await run(["install"], {...t.opts, env: {...t.opts.env, [flag]: "1"}}); expect(r.code).toBe(1);
    expect(t.text("skills-lock.json")).toBe(before); expect(t.text(".agents/skills/components/SKILL.md")).toContain("2.0.0"); expect(t.lock().incomplete).toBe(true);
  }
  expect((await run(["install"], t.opts)).code).toBe(0); expect(t.lock().incomplete).toBeUndefined();
});
test("two packages with the same skill fail before applying either", async () => {
  const t = setup({ui: {packageSkills: {include: ["@acme/ui", "other"]}}}); pkg(t.project); pkg(t.project, "other", "1.0.0", ["components"]);
  const r = await run(["install"], t.opts); expect(r.code).toBe(1); expect(r.stderr).toContain("components"); expect(existsSync(join(t.project, ".agents/skills/components"))).toBe(false);
});
test("unmanaged skills and native lock entries are preserved through cleanup", async () => {
  const t = setup(); pkg(t.project); expect((await run(["install"], t.opts)).code).toBe(0);
  const native = t.native(); native.skills.unmanaged = {...native.skills.components, source: "other"}; writeFileSync(join(t.project, "skills-lock.json"), JSON.stringify(native));
  mkdirSync(join(t.project, ".agents/skills/unmanaged")); writeFileSync(join(t.project, ".agents/skills/unmanaged/SKILL.md"), "Unmanaged");
  const r = await run(["remove", "frontend"], t.opts); expect(r.code, r.stderr).toBe(0); expect(t.native().skills.unmanaged).toEqual(native.skills.unmanaged); expect(t.text(".agents/skills/unmanaged/SKILL.md")).toBe("Unmanaged"); expect(existsSync(join(t.project, ".agents/skills/components"))).toBe(false);
});
test("failed removal retains a readable lock and recovers without deleting an unmanaged link", async () => {
  const t = setup(); pkg(t.project); expect((await run(["install"], t.opts)).code).toBe(0);
  rmSync(join(t.project, ".claude/skills/components")); symlinkSync(t.home, join(t.project, ".claude/skills/components"));
  const r = await run(["remove", "frontend"], t.opts); expect(r.code).toBe(1);
  const status = await run(["status", "--json"], t.opts); expect(status.code, status.stderr).toBe(0); expect(JSON.parse(status.stdout).incomplete).toBe(true);
  rmSync(join(t.project, ".claude/skills/components")); expect((await run(["install"], t.opts)).code).toBe(0); expect(t.lock().incomplete).toBeUndefined();
});
test("companion content refresh and missing links are repaired without update", async () => {
  const t = setup(); const dir = pkg(t.project); expect((await run(["install"], t.opts)).code).toBe(0); const hash = t.native().skills.components.computedHash;
  writeFileSync(join(dir, "skills/components/reference.md"), "Updated local package"); rmSync(join(t.project, ".claude/skills/components"));
  expect((await run(["install"], t.opts)).code).toBe(0); expect(t.text(".claude/skills/components/reference.md")).toBe("Updated local package"); expect(t.native().skills.components.computedHash).not.toBe(hash);
});
test("install reports a missing explicitly named companion instead of silently accepting it", async () => {
  const t = setup({ui: {packageSkills: {include: ["@acme/ui#typo"]}}}); pkg(t.project);
  const r = await run(["install"], t.opts); expect(r.code).toBe(1); expect(r.stderr).toContain("@acme/ui#typo");
});
test("unsafe companion payload symlinks are rejected before replacing installed files", async () => {
  const t = setup(); const dir = pkg(t.project); expect((await run(["install"], t.opts)).code).toBe(0); const before = t.text("skills-lock.json");
  symlinkSync(join(t.home, "secret"), join(dir, "skills/components/unsafe"));
  const r = await run(["install"], t.opts); expect(r.code).toBe(1); expect(r.stderr).toContain("unsafe"); expect(t.text("skills-lock.json")).toBe(before); expect(existsSync(join(t.project, ".agents/skills/components/unsafe"))).toBe(false);
});
test("lock validation rejects unsafe package ownership before touching files", async () => {
  const t = setup(); pkg(t.project); expect((await run(["install"], t.opts)).code).toBe(0);
  const lock = t.lock(); lock.installed["package-skill:codex:@acme/ui#../outside"] = ["../outside"]; writeFileSync(join(t.project, "loadouts.lock.json"), JSON.stringify(lock));
  const r = await run(["install"], t.opts); expect(r.code).toBe(1); expect(r.stderr).toContain("invalid lock"); expect(t.text(".agents/skills/components/SKILL.md")).toContain("2.0.0");
});

test("retry completes a partial companion restore even when SKILL.md and the previous hash exist", async () => {
  const t = setup(); pkg(t.project); expect((await run(["install"], t.opts)).code).toBe(0);
  rmSync(join(t.project, ".agents/skills/components"), {recursive: true});
  const copy = fs.cpSync;
  const failure = spyOn(fs, "cpSync").mockImplementation((source, dest) => {
    mkdirSync(String(dest), {recursive: true}); copy(join(String(source), "SKILL.md"), join(String(dest), "SKILL.md"));
    throw new Error("fixture partial copy failure");
  });
  try { await expect(withEnv(t.env, () => sync(t.project, t.lock(), {repair: true}))).rejects.toThrow("partial copy failure"); }
  finally { failure.mockRestore(); }
  expect(t.lock().incomplete).toBe(true); expect(existsSync(join(t.project, ".agents/skills/components/reference.md"))).toBe(false);
  const retry = await run(["install"], t.opts); expect(retry.code, retry.stderr).toBe(0);
  expect(t.text(".agents/skills/components/reference.md")).toBe("Companion reference"); expect(t.lock().incomplete).toBeUndefined();
});

test.each(["constructor", "__proto__"])("valid companion name %s does not collide with inherited properties", async name => {
  const t = setup({ui: {packageSkills: {include: ["@acme/ui"]}}}); pkg(t.project, "@acme/ui", "1.0.0", [name]);
  const r = await run(["install"], t.opts); expect(r.code, r.stderr).toBe(0);
  expect(Object.hasOwn(t.native().skills, name)).toBe(true); expect(t.native().skills[name].source).toBe("@acme/ui"); expect(t.text(`.agents/skills/${name}/SKILL.md`)).toContain("1.0.0");
  expect((await run(["install"], t.opts)).code).toBe(0); expect((await run(["remove", "frontend"], t.opts)).code).toBe(0);
  expect(existsSync(join(t.project, ".agents/skills", name))).toBe(false);
});


test("diamond package companions discover once per package and remain owned until the final root", async () => {
  const t = setup(); pkg(t.project);
  const source = (name: string) => ({source: `file:./.loadouts/catalog/${name}.yml`});
  for (const name of ["a", "z"]) writeFileSync(join(t.project, `.loadouts/catalog/${name}.yml`), JSON.stringify({name, includes: {frontend: source("frontend")}, items: {also: {packageSkills: {include: ["@acme/ui#components"]}}}}));
  writeFileSync(join(t.project, "loadouts.json"), JSON.stringify({harnesses: ["claude-code", "codex"], loadouts: {a: source("a"), z: source("z")}}));
  expect((await run(["install"], t.opts)).code).toBe(0);
  const calls = readFileSync(t.opts.env.FAKE_SKILLS_LOG, "utf8").trim().split("\n").map(line => JSON.parse(line));
  expect(calls.filter(args => args[0] === "experimental_sync")).toHaveLength(1);
  expect(t.lock().packageSkills["@acme/ui"].requiredBy).toEqual(["a/also", "frontend/ui", "z/also"]);
  expect(Object.keys(t.lock().installed).filter(k => k.endsWith("@acme/ui#components"))).toHaveLength(2);
  expect((await run(["remove", "a"], t.opts)).code).toBe(0); expect(existsSync(join(t.project, ".agents/skills/components/SKILL.md"))).toBe(true);
  expect(t.lock().packageSkills["@acme/ui"].requiredBy).toEqual(["frontend/ui", "z/also"]);
  expect((await run(["remove", "z"], t.opts)).code).toBe(0); expect(existsSync(join(t.project, ".agents/skills/components"))).toBe(false);
  expect(existsSync(join(t.project, "node_modules/@acme/ui/package.json"))).toBe(true);
});
