import { test, expect } from "bun:test";
import { existsSync, mkdirSync, writeFileSync, readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tempEnv, fixtureCatalog, run, withEnv, git } from "./helpers";
import { sync } from "../src/sync";
import { readLock } from "../src/lock";
import { openCatalog } from "../src/catalog";

async function setup() {
  const t = tempEnv(), catalog = fixtureCatalog(), opts = {cwd: t.project, env: t.env};
  mkdirSync(join(t.home, ".codex")); writeFileSync(join(t.home, ".codex/auth.json"), "{}");
  await run(["init"], opts);
  expect((await run(["add", "base", "frontend", "--catalog", catalog], opts)).code).toBe(0);
  return {...t, catalog, opts};
}

test("doctor checks active nested groups and container alternatives without scanning inactive languages", async () => {
  const t = await setup();
  writeFileSync(join(t.project, ".loadouts/catalog/testing.yml"), JSON.stringify({name: "testing", items: {
    languages: {any_of: {
      python: {items: {framework: {one_of: {chosen: {}, other: {items: {tool: {skills: ["acme/alternate@alternate"]}}}}, default: "chosen"}}},
      typescript: {includes: {missing: {source: "file:./.loadouts/catalog/missing.yml"}}, items: {framework: {one_of: {chosen: {}, other: {skills: ["acme/inactive@inactive"]}}, default: "chosen"}}},
    }, default: ["python"]},
  }}));
  expect((await run(["add", "file:./.loadouts/catalog/testing.yml"], t.opts)).code).toBe(0);
  for (const [name, source] of [["alternate", "acme/alternate"], ["inactive", "acme/inactive"]]) {
    const dir = join(t.home, ".agents/skills", name!); mkdirSync(dir, {recursive: true}); writeFileSync(join(dir, "SKILL.md"), "# skill"); writeFileSync(join(dir, ".source"), source!);
  }
  const before = readFileSync(join(t.project, "loadouts.lock.json"), "utf8"), result = await run(["doctor", "--json"], t.opts);
  const findings = JSON.parse(result.stdout).findings; expect(findings).toHaveLength(1);
  const conflicts = findings.filter((finding: any) => finding.kind === "conflict");
  expect(conflicts).toHaveLength(1); expect(conflicts[0].message).toContain("testing/languages/python/framework"); expect(conflicts[0].message).not.toContain("typescript");
  expect(readFileSync(join(t.project, "loadouts.lock.json"), "utf8")).toBe(before);
});

test("doctor ignores desired shared artifacts but detects exclusive inactive container artifacts", async () => {
  const t = await setup();
  writeFileSync(join(t.project, ".loadouts/catalog/shared.yml"), 'name: shared\nitems: {review: {skills: [acme/root-shared@root-shared]}}\n');
  writeFileSync(join(t.project, ".loadouts/catalog/testing.yml"), JSON.stringify({name: "testing", items: {
    languages: {any_of: {python: {items: {framework: {one_of: {
      pytest: {items: {tools: {skills: ["acme/pytest@pytest", "acme/choice-shared@choice-shared", "acme/root-shared@root-shared"]}}},
      unittest: {skills: ["acme/unittest@unittest", "acme/choice-shared@choice-shared"]},
    }, default: "pytest"}}}}, default: ["python"]},
  }}));
  expect((await run(["add", "file:./.loadouts/catalog/testing.yml", "file:./.loadouts/catalog/shared.yml"], t.opts)).code).toBe(0);
  expect((await run(["switch", "testing/languages/python/framework", "unittest"], t.opts)).code).toBe(0);
  expect(existsSync(join(t.project, ".agents/skills/pytest/SKILL.md"))).toBe(false);
  for (const key of ["skill:codex:acme/choice-shared@choice-shared", "skill:codex:acme/root-shared@root-shared"]) expect(Object.hasOwn(readLock(t.project).installed, key)).toBe(true);
  const file = join(t.project, "loadouts.lock.json"), before = readFileSync(file, "utf8");
  const clean = await run(["doctor", "--json"], t.opts);
  expect(clean.code, clean.stderr + clean.stdout).toBe(0); expect(JSON.parse(clean.stdout).findings).toEqual([]);
  const global = join(t.home, ".agents/skills/pytest"); mkdirSync(global, {recursive: true});
  writeFileSync(join(global, "SKILL.md"), "# pytest\n"); writeFileSync(join(global, ".source"), "acme/pytest");
  const conflict = await run(["doctor", "--json"], t.opts);
  expect(conflict.code).toBe(1);
  expect(JSON.parse(conflict.stdout).findings).toEqual([expect.objectContaining({kind: "conflict", message: "testing/languages/python/framework: non-selected alternative pytest is installed"})]);
  expect(readFileSync(file, "utf8")).toBe(before);
});
test("doctor accepts unrelated inherited plugins, MCP servers and skills", async () => {
  const t = await setup();
  mkdirSync(join(t.home, ".claude")); writeFileSync(join(t.home, ".claude/settings.json"), '{"enabledPlugins":{"stray@x":true}}');
  writeFileSync(join(t.home, ".codex/config.toml"), '[plugins."personal@tools"]\nenabled = true\n[mcp_servers.personal]\ncommand = "personal"\n');
  mkdirSync(join(t.home, ".codex/skills/personal"), {recursive: true});
  writeFileSync(join(t.home, ".codex/skills/personal/SKILL.md"), "Personal");
  const r = await run(["doctor", "--json"], t.opts);
  expect(r.code, r.stderr).toBe(0); expect(JSON.parse(r.stdout).findings).toEqual([]); expect(r.stdout).not.toContain("prune");
});
test("global non-selected skills are one_of conflicts", async () => {
  const t = await setup(), dir = join(t.home, ".agents/skills/agent-skills-x");
  mkdirSync(dir, {recursive: true}); writeFileSync(join(dir, "SKILL.md"), "# skill"); writeFileSync(join(dir, ".source"), "addyosmani/agent-skills");
  const r = await run(["doctor", "--json"], t.opts);
  expect(r.code).toBe(1); expect(JSON.parse(r.stdout).findings).toContainEqual(expect.objectContaining({kind: "conflict", message: expect.stringContaining("base/methodology")}));
});
test("doctor retains unknown-source global skills without inventing source conflicts", async () => {
  const t = await setup();
  for (const root of [t.home, t.project]) {
    const dir = join(root, ".agents/skills/agent-skills");
    mkdirSync(dir, {recursive: true}); writeFileSync(join(dir, "SKILL.md"), "# Local skill\n");
  }
  const r = await run(["doctor", "--json"], t.opts);
  expect(r.code).toBe(0); expect(r.stderr).toBe("");
  const findings = JSON.parse(r.stdout).findings;
  expect(findings).toEqual([]);
  expect(findings.some((f: any) => f.kind === "conflict")).toBe(false);
});
test("doctor detects unreachable servers without editing the project", async () => {
  const t = await setup();
  writeFileSync(join(t.catalog, "loadouts/frontend.yml"), 'name: frontend\nitems: {ui: {mcp: {shadcn: {command: "false"}}}}');
  git(t.catalog, "add", "."); git(t.catalog, "commit", "-m", "Unreachable"); git(t.catalog, "tag", "v1.1.0");
  await withEnv(t.env, async () => {
    const lock = readLock(t.project); lock.catalog = await openCatalog(t.catalog);
    lock.resolved!.frontend.catalog = lock.catalog;
    await sync(t.project, lock, {check: false});
  });
  const file = join(t.project, "loadouts.lock.json"), before = readFileSync(file, "utf8");
  const r = await run(["doctor", "--json"], t.opts);
  expect(r.code).toBe(1); expect(JSON.parse(r.stdout).findings).toContainEqual(expect.objectContaining({kind: "mcp", message: expect.stringContaining("shadcn")}));
  expect(readFileSync(file, "utf8")).toBe(before);
});
test("clean setup passes without file-based Codex credentials", async () => {
  const t = await setup(); unlinkSync(join(t.home, ".codex/auth.json"));
  const clean = await run(["doctor"], t.opts);
  expect(clean.code, clean.stderr).toBe(0); expect(clean.stdout).toContain("No problems found.");
});

test.each(["claude-code", "codex"])("%s project disablement masks a global alternative", async harness => {
  const t = await setup();
  const local = join(t.project, ".loadouts/catalog/choice.yml");
  writeFileSync(local, `name: choice\nitems:\n  method:\n    one_of:\n      chosen: {skills: [acme/chosen]}\n      other:\n        ${harness === "codex" ? "codex" : "claude"}: {plugin: other@tools, marketplace: acme/tools}\n    default: chosen\n`);
  expect((await run(["add", "file:./.loadouts/catalog/choice.yml"], t.opts)).code).toBe(0);
  const userHome = join(t.home, "custom-codex"); mkdirSync(userHome);
  const opts = {...t.opts, env: {...t.env, CODEX_HOME: userHome}};
  if (harness === "codex") writeFileSync(join(userHome, "config.toml"), '[plugins."other@tools"]\nenabled = true\n');
  else { mkdirSync(join(t.home, ".claude"), {recursive: true}); writeFileSync(join(t.home, ".claude/settings.json"), '{"enabledPlugins":{"other@tools":true}}'); }
  const active = await run(["doctor", "--json"], opts);
  expect(JSON.parse(active.stdout).findings).toContainEqual(expect.objectContaining({kind: "conflict", message: expect.stringContaining("choice/method")}));
  const file = join(t.project, harness === "codex" ? ".codex/config.toml" : ".claude/settings.local.json");
  writeFileSync(file, harness === "codex" ? readFileSync(file, "utf8") + '\n[plugins."other@tools"]\nenabled = false\n' : '{"enabledPlugins":{"other@tools":false}}');
  const masked = await run(["doctor", "--json"], opts);
  expect(JSON.parse(masked.stdout).findings.some((f: any) => f.kind === "conflict")).toBe(false);
});

test.each(["claude-code", "codex"])("%s duplicate user and project integration hooks warn without writes", async harness => {
  const t = await setup(), custom = join(t.home, "custom-codex"); mkdirSync(custom);
  const user = harness === "codex" ? join(custom, "hooks.json") : join(t.home, ".claude/settings.json");
  const project = join(t.project, harness === "codex" ? ".codex/hooks.json" : ".claude/settings.local.json");
  mkdirSync(join(user, ".."), {recursive: true});
  const text = JSON.stringify({hooks: {SessionStart: [{hooks: [{type: "command", command: "codebase-memory-mcp hook-augment"}]}]}});
  writeFileSync(user, text); writeFileSync(project, text);
  const r = await run(["doctor", "--json"], {...t.opts, env: {...t.env, CODEX_HOME: custom}});
  expect(r.code).toBe(1);
  expect(JSON.parse(r.stdout).findings).toContainEqual(expect.objectContaining({kind: "conflict", message: expect.stringContaining("may run twice")}));
  expect(r.stdout).toContain(user); expect(r.stdout).toContain(project); expect(r.stdout).not.toContain("prune");
  expect(readFileSync(user, "utf8")).toBe(text); expect(readFileSync(project, "utf8")).toBe(text);
});

test("effective inherited MCP alternatives conflict unless the native project disables them", async () => {
  const t = await setup();
  writeFileSync(join(t.project, ".loadouts/catalog/tools.yml"), "name: tools\nitems:\n  tool:\n    one_of:\n      selected: {skills: [acme/selected]}\n      other: {codex: {mcp: {alternative: {command: alternate}}}}\n    default: selected\n");
  expect((await run(["add", "file:./.loadouts/catalog/tools.yml"], t.opts)).code).toBe(0);
  writeFileSync(join(t.home, ".codex/config.toml"), '[mcp_servers.alternative]\ncommand = "alternate"\n');
  const active = await run(["doctor", "--json"], t.opts);
  expect(JSON.parse(active.stdout).findings).toContainEqual(expect.objectContaining({kind: "conflict", message: expect.stringContaining("tools/tool")}));
  const file = join(t.project, ".codex/config.toml");
  writeFileSync(file, readFileSync(file, "utf8") + '\n[mcp_servers.alternative]\nenabled = false\n');
  expect(JSON.parse((await run(["doctor", "--json"], t.opts)).stdout).findings.some((f: any) => f.kind === "conflict")).toBe(false);
});

test("doctor checks setup before project init and reports broken guide imports alongside project findings", async () => {
  const t = tempEnv(), opts = {cwd: t.project, env: t.env};
  const configure = ["global", "configure", "--catalog", fixtureCatalog(), "--harness", "claude-code,codex"];
  const diagnose = () => run(["doctor", "--json"], opts);
  expect((await run(configure, opts)).code).toBe(0);
  const clean = await diagnose();
  expect(clean.code, clean.stderr).toBe(0);
  expect(JSON.parse(clean.stdout)).toEqual({findings: []});
  const codexGuide = join(t.home, ".codex/LOADOUTS.md"), claudeInstructions = join(t.home, ".claude/CLAUDE.md");
  const stale = "Agent setups are managed by `loadouts`; see `loadouts help`.\n";
  writeFileSync(codexGuide, stale);
  writeFileSync(claudeInstructions, "A note mentioning @LOADOUTS.md inline.\r\n");
  const broken = await diagnose();
  expect(broken.code).toBe(1);
  const findings = JSON.parse(broken.stdout).findings;
  expect(findings).toHaveLength(2);
  for (const file of [codexGuide, claudeInstructions]) {
    expect(findings).toContainEqual({kind: "global", message: expect.stringContaining(file), fix: "loadouts global configure"});
  }
  expect(readFileSync(codexGuide, "utf8")).toBe(stale);
  expect(readFileSync(claudeInstructions, "utf8")).toContain("inline.");
  expect((await run(["init"], opts)).code).toBe(0);
  const projectFindings = JSON.parse((await diagnose()).stdout).findings;
  for (const finding of findings) expect(projectFindings).toContainEqual(finding);
  expect(projectFindings).toContainEqual(expect.objectContaining({kind: "local"}));
  expect((await run(["global", "configure"], opts)).code).toBe(0);
  expect(JSON.parse((await diagnose()).stdout).findings.every((f: any) => f.kind === "local")).toBe(true);
});

test("doctor checks only configured harnesses and reports missing files and invalid machine config", async () => {
  const t = tempEnv(), opts = {cwd: t.project, env: t.env};
  expect((await run(["global", "configure", "--harness", "codex"], opts)).code).toBe(0);
  const guide = join(t.home, ".codex/LOADOUTS.md");
  unlinkSync(guide);
  const result = await run(["doctor"], opts);
  expect(result.code).toBe(1); expect(result.stdout).toContain(guide); expect(result.stdout).not.toContain(".claude");
  expect(existsSync(guide)).toBe(false);
  writeFileSync(join(t.home, ".config/loadouts/config.toml"), "broken = [");
  const broken = await run(["doctor", "--json"], opts);
  expect(broken.code).toBe(1);
  expect(JSON.parse(broken.stdout).findings).toContainEqual(expect.objectContaining({kind: "global", fix: expect.stringContaining("--catalog")}));
});
