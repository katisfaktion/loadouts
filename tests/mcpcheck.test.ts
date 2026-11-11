import { test, expect } from "bun:test";
import { checkMcp } from "../src/mcpcheck";
import { repo, tempEnv, run, fixtureCatalog, git } from "./helpers";
import { existsSync, mkdirSync, readFileSync, writeFileSync, cpSync } from "node:fs";
import { join } from "node:path";

test("stdio initialize succeeds", async () => {
  expect(await checkMcp({command: process.execPath, args: [repo + "/tests/fixtures/mcp-ok.ts"]})).toEqual({ok: true});
});
test("default timeout allows a server taking more than ten seconds to initialize", async () => {
  expect(await checkMcp({command: process.execPath, args: [repo + "/tests/fixtures/mcp-ok.ts", "11000"]})).toEqual({ok: true});
}, 15000);
test("exited servers fail", async () => { expect((await checkMcp({command: "false"})).ok).toBe(false); });
test("silent servers time out and are terminated", async () => {
  const r = await checkMcp({command: "sleep", args: ["30"]}, 500);
  expect(r.ok).toBe(false); if (!r.ok) expect(r.reason).toContain("timeout");
});
test("unreachable HTTP servers fail", async () => { expect((await checkMcp({url: "http://127.0.0.1:9"})).ok).toBe(false); });

test("npx MCP servers initialize in pnpm projects during apply, harness use and doctor", async () => {
  const t = tempEnv(), bin = join(t.home, "bin");
  const manifest = JSON.stringify({name: "pnpm-project", devEngines: {packageManager: {name: "pnpm", version: "^10.11.0"}}});
  writeFileSync(join(t.project, "package.json"), manifest);
  mkdirSync(bin, {recursive: true});
  writeFileSync(join(bin, "loadouts-mcp-fixture"), `#!${process.execPath}\nif (process.cwd() !== process.env.MCP_PROJECT) throw new Error("server lost project cwd");\nimport ${JSON.stringify(join(repo, "tests/fixtures/mcp-ok.ts"))};\n`, {mode: 0o755});
  mkdirSync(join(t.home, ".codex")); writeFileSync(join(t.home, ".codex/auth.json"), "{}");
  const env = {...t.env, PATH: `${bin}:${process.env.PATH}`, MCP_PROJECT: t.project, npm_config_offline: "true", npm_config_cache: join(t.home, ".npm"), npm_config_userconfig: join(t.home, ".npmrc"), npm_config_update_notifier: "false"};
  const opts = {cwd: t.project, env};
  expect((await run(["global", "configure", "--catalog", fixtureCatalog(), "--harness", "claude-code,codex"], opts)).code).toBe(0);
  expect((await run(["init"], opts)).code).toBe(0);
  writeFileSync(join(t.project, ".loadouts/catalog/work.yml"), 'name: work\nitems:\n  ui:\n    mcp:\n      ui:\n        command: npx\n        args: [-c, loadouts-mcp-fixture]\n');
  const applied = await run(["add", "file:./.loadouts/catalog/work.yml"], opts);
  expect(applied.code).toBe(0);
  const claude = JSON.parse(readFileSync(join(t.project, ".mcp.json"), "utf8")).mcpServers.ui;
  const codex = (Bun.TOML.parse(readFileSync(join(t.project, ".codex/config.toml"), "utf8")) as any).mcp_servers.ui;
  for (const server of [claude, codex]) {
    const child = Bun.spawn([server.command, ...server.args], {cwd: t.project, env: {...process.env, ...env, ...server.env}, stdin: new TextEncoder().encode('{"jsonrpc":"2.0","id":1,"method":"initialize"}\n'), stdout: "pipe", stderr: "pipe"});
    const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    expect(code, stderr).toBe(0); expect(JSON.parse(stdout).result.serverInfo.name).toBe("ok");
  }
  const diagnosis = await run(["doctor", "--json"], opts);
  expect(diagnosis.code).toBe(0); expect(JSON.parse(diagnosis.stdout).findings).toEqual([]);
  mkdirSync(join(t.project, "nested"));
  const nested = await run(["doctor", "--json"], {...opts, cwd: join(t.project, "nested")});
  expect(nested.code, nested.stderr + nested.stdout).toBe(0);
  git(t.project, "init", "-b", "main");
  git(t.project, "add", ".mcp.json", "package.json", ".loadouts/.gitkeep"); git(t.project, "commit", "-m", "Portable MCP fixture");
  const other = tempEnv(), otherBin = join(other.home, "bin");
  git(t.project, "clone", "--local", t.project, other.project);
  mkdirSync(otherBin); cpSync(join(bin, "loadouts-mcp-fixture"), join(otherBin, "loadouts-mcp-fixture"));
  const shared = readFileSync(join(other.project, ".mcp.json"), "utf8"), server = JSON.parse(shared).mcpServers.ui;
  expect(shared).not.toContain(t.home); expect(shared).not.toContain(t.env.LOADOUTS_CACHE!);
  const child = Bun.spawn([server.command, ...server.args], {cwd: other.project, env: {...process.env, ...env, ...other.env, PATH: `${otherBin}:${process.env.PATH}`, MCP_PROJECT: other.project, npm_config_cache: join(other.home, ".npm"), npm_config_userconfig: join(other.home, ".npmrc")}, stdin: new TextEncoder().encode('{"jsonrpc":"2.0","id":1,"method":"initialize"}\n'), stdout: "pipe", stderr: "pipe"});
  const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
  expect(code, stderr).toBe(0); expect(JSON.parse(stdout).result.serverInfo.name).toBe("ok");
  expect(existsSync(join(other.project, ".loadouts/.gitkeep"))).toBe(true);
  expect(readFileSync(join(t.project, "package.json"), "utf8")).toBe(manifest);
  expect(existsSync(join(t.project, "package-lock.json"))).toBe(false);
  expect(existsSync(join(t.project, "node_modules"))).toBe(false);
});
