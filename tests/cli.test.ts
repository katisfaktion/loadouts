import { test, expect } from "bun:test";
import { COMMANDS } from "../src/cli";
import { run, tempEnv } from "./helpers";
import { readdirSync } from "node:fs";

test("help starts with workflow discovery and points to command syntax", async () => {
  const r = await run(["help"]);
  expect(r.code).toBe(0);
  expect(r.stdout).toMatch(/Guidance:\n  agents\s/);
  expect(r.stdout).toContain("loadouts help <command>");
  expect(r.stdout).not.toContain("loadouts add base frontend backend");
});

test("root help aliases show compact grouped commands", async () => {
  const help = await run(["help"]);
  for (const args of [[], ["--help"], ["-h"]]) {
    const result = await run(args);
    expect(result.code).toBe(0); expect(result.stdout).toBe(help.stdout);
  }
  expect(help.stdout).toContain("Usage: loadouts");
  expect(help.stdout).toMatch(/\n  install\s+.*\n  add\s+/);
  const groups = [...help.stdout.matchAll(/^(Guidance|Workflow|Diagnostics|Setup):\n((?:  [^\n]+\n)+)/gm)];
  expect(groups.map(group => group[1])).toEqual(["Guidance", "Workflow", "Diagnostics", "Setup"]);
  const commands = groups.map(group => [...group[2]!.matchAll(/^  (\w+)/gm)].map(row => row[1]!));
  expect(commands[0]).toEqual(["agents", "help"]);
  expect(commands[1]).toEqual(expect.arrayContaining(["list", "show", "install", "publish", "claude", "codex"]));
  expect(commands[2]).toEqual(expect.arrayContaining(["inspect", "status", "doctor", "validate"]));
  expect(commands[3]).toEqual(expect.arrayContaining(["init", "harness", "global"]));
  expect(commands.flat().sort()).toEqual(Object.keys(COMMANDS).sort());
  expect(help.stdout).toContain("Flags:");
});

test.each([
  ["add", "--with", "--catalog", "--yes"],
  ["create", "--from"], ["publish", "--summary", "--catalog", "--yes"],
  ["inspect", "--json"], ["status", "--json"], ["doctor", "--json"],
  ["list", "--catalog", "--json"], ["show", "--catalog", "--json"],
])("command help documents accepted options for %s", async (name, ...flags) => {
  const result = await run(["help", name]);
  expect(result.code).toBe(0);
  expect(result.stdout).toContain("Flags:");
  for (const flag of [...flags, "--help"]) expect(result.stdout.split("Flags:")[1]).toContain(flag);
});
test("command help has examples and aliases", async () => {
  const r = await run(["help", "add"]);
  expect(r.code).toBe(0);
  expect(r.stdout).toContain("Example");
  expect((await run(["add", "--help"])).stdout).toBe(r.stdout);
  expect((await run(["add", "-h"])).stdout).toBe(r.stdout);
});
test("unknown commands explain recovery", async () => {
  const r = await run(["nosuch"]);
  expect(r.code).toBe(2);
  expect(r.stderr).toContain('error: unknown command "nosuch"');
  expect(r.stderr).toContain("fix: run loadouts help");
});

test.each([
  [["help", "global", "test"], "loadouts help global"],
  [["help", "add", "extra"], "loadouts help add"],
  [["help", "--unknown"], "loadouts help"],
] as const)("invalid help requests point to a usable page: %j", async (args, page) => {
  const error = await run([...args]);
  expect(error.code).toBe(2);
  expect(error.stderr.trim().split("\n").at(-1)).toBe(`fix: run ${page}`);
  expect((await run(page.split(" ").slice(1))).code).toBe(0);
});

test("a missing setup value cannot swallow an unknown flag and write configuration", async () => {
  const t = tempEnv();
  const result = await run(["global", "configure", "--catalog", "--unknown", "--harness", "codex"], {cwd: t.project, env: t.env});
  expect(result.code).toBe(2);
  expect(readdirSync(t.home, {recursive: true})).toEqual([]);
  expect(readdirSync(t.project, {recursive: true})).toEqual([]);
});
test("every registered command has examples", () => {
  for (const c of Object.values(COMMANDS)) expect(c.examples.length).toBeGreaterThan(0);
});

test("install and add help explain committed sources and restoration", async () => {
  const install = await run(["help", "install"]), add = await run(["help", "add"]);
  for (const text of ["loadouts.json", "loadouts.lock.json", "skills-lock.json", "loadouts update", "loadouts agents apply"]) expect(install.stdout).toContain(text);
  expect(add.stdout).toContain("file:./.loadouts/catalog/");
  expect(add.stdout).toContain("confirmation_required");
  const guide = await run(["agents", "apply"]);
  for (const text of ["file:./.loadouts/catalog/", "github:", "loadouts agents diagnose"]) expect(guide.stdout).toContain(text);
  expect(install.stdout).not.toContain("Example loadouts.json:");
});

test("the checkout guide specifies release lock v1 and rejects development formats", async () => {
  const result = await run(["agents", "apply"]);
  expect(result.code).toBe(0);
  expect(result.stdout).toContain("lock format 1");
  expect(result.stdout).toContain("rejects development lock formats");
  expect(result.stdout).not.toMatch(/migrat|locks 1–5|Lock v6/);
});

test("publish help shows the preview example and identifies the flag that opens a PR", async () => {
  const result = await run(["help", "publish"]);
  expect(result.code).toBe(0);
  expect(result.stdout).toContain("loadouts agents publish");
  expect(result.stdout).toContain("--catalog OWNER/REPO");
  expect(result.stdout).toMatch(/--yes +Push a branch and open a pull request/);
  expect(result.stdout).toMatch(/^  loadouts publish .+--summary [^\n]+$/m);
  expect(result.stdout).not.toMatch(/^  loadouts publish .*--yes/m);
});

test.each(["claude", "codex"])("%s help explains normal inheritance and read-only preflight", async command => {
  const r = await run(["help", command]);
  expect(r.code).toBe(0); expect(r.stdout).toContain("project and user settings");
  expect(r.stdout).toContain("Forward all arguments"); expect(r.stdout).toContain("agent's exit code");
  expect(r.stdout).toContain("read-only"); expect(r.stdout).toContain("loadouts install");
});

test("global help distinguishes configure and prune and their options", async () => {
  const root = await run(["help", "global"]);
  expect(root.stdout).toContain("configure"); expect(root.stdout).toContain("prune");
  for (const [action, flags, excluded] of [["configure", ["--harness", "--catalog"], "--yes"], ["prune", ["--yes"], "--harness"]] as const) {
    const help = await run(["help", "global", action]);
    expect(help.code, help.stderr).toBe(0);
    expect(help.stdout).toContain(`loadouts global ${action}`);
    expect((await run(["global", action, "--help"])).stdout).toBe(help.stdout);
    for (const flag of [...flags, "--help"]) expect(help.stdout.split("Flags:")[1]).toContain(flag);
    expect(help.stdout).not.toContain(excluded);
    expect((await run(["global", action, excluded])).code).toBe(2);
  }
  const old = await run(["setup"]);
  expect(old.code).toBe(2); expect(old.stderr).toContain("loadouts global configure");
});
