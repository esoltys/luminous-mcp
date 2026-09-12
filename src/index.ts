#!/usr/bin/env bun
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SERVER_NAME, SERVER_VERSION } from "./constants.ts";
import { createMcpServer } from "./server.ts";

async function main() {
  const { server, db } = createMcpServer();
  const transport = new StdioServerTransport();

  const shutdown = async () => {
    console.error(`Shutting down ${SERVER_NAME}...`);
    try {
      db.close();
      await server.close();
    } catch {
      // Ignore cleanup errors during shutdown
    }
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  await server.connect(transport);

  const stats = db.getStats();
  console.error(`${SERVER_NAME} v${SERVER_VERSION} running on stdio`);
  console.error(`Database target: ${stats.dbPath} (exists: ${stats.exists})`);
  if (stats.exists) {
    console.error(`Schema version: ${stats.schemaVersion}, songs: ${stats.trackCount}`);
  } else {
    console.error(
      "Notice: Luminous database not found at default location. " +
      "Set LUMINOUS_DB_PATH if your database is stored in a custom path."
    );
  }
}

main().catch((error) => {
  console.error("Fatal error running server:", error);
  process.exit(1);
});