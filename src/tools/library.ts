import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { LuminousDatabase } from "../db/connection.ts";
import {
  getArtistSummary,
  getTrackDetails,
  searchLibrary,
  type SearchLibraryParams,
} from "../db/library.ts";
import { formatMcpResponse } from "../utils/response.ts";

/**
 * Registers music library inspection and search tools on the MCP server instance.
 */
export function registerLibraryTools(server: McpServer, db: LuminousDatabase): void {
  server.tool(
    "search_library",
    "Search music library tracks with full-text search (matching title, artist, album, composer, performer, genre, or lyrics) and structured filters (artist, album, genre, composer, release year, BPM tempo, EBU R128 LUFS loudness).",
    {
      query: z
        .string()
        .optional()
        .describe(
          "Text query matching track title, artist, album, composer, performer, genre, or lyrics"
        ),
      artist: z.string().optional().describe("Filter by artist or album artist name"),
      album: z.string().optional().describe("Filter by album name"),
      genre: z.string().optional().describe("Filter by genre name"),
      composer: z.string().optional().describe("Filter by composer name"),
      year_min: z.number().int().optional().describe("Minimum release year (inclusive)"),
      year_max: z.number().int().optional().describe("Maximum release year (inclusive)"),
      bpm_min: z.number().optional().describe("Minimum tempo in BPM (inclusive)"),
      bpm_max: z.number().optional().describe("Maximum tempo in BPM (inclusive)"),
      lufs_min: z
        .number()
        .optional()
        .describe("Minimum integrated loudness in LUFS (EBU R128, inclusive, e.g. -14.0)"),
      lufs_max: z
        .number()
        .optional()
        .describe("Maximum integrated loudness in LUFS (EBU R128, inclusive, e.g. -8.0)"),
      limit: z
        .number()
        .int()
        .min(1)
        .max(100)
        .default(25)
        .optional()
        .describe("Maximum results to return (default 25, max 100)"),
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
        const searchParams: SearchLibraryParams = {
          query: params.query,
          artist: params.artist,
          album: params.album,
          genre: params.genre,
          composer: params.composer,
          year_min: params.year_min,
          year_max: params.year_max,
          bpm_min: params.bpm_min,
          bpm_max: params.bpm_max,
          lufs_min: params.lufs_min,
          lufs_max: params.lufs_max,
          limit: params.limit,
        };

        const results = searchLibrary(handle, searchParams);

        return formatMcpResponse(results);
      } catch (err: any) {
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: `Failed to search library: ${err.message ?? String(err)}`,
            },
          ],
        };
      }
    }
  );

  server.tool(
    "get_track_details",
    "Get comprehensive metadata, technical audio specs, acoustic measurements, lyrics, MusicBrainz IDs, and playback statistics for a single track.",
    {
      track_id: z
        .number()
        .int()
        .describe("The unique ID of the track in the Luminous database"),
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
        const details = getTrackDetails(handle, params.track_id);

        if (!details) {
          return {
            isError: true,
            content: [
              {
                type: "text" as const,
                text: `Track with ID ${params.track_id} was not found in the Luminous library.`,
              },
            ],
          };
        }

        return formatMcpResponse(details);
      } catch (err: any) {
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: `Failed to retrieve track details: ${err.message ?? String(err)}`,
            },
          ],
        };
      }
    }
  );

  server.tool(
    "get_artist_summary",
    "Get a comprehensive summary of an artist in the local library, including total tracks, albums, genres, collaborators, composers, performers/producers, and listening statistics.",
    {
      artist: z.string().describe("Artist name to look up in the library"),
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
        const summary = getArtistSummary(handle, params.artist);

        return formatMcpResponse(summary);
      } catch (err: any) {
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: `Failed to retrieve artist summary: ${err.message ?? String(err)}`,
            },
          ],
        };
      }
    }
  );
}
