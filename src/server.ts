import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SERVER_NAME, SERVER_VERSION } from "./constants.ts";
import { LuminousDatabase } from "./db/connection.ts";
import { resolveDbPath } from "./db/paths.ts";
import { registerLibraryTools } from "./tools/library.ts";
import { registerSystemTools } from "./tools/system.ts";

export interface ServerOptions {
  dbPath?: string;
}

export interface ServerContext {
  server: McpServer;
  db: LuminousDatabase;
}

/**
 * Creates and initializes the Luminous MCP server and database context.
 */
export function createMcpServer(options: ServerOptions = {}): ServerContext {
  const dbPath = resolveDbPath({ customPath: options.dbPath });
  const db = new LuminousDatabase(dbPath);

  const server = new McpServer({
    name: SERVER_NAME,
    version: SERVER_VERSION,
  });

  registerSystemTools(server, db);
  registerLibraryTools(server, db);

  return { server, db };
}
