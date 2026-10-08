import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createIntelligentUiServer } from "./server.js";

async function main() {
  const { server, sessions } = createIntelligentUiServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(
    `[intelligent-ui-mcp] stdio ready; sessionDir=${sessions.events.dir}`,
  );
}

main().catch((err) => {
  console.error("[intelligent-ui-mcp] fatal", err);
  process.exit(1);
});
