import {appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, symlinkSync} from "node:fs";
import {join} from "node:path";
const raw = Bun.argv.slice(2), root = process.env.CODEX_HOME!, overrides: any = {};
const args: string[] = [];
for (let i = 0; i < raw.length; i++) {
  if (raw[i] === "-c") Object.assign(overrides, Bun.TOML.parse(raw[++i]!));
  else args.push(raw[i]!);
}
if (args[0] !== "plugin") { console.log(JSON.stringify({args, home: root})); process.exit(0); }
if (process.env.FAKE_CODEX_LOG) appendFileSync(process.env.FAKE_CODEX_LOG, JSON.stringify({args, cwd: process.cwd(), home: root, overrides}) + "\n");
const file = join(root, "config.toml"), config: any = {...(existsSync(file) ? Bun.TOML.parse(readFileSync(file, "utf8")) : {}), ...overrides};
const invalid = process.env.FAKE_CODEX_INVALID;
const write = (file: string, value: any) => { mkdirSync(join(file, ".."), {recursive: true}); writeFileSync(file, JSON.stringify(value)); };
let result: any;
if (args[1] === "marketplace" && args[2] === "upgrade") {
  const market = args[3]!, source = config.marketplaces?.[market]; if (!source) throw new Error("missing marketplace override");
  const path = join(root, ".tmp/marketplaces", market);
  write(join(path, ".codex-marketplace-install.json"), {source_type: "git", source: source.source});
  write(join(path, ".agents/plugins/marketplace.json"), {name: invalid === "namespace" ? "different" : market, plugins: []});
  result = {selectedMarketplaces: [market], upgradedRoots: [path], errors: invalid === "errors" ? ["fixture failure"] : []};
} else if (args[1] === "list") {
  const market = args[args.indexOf("--marketplace") + 1]!;
  const plugins = Object.keys(config.plugins ?? {}).filter(id => id.endsWith("@" + market)).map(id => {
    const name = id.split("@")[0]!, path = join(root, "plugins/cache", market, name);
    const versions = existsSync(path) ? readdirSync(path).filter(v => !v.startsWith(".") && existsSync(join(path, v, ".codex-plugin/plugin.json"))) : [];
    return {pluginId: id, name, marketplaceName: market, version: versions[0] ?? null, installed: !!versions.length, enabled: config.plugins[id].enabled, marketplaceSource: {sourceType: "git", source: config.marketplaces[market].source}};
  });
  result = {installed: plugins.filter(p => p.installed), available: plugins.filter(p => !p.installed)};
} else if (args[1] === "add") {
  if (root === process.env.FAKE_CODEX_USER_HOME) throw new Error("attempt to enable plugin globally");
  const id = args[2]!, [name, market] = id.split("@"), path = join(root, "plugins/cache", market!, name!, "1.0.0");
  write(join(path, ".codex-plugin/plugin.json"), {name, version: "1.0.0"});
  write(join(path, "skills/review/SKILL.md"), {source: config.marketplaces[market!].source});
  if (invalid === "symlink") symlinkSync(process.env.HOME!, join(path, "escape"));
  config.plugins = {[id]: {enabled: true}}; writeFileSync(file, Bun.TOML.stringify(config));
  result = {pluginId: id, name, marketplaceName: market, version: invalid === "version" ? "../escape" : "1.0.0", installedPath: invalid === "outside" ? process.env.HOME : path, authPolicy: "ON_INSTALL"};
} else throw new Error("unexpected native operation " + args.join(" "));
if (process.env.FAKE_CODEX_FAIL === args.slice(1, -1).join(" ")) { console.error("fixture failure after side effect"); process.exit(1); }
console.log(invalid === "json" ? "invalid JSON" : JSON.stringify(result));
