import { existsSync, mkdirSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { cacheDir } from "./paths";
import { CliError } from "./errors";
import { parseLoadout, type Loadout } from "./loadout";

export interface CatalogRef { repo: string; ref: string; commit: string }
function catalogPath(repo: string): string {
  return join(cacheDir(), "catalogs", repo.replaceAll("/", "__"));
}
async function git(args: string[], env: Record<string, string> = {}): Promise<string> {
  if (!Bun.which("git")) throw new CliError("git not found on PATH", 3, "install git, then rerun");
  const child = Bun.spawn(["git", ...args], { stdout: "pipe", stderr: "pipe", env: { ...process.env, GIT_TERMINAL_PROMPT: "0", ...env } });
  const [code, out, err] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
  if (code) throw new CliError(`catalog git operation failed: ${err.trim()}`, 1, "check the catalog path, ref and Git access, then rerun");
  return out.trim();
}
export async function openCatalog(repo: string, ref?: string): Promise<CatalogRef> {
  if (!isAbsolute(repo) && !/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new CliError(`invalid catalog ${repo}`, 2, "use owner/repo or an absolute local path");
  const path = catalogPath(repo);
  if (existsSync(path)) await git(["-C", path, "fetch", "--tags", "--force", "origin", "+refs/heads/*:refs/heads/*"]);
  else { mkdirSync(join(path, ".."), { recursive: true }); await git(["clone", "--bare", "--", isAbsolute(repo) ? repo : `https://github.com/${repo}.git`, path]); }
  if (!ref) {
    const tags = (await git(["-C", path, "tag", "--sort=-version:refname"])).split("\n");
    ref = tags.find(t => /^v?\d+\.\d+\.\d+$/.test(t)) ?? "HEAD";
  }
  const commit = await git(["-C", path, "rev-parse", "--verify", "--end-of-options", `${ref}^{commit}`]);
  return { repo, ref, commit };
}
export async function listLoadouts(c: CatalogRef): Promise<string[]> {
  if (!existsSync(catalogPath(c.repo))) await openCatalog(c.repo, c.commit);
  else {
    try { await git(["-C", catalogPath(c.repo), "cat-file", "-e", `${c.commit}^{commit}`]); }
    catch { await openCatalog(c.repo, c.commit); }
  }
  const files = await git(["-C", catalogPath(c.repo), "ls-tree", "--name-only", c.commit, "loadouts/"]);
  return files.split("\n").filter(p => /^loadouts\/[^/]+\.yml$/.test(p)).map(p => p.slice(9, -4)).sort();
}
export async function readLoadout(c: CatalogRef, name: string): Promise<Loadout> {
  return parseLoadout(await readLoadoutYaml(c, name), `loadouts/${name}.yml`);
}
export async function readCachedLoadout(c: CatalogRef, name: string): Promise<Loadout> {
  let yaml: string;
  try { yaml = await git(["-C", catalogPath(c.repo), "show", `${c.commit}:loadouts/${name}.yml`], {GIT_NO_LAZY_FETCH: "1"}); }
  catch { throw new CliError(`cached definition for ${name} at ${c.commit} is unavailable`, 1, "run loadouts install to restore the pinned catalog cache, then verify before publishing"); }
  return parseLoadout(yaml, `loadouts/${name}.yml`);
}
export async function readLoadoutYaml(c: CatalogRef, name: string): Promise<string> {
  const names = await listLoadouts(c);
  if (!names.includes(name)) throw new CliError(`unknown loadout "${name}"`, 2, `choose one of: ${names.join(", ")}`);
  return git(["-C", catalogPath(c.repo), "show", `${c.commit}:loadouts/${name}.yml`]);
}
