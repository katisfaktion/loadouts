import { expect, test } from "bun:test";
import { paint } from "../src/output";
import { repo, run, tempEnv, withEnv, fixtureCatalog } from "./helpers";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const plainEnv = {NO_COLOR: "", NODE_DISABLE_COLORS: "", FORCE_COLOR: ""};
const ansi = /\x1b\[[0-9;]*m/g;

test("a slow install identifies the pending skill in the terminal before it finishes", async () => {
  const t = tempEnv(), dir = join(t.project, ".loadouts/catalog");
  mkdirSync(dir, {recursive: true});
  writeFileSync(join(dir, "work.yml"), "name: work\nitems: {review: {skills: [acme/tools@review]}}\n");
  writeFileSync(join(t.project, "loadouts.json"), JSON.stringify({harnesses: ["codex"], loadouts: {work: {source: "file:./.loadouts/catalog/work.yml"}}}));
  const ready = join(t.home, "progress-seen"), slow = join(t.home, "slow.ts");
  writeFileSync(slow, `const deadline = Date.now() + 3000;
while (!await Bun.file(${JSON.stringify(ready)}).exists()) {
  if (Date.now() > deadline) throw new Error("No progress appeared while waiting");
  await Bun.sleep(25);
}
await import(${JSON.stringify(join(repo, "tests/fixtures/fake-skills.ts"))});`);
  let output = "";
  const child = Bun.spawn([process.execPath, join(repo, "src/cli.ts"), "install"], {
    cwd: t.project, env: {...process.env, ...t.env, NO_COLOR: "1", LOADOUTS_SKILLS_CMD: `bun ${slow}`},
    terminal: {cols: 100, rows: 20, data(_, chunk) {
      output += new TextDecoder().decode(chunk);
      if (/\d+s.*acme\/tools@review.*codex/i.test(output) && !existsSync(ready)) writeFileSync(ready, "");
    }},
  });
  const timeout = setTimeout(() => child.kill(), 3500);
  try {
    expect(await child.exited, output).toBe(0);
    expect(output).toContain("1 added, 0 removed");
  } finally { clearTimeout(timeout); child.terminal!.close(); writeFileSync(ready, ""); }

  const piped = await run(["install"], {cwd: t.project, env: t.env});
  expect(piped).toEqual({code: 0, stdout: "Nothing changed.\n", stderr: ""});
  writeFileSync(slow, 'await Bun.sleep(1200); console.error("fixture installer failed"); process.exit(1);');
  const failed = await run(["update"], {cwd: t.project, env: {...t.env, LOADOUTS_SKILLS_CMD: `bun ${slow}`}});
  expect(failed.code).toBe(1);
  expect(failed.stderr).toContain("fixture installer failed");
  expect(failed.stderr).not.toMatch(/\[\d+s\]|\x1b\[2K/);
});

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
  expect((await run(["agents", "explore"], {env})).stdout).toBe((await run(["agents", "explore"], {env: plainEnv})).stdout);
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

test("selection commands report one JSON result, including nested choice cleanup and installer notes", async () => {
  const t = tempEnv(), opts = {cwd: t.project, env: {...t.env, FORCE_COLOR: "1"}};
  await run(["init", "--harness", "codex"], opts);
  writeFileSync(join(t.project, ".loadouts/catalog/testing.yml"), `name: testing
items:
  helpers: {packageSkills: {include: [missing-library]}}
  tools:
    any_of:
      browser:
        items:
          runner: {one_of: {a: {}, b: {}}, default: a}
    default: []
`);
  const call = async (...args: string[]) => {
    const r = await run([...args, "--json"], opts);
    expect(r.code, r.stderr).toBe(0); expect(r.stderr).toBe("");
    const result = JSON.parse(r.stdout);
    for (const key of ["added", "removed", "files"]) expect(Array.isArray(result[key])).toBe(true);
    return result;
  };
  expect((await call("add", "file:./.loadouts/catalog/testing.yml")).notes.join(" ")).toContain("missing-library");
  await call("enable", "testing/tools", "browser");
  await call("switch", "testing/tools/browser/runner", "b");
  expect((await call("disable", "testing/tools", "browser")).removedChoices).toEqual(["testing/tools/browser/runner"]);
  await call("update"); await call("harness", "add", "claude-code"); await call("remove", "testing");
});

test("each root help command group has a distinct color", async () => {
  const help = await run(["help"], {env: {...plainEnv, FORCE_COLOR: "1"}});
  const groups = [...help.stdout.matchAll(/^\x1b\[(\d+)m(?:Guidance|Workflow|Diagnostics|Setup):\x1b\[0m\n((?:  [^\n]+\n)+)/gm)];
  expect(groups).toHaveLength(4);
  const colors = groups.map(([, color, commands]) => {
    for (const row of commands!.trimEnd().split("\n")) expect(row.startsWith(`  \x1b[${color}m`)).toBe(true);
    return color;
  });
  expect(new Set(colors).size).toBe(groups.length);
});
