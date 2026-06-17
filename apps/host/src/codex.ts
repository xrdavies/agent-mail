export function buildCodexMcpConfigArgs(mcpUrl: string): string[] {
  return [
    "-c",
    `mcp_servers.agent-mail-host.url="${mcpUrl}"`,
    "-c",
    "mcp_servers.nowledge-mem.enabled=false"
  ];
}
