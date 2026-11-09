import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CliError } from "./errors";
import { readConfig } from "./config";
import { readManifest, manifestMatchesLock, fileSource } from "./manifest";
import { readLock, loadoutClosure, loadoutPaths, validateLockedLoadout } from "./lock";
import { readCachedLoadout } from "./catalog";
import { missingArtifacts } from "./sync";
import { readLocal } from "./local";
import { activeItems, artifactsFor, includeDeclarations, parseLoadout } from "./loadout";

export async function publish(project: string, name: string, opts: {summary: string; catalog?: string; yes?: boolean}): Promise<string> {
  if (!opts.summary?.trim()) throw new CliError("verification summary is required", 2, "use --summary to describe how this loadout was verified in your project");
  const yaml = readLocal(project, name);
  if (yaml === null) throw new CliError(`local definition .loadouts/catalog/${name}.yml is missing`, 1, `run loadouts create ${name}, then edit and apply it`);
  const loadout = parseLoadout(yaml, name + ".yml"), lock = readLock(project);
  if (!existsSync(join(project, "loadouts.json")) || !manifestMatchesLock(readManifest(project), lock)) throw new CliError("loadouts.json does not match the applied setup", 1, "run loadouts install and verify the result before publishing");
  if (lock.resolved?.[name]?.source !== fileSource(name) || !Object.hasOwn(lock.local ?? {}, name) || lock.local![name] !== yaml) throw new CliError(`${name} has not been applied with its current contents`, 1, `run loadouts add ${fileSource(name)} and verify the result before publishing`);
  const closure = loadoutClosure(lock, name);
  for (const node of closure) if (Object.hasOwn(lock.local ?? {}, node) && readLocal(project, node) !== lock.local![node]) throw new CliError(`${loadoutPaths(lock, node).map(path => path.join(" → ")).join(", ")} has not been applied with its current contents`, 1, "run loadouts install and verify the result before publishing");
  const nonportable = closure.filter(node => node !== name && !lock.resolved![node]!.source.startsWith("github:"));
  if (nonportable.length) throw new CliError(`publication requires portable dependencies:\n${nonportable.flatMap(node => loadoutPaths(lock, node).map(path => `${path.join(" → ")}: ${lock.resolved![node]!.source}`)).join("\n")}`, 1, "publish local dependencies first, replace their includes with available github: sources, then run loadouts install and verify before publishing");
  const keys = new Set<string>();
  for (const node of closure) {
    const definition = node === name ? loadout : await readCachedLoadout(lock.resolved![node]!.catalog!, node);
    validateLockedLoadout(lock, node, definition);
    const declarations = includeDeclarations(definition).filter(({selection}) => !selection.source.startsWith("github:"));
    if (declarations.length) throw new CliError(`publication requires portable dependencies:\n${declarations.map(({path, selection}) => `${loadoutPaths(lock, node).map(chain => chain.join(" → ")).join("; ")}: ${path}: ${selection.source}`).join("\n")}`, 1, "publish local dependencies first and use portable github: sources in every include declaration, including inactive branches");
    for (const item of activeItems(definition, lock.loadouts[node]!)) for (const harness of lock.harnesses) for (const key of artifactsFor(item, harness).keys()) keys.add(key);
  }
  if (missingArtifacts(project, lock).length) throw new CliError("project artifacts are missing, disabled or unreadable", 1, "run loadouts install and verify the result before publishing");
  if (lock.incomplete || lock.pending?.some(key => keys.has(key)) || [...keys].some(key => !Object.hasOwn(lock.installed, key))) throw new CliError("project reconciliation is incomplete", 1, "run loadouts install successfully before publishing");
  const target = opts.catalog ?? lock.catalog?.repo ?? readConfig().catalog;
  if (!/^[\w.-]+\/[\w.-]+$/.test(target)) throw new CliError("publishing requires a GitHub owner/repo catalog", 2, "pass --catalog owner/repo");
  const title = `Add or update ${name} loadout`;
  const body = `Proposes \`loadouts/${name}.yml\` from a project-local loadout.\n\n## Verification\n\n${opts.summary.trim()}\n\nApplied with: ${lock.harnesses.join(", ")}.\nSelected alternatives: ${JSON.stringify(lock.loadouts[name])}.\nVerified active choices (active closure only): ${JSON.stringify(Object.fromEntries(closure.map(node => [node, lock.loadouts[node]])))}.\nInactive targets were checked for source portability only; they were not fetched or tested.\n`;
  if (!opts.yes) return `Catalog: ${target}\nFile: loadouts/${name}.yml\nTitle: ${title}\n\n${body}\n--- YAML ---\n${yaml}\nRun again with --yes to push a contribution branch and open a PR.`;
  for (const bin of ["git", "gh"]) if (!Bun.which(bin)) throw new CliError(`${bin} not found on PATH`, 3, `install ${bin}${bin === "gh" ? " and run gh auth login" : ""}, then rerun`);
  const root = mkdtempSync(join(tmpdir(), "loadouts-publish-")), checkout = join(root, "catalog");
  const checkedFile = (path: string): string => {
    let file = checkout;
    const parts = path.split("/");
    for (const [index, part] of parts.entries()) {
      file = join(file, part);
      const stat = lstatSync(file, {throwIfNoEntry: false});
      if (stat && (stat.isSymbolicLink() || (index === parts.length - 1 ? !stat.isFile() : !stat.isDirectory()))) {
        throw new CliError(`catalog path ${path} contains a symlink or unexpected file type`, 1, "use ordinary files and directories for loadouts and PR templates in the catalog");
      }
    }
    return file;
  };
  const command = async (argv: string[], cwd: string, allowed = [0]): Promise<{code: number; out: string}> => {
    const child = Bun.spawn(argv, {cwd, env: {...process.env, GH_PROMPT_DISABLED: "1", GIT_TERMINAL_PROMPT: "0"}, stdin: "ignore", stdout: "pipe", stderr: "pipe"});
    const [code, out, err] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    if (!allowed.includes(code)) throw new CliError(`${argv[0]} ${argv[1]} failed: ${err.trim() || out.trim()}`, 1, "check Git identity, GitHub authentication and repository access, then retry");
    return {code, out: out.trim()};
  };
  try {
    const info = JSON.parse((await command(["gh", "repo", "view", target, "--json", "viewerPermission,defaultBranchRef"], project)).out);
    const base = info.defaultBranchRef?.name;
    if (typeof base !== "string" || !base) throw new CliError(`catalog ${target} has no default branch`, 1, "initialize the shared catalog before contributing");
    await command(["gh", "repo", "clone", target, checkout, "--", "--quiet"], root);
    const branch = `loadouts/${crypto.randomUUID()}`;
    await command(["git", "checkout", "--no-track", "-b", branch, `origin/${base}`], checkout);
    const destination = checkedFile(`loadouts/${name}.yml`);
    mkdirSync(join(checkout, "loadouts"), {recursive: true});
    writeFileSync(destination, yaml);
    await command(["git", "add", "--", `loadouts/${name}.yml`], checkout);
    const diff = await command(["git", "diff", "--cached", "--quiet"], checkout, [0, 1]);
    if (!diff.code) throw new CliError(`${name} already matches the shared catalog`, 1, "no PR is needed; keep using the existing definition");
    await command(["git", "commit", "-m", title], checkout);
    const template = [".github/pull_request_template.md", ".github/PULL_REQUEST_TEMPLATE.md", "pull_request_template.md", "PULL_REQUEST_TEMPLATE.md", "docs/pull_request_template.md"].find(path => existsSync(checkedFile(path)));
    const bodyFile = join(root, "pr-body.md");
    writeFileSync(bodyFile, (template ? readFileSync(join(checkout, template), "utf8") + "\n\n" : "") + body);
    let remote = "origin", head = branch;
    if (!["WRITE", "MAINTAIN", "ADMIN"].includes(info.viewerPermission)) {
      await command(["gh", "repo", "fork", "--clone=false", "--remote", "--remote-name", "loadouts-fork"], checkout);
      const login = (await command(["gh", "api", "user", "--jq", ".login"], checkout)).out;
      if (!/^[\w-]+$/.test(login)) throw new CliError("GitHub returned an invalid user login", 1, "check gh auth status before retrying");
      remote = "loadouts-fork"; head = `${login}:${branch}`;
    }
    await command(["git", "push", "--set-upstream", remote, branch], checkout);
    try {
      return (await command(["gh", "pr", "create", "--repo", target, "--base", base, "--head", head, "--title", title, "--body-file", bodyFile], checkout)).out;
    } catch (error) {
      throw new CliError(`branch ${head} was already pushed, but PR creation failed: ${String(error)}`, 1, `run gh pr create --repo ${target} --head ${head} and supply the title and verification notes`);
    }
  } finally { rmSync(root, {recursive: true, force: true}); }
}
