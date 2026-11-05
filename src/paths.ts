import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { CliError } from "./errors";

export function home(): string {
  if (!process.env.HOME) throw new CliError("HOME is not set", 3, "set HOME to your home directory");
  return process.env.HOME;
}
export function configFile(): string { return join(home(), ".config/loadouts/config.toml"); }
export function cacheDir(): string { return process.env.LOADOUTS_CACHE ?? join(home(), ".cache/loadouts"); }
export function findProject(cwd: string): string | null {
  let dir = resolve(cwd);
  for (;;) {
    if (existsSync(join(dir, "loadouts.json")) || existsSync(join(dir, "loadouts.lock.json"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}
export function writeIfChanged(file: string, content: string): boolean {
  if (existsSync(file) && readFileSync(file, "utf8") === content) return false;
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);
  return true;
}
