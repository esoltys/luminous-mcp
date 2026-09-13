import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SERVER_NAME, SERVER_VERSION } from "../constants.ts";
import type { LuminousDatabase } from "../db/connection.ts";
import { formatMcpResponse } from "../utils/response.ts";

/**
 * Registers core diagnostic and system tools on the MCP server instance.
 */
export function registerSystemTools(server: McpServer, db: LuminousDatabase): void {
  server.tool(
    "ping",
    "Check server connectivity, uptime, and basic health",
    {},
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

  server.tool(
    "get_server_info",
    "Get Luminous MCP server metadata, database resolution status, schema version, and library size",
    {},
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
