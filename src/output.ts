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

export async function withProgress<T>(label: string, work: Promise<T>): Promise<T> {
  if (!process.stderr.isTTY) return work;
  const start = performance.now();
  let visible = false;
  const timer = setInterval(() => {
    const seconds = Math.round((performance.now() - start) / 1000);
    const line = `[${seconds}s] ${label}`.slice(0, Math.max(1, (process.stderr.columns || 80) - 1));
    process.stderr.write(`\r\x1b[2K${paint(line, "cyan", "stderr")}`);
    visible = true;
  }, 1000);
  try { return await work; }
  finally {
    clearInterval(timer);
    if (visible) process.stderr.write("\r\x1b[2K");
  }
}
