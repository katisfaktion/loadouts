import { expect, test } from "bun:test";
import { paint } from "../src/output";
import { run, tempEnv, withEnv, fixtureCatalog } from "./helpers";
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const plainEnv = {NO_COLOR: "", NODE_DISABLE_COLORS: "", FORCE_COLOR: ""};
const ansi = /\x1b\[[0-9;]*m/g;

test("terminal color detection is per stream and explicit disable wins", async () => {
  const out = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");
  const err = Object.getOwnPropertyDescriptor(process.stderr, "isTTY");
  try {
    Object.defineProperty(process.stdout, "isTTY", {value: false, configurable: true});
    Object.defineProperty(process.stderr, "isTTY", {value: true, configurable: true});
    await withEnv(plainEnv, () => {
      expect(paint("result", "green")).toBe("result");
      expect(paint("error", "red", "stderr")).toContain("\x1b[");
    });
    for (const env of [{NO_COLOR: "1"}, {NODE_DISABLE_COLORS: "1"}, {FORCE_COLOR: "0"}]) {
      await withEnv({...plainEnv, FORCE_COLOR: "1", ...env}, () => {
        expect(paint("error", "red", "stderr")).toBe("error");
      });
    }
  } finally {
    if (out) Object.defineProperty(process.stdout, "isTTY", out); else delete process.stdout.isTTY;
    if (err) Object.defineProperty(process.stderr, "isTTY", err); else delete process.stderr.isTTY;
  }
});

test("forced color styles help and stderr without changing plain text or alignment", async () => {
  for (const args of [["help"], ["help", "add"], ["unknown"]]) {
    const plain = await run(args, {env: plainEnv});
    const color = await run(args, {env: {...plainEnv, FORCE_COLOR: "1"}});
    expect(plain.stdout + plain.stderr).not.toContain("\x1b[");
    expect(color.stdout + color.stderr).toContain("\x1b[");
    expect(color.stdout.replace(ansi, "")).toBe(plain.stdout);
    expect(color.stderr.replace(ansi, "")).toBe(plain.stderr);
  }
});

test("forced color never changes JSON or raw exploration Markdown", async () => {
  const t = tempEnv();
  const env = {...t.env, ...plainEnv, FORCE_COLOR: "1"};
  expect((await run(["init", "--harness", "codex"], {cwd: t.project, env})).code).toBe(0);
  for (const args of [["inspect", "--json"], ["status", "--json"], ["doctor", "--json"]]) {
    const r = await run(args, {cwd: t.project, env});
    expect(r.stdout).not.toContain("\x1b[");
    expect(() => JSON.parse(r.stdout)).not.toThrow();
  }
  expect((await run(["explore"], {env})).stdout).toBe((await run(["explore"], {env: plainEnv})).stdout);
});

test("installation summarizes changes, human status explains choices, and reinstall changes nothing", async () => {
  const t = tempEnv(), opts = {cwd: t.project, env: {...t.env, ...plainEnv}};
  expect((await run(["init", "--harness", "codex"], opts)).code).toBe(0);
  mkdirSync(join(t.project, ".loadouts/catalog"), {recursive: true});
  writeFileSync(join(t.project, ".loadouts/catalog/demo.yml"), "name: demo\nitems:\n  tools:\n    any_of:\n      bun: {conventions: Use Bun.}\n    default: [bun]\n");
  const added = await run(["add", "file:./.loadouts/catalog/demo.yml", "--with", "demo/tools="], opts);
  expect(added.code, added.stderr).toBe(0);
  expect(added.stdout).toMatch(/0 added, 0 removed, \d+ files written\./);
  expect(added.stdout).toContain("4 files written."); // Manifest, lock, Codex config and AGENTS.md.
  const status = await run(["status"], opts);
  expect(status.stdout).toContain("demo  file:./.loadouts/catalog/demo.yml");
  expect(status.stdout).toContain("tools: none");
  expect(status.stdout).not.toContain('"tools"');
  const file = join(t.project, "loadouts.lock.json"), before = [readFileSync(file, "utf8"), statSync(file).mtimeMs];
  expect(await run(["install"], opts)).toMatchObject({code: 0, stdout: "Nothing changed.\n"});
  expect([readFileSync(file, "utf8"), statSync(file).mtimeMs]).toEqual(before);
  const manifest = JSON.parse(readFileSync(join(t.project, "loadouts.json"), "utf8"));
  manifest.loadouts.demo.choices.tools = ["bun"];
  writeFileSync(join(t.project, "loadouts.json"), JSON.stringify(manifest));
  const drift = await run(["status"], opts);
  expect(drift.stdout).toContain("tools: none");
  expect(drift.stdout).toContain("requested tools: bun");
  expect(drift.stdout).toContain("loadouts install");
});

test("human findings and package warnings are colored and actionable; JSON stays raw", async () => {
  const t = tempEnv(), opts = {cwd: t.project, env: {...t.env, ...plainEnv, FORCE_COLOR: "1"}};
  expect((await run(["setup", "--catalog", fixtureCatalog(), "--harness", "codex"], opts)).code).toBe(0);
  expect((await run(["init"], opts)).code).toBe(0);
  const doctor = await run(["doctor"], opts);
  expect(doctor.code).toBe(1); expect(doctor.stdout).toContain("\x1b[33m");
  expect(doctor.stdout.replace(ansi, "")).toContain("fix: loadouts install");
  mkdirSync(join(t.project, ".loadouts/catalog"), {recursive: true});
  writeFileSync(join(t.project, ".loadouts/catalog/demo.yml"), 'name: demo\nitems:\n  ui:\n    packageSkills: {include: ["@missing/ui"]}\n');
  const install = await run(["add", "file:./.loadouts/catalog/demo.yml"], opts);
  expect(install.code, install.stderr).toBe(0);
  expect(install.stdout).toContain("\x1b[33mPackage @missing/ui");
  expect(install.stdout).toContain("\x1b[32m");
  for (const args of [["status", "--json"], ["list", "--json"], ["show", "demo", "--json"]]) {
    const r = await run(args, opts);
    expect(r.code, r.stderr).toBe(0); expect(r.stdout).not.toContain("\x1b[");
    expect(() => JSON.parse(r.stdout)).not.toThrow();
  }
});
