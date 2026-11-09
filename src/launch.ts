import { existsSync } from "node:fs";
import { join } from "node:path";
import { CliError } from "./errors";
import { readManifest, manifestMatchesLock } from "./manifest";
import { readLock } from "./lock";
import { missingArtifacts } from "./sync";

export function claudeArgv(project: string, args: string[]): string[] {
  return ["claude", ...args];
}
export function codexEnv(project: string, env: Record<string, string | undefined>): Record<string, string | undefined> {
  return {...env};
}
export async function launch(bin: "claude" | "codex", project: string, args: string[]): Promise<number> {
  if (!Bun.which(bin)) throw new CliError(`${bin} not found on PATH`, 3, "install it, then rerun");
  if (!existsSync(join(project, "loadouts.lock.json")) || !existsSync(join(project, "loadouts.json"))) throw new CliError("project setup has not been installed", 1, "run loadouts install before launching");
  const lock = readLock(project);
  if (lock.incomplete || lock.pending?.length || !manifestMatchesLock(readManifest(project), lock) || missingArtifacts(project, lock).length) throw new CliError("project setup needs installation", 1, "run loadouts install before launching");
  const child = Bun.spawn(bin === "claude" ? claudeArgv(project, args) : [bin, ...args], {cwd: project, env: bin === "codex" ? codexEnv(project, process.env) : {...process.env}, stdin: "inherit", stdout: "inherit", stderr: "inherit"});
  return await child.exited;
}
