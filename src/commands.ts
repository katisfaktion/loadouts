import { object, tuple } from "@optique/core/constructs";
import { argument, command, constant, option, passThrough } from "@optique/core/primitives";
import { map, multiple } from "@optique/core/modifiers";
import { parseSync } from "@optique/core/parser";
import { choice, string } from "@optique/core/valueparser";
import { formatMessage, message, text } from "@optique/core/message";
import { CliError } from "./errors";

export interface ParsedCommand {
  name: string;
  positionals: string[];
  values: {catalog?: string; harness?: string; from?: string; summary?: string; yes?: boolean; json?: boolean; with?: string[]};
}

const valueOptions = new Set<string>();
function textOption(name: `--${string}`, metavar: string, description: string) {
  valueOptions.add(name);
  return option(name, string({metavar}), {description: message`${text(description)}`});
}
const catalog = map(multiple(textOption("--catalog", "REPO[@REF]", "Override the shared catalog.")), values => values.at(-1));
const harness = map(multiple(textOption("--harness", "HARNESSES", "Comma-separated harnesses: claude-code,codex.")), values => values.at(-1));
const json = map(multiple(option("--json", {description: message`Print machine-readable JSON.`})), values => values.length > 0);
const yes = map(multiple(option("--yes", {description: message`Apply the previewed changes.`})), values => values.length > 0);
const arg = (metavar: string) => argument(string({metavar}));
const none = constant([] as string[]);
const empty = constant({});
const groupMember = tuple([arg("LOADOUT/PATH"), arg("MEMBER")]);

export const commandParsers = {
  explore: object({positionals: none, values: empty}),
  validate: object({positionals: tuple([arg("FILE")]), values: empty}),
  inspect: object({positionals: none, values: object({json})}),
  setup: object({positionals: none, values: object({catalog, harness})}),
  init: object({positionals: none, values: object({harness})}),
  install: object({positionals: none, values: empty}),
  create: object({positionals: tuple([arg("NAME")]), values: object({from: map(multiple(textOption("--from", "SHARED-NAME", "Copy a shared loadout into the local catalog.")), values => values.at(-1))})}),
  publish: object({positionals: tuple([arg("NAME")]), values: object({summary: map(multiple(textOption("--summary", "TEXT", "Describe how this loadout was verified (required to publish).")), values => values.at(-1)), catalog, yes})}),
  status: object({positionals: none, values: object({json})}),
  remove: object({positionals: tuple([arg("LOADOUT")]), values: empty}),
  switch: object({positionals: tuple([arg("LOADOUT/PATH"), arg("ALTERNATIVE")]), values: empty}),
  enable: object({positionals: groupMember, values: empty}),
  disable: object({positionals: groupMember, values: empty}),
  harness: object({positionals: tuple([argument(choice(["add", "remove"], {metavar: "ACTION"})), arg("HARNESS")]), values: empty}),
  update: object({positionals: none, values: empty}),
  doctor: object({positionals: none, values: object({json})}),
  claude: object({positionals: passThrough({format: "greedy", description: message`Forward all arguments unchanged to Claude Code.`}), values: empty}),
  codex: object({positionals: passThrough({format: "greedy", description: message`Forward all arguments unchanged to Codex.`}), values: empty}),
  global: object({positionals: command("prune", constant(["prune"])), values: object({yes})}),
  list: object({positionals: none, values: object({catalog, json})}),
  show: object({positionals: tuple([arg("LOADOUT")]), values: object({catalog, json})}),
  help: object({positionals: multiple(arg("COMMAND"), {max: 1}), values: empty}),
  add: object({positionals: multiple(arg("LOADOUT"), {min: 1}), values: object({
    with: multiple(textOption("--with", "LOADOUT/PATH=CHOICE[,CHOICE]", "Select group members, including nested paths; repeat for other groups. An empty value clears an any_of group. All requests are validated together; select ancestors explicitly.")), catalog,
    yes: map(multiple(option("--yes", {description: message`Confirm source replacements without prompting.`})), values => values.length > 0),
  })}),
};

export function parseCommand(argv: string[]): ParsedCommand {
  const [name = "help", ...args] = argv;
  if (!Object.hasOwn(commandParsers, name)) throw new CliError(`unknown command "${name}"`, 2);
  // Wrapper arguments belong to the child, including its help flags and separators.
  if (name === "claude" || name === "codex") return {name, positionals: args, values: {}};
  // Preserve parseArgs' ambiguity check; explicit --option=-value remains valid.
  for (let i = 0; i < args.length && args[i] !== "--"; i++) {
    if (!valueOptions.has(args[i]!)) continue;
    const flag = args[i]!, value = args[++i];
    if (value && value.length > 1 && value.startsWith("-")) throw new CliError(`missing value for ${flag}`, 2, `use ${flag}=VALUE for a value starting with -, or run loadouts help ${name}`);
  }
  const result = parseSync(commandParsers[name as keyof typeof commandParsers], args);
  if (!result.success) throw new CliError(formatMessage(result.error), 2, `run loadouts help ${name}`);
  const {positionals, values} = result.value;
  return {name, positionals: [...positionals], values: {...values}} as ParsedCommand;
}
