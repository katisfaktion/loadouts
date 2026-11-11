import { COMMANDS } from "./cli";
import { CliError } from "./errors";
import { commandParsers, globalParsers } from "./commands";
import { colorsEnabled, paint, type Tone } from "./output";
import { getDocPageSync } from "@optique/core/parser";
import { formatDocPage } from "@optique/core/doc";
import { option } from "@optique/core/primitives";
import { message } from "@optique/core/message";
import type { TerminalTheme } from "@optique/core/terminal";
import { version } from "../package.json";

const guidanceColor = "green";
const theme: TerminalTheme = {
  optionName: (_term, {text}) => ({type: "style", style: {foreground: text === "-h" || text === "--help" ? guidanceColor : "cyan"}, children: [{type: "text", text}]}),
  metavar: (_term, {text}) => ({type: "style", style: {dim: true}, children: [{type: "text", text}]}),
  programName: (_term, {text}) => ({type: "text", text}),
  label: (_term, {text}) => ({type: "text", text}),
};
const helpOption = option("-h", "--help", {description: message`Show usage, flags and examples.`});
const helpEntry = getDocPageSync(helpOption)!.sections.flatMap(section => section.entries)[0]!;

export function helpText(command?: string, action?: string): string {
  if (command) {
    if (!Object.hasOwn(COMMANDS, command)) throw new CliError(`unknown command "${command}"`, 2);
    const c = COMMANDS[command]!;
    if (action && (command !== "global" || !Object.hasOwn(globalParsers, action))) throw new CliError(`unknown command "${command} ${action}"`, 2, "run loadouts help global");
    const parser = action ? globalParsers[action as keyof typeof globalParsers] : commandParsers[command as keyof typeof commandParsers];
    const page = getDocPageSync(parser, action ? [action] : [])!;
    const examples = action ? c.examples.filter(example => example.startsWith(`loadouts global ${action}`)) : c.examples;
    const summary = action === "configure" ? "Set the default catalog and harnesses. Add a LOADOUTS.md import to each selected agent's user instructions." : action === "prune" ? "Preview which tools you can disable across all projects. The output lists any tools that need manual cleanup." : c.summary;
    const entries = page.sections.flatMap(section => section.entries);
    const forwarded = command === "claude" || command === "codex";
    const flags = entries.filter(entry => entry.term.type === "option");
    const arguments_ = entries.filter(entry => entry.term.type !== "option" && (entry.description?.length || entry.choices?.length));
    if (!forwarded) flags.push(helpEntry);
    const text = formatDocPage(`loadouts ${command}`, {
      ...page,
      usage: [...page.usage ?? [], ...forwarded ? [] : [{type: "optional" as const, terms: [helpEntry.term]}]],
      sections: [...arguments_.length ? [{title: "Arguments", entries: arguments_}] : [], ...flags.length ? [{title: "Flags", entries: flags}] : []],
    }, {colors: colorsEnabled(), theme, termWidth: "auto", showChoices: true, maxWidth: process.stdout.columns || 100});
    return `${summary}\n\n${text}\n${examples.length === 1 ? "Example" : "Examples"}:\n${examples.map(example => "  " + paint(example, "dim")).join("\n")}\n\n${forwarded ? "After launch, loadouts returns the agent's exit code." : "Exit codes: 0 success, 1 check or operation failed, 2 usage error, 3 missing prerequisite."}`;
  }
  const groups: [string, Tone, string[]][] = [
    ["Guidance", guidanceColor, ["agents", "help"]],
    ["Workflow", "blue", ["list", "show", "create", "install", "add", "switch", "enable", "disable", "remove", "update", "publish", "claude", "codex"]],
    ["Diagnostics", "yellow", ["inspect", "status", "validate", "doctor"]],
    ["Setup", "magenta", ["init", "harness", "global"]],
  ];
  const rows = groups.map(([heading, tone, names]) => {
    const commands = names.map(name => {
      const c = COMMANDS[name]!;
      return `  ${paint(name.padEnd(10), tone)}${paint((c.hint ?? "").padEnd(25), "dim")}${c.brief}`;
    });
    return [paint(heading + ":", tone), ...commands].join("\n");
  }).join("\n\n");
  const program = paint("loadouts", "orange");
  const usage = `Usage: ${program} <command> ${paint("[...flags] [...args]", "dim")}`;
  return `${program} manages project agent setups. ${paint(`(${version})`, "dim")}\n\n${usage}\n\n${rows}\n\nFlags:\n  ${paint("-h, --help", guidanceColor)}                         Show usage, flags and examples.\n\nRead loadouts help <command> for syntax and examples. Use loadouts agents for workflow guides. Commands with --json can return structured output.`;
}
