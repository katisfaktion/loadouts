import { chmodSync, copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const { version } = JSON.parse(readFileSync("package.json", "utf8"));
const platforms = ["linux-x64", "linux-arm64", "darwin-x64", "darwin-arm64", "win32-x64"];
const name = "@katisfaktion/loadouts";
const out = join(process.cwd(), "dist/npm");
const metadata = {
  version,
  repository: { type: "git", url: "git+https://github.com/katisfaktion/loadouts.git" },
  homepage: "https://github.com/katisfaktion/loadouts#readme",
  bugs: { url: "https://github.com/katisfaktion/loadouts/issues" },
  publishConfig: { access: "public" },
};

rmSync(out, { recursive: true, force: true });
for (const platform of platforms) {
  const [os, cpu] = platform.split("-");
  const dir = join(out, `loadouts-${platform}`);
  const executable = `loadouts${os === "win32" ? ".exe" : ""}`;
  mkdirSync(join(dir, "bin"), { recursive: true });
  copyFileSync(`dist/loadouts-bun-${platform.replace("win32", "windows")}${os === "win32" ? ".exe" : ""}`, join(dir, "bin", executable));
  chmodSync(join(dir, "bin", executable), 0o755);
  writeFileSync(join(dir, "package.json"), JSON.stringify({
    ...metadata, name: `${name}-${platform}`,
    description: `Native ${platform} binary for loadouts`,
    os: [os], cpu: [cpu], ...(os === "linux" ? { libc: ["glibc"] } : {}), files: ["bin"],
  }, null, 2) + "\n");
}

const dir = join(out, "loadouts");
mkdirSync(join(dir, "bin"), { recursive: true });
copyFileSync(join(import.meta.dir, "../npm/loadouts.cjs"), join(dir, "bin/loadouts.cjs"));
chmodSync(join(dir, "bin/loadouts.cjs"), 0o755);
copyFileSync("README.md", join(dir, "README.md"));
writeFileSync(join(dir, "package.json"), JSON.stringify({
  ...metadata, name, description: "Reusable agent setups for Claude Code and Codex",
  bin: { loadouts: "bin/loadouts.cjs" }, files: ["bin"], engines: { node: ">=22" },
  optionalDependencies: Object.fromEntries(platforms.map(platform => [`${name}-${platform}`, version])),
}, null, 2) + "\n");
