import { expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, readdirSync, lstatSync, readlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fixtureCatalog, repo, run, tempEnv } from "./helpers";

function snapshot(dir: string): unknown {
  return Object.fromEntries(readdirSync(dir).sort().map(name => {
    const path = join(dir, name), stat = lstatSync(path);
    return [name, stat.isSymbolicLink() ? {link: readlinkSync(path)} : stat.isDirectory() ? snapshot(path) : {contents: readFileSync(path).toString("base64"), mtime: stat.mtimeMs}];
  }));
}

async function setup() {
  const t = tempEnv(), catalog = fixtureCatalog(), opts = {cwd: t.project, env: t.env};
  expect((await run(["init", "--harness", "claude-code"], opts)).code).toBe(0);
  expect((await run(["add", "backend", "--catalog", catalog, "--with", "backend/runtime=python"], opts)).code).toBe(0);
  writeFileSync(join(t.project, ".loadouts/catalog/backend.yml"), readFileSync(join(catalog, "loadouts/backend.yml"), "utf8") + "conventions: local replacement\n");
  return {...t, opts, source: `file:${catalog}#backend`, local: "file:./.loadouts/catalog/backend.yml"};
}

async function interactive(args: string[], opts: {cwd: string; env: Record<string, string>}, answer: string) {
  let output = "", prompted = false;
  const child = Bun.spawn([process.execPath, join(repo, "src/cli.ts"), ...args], {
    cwd: opts.cwd, env: {...process.env, ...opts.env, NO_COLOR: "1"},
    terminal: {cols: 200, rows: 30, data(terminal, data) {
      output += new TextDecoder().decode(data);
      if (!prompted && output.includes("[y/N]")) { prompted = true; terminal.write(answer); }
    }},
  });
  const timeout = setTimeout(() => child.kill(), 4000);
  try { return {code: await child.exited, output, prompted}; }
  finally { clearTimeout(timeout); child.terminal!.close(); }
}

test("non-interactive source replacement shows both sources and leaves the project untouched", async () => {
  const t = await setup(), before = snapshot(t.project);
  const result = await run(["add", t.local], t.opts);
  expect(result.code).toBe(1);
  expect(result.stderr).toContain(t.source); expect(result.stderr).toContain(t.local);
  expect(result.stderr).toContain("--yes"); expect(snapshot(t.project)).toEqual(before);
});

test.each(["n\n", "\n", "maybe\n", "\x04", "\x03"])("declining or cancelling replacement (%j) makes no changes", async answer => {
  const t = await setup(), before = snapshot(t.project);
  const result = await interactive(["add", t.local], t.opts, answer);
  expect(result.prompted).toBe(true); expect(result.code).toBe(1);
  expect(result.output).toContain(t.source); expect(result.output).toContain(t.local);
  expect(snapshot(t.project)).toEqual(before);
});

test.each(["y\n", "YES\n"])("affirmative confirmation (%j) applies the replacement and retains choices", async answer => {
  const t = await setup(), result = await interactive(["add", t.local], t.opts, answer);
  expect(result.prompted).toBe(true); expect(result.code, result.output).toBe(0);
  const manifest = JSON.parse(readFileSync(join(t.project, "loadouts.json"), "utf8"));
  expect(manifest.loadouts.backend).toEqual({source: t.local, choices: {runtime: ["python"]}});
  expect(JSON.parse(readFileSync(join(t.project, "loadouts.lock.json"), "utf8")).resolved.backend.source).toBe(t.local);
  expect(readFileSync(join(t.project, "AGENTS.md"), "utf8")).toContain("local replacement");
});

test("--yes authorizes source changes, including catalog overrides and ref changes", async () => {
  const t = await setup(), second = fixtureCatalog();
  for (const [args, source] of [
    [[t.local], t.local],
    [["backend", "--catalog", second], `file:${second}#backend`],
    [[`file:${second}#backend@v1.0.0`], `file:${second}#backend@v1.0.0`],
  ] as [string[], string][]) {
    const before = JSON.parse(readFileSync(join(t.project, "loadouts.json"), "utf8")).loadouts.backend.source;
    const blocked = await run(["add", ...args], t.opts);
    expect(blocked.code).toBe(1); expect(blocked.stderr).toContain(before); expect(blocked.stderr).toContain(source);
    const allowed = await run(["add", ...args, "--yes"], t.opts);
    expect(allowed.code, allowed.stderr).toBe(0); expect(allowed.stderr).toContain(before); expect(allowed.stderr).toContain(source);
    expect(JSON.parse(readFileSync(join(t.project, "loadouts.json"), "utf8")).loadouts.backend.source).toBe(source);
  }
});

test("re-adding the same source or bare name needs no confirmation", async () => {
  const t = await setup(), before = snapshot(t.project);
  for (const name of [t.source, "backend"]) {
    const result = await run(["add", name], t.opts);
    expect(result.code, result.stderr).toBe(0); expect(result.stderr).toBe("");
  }
  expect(snapshot(t.project)).toEqual(before);
});

test("all replacements are shown together and declining cancels new additions too", async () => {
  const t = await setup(), second = fixtureCatalog();
  expect((await run(["add", "base"], t.opts)).code).toBe(0);
  const before = snapshot(t.project);
  const result = await interactive(["add", "frontend", "base", "backend", "--catalog", second], t.opts, "n\n");
  expect(result.code).toBe(1); expect(result.output.match(/\[y\/N\]/g)).toHaveLength(1);
  expect(result.output).toContain(`file:${second}#base`); expect(result.output).toContain(`file:${second}#backend`);
  expect(snapshot(t.project)).toEqual(before);
});

test("declining replacement does not migrate a legacy project", async () => {
  const t = tempEnv(), opts = {cwd: t.project, env: t.env};
  mkdirSync(join(t.project, ".loadouts"));
  const yaml = "name: work\nitems: {}\n";
  writeFileSync(join(t.project, ".loadouts/work.yml"), yaml);
  writeFileSync(join(t.project, "loadouts.lock.json"), JSON.stringify({version: 2, harnesses: ["claude-code"], catalog: null, loadouts: {work: {}}, local: {work: yaml}, installed: {}}));
  const before = snapshot(t.project);
  const result = await run(["add", `file:${join(t.home, "missing-catalog")}#work`], opts);
  expect(result.code).toBe(1); expect(result.stderr).toContain("--yes");
  expect(snapshot(t.project)).toEqual(before); expect(existsSync(join(t.project, "loadouts.json"))).toBe(false);
});
