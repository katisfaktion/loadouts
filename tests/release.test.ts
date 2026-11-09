import { expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { git, repo, tempEnv } from "./helpers";

const workflow = Bun.YAML.parse(readFileSync(join(repo, ".github/workflows/release.yml"), "utf8")) as any;
const check = workflow.jobs.release.steps.find((step: any) => step.id === "tag").run;
const releasePr = {merged_at: "2026-11-05T00:00:00Z", base: {ref: "main"}, head: {ref: "changeset-release/main"}};

test("npm publication runs only for a pending release and precedes its GitHub tag", () => {
  const steps = workflow.jobs.release.steps;
  const pack = steps.findIndex((step: any) => step.name === "Package for npm");
  const publish = steps.findIndex((step: any) => step.name === "Publish to npm");
  const github = steps.findIndex((step: any) => step.name === "Create GitHub release");
  expect(pack).toBeGreaterThan(steps.findIndex((step: any) => step.name === "Build binaries"));
  expect(publish).toBeGreaterThan(pack);
  expect(github).toBeGreaterThan(publish);
  for (const index of [pack, publish, github]) expect(steps[index].if).toBe("steps.tag.outputs.missing == 'true'");
  expect(workflow.permissions["id-token"]).toBe("write");
  expect(steps[github].run).toContain("dist/loadouts-bun-*");
});

test.each([
  ["ordinary push", [], false, false],
  ["unmerged release PR", [{...releasePr, merged_at: null}], false, false],
  ["other merged PR", [{...releasePr, head: {ref: "feature"}}], false, false],
  ["merged release PR", [releasePr], false, true],
  ["already released version", [releasePr], true, false],
])("release workflow handles %s", (name, prs, tagged, pending) => {
  const t = tempEnv(), bin = join(t.home, "bin"), output = join(t.home, "output");
  mkdirSync(bin);
  writeFileSync(join(bin, "gh"), '#!/bin/sh\nprintf "%s" "$TEST_PRS" | jq "$4"\n', {mode: 0o755});
  writeFileSync(join(t.project, "package.json"), '{"version":"0.1.0"}\n');
  git(t.project, "init", "-b", "main"); git(t.project, "add", "."); git(t.project, "commit", "-m", "Fixture");
  if (tagged) git(t.project, "tag", "v0.1.0");
  const result = Bun.spawnSync(["bash", "-e", "-o", "pipefail", "-c", check], {
    cwd: t.project,
    env: {...process.env, ...t.env, PATH: `${bin}:${process.env.PATH}`, TEST_PRS: JSON.stringify(prs), GITHUB_OUTPUT: output, GITHUB_REPOSITORY: "example/loadouts", GITHUB_SHA: "fixture"},
  });
  expect(result.exitCode, result.stderr.toString()).toBe(0);
  expect(readFileSync(output, "utf8").includes("missing=true")).toBe(pending as boolean);
});
