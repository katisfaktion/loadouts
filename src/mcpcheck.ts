import type { McpServer } from "./loadout";
import { findProject } from "./paths";

export async function checkMcp(s: McpServer, timeoutMs = 30000): Promise<{ok: true} | {ok: false; reason: string}> {
  const request = {jsonrpc: "2.0", id: 1, method: "initialize", params: {protocolVersion: "2025-06-18", capabilities: {}, clientInfo: {name: "loadouts", version: "0"}}};
  if (s.url) {
    try {
      const r = await fetch(s.url, {method: "POST", headers: {"Content-Type": "application/json", Accept: "application/json, text/event-stream"}, body: JSON.stringify(request), signal: AbortSignal.timeout(timeoutMs)});
      await r.body?.cancel();
      return r.status < 500 ? {ok: true} : {ok: false, reason: `HTTP ${r.status}`};
    } catch (e) { return {ok: false, reason: String(e)}; }
  }
  if (!s.command) return {ok: false, reason: "missing command or url"};
  let child: ReturnType<typeof Bun.spawn>;
  try { child = Bun.spawn([s.command, ...(s.args ?? [])], {cwd: findProject(process.cwd()) ?? process.cwd(), env: {...process.env, ...s.env}, stdin: new TextEncoder().encode(JSON.stringify(request) + "\n"), stdout: "pipe", stderr: "ignore"}); }
  catch (e) { return {ok: false, reason: String(e)}; }
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const response = async (): Promise<{ok: true} | {ok: false; reason: string}> => {
      let buffer = "";
      const decoder = new TextDecoder();
      for await (const chunk of child.stdout as ReadableStream<Uint8Array>) {
        buffer += decoder.decode(chunk, {stream: true});
        let newline: number;
        while ((newline = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
          try { const message = JSON.parse(line); if (message.id === request.id && message.result) return {ok: true}; } catch { /* Servers may emit non-JSON startup lines. */ }
        }
      }
      return {ok: false, reason: "server exited without an initialize response"};
    };
    return await Promise.race([response(), new Promise<{ok: false; reason: string}>(resolve => { timer = setTimeout(() => resolve({ok: false, reason: `initialize timeout after ${timeoutMs} ms`}), timeoutMs); })]);
  } catch (e) { return {ok: false, reason: String(e)}; }
  finally { clearTimeout(timer); child.kill("SIGKILL"); await child.exited; }
}
