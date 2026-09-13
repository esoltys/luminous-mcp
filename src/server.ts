import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { LuminousBridgeClient } from "./bridge/client.ts";
import { SERVER_NAME, SERVER_VERSION } from "./constants.ts";
import { LuminousDatabase } from "./db/connection.ts";
import { resolveDbPath } from "./db/paths.ts";
import { registerAnalyticsTools } from "./tools/analytics.ts";
import { registerCurationTools } from "./tools/curation.ts";
import { registerLibraryTools } from "./tools/library.ts";
import { registerPlaybackTools } from "./tools/playback.ts";
import { registerPlaylistTools } from "./tools/playlists.ts";
import { registerSystemTools } from "./tools/system.ts";

export interface ServerOptions {
  dbPath?: string;
  readonly?: boolean;
  bridgeUrl?: string;
  bridgePort?: number;
  bridgeClient?: LuminousBridgeClient;
}

export interface ServerContext {
  server: McpServer;
  db: LuminousDatabase;
  bridge: LuminousBridgeClient;
}

/**
 * Creates and initializes the Luminous MCP server, database context, and desktop bridge.
 */
export function createMcpServer(options: ServerOptions = {}): ServerContext {
  const dbPath = resolveDbPath({ customPath: options.dbPath });
  const db = new LuminousDatabase(dbPath, { readonly: options.readonly });
  const bridge =
    options.bridgeClient ??
    new LuminousBridgeClient({
      baseUrl: options.bridgeUrl,
      port: options.bridgePort,
    });

  const server = new McpServer({
    name: SERVER_NAME,
    version: SERVER_VERSION,
  });

  registerSystemTools(server, db);
  registerLibraryTools(server, db);
  registerAnalyticsTools(server, db);
  registerPlaylistTools(server, db, bridge);
  registerCurationTools(server, db, bridge);
  registerPlaybackTools(server, bridge, db);

  return { server, db, bridge };
}
