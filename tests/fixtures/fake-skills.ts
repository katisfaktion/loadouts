import { appendFileSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
const args = Bun.argv.slice(2), [command] = args;
if (process.env.FAKE_SKILLS_LOG) appendFileSync(process.env.FAKE_SKILLS_LOG, JSON.stringify(args) + "\n");
const root = args.includes("-g") ? process.env.HOME! : process.cwd();
const store = join(root, ".agents/skills");
const agent = args[args.indexOf("-a") + 1] ?? "codex";
const catalog = JSON.parse(process.env.FAKE_SKILLS ?? "{}");
const lockFile = join(root, "skills-lock.json");
const version = Number(process.env.FAKE_SKILLS_LOCK_VERSION ?? 2);
const lock = existsSync(lockFile) ? JSON.parse(readFileSync(lockFile, "utf8")) : {version, skills: {}};
lock.skills = Object.assign(Object.create(null), lock.skills);
const content = (name: string) => `# ${name}\n${process.env.FAKE_SKILLS_CONTENT ?? ""}`;
const hash = (name: string) => createHash("sha256").update("SKILL.md").update(content(name)).digest("hex");
const saveLock = () => writeFileSync(lockFile, JSON.stringify(lock, null, 2) + "\n");
if (command === "find") {
  console.log(JSON.parse(process.env.FAKE_SKILLS_FIND ?? "{}")[args.slice(1).join(" ")] ?? "No skills found");
} else if (command === "add") {
  const repo = args[1]!, selection = args[args.indexOf("-s") + 1];
  const names: string[] = selection && selection !== "*" ? [selection] : catalog[repo] ?? [repo.split("/").at(-1)];
  const result = names.map((name, index) => {
    const failed = process.env.FAKE_SKILLS_FAIL === repo || (process.env.FAKE_SKILLS_PARTIAL === repo && index > 0);
    if (!failed) {
      const dir = join(store, name); mkdirSync(dir, {recursive: true});
      writeFileSync(join(dir, "SKILL.md"), content(name)); writeFileSync(join(dir, ".source"), repo);
      lock.skills[name] = {source: version === 2 ? repo.toLowerCase() : repo, sourceType: "github", skillPath: `skills/${name}/SKILL.md`, computedHash: hash(name)};
      const agentsFile = join(dir, ".agents"), agents: string[] = existsSync(agentsFile) ? JSON.parse(readFileSync(agentsFile, "utf8")) : [];
      writeFileSync(agentsFile, JSON.stringify([...new Set([...agents, agent])]));
      if (agent === "claude-code") {
        const link = join(root, ".claude/skills", name); mkdirSync(join(root, ".claude/skills"), {recursive: true});
        rmSync(link, {recursive: true, force: true}); symlinkSync(`../../.agents/skills/${name}`, link);
      }
    }
    return {name, status: failed ? "failed" : "installed"};
  });
  saveLock();
  console.log(JSON.stringify(result)); process.exit(result.some(r => r.status === "failed") ? 1 : 0);
} else if (command === "experimental_sync") {
  for (const flag of ["--copy", "--no-remote", "--no-cleanup", "--no-frozen-lockfile"]) {
    if (!args.includes(flag)) { console.error(`missing required flag ${flag}`); process.exit(2); }
  }
  const pkg = args[args.indexOf("--include") + 1]!, dir = join(root, "node_modules", pkg);
  if (process.env.FAKE_PACKAGE_FAIL) { console.error("fixture package sync failed"); process.exit(1); }
  if (!existsSync(join(dir, "package.json"))) process.exit(0);
  const metadata = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
  const folders = existsSync(join(dir, "SKILL.md")) ? [""] : ["skills", "dist/skills"].flatMap(path => existsSync(join(dir, path)) ? readdirSync(join(dir, path)).map(n => `${path}/${n}`) : []);
  for (const folder of folders) {
    const file = join(dir, folder, "SKILL.md"); if (!existsSync(file)) continue;
    const text = readFileSync(file, "utf8"), frontmatter = Bun.YAML.parse(text.split("---")[1]!) as any;
    const name = frontmatter.name;
    const target = join(store, name); mkdirSync(target, {recursive: true}); cpSync(join(dir, folder), target, {recursive: true, filter: path => !path.includes("node_modules/node_modules")});
    const digest = createHash("sha256");
    const hashFiles = (path: string, prefix = "") => { for (const entry of readdirSync(path, {withFileTypes: true}).sort((a, b) => a.name.localeCompare(b.name))) {
      if (["node_modules", ".git"].includes(entry.name)) continue;
      const relative = prefix + entry.name;
      if (entry.isDirectory()) hashFiles(join(path, entry.name), relative + "/");
      else if (entry.isFile()) digest.update(relative).update(readFileSync(join(path, entry.name)));
    } }; hashFiles(join(dir, folder));
    lock.skills[name] = {source: pkg, sourceType: "node_modules", version: metadata.version, skillPath: process.env.FAKE_PACKAGE_UNSAFE ? "../escape/SKILL.md" : (folder ? folder + "/" : "") + "SKILL.md", computedHash: digest.digest("hex"), installMode: "copy"};
  }
  saveLock();
} else if (command === "experimental_install") {
  if (lock.version !== version) { console.error("frozen lock uses a different hash format"); process.exit(1); }
  if (!args.includes("--frozen-lockfile")) { console.error("expected frozen restore"); process.exit(2); }
  for (const [name, entry] of Object.entries(lock.skills) as [string, any][]) {
    if (existsSync(join(store, name, "SKILL.md"))) continue;
    if (process.env.FAKE_SKILLS_RESTORE_FAIL || entry.computedHash !== hash(name)) { console.error(`frozen lockfile mismatch: ${name}`); process.exit(1); }
    if (process.env.FAKE_SKILLS_RESTORE_SKIP === name) continue;
    const dir = join(store, name); mkdirSync(dir, {recursive: true});
    writeFileSync(join(dir, "SKILL.md"), content(name)); writeFileSync(join(dir, ".source"), entry.source);
  }
} else if (command === "remove") {
  for (const name of args.slice(1, args.indexOf("-a") < 0 ? args.indexOf("-g") : args.indexOf("-a"))) {
    const dir = join(store, name), agentsFile = join(dir, ".agents");
    const agents: string[] = existsSync(agentsFile) ? JSON.parse(readFileSync(agentsFile, "utf8")) : [];
    if (agent === "claude-code") rmSync(join(root, ".claude/skills", name), {recursive: true, force: true});
    // Restoration has no per-agent metadata; remaining links determine use.
    const remaining = agent !== "claude-code" && existsSync(join(root, ".claude/skills", name)) ? ["claude-code"] : [];
    if (process.env.FAKE_SKILLS_RETAIN_CANONICAL) continue; // Other detected universal agents still use the canonical directory.
    if (remaining.length) writeFileSync(agentsFile, JSON.stringify(remaining)); else rmSync(dir, {recursive: true, force: true});
    if (!existsSync(dir)) delete lock.skills[name];
  }
  saveLock();
} else if (command === "ls") {
  console.log(JSON.stringify(existsSync(store) ? readdirSync(store).filter(n => existsSync(join(store, n, "SKILL.md"))).map(name => {
    const path = join(store, name), sourceFile = join(path, ".source"), agentsFile = join(path, ".agents");
    const source = existsSync(sourceFile) ? readFileSync(sourceFile, "utf8") : null;
    const agents: string[] = existsSync(agentsFile) ? JSON.parse(readFileSync(agentsFile, "utf8")) : [];
    return {name, path, scope: args.includes("-g") ? "global" : "project", agents: agents.map(a => a === "codex" ? "Codex" : "Claude Code"), source, sourceUrl: null, sourceType: source === null ? null : "github"};
  }) : []));
} else { console.error("unknown fake skills command"); process.exit(2); }
