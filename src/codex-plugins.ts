import { paint, reportNote, withProgress } from "./output";
import {existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, lstatSync, cpSync, renameSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {dirname, join, resolve} from "node:path";
import {codexConfigPath, codexUserHome, stringifyCodexConfig, stringifyCodexValue} from "./codex";
import {CliError} from "./errors";
import {writeLock, type Lock} from "./lock";
import {writeIfChanged} from "./paths";

function failure(message: string): never { throw new CliError(message, 1, "check Codex plugin support, marketplace access and cache conflicts, then rerun loadouts install"); }
function safePath(root: string, relative = ""): string {
  const parts = relative ? relative.split("/") : [];
  if (parts.some(p => !/^[\w.-]+$/.test(p) || p === "." || p === "..")) failure(`unsafe Codex cache path ${relative}`);
  let path = root;
  for (const part of ["", ...parts]) {
    path = join(path, part);
    if (lstatSync(path, {throwIfNoEntry: false})?.isSymbolicLink()) failure(`Codex cache path is a symlink: ${path}`);
  }
  return path;
}
function files(root: string): string {
  const values: [string, string][] = [];
  const walk = (dir: string, prefix: string) => {
    for (const entry of readdirSync(dir, {withFileTypes: true}).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(dir, entry.name), name = prefix + entry.name;
      if (entry.isDirectory()) walk(path, name + "/");
      else if (entry.isFile()) values.push([name, new Bun.CryptoHasher("sha256").update(readFileSync(path)).digest("hex")]);
      else failure(`unsupported Codex cache asset ${path}`);
    }
  };
  walk(root, ""); return JSON.stringify(values);
}
export function codexPluginCachePresent(id: string): boolean {
  try {
    const [name, market, extra] = id.split("@");
    if (!name || !market || extra) return false;
    const dir = safePath(codexUserHome(), `plugins/cache/${market}/${name}`);
    return readdirSync(dir).filter(v => !v.startsWith(".")).some(version => {
      try {
        const path = safePath(dir, `${version}/.codex-plugin/plugin.json`);
        const manifest = JSON.parse(readFileSync(path, "utf8"));
        return manifest.name === name && manifest.version === version;
      } catch { return false; }
    });
  } catch { return false; }
}
export async function syncCodexPlugins(project: string, lock: Lock, keys: string[], opts?: {update?: boolean}): Promise<void> {
  const managed = (key: string) => key.startsWith("codex-plugin:") || key.startsWith("codex-marketplace:");
  const wanted = keys.filter(managed), owned = [...new Set([...Object.keys(lock.installed), ...lock.pending ?? []])].filter(managed);
  const clear = (key: string) => { if (lock.pending) { lock.pending = lock.pending.filter(k => k !== key); if (!lock.pending.length) delete lock.pending; } };
  for (const key of owned.filter(k => !wanted.includes(k))) { delete lock.installed[key]; clear(key); }
  if (!wanted.length) return;
  if (!Bun.which("codex")) throw new CliError("codex not found on PATH", 3, "install Codex with plugin command support, then rerun");
  const root = codexUserHome(), config = Bun.TOML.parse(readFileSync(codexConfigPath(project), "utf8")) as any;
  const selected = {marketplaces: Object.fromEntries(wanted.filter(k => k.startsWith("codex-marketplace:")).map(k => [k.split(":")[1]!, config.marketplaces[k.split(":")[1]!]])), plugins: Object.fromEntries(wanted.filter(k => k.startsWith("codex-plugin:")).map(k => [k.slice(13), config.plugins[k.slice(13)]]))};
  const overrides = Object.entries(selected).flatMap(([key, value]) => ["-c", `${key}=${stringifyCodexValue(value)}`]);
  const command = async (args: string[], stage?: string): Promise<any> => {
    const child = Bun.spawn(["codex", ...(!stage ? overrides : []), "plugin", ...args, "--json"], {cwd: stage ?? project, env: {...process.env, CODEX_HOME: stage ?? root}, stdout: "pipe", stderr: "pipe"});
    const [code, stdout, stderr] = await withProgress(`Running codex plugin ${args.join(" ")}`,
      Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]));
    if (code) failure(`Codex plugin command failed: ${stderr.trim() || stdout.trim() || "no output"}`);
    let result: any;
    try { result = JSON.parse(stdout); } catch { failure("Codex returned invalid plugin JSON"); }
    if (!result || typeof result !== "object" || Array.isArray(result)) failure("Codex returned invalid plugin JSON");
    if (result.errors !== undefined && (!Array.isArray(result.errors) || result.errors.length)) failure("Codex reported marketplace errors");
    return result;
  };
  for (const [market, source] of Object.entries(selected.marketplaces) as [string, any][]) {
    const snapshot = safePath(root, `.tmp/marketplaces/${market}`), metadataFile = safePath(root, `.tmp/marketplaces/${market}/.codex-marketplace-install.json`);
    let metadata: any = null;
    try { metadata = JSON.parse(readFileSync(metadataFile, "utf8")); } catch { /* Missing snapshots are repaired by native refresh. */ }
    const changedSource = !!metadata && metadata.source !== source.source || owned.some(k => k.startsWith(`codex-marketplace:${market}:`) && !wanted.includes(k));
    const refresh = opts?.update || changedSource || metadata?.source !== source.source;
    if (opts?.update || changedSource) {
      // Snapshot refresh can succeed before its command fails; persist replacement intent first.
      for (const key of wanted.filter(k => k.startsWith("codex-plugin:") && k.slice(13).split("@")[1] === market)) {
        lock.installed[key] ??= [];
        lock.pending = [...new Set([...lock.pending ?? [], key])];
      }
      writeLock(project, lock);
    }
    if (refresh) {
      const result = await command(["marketplace", "upgrade", market]);
      if (!Array.isArray(result.selectedMarketplaces) || !result.selectedMarketplaces.includes(market)) failure("Codex returned unexpected marketplace identity");
    }
    const manifestFile = [".agents/plugins/marketplace.json", ".claude-plugin/marketplace.json"].map(p => safePath(snapshot, p)).find(existsSync);
    let manifest: any;
    try { manifest = manifestFile && JSON.parse(readFileSync(manifestFile, "utf8")); } catch { failure("Codex marketplace manifest is unreadable"); }
    if (manifest?.name !== market) failure("Codex returned unexpected marketplace identity");
    const listing = await command(["list", "--marketplace", market, "--available"]);
    if (!Array.isArray(listing.installed) || !Array.isArray(listing.available)) failure("Codex returned invalid plugin list");
    const marketplaceKey = wanted.find(k => k.startsWith(`codex-marketplace:${market}:`))!;
    lock.installed[marketplaceKey] = []; clear(marketplaceKey);
    for (const key of wanted.filter(k => k.startsWith("codex-plugin:") && k.slice(13).split("@")[1] === market)) {
      const id = key.slice(13), name = id.split("@")[0]!;
      safePath(root, `plugins/cache/${market}/${name}`);
      const plugin = [...listing.installed, ...listing.available].find((p: any) => p?.pluginId === id);
      if (!plugin || plugin.marketplaceName !== market || plugin.marketplaceSource?.sourceType !== "git" || plugin.marketplaceSource.source !== source.source) failure(`Codex returned unexpected plugin identity or source for ${id}`);
      const cached = typeof plugin.version === "string" ? safePath(root, `plugins/cache/${market}/${name}/${plugin.version}`) : null;
      const retrying = lock.pending?.includes(key) && Object.hasOwn(lock.installed, key);
      const intact = plugin.installed === true && cached && existsSync(safePath(cached, ".codex-plugin/plugin.json"));
      if (!opts?.update && !changedSource && !retrying && intact) { lock.installed[key] = []; clear(key); continue; }
      lock.pending = [...new Set([...lock.pending ?? [], key])]; writeLock(project, lock);
      const stage = mkdtempSync(join(tmpdir(), "loadouts-codex-"));
      try {
        writeIfChanged(join(stage, "config.toml"), stringifyCodexConfig({marketplaces: {[market]: source}}));
        await command(["marketplace", "upgrade", market], stage);
        const result = await command(["add", id], stage);
        if (result.pluginId !== id || result.name !== name || result.marketplaceName !== market || typeof result.version !== "string" || !result.version || typeof result.installedPath !== "string") failure("Codex returned unexpected plugin identity");
        const relative = `plugins/cache/${market}/${name}/${result.version}`, from = safePath(stage, relative), to = safePath(root, relative);
        if (resolve(result.installedPath) !== from || !lstatSync(from, {throwIfNoEntry: false})?.isDirectory()) failure("Codex returned an unsafe plugin cache path");
        const contents = files(from);
        const pluginManifest = JSON.parse(readFileSync(safePath(from, ".codex-plugin/plugin.json"), "utf8"));
        if (pluginManifest.name !== name || pluginManifest.version !== result.version) failure("Codex returned unexpected plugin manifest identity");
        if (existsSync(to) && files(to) !== contents && !opts?.update && !changedSource && !retrying) failure(`conflicting Codex plugin cache for ${id}`);
        if (!existsSync(to) || files(to) !== contents) {
          mkdirSync(dirname(to), {recursive: true});
          const staging = mkdtempSync(join(dirname(to), ".loadouts-")), incoming = join(staging, "incoming"), backup = join(staging, "previous");
          try {
            cpSync(from, incoming, {recursive: true, errorOnExist: true});
            if (existsSync(to)) renameSync(to, backup);
            try { renameSync(incoming, to); } catch (error) { if (existsSync(backup)) renameSync(backup, to); throw error; }
          } finally { rmSync(staging, {recursive: true, force: true}); }
          reportNote(`${paint("cached", "green")} Codex plugin ${id}`);
        }
        lock.installed[key] = []; clear(key);
      } finally { rmSync(stage, {recursive: true, force: true}); }
    }
  }
}
