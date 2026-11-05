import { test, expect } from "bun:test";
import { COMMANDS } from "../src/cli";
import { run, tempEnv } from "./helpers";
import { readdirSync } from "node:fs";

test("help teaches the typical flow", async () => {
  const r = await run(["help"]);
  expect(r.code).toBe(0);
  expect(r.stdout).toContain("loadouts add");
  expect(r.stdout).toContain("Typical flow");
});

test("root help aliases show compact grouped commands", async () => {
  const help = await run(["help"]);
  for (const args of [[], ["--help"], ["-h"]]) {
    const result = await run(args);
    expect(result.code).toBe(0); expect(result.stdout).toBe(help.stdout);
  }
  expect(help.stdout).toContain("Usage: loadouts");
  expect(help.stdout).toMatch(/\n  install\s+.*\n  add\s+/);
  expect(help.stdout).toContain("Commands:");
  expect(help.stdout).toContain("Flags:");
});

test.each([
  ["setup", "--catalog", "--harness"], ["add", "--with", "--catalog", "--yes"],
  ["create", "--from"], ["publish", "--summary", "--catalog", "--yes"],
  ["inspect", "--json"], ["status", "--json"], ["doctor", "--json"],
  ["list", "--catalog", "--json"], ["show", "--catalog", "--json"], ["global", "--yes"],
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

test("a missing setup value cannot swallow an unknown flag and write configuration", async () => {
  const t = tempEnv();
  const result = await run(["setup", "--catalog", "--unknown", "--harness", "codex"], {cwd: t.project, env: t.env});
  expect(result.code).toBe(2);
  expect(readdirSync(t.home, {recursive: true})).toEqual([]);
  expect(readdirSync(t.project, {recursive: true})).toEqual([]);
});
test("every registered command has examples", () => {
  for (const c of Object.values(COMMANDS)) expect(c.examples.length).toBeGreaterThan(0);
});

test("install and add help explain committed sources and restoration", async () => {
  const install = await run(["help", "install"]), add = await run(["help", "add"]);
  for (const text of ["loadouts.json", "loadouts.lock.json", "file:./.loadouts/catalog/", "github:", "loadouts update"]) expect(install.stdout).toContain(text);
  expect(add.stdout).toContain("file:./.loadouts/catalog/");
});

test.each(["claude", "codex"])("%s help explains normal inheritance and read-only preflight", async command => {
  const r = await run(["help", command]);
  expect(r.code).toBe(0); expect(r.stdout).toContain("normal configuration inheritance");
  expect(r.stdout).toContain("read-only"); expect(r.stdout).toContain("loadouts install");
});
