import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { LuminousBridgeClient } from "../bridge/client.ts";
import type { PlaybackControlAction } from "../bridge/types.ts";
import type { LuminousDatabase } from "../db/connection.ts";
import { formatMcpResponse } from "../utils/response.ts";

/**
 * Registers live playback control and transport bridge tools on the MCP server instance.
 */
export function registerPlaybackTools(
  server: McpServer,
  bridgeClient: LuminousBridgeClient,
  _db?: LuminousDatabase
): void {
  server.tool(
    "get_playback_state",
    "Get the live playback state from the active Luminous Music Player desktop instance, including currently playing track, status (playing/paused/stopped), position, duration, volume, and shuffle/repeat modes.",
    {},
    async () => {
      try {
        const state = await bridgeClient.getPlaybackState();
        return formatMcpResponse(state);
      } catch (err: any) {
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: err.message ?? String(err),
            },
          ],
        };
      }
    }
  );

  server.tool(
    "control_playback",
    "Control live audio playback and transport in the active Luminous Music Player desktop instance (play, pause, play_pause, next, previous, seek, set_volume, set_shuffle, set_repeat).",
    {
      action: z
        .enum([
          "play",
          "pause",
          "play_pause",
          "next",
          "previous",
          "seek",
          "set_volume",
          "set_shuffle",
          "set_repeat",
        ])
        .describe("Transport action to execute"),
      position_seconds: z
        .number()
        .min(0)
        .optional()
        .describe("Playback position in seconds to seek to (required for action='seek')"),
      volume: z
        .number()
        .min(0)
        .max(100)
        .optional()
        .describe("Target audio volume: 0.0 to 1.0 (float) or 0 to 100 (percentage) (required for action='set_volume')"),
      shuffle: z
        .union([z.enum(["off", "all"]), z.boolean()])
        .optional()
        .describe("Shuffle mode ('off', 'all', or boolean) (for action='set_shuffle')"),
      repeat: z
        .enum(["off", "all", "one"])
        .optional()
        .describe("Repeat mode ('off', 'all', 'one') (for action='set_repeat')"),
    },
    async (params) => {
      const action = params.action as PlaybackControlAction;

      // Validation for parameter-specific actions
      if (action === "seek" && params.position_seconds === undefined) {
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: "Parameter 'position_seconds' is required when action is 'seek'.",
            },
          ],
        };
      }

      if (action === "set_volume" && params.volume === undefined) {
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: "Parameter 'volume' is required when action is 'set_volume'.",
            },
          ],
        };
      }

      if (action === "set_shuffle" && params.shuffle === undefined) {
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: "Parameter 'shuffle' is required when action is 'set_shuffle'.",
            },
          ],
        };
      }

      if (action === "set_repeat" && params.repeat === undefined) {
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: "Parameter 'repeat' is required when action is 'set_repeat'.",
            },
          ],
        };
      }

      // Normalize volume to 0.0 - 1.0 scale if passed as 1-100 percentage
      let normalizedVolume = params.volume;
      if (normalizedVolume !== undefined && normalizedVolume > 1.0) {
        normalizedVolume = Math.min(1.0, Math.max(0.0, normalizedVolume / 100));
      }

      // Normalize shuffle mode
      let normalizedShuffle: "off" | "all" | undefined;
      if (typeof params.shuffle === "boolean") {
        normalizedShuffle = params.shuffle ? "all" : "off";
      } else if (params.shuffle !== undefined) {
        normalizedShuffle = params.shuffle;
      }

      try {
        const result = await bridgeClient.controlPlayback({
          action,
          position_seconds: params.position_seconds,
          volume: normalizedVolume,
          shuffle: normalizedShuffle,
          repeat: params.repeat,
        });

        return formatMcpResponse(result);
      } catch (err: any) {
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: err.message ?? String(err),
            },
          ],
        };
      }
    }
  );

  server.tool(
    "play_tracks",
    "Replace the active Luminous playback queue with an array of track IDs and immediately begin playback.",
    {
      track_ids: z
        .array(z.number().int())
        .min(1)
        .describe("Ordered array of track IDs to load into the playback queue and play"),
      start_index: z
        .number()
        .int()
        .min(0)
        .default(0)
        .optional()
        .describe("Zero-based index of the track in track_ids to begin playing (default 0)"),
    },
    async (params) => {
      try {
        const result = await bridgeClient.playTracks({
          track_ids: params.track_ids,
          start_index: params.start_index ?? 0,
        });

        return formatMcpResponse(result);
      } catch (err: any) {
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: err.message ?? String(err),
            },
          ],
        };
      }
    }
  );
}
