import { CliError } from "./errors";
import type { Harness } from "./loadout";
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, rmSync, statSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { cacheDir, writeIfChanged } from "./paths";

export async function skills(cwd: string, args: string[], lockVersion: SkillLock["version"] = 2) {
  const npmPrefix = join(cacheDir(), "npm");
  // The two formats hash identical skill contents differently.
  const installer = lockVersion === 1 ? "skills@1.7.6" : "skills@1.8.0";
  const prefix = process.env.LOADOUTS_SKILLS_CMD?.split(/ +/) ?? ["npx", "--prefix", npmPrefix, "-y", installer];
  if (!Bun.which(prefix[0]!)) throw new CliError(`${prefix[0]} not found on PATH`, 3, "install Node.js so npx is available");
  // Isolate npm's project checks while skills still runs in the target cwd.
  if (!process.env.LOADOUTS_SKILLS_CMD) mkdirSync(npmPrefix, {recursive: true});
  const child = Bun.spawn([...prefix, ...args], {cwd, env: {...process.env}, stdout: "pipe", stderr: "pipe"});
  const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
  return {code, stdout, stderr};
}
export async function addSkills(project: string, identifier: string, h: Harness, version = readSkillLock(project).version): Promise<string[]> {
  const [repo, skill] = identifier.split("@");
  const result = await skills(project, ["add", repo!, "-s", skill ?? "*", "-a", h, "-y", "--json"], version);
  let rows: {name: string; status: string}[] = [];
  try {
    const parsed = JSON.parse(result.stdout);
    if (Array.isArray(parsed) && parsed.every(r => r && typeof r.name === "string" && /^[\w.-]+$/.test(r.name) && ![".", ".."].includes(r.name) && typeof r.status === "string")) rows = parsed;
  } catch { /* Invalid output is an installation failure below. */ }
  const installed = rows.filter(r => r.status === "installed").map(r => r.name);
  if (result.code || !rows.length || rows.some(r => r.status !== "installed")) {
    const error = new CliError(`npx skills could not install ${identifier}: ${result.stderr.trim() || result.stdout.trim() || "empty install result"}`, 1, `check the identifier with: npx skills add ${repo} --list`);
    error.installed = installed;
    throw error;
  }
  return installed;
}

export type SkillLock = {version: 1 | 2; skills: Record<string, {source: string; sourceType: string; computedHash: string; [key: string]: unknown}>};
export const fromGithubRepo = (entry: SkillLock["skills"][string] | undefined, repo: string) =>
  entry?.sourceType === "github" && entry.source.toLowerCase() === repo.toLowerCase();
export const validName = (name: string) => /^[\w.-]+$/.test(name) && ![".", ".."].includes(name);
const recovery = "restore skills-lock.json and verified skill folders from version control or backup; use loadouts update only to accept newer contents";
export function checkSkillDirectories(project: string): void {
  for (const path of [".agents", ".agents/skills", ".claude", ".claude/skills"]) {
    try {
      if (!lstatSync(join(project, path)).isDirectory()) throw new CliError(`skill parent ${path} must be a real directory`, 1, "move the conflicting path aside and retry loadouts install");
    } catch (e: any) { if (e.code !== "ENOENT") throw e; }
  }
}
export function readSkillLock(project: string, expectedVersion?: SkillLock["version"]): SkillLock {
  const file = join(project, "skills-lock.json");
  if (!existsSync(file)) return {version: expectedVersion ?? 2, skills: Object.create(null)};
  try {
    const lock = JSON.parse(readFileSync(file, "utf8"));
    if (typeof lock?.version !== "number") throw new Error();
    if (lock.version !== 1 && lock.version !== 2) throw new CliError(`unsupported skills-lock.json version ${lock.version}`, 1, "use a loadouts release that supports this lockfile");
    if (expectedVersion && lock.version !== expectedVersion) throw new CliError(`skills installer wrote lock version ${lock.version}, expected ${expectedVersion}`, 1, "unset LOADOUTS_SKILLS_CMD to use the compatible installer");
    if (!lock.skills || typeof lock.skills !== "object" || Array.isArray(lock.skills)) throw new Error();
    for (const [name, entry] of Object.entries(lock.skills) as [string, SkillLock["skills"][string]][]) {
      if (!validName(name) || !entry || typeof entry.source !== "string" || !entry.source || typeof entry.sourceType !== "string" || typeof entry.computedHash !== "string") throw new Error();
      // skills 1.8 can leave the hash empty during migration. Fresh installer output must have a digest.
      if (expectedVersion === undefined && lock.version === 2 && entry.computedHash === "") continue;
      if (!/^[a-f0-9]{64}$/.test(entry.computedHash)) throw new Error();
    }
    return {...lock, skills: Object.assign(Object.create(null), lock.skills)};
  } catch (e) {
    if (e instanceof CliError) throw e;
    throw new CliError("invalid skills-lock.json", 1, recovery);
  }
}
export function writeSkillLock(project: string, lock: SkillLock): boolean {
  return writeIfChanged(join(project, "skills-lock.json"), JSON.stringify(lock, (_key, value) => value && typeof value === "object" && !Array.isArray(value) ? Object.fromEntries(Object.keys(value).sort().map(k => [k, value[k]])) : value, 2) + "\n");
}
export function identicalSkillDirectories(a: string, b: string): boolean {
  if (!lstatSync(a, {throwIfNoEntry: false})?.isDirectory() || !lstatSync(b, {throwIfNoEntry: false})?.isDirectory()) return false;
  const entries = readdirSync(a, {withFileTypes: true}), other = readdirSync(b);
  if (entries.length !== other.length) return false;
  return entries.every(entry => {
    const left = join(a, entry.name), right = join(b, entry.name);
    return entry.isDirectory() ? identicalSkillDirectories(left, right) : entry.isFile() && lstatSync(right, {throwIfNoEntry: false})?.isFile() && readFileSync(left).equals(readFileSync(right));
  });
}
export function linkSkill(project: string, name: string, h: Harness): void {
  if (h !== "claude-code") return;
  const dir = join(project, ".claude/skills"), link = join(dir, name);
  mkdirSync(dir, {recursive: true});
  let existing;
  try { existing = lstatSync(link); } catch (e: any) { if (e.code !== "ENOENT") throw e; }
  if (existing && !existing.isSymbolicLink()) {
    if (!identicalSkillDirectories(link, join(project, ".agents/skills", name))) throw new CliError(`cannot replace skill directory ${link}`, 1, "move the conflicting directory aside and retry loadouts install");
    rmSync(link, {recursive: true}); existing = undefined;
  }
  if (existing && resolve(dir, readlinkSync(link)) === join(project, ".agents/skills", name)) return;
  if (existing && existsSync(link)) throw new CliError(`cannot replace conflicting skill link ${link}`, 1, "move the conflicting link aside and retry loadouts install");
  if (existing) unlinkSync(link);
  symlinkSync(`../../.agents/skills/${name}`, link);
}

export async function installSkills(project: string, identifier: string, h: Harness, opts: {names?: string[]; pending?: boolean; update?: boolean}): Promise<string[]> {
  checkSkillDirectories(project);
  const [repo, selected] = identifier.split("@"), lock = readSkillLock(project);
  const names = opts.names?.length ? opts.names : Object.entries(lock.skills).filter(([name, entry]) => fromGithubRepo(entry, repo!) && (!selected || name === selected)).map(([name]) => name);
  if (names.some(n => !validName(n))) throw new CliError("invalid installed skill name", 1, "restore loadouts.lock.json from version control");
  const checkSource = (name: string) => {
    const entry = lock.skills[name];
    if (entry && !fromGithubRepo(entry, repo!)) throw new CliError(`skill ${name} is already locked to another source`, 1, "use distinct skill names or remove the conflicting selection first");
  };
  for (const name of [...names, ...(selected ? [selected] : [])]) checkSource(name);
  const restore = names.length > 0 && !opts.update && !opts.pending;
  const missing = names.filter(name => missingSkills(project, [name], "codex"));
  if (restore && !missing.length) { for (const name of names) linkSkill(project, name, h); return names; }
  if (restore && missing.some(name => !Object.hasOwn(lock.skills, name))) throw new CliError(`skills-lock.json has no entry for missing skills from ${identifier}`, 1, recovery);
  if (restore) for (const name of missing) {
    if (!lock.skills[name]!.computedHash) throw new CliError(`skills-lock.json has no verified hash for ${name}`, 1, recovery);
  }
  const stage = mkdtempSync(join(tmpdir(), "loadouts-skills-")), installed: string[] = [];
  let discoveryPending = !restore;
  try {
    let fetched: string[], failure: unknown, next = lock;
    if (restore) {
      writeFileSync(join(stage, "skills-lock.json"), JSON.stringify({version: lock.version, skills: Object.fromEntries(missing.map(name => [name, lock.skills[name]]))}));
      const result = await skills(stage, ["experimental_install", "--frozen-lockfile"], lock.version);
      if (result.code || missingSkills(stage, missing, "codex")) throw new CliError(`frozen skill restore failed for ${identifier}: ${result.stderr.trim() || result.stdout.trim() || "installer did not restore every requested skill"}`, 1, recovery);
      fetched = missing;
    } else {
      try { fetched = await addSkills(stage, identifier, "codex", lock.version); }
      catch (e) { if (!(e instanceof CliError) || !e.installed) throw e; fetched = e.installed; failure = e; }
      next = readSkillLock(stage, lock.version);
      for (const name of fetched) {
        checkSource(name);
        if (!fromGithubRepo(next.skills[name], repo!) || missingSkills(stage, [name], "codex")) throw new CliError(`installer did not record skill ${name} in skills-lock.json`, 1, recovery);
        if (!opts.update && lock.skills[name] && lock.skills[name].computedHash !== next.skills[name].computedHash) throw new CliError(`frozen skill hash changed for ${name}`, 1, recovery);
      }
    }
    for (const name of fetched) {
      const dest = join(project, ".agents/skills", name);
      let existing;
      try { existing = lstatSync(dest); } catch (e: any) { if (e.code !== "ENOENT") throw e; }
      if (existing?.isSymbolicLink()) throw new CliError(`cannot replace symlinked skill ${dest}`, 1, "move the conflicting link aside and retry loadouts install");
      if (existing && !lock.skills[name] && !opts.names?.includes(name)) throw new CliError(`skill ${name} already exists and is not locked`, 1, "move the conflicting skill folder aside and retry loadouts install");
      if (existing) rmSync(dest, {recursive: true});
      mkdirSync(join(project, ".agents/skills"), {recursive: true});
      cpSync(join(stage, ".agents/skills", name), dest, {recursive: true, verbatimSymlinks: true});
      installed.push(name);
      if (!restore) {
        lock.skills[name] = next.skills[name]!;
        writeSkillLock(project, lock);
      }
    }
    const result = restore ? names : fetched;
    discoveryPending = !!failure;
    for (const name of result) linkSkill(project, name, h);
    if (failure) throw failure;
    return result;
  } catch (e) {
    const error = e instanceof CliError ? e : new CliError(`could not install ${identifier}: ${(e as Error).message}`, 1, "fix the filesystem error and retry loadouts install");
    error.installed = installed;
    error.skillDiscoveryPending = discoveryPending;
    throw error;
  } finally { rmSync(stage, {recursive: true, force: true}); }
}
export function removeSkillLinks(project: string, names: string[]): void {
  checkSkillDirectories(project);
  for (const name of names) {
    if (!validName(name)) throw new CliError("invalid installed skill name", 1, "restore loadouts.lock.json from version control");
    const link = join(project, ".claude/skills", name);
    try { unlinkSync(link); } catch (e: any) { if (e.code !== "ENOENT") throw new CliError(`cannot remove skill link ${link}`, 1, "move the conflicting skill directory aside and retry"); }
  }
}
export async function removeSkills(project: string, names: string[], h: Harness): Promise<void> {
  if (!names.length) return;
  const r = await skills(project, ["remove", ...names, "-a", h, "-y"], readSkillLock(project).version);
  if (r.code) throw new CliError(`npx skills could not remove ${names.join(", ")}: ${r.stderr.trim()}`, 1, "check the installed skills with npx skills ls, then retry");
}
export async function listSkills(opts: {global: boolean; cwd: string}): Promise<{name: string; source: string | null}[]> {
  const r = await skills(opts.cwd, ["ls", ...(opts.global ? ["-g"] : []), "--json"]);
  if (r.code) throw new CliError(`npx skills could not list skills: ${r.stderr.trim()}`, 1, "run npx skills ls --json to check the installation");
  try {
    const rows = JSON.parse(r.stdout);
    if (!Array.isArray(rows) || rows.some(r => !r || typeof r.name !== "string" || (r.source !== null && typeof r.source !== "string"))) throw new Error();
    return rows.map(({name, source}) => ({name, source}));
  } catch { throw new CliError("npx skills returned an invalid skill list", 1, "check npx skills ls --json output"); }
}

export function missingSkills(project: string, names: string[], harness: Harness): boolean {
  const present = (path: string) => { try { return statSync(path).isFile(); } catch { return false; } };
  return !names.length || names.some(name => !present(join(project, ".agents/skills", name, "SKILL.md")) || (harness === "claude-code" && !present(join(project, ".claude/skills", name, "SKILL.md"))));
}
