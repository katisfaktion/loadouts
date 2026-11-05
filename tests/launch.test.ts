import { test, expect } from "bun:test";
import { writeFileSync, mkdirSync, existsSync, readFileSync, statSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { claudeArgv, codexEnv } from "../src/launch";
import { tempEnv, run } from "./helpers";

test("launch arguments and environment preserve native configuration inheritance", () => {
  const {project} = tempEnv(), args = ["-p", "hi", "--model", "x"];
  expect(claudeArgv(project, args)).toEqual(["claude", ...args]);
  writeFileSync(join(project, ".mcp.json"), "{}");
  expect(claudeArgv(project, [])).toEqual(["claude"]);
  expect(codexEnv(project, {KEEP: "yes"})).toEqual({KEEP: "yes"});
  expect(codexEnv(project, {CODEX_HOME: "/custom", KEEP: "yes"})).toEqual({CODEX_HOME: "/custom", KEEP: "yes"});
});
test.each(["claude", "codex"])("%s forwards argv, environment and exit status without auth or configuration writes", async binName => {
  const t = tempEnv(), opts = {cwd: t.project, env: t.env};
  expect((await run(["init"], opts)).code).toBe(0);
  expect((await run(["install"], opts)).code).toBe(0);
  const bin = join(t.project, "bin"); mkdirSync(bin);
  writeFileSync(join(bin, binName), `#!${process.execPath}\nconsole.log(JSON.stringify({args: process.argv.slice(2), home: process.env.CODEX_HOME, keep: process.env.KEEP})); process.exit(7);\n`, {mode: 0o755});
  const files = ["loadouts.lock.json", ".gitignore", ".codex/config.toml"];
  const before = files.map(f => [readFileSync(join(t.project, f), "utf8"), statSync(join(t.project, f)).mtimeMs]);
  const custom = join(t.home, "custom-codex");
  const r = await run([binName, "--help", "--model", "x"], {...opts, env: {...t.env, CODEX_HOME: custom, KEEP: "yes", PATH: bin}});
  expect(r.code, r.stderr).toBe(7);
  expect(JSON.parse(r.stdout)).toEqual({args: ["--help", "--model", "x"], home: custom, keep: "yes"});
  expect(files.map(f => [readFileSync(join(t.project, f), "utf8"), statSync(join(t.project, f)).mtimeMs])).toEqual(before);
  expect(existsSync(join(t.home, ".codex/auth.json"))).toBe(false);
  expect(existsSync(join(t.project, ".loadouts/codex-home/auth.json"))).toBe(false);
  unlinkSync(join(t.project, "CLAUDE.md"));
  expect((await run([binName], {...opts, env: {...t.env, PATH: bin}})).stderr).toContain("loadouts install");
});
test("missing harness binaries give environment errors", async () => {
  const t = tempEnv(), opts = {cwd: t.project, env: t.env}; await run(["init"], opts);
  const r = await run(["claude"], {...opts, env: {...t.env, PATH: "/nonexistent-loadouts-test"}});
  expect(r.code).toBe(3); expect(r.stderr).toContain("claude not found on PATH");
});
test("launch forwards help flags and child exit status untouched", async () => {
  const t = tempEnv(), opts = {cwd: t.project, env: t.env}; await run(["init"], opts); await run(["install"], opts);
  const bin = join(t.project, "bin"); mkdirSync(bin);
  writeFileSync(join(bin, "claude"), '#!/bin/sh\nprintf "%s\\n" "$@"\nexit 7\n', {mode: 0o755});
  const r = await run(["claude", "--help", "--model", "x"], {...opts, env: {...t.env, PATH: bin}});
  expect(r.code).toBe(7); expect(r.stdout).toBe("--help\n--model\nx\n");
});

test("direct Codex launch ignores generated state before starting", async () => {
  const t = tempEnv(), opts = {cwd: t.project, env: t.env}, bin = join(t.project, "bin");
  mkdirSync(bin); mkdirSync(join(t.home, ".codex")); writeFileSync(join(t.home, ".codex/auth.json"), "{}");
  writeFileSync(join(bin, "codex"), '#!/bin/sh\ntest -f .gitignore || exit 9\nexit 0\n', {mode: 0o755});
  await run(["init", "--harness", "codex"], opts);
  await run(["install"], opts);
  expect((await run(["codex"], {...opts, env: {...t.env, PATH: bin}})).code).toBe(0);
  expect(await Bun.file(join(t.project, ".gitignore")).text()).toContain(".loadouts/");
});

test("launch requires a completed install matching the manifest", async () => {
  const t = tempEnv(), bin = join(t.home, "bin"); mkdirSync(bin);
  writeFileSync(join(bin, "claude"), '#!/bin/sh\nexit 9\n', {mode: 0o755});
  const opts = {cwd: t.project, env: {...t.env, PATH: `${bin}:${process.env.PATH}`}};
  await run(["init", "--harness", "claude-code"], opts);
  const before = await run(["claude"], opts); expect(before.code).toBe(1); expect(before.stderr).toContain("loadouts install");
  await run(["install"], opts); expect((await run(["claude"], opts)).code).toBe(9);
  writeFileSync(join(t.project, "loadouts.json"), JSON.stringify({harnesses: [], loadouts: {}}));
  expect((await run(["claude"], opts)).code).toBe(1);
  writeFileSync(join(t.project, "loadouts.json"), JSON.stringify({harnesses: ["claude-code"], loadouts: {}}));
  const file = join(t.project, "loadouts.lock.json"), lock = JSON.parse(await Bun.file(file).text());
  writeFileSync(file, JSON.stringify({...lock, incomplete: true}));
  expect((await run(["claude"], opts)).stderr).toContain("loadouts install");
});
