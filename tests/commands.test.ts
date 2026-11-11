import { expect, test } from "bun:test";
import { parseCommand } from "../src/commands";

test.each([
  ["agents", "explore"], ["validate", "draft.yml"], ["inspect", "--json"],
  ["global", "configure", "--catalog", "acme/catalog", "--harness", "codex"], ["init"], ["install"],
  ["create", "backend", "--from", "base"], ["publish", "base", "--summary", "Verified", "--yes"],
  ["status"], ["remove", "base"], ["switch", "base/runtime", "bun"],
  ["enable", "base/runtime", "bun"], ["disable", "base/runtime", "bun"],
  ["harness", "add", "codex"], ["harness", "remove", "claude-code"], ["update"],
  ["doctor", "--json"], ["global", "prune", "--yes"], ["list", "--catalog", "acme/catalog"],
  ["show", "base", "--json"], ["help", "install"], ["add", "base", "backend"],
])("parses %j", (...args) => { expect(parseCommand(args).name).toBe(args[0]); });

test.each([
  ["install", "extra"], ["agents", "explore", "extra"], ["global", "configure", "extra"], ["validate"],
  ["validate", "one", "two"], ["add"], ["switch", "base/runtime"], ["harness", "oops", "codex"],
  ["global", "oops"], ["doctor", "--unknown"], ["help", "add", "extra"], ["create", "base", "--from"],
])("rejects invalid arguments %j with usage error", (...args) => {
  try { parseCommand(args); throw new Error("accepted invalid arguments"); }
  catch (error) { expect((error as {code: number}).code).toBe(2); }
});

test("repeated choices, empty selection and options around names retain meaning", () => {
  expect(parseCommand(["add", "--with", "base/tools=", "base", "backend", "--with=backend/runtime=bun,go", "--catalog", "acme/catalog"]))
    .toMatchObject({name: "add", positionals: ["base", "backend"], values: {with: ["base/tools=", "backend/runtime=bun,go"], catalog: "acme/catalog"}});
  expect(parseCommand(["validate", "--", "--help"]).positionals).toEqual(["--help"]);
});

test.each(["claude", "codex"])("%s forwards all arguments unchanged", name => {
  const args = ["--help", "-h", "--unknown=value", "--", "two words", ""];
  expect(parseCommand([name, ...args])).toMatchObject({name, positionals: args});
});

test.each([
  ["global", "configure", "--catalog", "--unknown", "--harness", "codex"],
  ["init", "--harness", "--unknown"], ["create", "demo", "--from", "--unknown"],
  ["publish", "demo", "--summary", "--unknown"], ["add", "demo", "--with", "--unknown"],
  ["global", "configure", "--catalog", "--"],
])("option-looking tokens cannot become implicit string values: %j", (...args) => {
  expect(() => parseCommand(args)).toThrow();
});

test("explicit dash-prefixed values, repeated overrides and global option order retain compatibility", () => {
  expect(parseCommand(["global", "configure", "--catalog=--custom"]).values.catalog).toBe("--custom");
  expect(parseCommand(["publish", "demo", "--summary=-text"]).values.summary).toBe("-text");
  expect(parseCommand(["status", "--json", "--json"]).values.json).toBe(true);
  expect(parseCommand(["global", "configure", "--catalog", "first", "--catalog", "second"]).values.catalog).toBe("second");
  expect(parseCommand(["global", "--yes", "prune"])).toMatchObject({name: "global", positionals: ["prune"], values: {yes: true}});
});
