import { appendFileSync, readFileSync } from "node:fs";

const args = process.argv.slice(2), command = args.slice(0, 2).join(" ");
const event: Record<string, unknown> = {args, cwd: process.cwd()};
function git(...argv: string[]): string {
  const p = Bun.spawnSync(["git", ...argv], {stdout: "pipe", stderr: "pipe"});
  if (p.exitCode) throw new Error(p.stderr.toString());
  return p.stdout.toString().trim();
}
if (command === "pr create") {
  event.body = readFileSync(args[args.indexOf("--body-file") + 1]!, "utf8");
  event.files = git("diff", "--name-only", "origin/main", "HEAD").split("\n");
}
appendFileSync(process.env.FAKE_GH_LOG!, JSON.stringify(event) + "\n");
if (process.env.FAKE_GH_FAIL === command) { console.error("simulated GitHub failure"); process.exit(1); }
if (command === "repo view") console.log(JSON.stringify({viewerPermission: process.env.FAKE_GH_PERMISSION ?? "WRITE", defaultBranchRef: {name: "main"}}));
else if (command === "repo clone") git("clone", "--quiet", process.env.FAKE_GH_REMOTE!, args[3]!);
else if (command === "repo fork") git("remote", "add", "loadouts-fork", process.env.FAKE_GH_FORK!);
else if (command === "api user") console.log("test-user");
else if (command === "pr create") console.log("https://github.com/acme/catalog/pull/42");
else { console.error("unsupported fake gh command"); process.exit(2); }
