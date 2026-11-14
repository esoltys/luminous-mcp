import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SERVER_NAME, SERVER_VERSION } from "../constants.ts";
import type { LuminousDatabase } from "../db/connection.ts";
import { formatMcpResponse } from "../utils/response.ts";
import { READ_ONLY_LOCAL } from "./annotations.ts";

/**
 * Registers core diagnostic and system tools on the MCP server instance.
 */
export function registerSystemTools(server: McpServer, db: LuminousDatabase): void {
  server.registerTool(
    "ping",
    {
      title: "Ping Server",
      description: "Check server connectivity, uptime, and basic health",
      inputSchema: {},
      annotations: READ_ONLY_LOCAL,
    },
    async () => {
      const response = {
        status: "ok",
        timestamp: new Date().toISOString(),
        server: {
          name: SERVER_NAME,
          version: SERVER_VERSION,
        },
      };

      return formatMcpResponse(response);
    }
  );

  server.registerTool(
    "get_server_info",
    {
      title: "Get Server Info",
      description:
        "Get Luminous MCP server metadata, database resolution status, schema version, and library size",
      inputSchema: {},
      annotations: READ_ONLY_LOCAL,
    },
    async () => {
      const stats = db.getStats();
      const response = {
        server: {
          name: SERVER_NAME,
          version: SERVER_VERSION,
          runtime: `Bun ${typeof Bun !== "undefined" ? Bun.version : process.version}`,
        },
        platform: {
          os: process.platform,
          arch: process.arch,
        },
        database: {
          path: stats.dbPath,
          exists: stats.exists,
          isOpen: stats.isOpen,
          fileSizeBytes: stats.fileSizeBytes,
          schemaVersion: stats.schemaVersion,
          knownSchemaVersion: stats.knownSchemaVersion,
          isCompatible: stats.isCompatible,
          trackCount: stats.trackCount,
        },
      };

      return formatMcpResponse(response);
    }
  );
}
