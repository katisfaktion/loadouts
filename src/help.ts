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

const theme: TerminalTheme = {
  optionName: (_term, {text}) => ({type: "style", style: {foreground: "cyan"}, children: [{type: "text", text}]}),
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
    const summary = action === "configure" ? "Set machine defaults and link each selected agent’s global instructions to LOADOUTS.md." : action === "prune" ? "Preview global tools to disable. Pass --yes to apply." : c.summary;
    const entries = page.sections.flatMap(section => section.entries);
    const forwarded = command === "claude" || command === "codex";
    const flags = entries.filter(entry => entry.term.type === "option");
    const arguments_ = entries.filter(entry => entry.term.type !== "option");
    if (!forwarded) flags.push(helpEntry);
    const text = formatDocPage(`loadouts ${command}`, {
      ...page,
      usage: [...page.usage ?? [], ...forwarded ? [] : [{type: "optional" as const, terms: [helpEntry.term]}]],
      sections: [...arguments_.length ? [{title: "Arguments", entries: arguments_}] : [], ...flags.length ? [{title: "Flags", entries: flags}] : []],
    }, {colors: colorsEnabled(), theme, termWidth: "auto", showChoices: true, maxWidth: process.stdout.columns || 100});
    return `${summary}\n\n${text}\nExamples:\n${examples.map(example => "  " + paint(example, "dim")).join("\n")}${command === "claude" || command === "codex" ? "\n\nThe read-only preflight checks the manifest, lock and installed artifacts, then forwards arguments and environment unchanged. Run loadouts install to repair missing setup. Ordinary launches and Codex Desktop use the same native project files without this check. Personal configuration still loads; Codex project configuration and hooks require native trust. Neither launcher installs, writes configuration, or changes CODEX_HOME." : ""}\n\nExit codes: 0 success; 1 check failed; 2 usage error; 3 environment missing.`;
  }
  const groups: [string, Tone, string[]][] = [
    ["Guidance", "green", ["agents", "help"]],
    ["Workflow", "blue", ["list", "show", "create", "install", "add", "switch", "enable", "disable", "remove", "update", "publish", "claude", "codex"]],
    ["Diagnostics", "yellow", ["inspect", "status", "validate", "doctor"]],
    ["Setup", "cyan", ["init", "harness", "global"]],
  ];
  const rows = groups.map(([heading, tone, names]) => {
    const commands = names.map(name => {
      const c = COMMANDS[name]!;
      return `  ${paint(name.padEnd(10), tone)}${paint((c.hint ?? "").padEnd(25), "dim")}${c.brief}`;
    });
    return [paint(heading + ":", tone), ...commands].join("\n");
  }).join("\n\n");
  return `${paint("loadouts", "magenta")} manages project agent setups. ${paint(`(${version})`, "dim")}\n\nUsage: loadouts <command> ${paint("[...flags]", "cyan")} [...args]\n\n${rows}\n\nFlags:\n  ${paint("-h, --help", "cyan")}                         Show usage, flags and examples.\n\nRead loadouts help <command> for syntax and examples. Use --json for structured inspection, catalog discovery and project selection or installation results.`;
}
