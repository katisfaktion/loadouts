export type Tone = "magenta" | "blue" | "cyan" | "green" | "yellow" | "red" | "dim";
const codes: Record<Tone, number> = {magenta: 35, blue: 34, cyan: 36, green: 32, yellow: 33, red: 31, dim: 2};

export function colorsEnabled(stream: "stdout" | "stderr" = "stdout"): boolean {
  const {NO_COLOR, NODE_DISABLE_COLORS, FORCE_COLOR} = process.env;
  if (NO_COLOR || NODE_DISABLE_COLORS || FORCE_COLOR === "0") return false;
  return !!FORCE_COLOR || !!process[stream].isTTY;
}

export function paint(text: string, tone: Tone, stream: "stdout" | "stderr" = "stdout"): string {
  return colorsEnabled(stream) ? `\x1b[${codes[tone]}m${text}\x1b[0m` : text;
}
