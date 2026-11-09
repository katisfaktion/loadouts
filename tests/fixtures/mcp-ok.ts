for await (const line of console) {
  if (!line.trim()) continue;
  const request = JSON.parse(line);
  if (process.argv[2]) await Bun.sleep(Number(process.argv[2]));
  if (request.method === "initialize") console.log(JSON.stringify({jsonrpc: "2.0", id: request.id, result: {protocolVersion: "2025-06-18", capabilities: {}, serverInfo: {name: "ok", version: "0"}}}));
}
