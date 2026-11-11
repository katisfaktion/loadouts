import { object, or, tuple } from "@optique/core/constructs";
import { argument, command, constant, option, passThrough } from "@optique/core/primitives";
import { map, multiple } from "@optique/core/modifiers";
import { parseSync } from "@optique/core/parser";
import { choice, string } from "@optique/core/valueparser";
import { formatMessage, message, text } from "@optique/core/message";
import { guides } from "./guides";
import { CliError } from "./errors";

export interface ParsedCommand {
  name: string;
  positionals: string[];
  values: {catalog?: string; harness?: string; from?: string; summary?: string; yes?: boolean; json?: boolean; sources?: boolean; with?: string[]};
}

const valueOptions = new Set<string>();
function textOption(name: `--${string}`, metavar: string, description: string) {
  valueOptions.add(name);
  return option(name, string({metavar}), {description: message`${text(description)}`});
}
function catalogOption(metavar: string, description: string) {
  return map(multiple(textOption("--catalog", metavar, description)), values => values.at(-1));
}
const catalog = catalogOption("REPO[@REF]", "Use this catalog and optional ref for this command.");
const harness = map(multiple(textOption("--harness", "HARNESSES", "Choose claude-code, codex, or both separated by a comma.")), values => values.at(-1));
const json = map(multiple(option("--json", {description: message`Print machine-readable JSON.`})), values => values.length > 0);
function yesOption(description: string) {
  return map(multiple(option("--yes", {description: message`${text(description)}`})), values => values.length > 0);
}
const arg = (metavar: string) => argument(string({metavar}));
const none = constant([] as string[]);
const empty = constant({});
const groupMember = tuple([arg("LOADOUT/PATH"), arg("MEMBER")]);

export const globalParsers = {
  configure: object({positionals: command("configure", constant(["configure"])), values: object({catalog: catalogOption("REPO", "Set the default shared catalog."), harness})}),
  prune: object({positionals: command("prune", constant(["prune"])), values: object({yes: yesOption("Disable global tools marked for automatic cleanup.")})}),
};

export const commandParsers = {
  agents: object({positionals: multiple(argument(choice(Object.keys(guides), {metavar: "GUIDE"})), {max: 1}), values: empty}),
  validate: object({positionals: tuple([arg("FILE")]), values: empty}),
  inspect: object({positionals: none, values: object({json})}),
  init: object({positionals: none, values: object({harness})}),
  install: object({positionals: none, values: object({json})}),
  create: object({positionals: tuple([arg("NAME")]), values: object({from: map(multiple(textOption("--from", "SHARED-NAME", "Copy a shared loadout into the local catalog.")), values => values.at(-1))})}),
  publish: object({positionals: tuple([arg("NAME")]), values: object({summary: map(multiple(textOption("--summary", "TEXT", "Required. Describe how you verified the loadout.")), values => values.at(-1)), catalog: catalogOption("OWNER/REPO", "Send the contribution to this GitHub catalog."), yes: yesOption("Push a branch and open a pull request.")})}),
  status: object({positionals: none, values: object({json})}),
  remove: object({positionals: tuple([arg("LOADOUT")]), values: object({json})}),
  switch: object({positionals: tuple([arg("LOADOUT/PATH"), arg("ALTERNATIVE")]), values: object({json})}),
  enable: object({positionals: groupMember, values: object({json})}),
  disable: object({positionals: groupMember, values: object({json})}),
  harness: object({positionals: tuple([argument(choice(["add", "remove"], {metavar: "ACTION"})), arg("HARNESS")]), values: object({json})}),
  update: object({positionals: none, values: object({json})}),
  doctor: object({positionals: none, values: object({json})}),
  claude: object({positionals: passThrough({format: "greedy", description: message`Forward all arguments unchanged to Claude Code.`}), values: empty}),
  codex: object({positionals: passThrough({format: "greedy", description: message`Forward all arguments unchanged to Codex.`}), values: empty}),
  global: or(globalParsers.configure, globalParsers.prune),
  list: object({positionals: none, values: object({catalog, json, sources: option("--sources", {description: message`Show the source of each entry. Pass it to show or add.`})})}),
  show: object({positionals: tuple([arg("NAME-OR-SOURCE")]), values: object({catalog, json})}),
  help: object({
    positionals: or(
      command("global", map(multiple(argument(choice(Object.keys(globalParsers), {metavar: "ACTION"})), {max: 1}), action => ["global", ...action])),
      multiple(arg("COMMAND"), {max: 1}),
    ),
    values: empty,
  }),
  add: object({positionals: multiple(arg("LOADOUT"), {min: 1}), values: object({
    json, with: multiple(textOption("--with", "LOADOUT/PATH=CHOICE[,CHOICE]", "Select members by group path. Repeat for each group, including its parents. An empty value clears an any_of group.")), catalog,
    yes: yesOption("Confirm source replacements without prompting."),
  })}),
};

export function parseCommand(argv: string[]): ParsedCommand {
  const [name = "help", ...args] = argv;
  if (!Object.hasOwn(commandParsers, name)) throw new CliError(`unknown command "${name}"`, 2);
  // Wrapper arguments belong to the child, including its help flags and separators.
  if (name === "claude" || name === "codex") return {name, positionals: args, values: {}};
  const topic = name === "help" ? args[0] : name;
  const helpPage = topic && topic !== "help" && Object.hasOwn(commandParsers, topic) ? `loadouts help ${topic}` : "loadouts help";
  // Preserve parseArgs' ambiguity check; explicit --option=-value remains valid.
  for (let i = 0; i < args.length && args[i] !== "--"; i++) {
    if (!valueOptions.has(args[i]!)) continue;
    const flag = args[i]!, value = args[++i];
    if (value && value.length > 1 && value.startsWith("-")) throw new CliError(`missing value for ${flag}`, 2, `use ${flag}=VALUE for a value starting with -, or run ${helpPage}`);
  }
  const result = parseSync(commandParsers[name as keyof typeof commandParsers], args);
  if (!result.success) throw new CliError(formatMessage(result.error), 2, `run ${helpPage}`);
  const {positionals, values} = result.value;
  return {name, positionals: [...positionals], values: {...values}} as ParsedCommand;
}
