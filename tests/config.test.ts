import { test, expect } from "bun:test";
import { existsSync, readFileSync, statSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tempEnv, fixtureCatalog, run } from "./helpers";

const pointer = "When asked to set up, restore, change, troubleshoot or share project loadouts, run `loadouts agents` and read the matching guide.";

test("setup is idempotent and supplies catalog defaults", async () => {
  const t = tempEnv(), catalog = fixtureCatalog(), opts = { cwd: t.project, env: t.env };
  const args = ["global", "configure", "--catalog", catalog, "--harness", "claude-code,codex"];
  expect((await run(args, opts)).code).toBe(0);
  expect((await run(args, opts)).stdout).toContain("Nothing changed.");
  expect(readFileSync(join(t.home, ".claude/CLAUDE.md"), "utf8")).toBe("@LOADOUTS.md\n");
  expect(readFileSync(join(t.home, ".codex/AGENTS.md"), "utf8")).toBe(`@${join(t.home, ".codex/LOADOUTS.md")}\n`);
  for (const dir of [".claude", ".codex"]) {
    expect(readFileSync(join(t.home, dir, "LOADOUTS.md"), "utf8")).toBe(pointer + "\n");
  }
  expect((await run(["show", "base", "--json"], opts)).code).toBe(0);
});
test("setup preserves existing instructions and loadout notes", async () => {
  const t = tempEnv(), opts = { cwd: t.project, env: t.env };
  const sentence = "Agent setups are managed by `loadouts`; see `loadouts help`.";
  for (const [dir, name] of [[".claude", "CLAUDE.md"], [".codex", "AGENTS.md"]]) {
    mkdirSync(join(t.home, dir));
    await Bun.write(join(t.home, dir, name), `@RTK.md\n${sentence}\n\nKeep these instructions.\n`);
    await Bun.write(join(t.home, dir, "LOADOUTS.md"), "Keep these loadout notes.");
  }
  const args = ["global", "configure", "--catalog", "acme/repo", "--harness", "claude-code,codex"];
  expect((await run(args, opts)).code).toBe(0);
  for (const [dir, name] of [[".claude", "CLAUDE.md"], [".codex", "AGENTS.md"]]) {
    const reference = dir === ".claude" ? "@LOADOUTS.md" : `@${join(t.home, dir, "LOADOUTS.md")}`;
    expect(readFileSync(join(t.home, dir, name), "utf8")).toBe(`@RTK.md\n${sentence}\n\nKeep these instructions.\n${reference}\n`);
    expect(readFileSync(join(t.home, dir, "LOADOUTS.md"), "utf8")).toBe(`Keep these loadout notes.\n${pointer}\n`);
  }
  expect((await run(args, opts)).stdout).toContain("Nothing changed.");
});
test("setup only adds references for selected harnesses and preserves inline prose", async () => {
  const t = tempEnv();
  mkdirSync(join(t.home, ".codex"));
  const prose = "Note: Agent setups are managed by `loadouts`; see `loadouts help`.";
  await Bun.write(join(t.home, ".codex/AGENTS.md"), prose);
  expect((await run(["global", "configure", "--catalog", "acme/repo", "--harness", "codex"], {cwd: t.project, env: t.env})).code).toBe(0);
  expect(readFileSync(join(t.home, ".codex/AGENTS.md"), "utf8")).toBe(`${prose}\n@${join(t.home, ".codex/LOADOUTS.md")}\n`);
  expect(existsSync(join(t.home, ".claude"))).toBe(false);
});
test("setup preserves existing references and CRLF line endings", async () => {
  const t = tempEnv(), dir = join(t.home, ".claude");
  mkdirSync(dir);
  const sentence = "Agent setups are managed by `loadouts`; see `loadouts help`.";
  await Bun.write(join(dir, "CLAUDE.md"), "@RTK.md\r\n@LOADOUTS.md\r\n");
  await Bun.write(join(dir, "LOADOUTS.md"), `Custom notes.\r\n${sentence}\r\n`);
  expect((await run(["global", "configure", "--catalog", "acme/repo", "--harness", "claude-code"], {cwd: t.project, env: t.env})).code).toBe(0);
  expect(readFileSync(join(dir, "CLAUDE.md"), "utf8")).toBe("@RTK.md\r\n@LOADOUTS.md\r\n");
  expect(readFileSync(join(dir, "LOADOUTS.md"), "utf8")).toBe(`Custom notes.\r\n${pointer}\r\n`);
});
test("setup replaces its two previous hint lines and preserves surrounding user notes", async () => {
  const t = tempEnv(), dir = join(t.home, ".codex");
  mkdirSync(dir);
  const guide = join(dir, "LOADOUTS.md");
  const old = "Agent setups are managed by `loadouts`; see `loadouts help`.";
  await Bun.write(guide, `My note: ${old}\n${old}\nRead bundled workflow guides with \`loadouts agents\`.\nKeep my footer.`);
  const args = ["global", "configure", "--catalog", "acme/repo", "--harness", "codex"];
  const opts = {cwd: t.project, env: t.env};
  expect((await run(args, opts)).code).toBe(0);
  expect(readFileSync(guide, "utf8")).toBe(`My note: ${old}\n${pointer}\nKeep my footer.`);
  expect((await run(args, opts)).stdout).toContain("Nothing changed.");
});
test("init selects harnesses without overwriting an existing project", async () => {
  const t = tempEnv(), opts = { cwd: t.project, env: t.env };
  expect((await run(["init", "--harness", "codex"], opts)).code).toBe(0);
  const file = join(t.project, "loadouts.json"), before = statSync(file).mtimeMs;
  expect(JSON.parse(readFileSync(file, "utf8")).harnesses).toEqual(["codex"]);
  expect((await run(["init", "--harness", "codex"], opts)).code).toBe(0);
  expect(statSync(file).mtimeMs).toBe(before);
  const r = await run(["init", "--harness", "claude-code"], opts);
  expect(r.code).toBe(2); expect(r.stderr).toContain("use loadouts harness add|remove");
});
test("unknown harnesses are usage errors", async () => {
  expect((await run(["init", "--harness", "vim"])).code).toBe(2);
});
test("status requires a project and locates locks in ancestor directories", async () => {
  const t = tempEnv(), opts = {cwd: t.project, env: t.env};
  const r = await run(["status"], opts);
  expect(r.code).toBe(2); expect(r.stderr).toContain("fix: run loadouts init");
  await run(["init"], opts);
  mkdirSync(join(t.project, "child"));
  expect((await run(["status"], {...opts, cwd: join(t.project, "child")})).code).toBe(0);
});
test("unknown options return usage errors", async () => {
  expect((await run(["init", "--bogus"])).code).toBe(2);
});

test("explicit setup repairs malformed user configuration", async () => {
  const t = tempEnv(), dir = join(t.home, ".config/loadouts"); mkdirSync(dir, {recursive: true});
  await Bun.write(join(dir, "config.toml"), "invalid");
  const r = await run(["global", "configure", "--catalog", "acme/repo", "--harness", "codex"], {cwd: t.project, env: t.env});
  expect(r.code).toBe(0);
  expect(Bun.TOML.parse(readFileSync(join(dir, "config.toml"), "utf8"))).toEqual({catalog: "acme/repo", harnesses: ["codex"]});
});
