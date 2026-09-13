import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { LuminousDatabase } from "../db/connection.ts";
import {
  addTracksToPlaylist,
  createPlaylist,
  getPlaylistTracks,
  listPlaylists,
} from "../db/playlists.ts";
import { formatMcpResponse } from "../utils/response.ts";

/**
 * Registers playlist management tools on the MCP server instance.
 */
export function registerPlaylistTools(server: McpServer, db: LuminousDatabase): void {
  server.tool(
    "list_playlists",
    "List all user playlists and dynamic/smart playlists in the Luminous music library, including item counts and creation timestamps.",
    {
      query: z
        .string()
        .optional()
        .describe("Optional search filter matching playlist name"),
      include_dynamic: z
        .boolean()
        .default(true)
        .optional()
        .describe("Whether to include dynamic/smart playlists (default true)"),
    },
    async (params) => {
      if (!db.exists()) {
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: `Luminous database file not found at: "${db.dbPath}". Ensure Luminous Music Player is installed and has run at least once.`,
            },
          ],
        };
      }

      try {
        const handle = db.getHandle();
        const results = listPlaylists(handle, {
          query: params.query,
          include_dynamic: params.include_dynamic,
        });

        return formatMcpResponse(results);
      } catch (err: any) {
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: `Failed to list playlists: ${err.message ?? String(err)}`,
            },
          ],
        };
      }
    }
  );

  server.tool(
    "get_playlist_tracks",
    "Get the ordered track listing for a specific playlist by ID or name, including track details and position indices.",
    {
      playlist_id: z
        .number()
        .int()
        .optional()
        .describe("Numeric ID of the playlist to inspect"),
      playlist_name: z
        .string()
        .optional()
        .describe("Name of the playlist to inspect (case-insensitive)"),
      limit: z
        .number()
        .int()
        .min(1)
        .max(1000)
        .default(100)
        .optional()
        .describe("Maximum tracks to return (default 100, max 1000)"),
      offset: z
        .number()
        .int()
        .min(0)
        .default(0)
        .optional()
        .describe("Number of tracks to skip for pagination (default 0)"),
    },
    async (params) => {
      if (!db.exists()) {
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: `Luminous database file not found at: "${db.dbPath}". Ensure Luminous Music Player is installed and has run at least once.`,
            },
          ],
        };
      }

      if (params.playlist_id === undefined && (!params.playlist_name || params.playlist_name.trim() === "")) {
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: "Either playlist_id or playlist_name must be provided.",
            },
          ],
        };
      }

      try {
        const handle = db.getHandle();
        const results = getPlaylistTracks(handle, {
          playlist_id: params.playlist_id,
          playlist_name: params.playlist_name,
          limit: params.limit,
          offset: params.offset,
        });

        return formatMcpResponse(results);
      } catch (err: any) {
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: `Failed to get playlist tracks: ${err.message ?? String(err)}`,
            },
          ],
        };
      }
    }
  );

  server.tool(
    "create_playlist",
    "Create a new playlist in Luminous with an optional initial list of track IDs.",
    {
      name: z
        .string()
        .min(1)
        .describe("Name for the new playlist (must not be empty or reserved like 'Queue')"),
      track_ids: z
        .array(z.number().int())
        .optional()
        .describe("Optional array of track IDs to add to the new playlist in order"),
    },
    async (params) => {
      if (!db.exists()) {
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: `Luminous database file not found at: "${db.dbPath}". Ensure Luminous Music Player is installed and has run at least once.`,
            },
          ],
        };
      }

      try {
        const handle = db.getHandle();
        const results = createPlaylist(handle, {
          name: params.name,
          track_ids: params.track_ids,
        });

        return formatMcpResponse(results);
      } catch (err: any) {
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: `Failed to create playlist: ${err.message ?? String(err)}`,
            },
          ],
        };
      }
    }
  );

  server.tool(
    "add_tracks_to_playlist",
    "Append track IDs to an existing playlist, maintaining position indexes and UUID generation.",
    {
      playlist_id: z
        .number()
        .int()
        .optional()
        .describe("Numeric ID of the target playlist"),
      playlist_name: z
        .string()
        .optional()
        .describe("Name of the target playlist (case-insensitive)"),
      track_ids: z
        .array(z.number().int())
        .min(1)
        .describe("Non-empty array of track IDs to append to the playlist"),
    },
    async (params) => {
      if (!db.exists()) {
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: `Luminous database file not found at: "${db.dbPath}". Ensure Luminous Music Player is installed and has run at least once.`,
            },
          ],
        };
      }

      if (params.playlist_id === undefined && (!params.playlist_name || params.playlist_name.trim() === "")) {
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: "Either playlist_id or playlist_name must be provided.",
            },
          ],
        };
      }

      try {
        const handle = db.getHandle();
        const results = addTracksToPlaylist(handle, {
          playlist_id: params.playlist_id,
          playlist_name: params.playlist_name,
          track_ids: params.track_ids,
        });

        return formatMcpResponse(results);
      } catch (err: any) {
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: `Failed to add tracks to playlist: ${err.message ?? String(err)}`,
            },
          ],
        };
      }
    }
  );
}
