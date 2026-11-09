import { expect, test } from "bun:test";
import { cpSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { repo, tempEnv } from "./helpers";

const platforms = ["linux-x64", "linux-arm64", "darwin-x64", "darwin-arm64", "win32-x64"];

function prepare() {
  const t = tempEnv();
  mkdirSync(join(t.project, "dist"));
  writeFileSync(join(t.project, "package.json"), JSON.stringify({ version: "1.2.3" }));
  writeFileSync(join(t.project, "README.md"), "Fixture readme");
  for (const platform of platforms) {
    const filename = `loadouts-bun-${platform.replace("win32", "windows")}${platform.startsWith("win32") ? ".exe" : ""}`;
    writeFileSync(join(t.project, "dist", filename), "#!/bin/sh\nprintf '%s\\n' \"$@\"\nexit 7\n", { mode: 0o755 });
  }
  const result = Bun.spawnSync([process.execPath, join(repo, "scripts/package-npm.ts")], {
    cwd: t.project, env: { ...process.env, ...t.env },
  });
  expect(result.exitCode, result.stderr.toString()).toBe(0);
  return t;
}

test("npm packages pair an exact release with only the matching native binary", () => {
  const t = prepare(), dir = join(t.project, "dist/npm");
  const manifest = JSON.parse(readFileSync(join(dir, "loadouts/package.json"), "utf8"));
  expect(manifest.name).toBe("@katisfaktion/loadouts");
  expect(manifest.version).toBe("1.2.3");
  expect(manifest.bin).toEqual({ loadouts: "bin/loadouts.cjs" });
  expect(manifest.dependencies).toBeUndefined();
  expect(manifest.scripts).toBeUndefined();
  expect(manifest.optionalDependencies).toEqual(Object.fromEntries(platforms.map(p => [`@katisfaktion/loadouts-${p}`, "1.2.3"])));
  for (const platform of platforms) {
    const pkg = JSON.parse(readFileSync(join(dir, `loadouts-${platform}/package.json`), "utf8"));
    const [os, cpu] = platform.split("-");
    expect(pkg.name).toBe(`@katisfaktion/loadouts-${platform}`);
    expect(pkg.version).toBe(manifest.version);
    expect(pkg.os).toEqual([os]);
    expect(pkg.cpu).toEqual([cpu]);
    expect(pkg.libc).toEqual(os === "linux" ? ["glibc"] : undefined);
    expect(readFileSync(join(dir, `loadouts-${platform}/bin/loadouts${os === "win32" ? ".exe" : ""}`), "utf8")).toContain("exit 7");
  }
});

test("Node launcher preserves arguments, exit status and reports a missing platform package", () => {
  const t = prepare(), dir = join(t.project, "dist/npm/loadouts"), platform = `${process.platform}-${process.arch}`;
  const target = join(dir, "node_modules/@katisfaktion", `loadouts-${platform}`);
  mkdirSync(join(dir, "node_modules/@katisfaktion"), { recursive: true });
  cpSync(join(t.project, "dist/npm", `loadouts-${platform}`), target, { recursive: true });
  const run = () => Bun.spawnSync(["node", join(dir, "bin/loadouts.cjs"), "hello world", "--help"], { cwd: t.project, env: { ...process.env, ...t.env } });
  const result = run();
  expect(result.exitCode).toBe(7);
  expect(result.stdout.toString()).toBe("hello world\n--help\n");
  rmSync(target, { recursive: true });
  const missing = run();
  expect(missing.exitCode).toBe(1);
  expect(missing.stderr.toString()).toContain("optional dependencies");
});

test("packed npm tarballs install offline and run without Bun or install scripts", () => {
  const t = prepare(), dir = join(t.project, "dist/npm"), bin = join(t.home, "bin");
  mkdirSync(bin);
  symlinkSync(Bun.which("node")!, join(bin, "node"));
  const env = {
    ...process.env, ...t.env, PATH: `${bin}:/usr/bin:/bin`,
    npm_config_cache: join(t.home, "npm-cache"), npm_config_offline: "true",
    npm_config_userconfig: join(t.home, ".npmrc"), npm_config_update_notifier: "false",
  };
  const npm = (args: string[], cwd: string) => {
    const result = Bun.spawnSync([Bun.which("npm")!, ...args], { cwd, env });
    expect(result.exitCode, result.stderr.toString()).toBe(0);
    return result.stdout.toString();
  };
  const packages = [`loadouts-${process.platform}-${process.arch}`, "loadouts"].map(name => {
    const cwd = join(dir, name);
    const [packed] = JSON.parse(npm(["pack", "--ignore-scripts", "--json"], cwd));
    expect(packed.files.every((file: any) => file.path === "package.json" || file.path === "README.md" || file.path.startsWith("bin/"))).toBe(true);
    return join(cwd, packed.filename);
  });
  const consumer = join(t.home, "consumer");
  mkdirSync(consumer);
  writeFileSync(join(consumer, "package.json"), '{"private":true}');
  npm(["install", "--ignore-scripts", "--no-audit", "--no-fund", ...packages], consumer);
  expect(Bun.which("bun", { PATH: env.PATH })).toBeNull();
  const result = Bun.spawnSync([join(consumer, "node_modules/.bin/loadouts"), "a b"], { cwd: consumer, env });
  expect(result.exitCode).toBe(7);
  expect(result.stdout.toString()).toBe("a b\n");
}, 20_000);

test.each(["fresh", "partial", "registry-error", "publish-error"])("npm publishing handles %s without contacting npm", mode => {
  const t = prepare(), bin = join(t.home, "bin"), log = join(t.home, "npm.log");
  mkdirSync(bin);
  writeFileSync(join(bin, "npm"), `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.TEST_LOG, JSON.stringify(args) + '\\n');
if (args[0] === 'view') {
  if (process.env.TEST_MODE === 'partial' && args[1].includes('linux-x64')) {
    fs.writeSync(1, JSON.stringify('1.2.3')); process.exit(0);
  }
  fs.writeSync(1, JSON.stringify({error: {code: process.env.TEST_MODE === 'registry-error' ? 'E503' : 'E404'}}));
  process.exit(1);
}
if (args[0] === 'publish' && process.env.TEST_MODE === 'publish-error') process.exit(1);
`, { mode: 0o755 });
  const result = Bun.spawnSync([process.execPath, join(repo, "scripts/publish-npm.ts")], {
    cwd: t.project, env: { ...process.env, ...t.env, PATH: `${bin}:${process.env.PATH}`, TEST_LOG: log, TEST_MODE: mode },
  });
  const calls = readFileSync(log, "utf8").trim().split("\n").map(line => JSON.parse(line));
  const published = calls.filter(args => args[0] === "publish");
  if (mode.endsWith("error")) {
    expect(result.exitCode).not.toBe(0);
    expect(published).toHaveLength(mode === "registry-error" ? 0 : 1);
    expect(published.some(args => args[1].endsWith("/loadouts"))).toBe(false);
  } else {
    expect(result.exitCode, result.stderr.toString()).toBe(0);
    expect(published).toHaveLength(mode === "partial" ? 5 : 6);
    expect(published.at(-1)[1]).toBe(join(t.project, "dist/npm/loadouts"));
    expect(published.every(args => args.includes("--access") && args.includes("public") && args.includes("--provenance"))).toBe(true);
  }
});
