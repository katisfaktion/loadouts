import { appendFileSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
const args = process.argv.slice(2), env = process.env;
if (env.FAKE_INSTALLER_CONTROL) Object.assign(env, JSON.parse(readFileSync(env.FAKE_INSTALLER_CONTROL, "utf8")));
if (env.FAKE_INSTALLER_LOG) appendFileSync(env.FAKE_INSTALLER_LOG, JSON.stringify({args, home: env.HOME, cwd: process.cwd()}) + "\n");
if (args[0] === "--version") { console.log("codebase-memory-mcp " + (env.FAKE_INSTALLER_VERSION ?? "0.12.1")); process.exit(0); }
if (!args.length) {
  for await (const line of console) { const request = JSON.parse(line); if (request.method === "initialize") console.log(JSON.stringify({jsonrpc: "2.0", id: request.id, result: {protocolVersion: "2025-06-18", capabilities: {}, serverInfo: {name: "fake", version: "1"}}})); }
  process.exit(0);
}
if (args[0] === "cli" && args[1] === "index_repository") {
  if (env.FAKE_INSTALLER_FAIL === "index") { console.error("index failed"); process.exit(1); }
  console.log(JSON.stringify({status: "indexed"})); process.exit(0);
}
if (args[0] !== "install" || !args.includes("--skip-binary") || args.includes("--force")) throw new Error("unsafe installation arguments");
const dir = args.find(a => a.startsWith("--dir="))?.slice(6);
if (!dir) throw new Error("missing executable directory");
const binary = join(dir, "codebase-memory-mcp"), clients = args.find(a => a.startsWith("--clients="))!.slice(10).split(",");
const write = (file: string, text: string) => { mkdirSync(join(file, ".."), {recursive: true}); writeFileSync(file, text); };
for (const h of clients) {
  const root = h === "codex" ? env.CODEX_HOME! : env.CLAUDE_CONFIG_DIR!;
  write(join(root, "skills/codebase-memory/SKILL.md"), "---\nname: codebase-memory\ndescription: Explore code\n---\nUse the graph.\n" + (env.FAKE_INSTALLER_VERSION ?? "0.12.1") + "\n");
  for (const name of ["codebase-memory", "codebase-memory-scout", "codebase-memory-auditor"]) write(join(root, `agents/${name}.${h === "codex" ? "toml" : "md"}`), h === "codex" ? `name = "${name}"\ndescription = "Explore"\ndeveloper_instructions = "Read only"\n[mcp_servers.codebase-memory-mcp]\ncommand = ${JSON.stringify(binary)}\n` : `---\nname: ${name}\ndescription: Explore\n---\nRead only.\n`);
  const hooks = {SessionStart: [{matcher: "startup", hooks: [{type: "command", command: binary, args: ["hook-augment"], timeout: 5}]}]};
  if (h === "codex") {
    write(join(root, "config.toml"), `[mcp_servers.codebase-memory-mcp]\ncommand = ${JSON.stringify(binary)}\n`);
    write(join(root, "hooks.json"), JSON.stringify({hooks}));
    write(join(root, "AGENTS.md"), "Use codebase-memory before structural searches.\n");
  } else write(join(root, "settings.json"), JSON.stringify({hooks}));
}
if (env.FAKE_INSTALLER_FAIL === "configure") { console.error("configuration failed"); process.exit(1); }
