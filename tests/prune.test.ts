import { test, expect } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tempEnv, run } from "./helpers";

function globals() {
  const t = tempEnv();
  mkdirSync(join(t.home, ".claude/skills/extra"), {recursive: true});
  writeFileSync(join(t.home, ".claude/skills/extra/SKILL.md"), "# Extra");
  const settings = join(t.home, ".claude/settings.json"), config = join(t.home, ".codex/config.toml");
  writeFileSync(settings, '{"model":"opus","enabledPlugins":{"stray@x":true}}\n');
  mkdirSync(join(t.home, ".codex"));
  writeFileSync(config, '# My config\nmodel = "my-model"\n\n[mcp_servers.foo]\ncommand = "bun" # keep\n\n[mcp_servers."bar.baz"]\nenabled = true # keep this comment\nurl = "http://localhost"\n');
  return {...t, settings, config, opts: {cwd: t.project, env: t.env}};
}
test("prune without yes reports the plan and writes nothing", async () => {
  const t = globals(), settings = readFileSync(t.settings, "utf8"), config = readFileSync(t.config, "utf8");
  const r = await run(["global", "prune"], t.opts);
  expect(r.code).toBe(0); expect(r.stdout).toContain("These changes affect all projects:"); expect(r.stdout).toContain("Run again with --yes");
  expect(readFileSync(t.settings, "utf8")).toBe(settings); expect(readFileSync(t.config, "utf8")).toBe(config);
});
test("confirmed prune disables settings and preserves TOML text", async () => {
  const t = globals(), before = readFileSync(t.config, "utf8");
  expect((await run(["global", "prune", "--yes"], t.opts)).code).toBe(0);
  const settings = JSON.parse(readFileSync(t.settings, "utf8"));
  expect(settings).toEqual({model: "opus", enabledPlugins: {"stray@x": false}, skillOverrides: {extra: "off"}});
  const after = readFileSync(t.config, "utf8"), config = Bun.TOML.parse(after) as any;
  expect(config.mcp_servers.foo.enabled).toBe(false); expect(config.mcp_servers["bar.baz"].enabled).toBe(false);
  expect(after).toBe(before.replace("[mcp_servers.foo]\n", "[mcp_servers.foo]\nenabled = false\n").replace("enabled = true", "enabled = false"));
  const r = await run(["global", "prune", "--yes"], t.opts);
  expect(r.code).toBe(0); expect(r.stdout).toContain("Nothing changed.");
});

test("explicit prune uses the same CODEX_HOME as its inventory", async () => {
  const t = globals(), custom = join(t.home, "custom"), before = readFileSync(t.config, "utf8");
  mkdirSync(join(custom, "skills/personal"), {recursive: true});
  writeFileSync(join(custom, "config.toml"), '[mcp_servers.custom]\ncommand = "custom"\n');
  const r = await run(["global", "prune", "--yes"], {cwd: t.project, env: {...t.env, CODEX_HOME: custom}});
  expect(r.code, r.stderr).toBe(0);
  expect((Bun.TOML.parse(readFileSync(join(custom, "config.toml"), "utf8")) as any).mcp_servers.custom.enabled).toBe(false);
  expect(readFileSync(t.config, "utf8")).toBe(before);
  expect(r.stdout).toContain(join(custom, "skills/personal"));
});
