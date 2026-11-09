import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll } from "bun:test";

export const repo = resolve(import.meta.dir, "..");
const roots: string[] = [];
afterAll(() => { for (const root of roots) rmSync(root, { recursive: true, force: true }); });
export function tempEnv(): { home: string; project: string; env: Record<string,string> } {
  const root = mkdtempSync(join(tmpdir(), "loadouts-"));
  roots.push(root);
  const home = join(root, "home"), project = join(root, "project");
  mkdirSync(home); mkdirSync(project);
  return { home, project, env: { HOME: home, USERPROFILE: home, CODEX_HOME: join(home, ".codex"), CLAUDE_CONFIG_DIR: join(home, ".claude"), XDG_CONFIG_HOME: join(home, ".config"), XDG_CACHE_HOME: join(home, ".cache"), BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0", LOADOUTS_CACHE: join(root, "cache"), LOADOUTS_SKILLS_CMD: `bun ${repo}/tests/fixtures/fake-skills.ts` } };
}
export async function run(args: string[], opts?: { cwd?: string; env?: Record<string,string> }): Promise<{ code: number; stdout: string; stderr: string }> {
  const t = tempEnv();
  const child = Bun.spawn([process.execPath, join(repo, "src/cli.ts"), ...args], {
    cwd: opts?.cwd ?? t.project, env: { ...process.env, NO_COLOR: "", NODE_DISABLE_COLORS: "", FORCE_COLOR: "", ...t.env, ...opts?.env }, stdout: "pipe", stderr: "pipe",
  });
  const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
  return { code, stdout, stderr };
}

export const baseYaml = `name: base
items:
  methodology:
    one_of:
      superpowers:
        claude: { plugin: superpowers@superpowers-dev, marketplace: obra/superpowers }
        codex: { skills: [obra/superpowers] }
      agent-skills:
        skills: [addyosmani/agent-skills]
    default: superpowers
  ponytail:
    claude: { plugin: ponytail@ponytail, marketplace: DietrichGebert/ponytail }
    codex: { skills: [DietrichGebert/ponytail] }
    conventions: Terse code, platform features before dependencies.
routing:
  - when: Planning, specifying or implementing a feature
    use: [methodology]
  - when: Writing, changing or reviewing code
    use: [ponytail]
`;
export function git(cwd: string, ...args: string[]): string {
  const child = Bun.spawnSync(["git", ...args], { cwd, env: { ...process.env, HOME: cwd, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1", GIT_AUTHOR_NAME: "Test", GIT_AUTHOR_EMAIL: "test@example.invalid", GIT_COMMITTER_NAME: "Test", GIT_COMMITTER_EMAIL: "test@example.invalid" } });
  if (child.exitCode) throw new Error(child.stderr.toString());
  return child.stdout.toString().trim();
}
export function fixtureCatalog(): string {
  const { project } = tempEnv();
  mkdirSync(join(project, "loadouts"));
  writeFileSync(join(project, "loadouts/base.yml"), baseYaml);
  writeFileSync(join(project, "loadouts/backend.yml"), `name: backend
items:
  runtime:
    any_of:
      bun: { skills: [acme/bun-skills], conventions: bun for scripts and CLIs. }
      python: { skills: [acme/py-skills], conventions: Python only for AI/ML. }
      go: { skills: [acme/go-skills], conventions: Go for infrastructure and systems. }
    default: [bun]
`);
  writeFileSync(join(project, "loadouts/frontend.yml"), `name: frontend
items:
  shadcn:
    skills: [shadcn/ui@shadcn]
    mcp:
      shadcn: { command: ${JSON.stringify(process.execPath)}, args: [${JSON.stringify(join(repo, "tests/fixtures/mcp-ok.ts"))}] }
routing:
  - when: Adding or changing UI components
    use: [skill:shadcn, mcp:shadcn]
`);
  git(project, "init", "-b", "main");
  git(project, "add", "."); git(project, "commit", "-m", "Fixture catalog"); git(project, "tag", "v1.0.0");
  return project;
}
export async function withEnv<T>(env: Record<string,string>, fn: () => T | Promise<T>): Promise<T> {
  const old = Object.fromEntries(Object.keys(env).map(k => [k, process.env[k]]));
  Object.assign(process.env, env);
  try { return await fn(); } finally {
    for (const [key, value] of Object.entries(old)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
}
