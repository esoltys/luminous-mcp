import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { LuminousDatabase } from "../db/connection.ts";
import {
  getListeningStats,
  getRecentHistory,
  type ListeningStatsParams,
  type RecentHistoryParams,
} from "../db/analytics.ts";
import { formatMcpResponse } from "../utils/response.ts";

/**
 * Registers listening analytics, history, and library insights tools on the MCP server.
 */
export function registerAnalyticsTools(server: McpServer, db: LuminousDatabase): void {
  server.tool(
    "get_listening_stats",
    "Analyze listening habits, play counts, skipping patterns, top artists, top tracks, and surface forgotten favorites (tracks with high play counts unplayed for N months).",
    {
      category: z
        .enum(["overview", "top_artists", "top_tracks", "forgotten_favorites", "frequently_skipped"])
        .default("overview")
        .optional()
        .describe(
          "Insight category to retrieve: 'overview' (composite summary), 'top_artists' (ranked by plays), 'top_tracks' (ranked by plays), 'forgotten_favorites' (frequently played but unplayed for N months), or 'frequently_skipped' (ranked by skip count or ratio)."
        ),
      limit: z
        .number()
        .int()
        .min(1)
        .max(100)
        .default(10)
        .optional()
        .describe("Maximum results to return (default 10, max 100)"),
      year_min: z
        .number()
        .int()
        .optional()
        .describe("Filter tracks by minimum release year (inclusive, e.g. 1990)"),
      year_max: z
        .number()
        .int()
        .optional()
        .describe("Filter tracks by maximum release year (inclusive, e.g. 1999)"),
      genre: z
        .string()
        .optional()
        .describe("Filter tracks by genre substring (e.g. 'Electronic', 'Jazz')"),
      artist: z
        .string()
        .optional()
        .describe("Filter tracks by artist name substring"),
      unplayed_months: z
        .number()
        .min(1)
        .default(6)
        .optional()
        .describe("For forgotten_favorites: minimum months since last played (default 6)"),
      min_play_count: z
        .number()
        .int()
        .min(1)
        .default(5)
        .optional()
        .describe("For forgotten_favorites: minimum total play count threshold (default 5)"),
      skip_metric: z
        .enum(["skip_count", "skip_ratio"])
        .default("skip_count")
        .optional()
        .describe(
          "For frequently_skipped: rank by absolute 'skip_count' or proportional 'skip_ratio' (skips / (plays + skips))"
        ),
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
        const statsParams: ListeningStatsParams = {
          category: params.category,
          limit: params.limit,
          year_min: params.year_min,
          year_max: params.year_max,
          genre: params.genre,
          artist: params.artist,
          unplayed_months: params.unplayed_months,
          min_play_count: params.min_play_count,
          skip_metric: params.skip_metric,
        };

        const result = getListeningStats(handle, statsParams);

        return formatMcpResponse(result);
      } catch (err: any) {
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: `Failed to retrieve listening stats: ${err.message ?? String(err)}`,
            },
          ],
        };
      }
    }
  );

  server.tool(
    "get_recent_history",
    "Get chronological playback history of previously played / past songs from Luminous play_history table, including played timestamp, playback duration, and playback context (standalone song, album, or playlist name). NOTE: Use get_playback_state instead if the user is asking what is currently playing.",
    {
      limit: z
        .number()
        .int()
        .min(1)
        .max(100)
        .default(25)
        .optional()
        .describe("Maximum history entries to return (default 25, max 100)"),
      offset: z
        .number()
        .int()
        .min(0)
        .default(0)
        .optional()
        .describe("Number of history entries to skip for pagination (default 0)"),
      since: z
        .string()
        .optional()
        .describe(
          "Filter plays on or after this timestamp (ISO 8601 string like '2026-09-10T18:00:00Z' or unix epoch seconds)"
        ),
      until: z
        .string()
        .optional()
        .describe(
          "Filter plays on or before this timestamp (ISO 8601 string or unix epoch seconds)"
        ),
      context_type: z
        .string()
        .optional()
        .describe("Filter by playback context type ('song', 'album', 'playlist')"),
      playlist_id: z
        .number()
        .int()
        .optional()
        .describe("Filter plays originating from a specific playlist ID"),
      artist: z
        .string()
        .optional()
        .describe("Filter history entries by artist name substring"),
      track_id: z
        .number()
        .int()
        .optional()
        .describe("Filter history entries for a specific track ID"),
      order: z
        .enum(["desc", "asc"])
        .default("desc")
        .optional()
        .describe("Order of history results: 'desc' (most recent first, default) or 'asc' (chronological)"),
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
        const historyParams: RecentHistoryParams = {
          limit: params.limit,
          offset: params.offset,
          since: params.since,
          until: params.until,
          context_type: params.context_type,
          playlist_id: params.playlist_id,
          artist: params.artist,
          track_id: params.track_id,
          order: params.order,
        };

        const result = getRecentHistory(handle, historyParams);

        return formatMcpResponse(result);
      } catch (err: any) {
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: `Failed to retrieve recent history: ${err.message ?? String(err)}`,
            },
          ],
        };
      }
    }
  );
}
