import { readFileSync } from "node:fs";
import { join } from "node:path";

const out = join(process.cwd(), "dist/npm");
const manifest = JSON.parse(readFileSync(join(out, "loadouts/package.json"), "utf8"));
// Publish both launchers last so every optional binary is available when users install it.
for (const name of [...Object.keys(manifest.optionalDependencies), manifest.name, "agent-loadouts"]) {
  const result = Bun.spawnSync(["npm", "view", `${name}@${manifest.version}`, "version", "--json"]);
  const output = result.stdout.toString();
  if (result.exitCode === 0) {
    if (JSON.parse(output) !== manifest.version) throw new Error(`Unexpected npm version for ${name}: ${output}`);
    console.log(`Already published ${name}@${manifest.version}`);
    continue;
  }
  let code: string | undefined;
  try { code = JSON.parse(output).error?.code; } catch {}
  if (code !== "E404") throw new Error(`Cannot check ${name}: ${result.stderr.toString() || output}`);
  const dir = join(out, name.split("/").at(-1));
  const published = Bun.spawnSync(["npm", "publish", dir, "--access", "public", "--provenance"], { stdout: "inherit", stderr: "inherit" });
  if (published.exitCode !== 0) throw new Error(`Failed to publish ${name}@${manifest.version}`);
}
