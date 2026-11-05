import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { CliError } from "./errors";
import { paint } from "./output";
import { activeItems, artifactsFor, sourceFor, type Harness, type Loadout, type PackageSkills } from "./loadout";
import type { Lock } from "./lock";
import { checkSkillDirectories, identicalSkillDirectories, linkSkill, missingSkills, readSkillLock, skills, writeSkillLock, type SkillLock } from "./skills";

function installedPackage(project: string, name: string): {dir: string; version: string} | null {
  for (let dir = project; ; dir = dirname(dir)) {
    const path = join(dir, "node_modules", name);
    if (existsSync(join(path, "package.json"))) {
      let value;
      try { value = JSON.parse(readFileSync(join(path, "package.json"), "utf8")); } catch { /* Report invalid metadata below. */ }
      if (value?.name !== name || typeof value.version !== "string" || !value.version) throw new CliError(`invalid installed package metadata for ${name}`, 1, "repair the dependency installation and retry loadouts install");
      return {dir: path, version: value.version};
    }
    if (dirname(dir) === dir) return null;
  }
}
function checkPayload(path: string): void {
  for (const entry of readdirSync(path, {withFileTypes: true})) {
    if (entry.isDirectory()) checkPayload(join(path, entry.name));
    else if (!entry.isFile()) throw new CliError(`unsafe package skill payload: ${entry.name}`, 1, "package companions must contain regular files and directories, without symlinks");
  }
}
export function selectsPackageSkill(policy: PackageSkills, pkg: string, name: string): boolean {
  const matches = (selector: string) => selector === pkg || selector === `${pkg}#${name}`;
  return policy.include.some(matches) && !policy.exclude?.some(matches);
}
export function packageSkillStatus(project: string, lock: Lock): {missing: string[]; changed: string[]} {
  const missing: string[] = [], changed: string[] = [];
  for (const [name, entry] of Object.entries(lock.packageSkills ?? {})) {
    const current = installedPackage(project, name);
    if (!current) missing.push(name);
    if ((current?.version ?? null) !== entry.version) changed.push(name);
  }
  return {missing, changed};
}
export async function syncPackageSkills(project: string, lock: Lock, loaded: Record<string, Loadout>): Promise<void> {
  const requests = Object.entries(loaded).flatMap(([name, loadout]) => activeItems(loadout, lock.loadouts[name]!).flatMap(a => lock.harnesses.flatMap(h => {
    const policy = sourceFor(a.item, h).packageSkills;
    return policy ? [{id: a.id, h, policy}] : [];
  })));
  const packages = [...new Set(requests.flatMap(r => r.policy.include.map(s => s.split("#")[0]!)))].sort();
  if (!packages.length && !lock.packageSkills) return;
  checkSkillDirectories(project);
  const native = readSkillLock(project), stages: string[] = [];
  const records: NonNullable<Lock["packageSkills"]> = Object.create(null);
  const wanted = new Map<string, {pkg: string; path: string; entry: SkillLock["skills"][string]; harnesses: Harness[]}>();
  const old = Object.keys(lock.installed).filter(k => k.startsWith("package-skill:"));
  const selected = new Set(Object.entries(loaded).flatMap(([name, loadout]) => activeItems(loadout, lock.loadouts[name]!).flatMap(a => lock.harnesses.flatMap(h => [...artifactsFor(a, h).keys()]))));
  const retiring = Object.keys(lock.installed).filter(k => k.startsWith("skill:") && !selected.has(k));
  const conflict = (name: string) => new CliError(`package skill ${name} conflicts with an existing skill or unsafe path`, 1, "use distinct skill names or move the conflicting unmanaged file aside");
  try {
    for (const pkg of packages) {
      const selected = requests.filter(r => r.policy.include.some(s => s.split("#")[0] === pkg));
      const current = installedPackage(project, pkg);
      records[pkg] = {version: current?.version ?? null, skills: [], requiredBy: [...new Set(selected.map(r => r.id))].sort()};
      if (!current) { console.log(paint(`Package ${pkg} is not installed; companions are unavailable. Install project dependencies, then run loadouts install.`, "yellow")); continue; }
      const stage = mkdtempSync(join(tmpdir(), "loadouts-package-")); stages.push(stage);
      writeFileSync(join(stage, "package.json"), JSON.stringify({private: true, dependencies: {[pkg]: "*"}}));
      mkdirSync(dirname(join(stage, "node_modules", pkg)), {recursive: true});
      symlinkSync(current.dir, join(stage, "node_modules", pkg));
      const result = await skills(stage, ["experimental_sync", "--copy", "--no-remote", "--no-cleanup", "--no-frozen-lockfile", "-a", "codex", "-y", "--include", pkg]);
      if (result.code) throw new CliError(`could not sync package skills from ${pkg}: ${result.stderr.trim() || result.stdout.trim()}`, 1, "repair the installed package and retry loadouts install");
      const discovered = readSkillLock(stage).skills;
      for (const request of selected) for (const selector of request.policy.include) {
        const [source, name] = selector.split("#");
        if (source === pkg && name && selectsPackageSkill(request.policy, pkg, name) && !Object.hasOwn(discovered, name)) throw new CliError(`package companion ${selector} was not found`, 1, "check the installed package's skill names or adjust the loadout selection");
      }
      for (const [name, entry] of Object.entries(discovered)) {
        const path = join(stage, ".agents/skills", name), skillPath = entry.skillPath;
        if (!/^[A-Za-z0-9_-][\w.-]*$/.test(name) || entry.sourceType !== "node_modules" || entry.source !== pkg || entry.version !== current.version || typeof skillPath !== "string" || skillPath.startsWith("/") || (/[\\:]/.test(skillPath)) || skillPath.split("/").some(p => !p || p === "." || p === "..") || !(skillPath === "SKILL.md" || skillPath.endsWith("/SKILL.md")) || !lstatSync(path, {throwIfNoEntry: false})?.isDirectory() || missingSkills(stage, [name], "codex")) throw new CliError(`invalid package skill metadata for ${pkg}#${name}`, 1, "repair the package skills metadata and retry loadouts install");
        const harnesses = [...new Set(selected.filter(r => selectsPackageSkill(r.policy, pkg, name)).map(r => r.h))];
        if (!harnesses.length) continue;
        checkPayload(path);
        if (wanted.has(name)) throw conflict(name);
        wanted.set(name, {pkg, path, entry, harnesses}); records[pkg]!.skills.push(name);
      }
      records[pkg]!.skills.sort();
    }
    // Validate every destination before removing any previously managed companion.
    for (const name of new Set([...wanted.keys(), ...old.flatMap(k => lock.installed[k]!)])) {
      const next = wanted.get(name), owners = old.filter(k => lock.installed[k]!.includes(name));
      const replacing = next ? retiring.filter(k => lock.installed[k]!.includes(name)) : [];
      const previousPkg = owners[0]?.split(":")[2]?.split("#")[0];
      const entry = native.skills[name], dest = join(project, ".agents/skills", name), existing = lstatSync(dest, {throwIfNoEntry: false});
      const gitOwned = replacing.length > 0 && entry?.sourceType === "github" && replacing.every(k => k.split(":")[2]!.split("@")[0] === entry.source);
      if (Object.entries(lock.installed).some(([k, ns]) => k.startsWith("skill:") && !replacing.includes(k) && ns.includes(name)) || (entry && !gitOwned && (!owners.length || entry.sourceType !== "node_modules" || entry.source !== previousPkg)) || (existing && ((!owners.length && !gitOwned) || !existing.isDirectory())) || (next && previousPkg && next.pkg !== previousPkg)) throw conflict(name);
      const link = join(project, ".claude/skills", name), linked = lstatSync(link, {throwIfNoEntry: false});
      const claudeOwned = owners.some(k => k.startsWith("package-skill:claude-code:")) || (gitOwned && replacing.some(k => k.startsWith("skill:claude-code:")));
      if (linked && (!claudeOwned || !(linked.isSymbolicLink() ? resolve(dirname(link), readlinkSync(link)) === dest : identicalSkillDirectories(link, dest)))) throw conflict(name);
    }
    // Normalize verified legacy copies before replacing the canonical contents.
    for (const name of new Set([...wanted.keys(), ...old.flatMap(k => lock.installed[k]!)])) {
      const link = join(project, ".claude/skills", name), next = wanted.get(name);
      if (lstatSync(link, {throwIfNoEntry: false})?.isDirectory()) linkSkill(project, name, "claude-code");
      if (next && !next.harnesses.includes("claude-code") && retiring.some(k => k.startsWith("skill:claude-code:") && lock.installed[k]!.includes(name)) && lstatSync(link, {throwIfNoEntry: false})) unlinkSync(link);
    }
    lock.packageSkills = {...lock.packageSkills, ...records};
    for (const key of old) {
      const [, h, selector] = key.split(":"), [pkg, name] = selector!.split("#"), next = wanted.get(name!);
      if (next?.pkg === pkg && next.harnesses.includes(h as Harness)) continue;
      if (h === "claude-code") { const link = join(project, ".claude/skills", name!); if (lstatSync(link, {throwIfNoEntry: false})) unlinkSync(link); }
      if (!next) { rmSync(join(project, ".agents/skills", name!), {recursive: true, force: true}); delete native.skills[name!]; writeSkillLock(project, native); }
      delete lock.installed[key];
    }
    for (const [name, next] of wanted) {
      const transferring = retiring.filter(k => lock.installed[k]!.includes(name));
      if (transferring.length || native.skills[name]?.computedHash !== next.entry.computedHash || missingSkills(project, [name], "codex")) {
        const dest = join(project, ".agents/skills", name);
        // A failed copy must not retain a completion hash that would make retry skip it.
        delete native.skills[name]; writeSkillLock(project, native);
        // Transfer before destructive work so failures support both retry and removal.
        for (const h of next.harnesses) lock.installed[`package-skill:${h}:${next.pkg}#${name}`] = [name];
        for (const key of transferring) lock.installed[key] = lock.installed[key]!.filter(n => n !== name);
        rmSync(dest, {recursive: true, force: true}); mkdirSync(dirname(dest), {recursive: true});
        cpSync(next.path, dest, {recursive: true, verbatimSymlinks: true});
      }
      native.skills[name] = next.entry; writeSkillLock(project, native);
      for (const h of next.harnesses) { lock.installed[`package-skill:${h}:${next.pkg}#${name}`] = [name]; linkSkill(project, name, h); }
    }
    lock.packageSkills = records;
  } finally { for (const stage of stages) rmSync(stage, {recursive: true, force: true}); }
}
