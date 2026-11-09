#!/usr/bin/env node
const { spawnSync } = require("node:child_process");
const { writeSync } = require("node:fs");

const platform = `${process.platform}-${process.arch}`;
const executable = process.platform === "win32" ? "loadouts.exe" : "loadouts";
let binary;
try {
  binary = require.resolve(`@katisfaktion/loadouts-${platform}/bin/${executable}`);
} catch {
  writeSync(2, `loadouts: native binary missing for ${platform}. Reinstall @katisfaktion/loadouts with optional dependencies enabled. Supported: Linux (glibc) and macOS x64/arm64, Windows x64.\n`);
  process.exit(1);
}

const result = spawnSync(binary, process.argv.slice(2), { stdio: "inherit" });
if (result.error) {
  writeSync(2, `loadouts: ${result.error.message}\n`);
  process.exit(1);
}
if (result.signal) process.kill(process.pid, result.signal);
else process.exit(result.status ?? 1);
