import { chmodSync, copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const { version, description, keywords, author, license, repository, homepage, bugs } = JSON.parse(readFileSync("package.json", "utf8"));
const platforms = ["linux-x64", "linux-arm64", "darwin-x64", "darwin-arm64", "win32-x64"];
const name = "@katisfaktion/loadouts";
const out = join(process.cwd(), "dist/npm");
const metadata = {
  version, author, license, repository, homepage, bugs,
  publishConfig: { access: "public" },
};

rmSync(out, { recursive: true, force: true });
for (const platform of platforms) {
  const [os, cpu] = platform.split("-");
  const dir = join(out, `loadouts-${platform}`);
  const executable = `loadouts${os === "win32" ? ".exe" : ""}`;
  mkdirSync(join(dir, "bin"), { recursive: true });
  copyFileSync("LICENSE", join(dir, "LICENSE"));
  copyFileSync(`dist/loadouts-bun-${platform.replace("win32", "windows")}${os === "win32" ? ".exe" : ""}`, join(dir, "bin", executable));
  chmodSync(join(dir, "bin", executable), 0o755);
  writeFileSync(join(dir, "package.json"), JSON.stringify({
    ...metadata, name: `${name}-${platform}`,
    description: `Native ${platform} binary for ${name}. Install ${name} to use the CLI.`,
    os: [os], cpu: [cpu], ...(os === "linux" ? { libc: ["glibc"] } : {}), files: ["bin"],
  }, null, 2) + "\n");
}

const dir = join(out, "loadouts");
mkdirSync(join(dir, "bin"), { recursive: true });
copyFileSync(join(import.meta.dir, "../npm/loadouts.cjs"), join(dir, "bin/loadouts.cjs"));
chmodSync(join(dir, "bin/loadouts.cjs"), 0o755);
copyFileSync("README.md", join(dir, "README.md"));
copyFileSync("LICENSE", join(dir, "LICENSE"));
writeFileSync(join(dir, "package.json"), JSON.stringify({
  ...metadata, name, description, keywords,
  bin: { loadouts: "bin/loadouts.cjs" }, files: ["bin"], engines: { node: ">=22" },
  optionalDependencies: Object.fromEntries(platforms.map(platform => [`${name}-${platform}`, version])),
}, null, 2) + "\n");
