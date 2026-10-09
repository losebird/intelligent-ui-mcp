import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createIntelligentUiServer } from "./server.js";
import { defaultHostTokenPath, ensureHostToken } from "./hostAuth.js";

async function main() {
  const hostToken = ensureHostToken();
  const { server, sessions } = createIntelligentUiServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(
    `[intelligent-ui-mcp] stdio ready; sessionDir=${sessions.events.dir}; hostToken=${hostToken.slice(0, 8)}… file=${defaultHostTokenPath()}`,
  );
}

main().catch((err) => {
  console.error("[intelligent-ui-mcp] fatal", err);
  process.exit(1);
});
