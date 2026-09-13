import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { LuminousBridgeClient } from "../bridge/client.ts";
import type { PlaybackControlAction, PlaybackState } from "../bridge/types.ts";
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

  interface ActivePauseWatcher {
    trackId: number;
    title: string;
    artist?: string;
    scheduledAt: number;
    duration: number;
    abortController: AbortController;
  }

  let activeWatcher: ActivePauseWatcher | null = null;

  const cancelWatcher = () => {
    if (activeWatcher) {
      activeWatcher.abortController.abort();
      activeWatcher = null;
      return true;
    }
    return false;
  };

  server.tool(
    "pause_after_track",
    "Pause playback in Luminous Music Player cleanly at the end of the currently playing track without cutting into the next track. Supports action='schedule' (default) to schedule a pause, 'cancel' to cancel a pending pause, or 'status' to check if a pause is currently scheduled.",
    {
      action: z
        .enum(["schedule", "cancel", "status"])
        .default("schedule")
        .optional()
        .describe("Action to perform: 'schedule' (default) to pause after current track, 'cancel' to cancel a pending pause, or 'status' to check if a pause is scheduled"),
    },
    async (params) => {
      const action = params.action ?? "schedule";

      if (action === "cancel") {
        const wasCancelled = cancelWatcher();
        return formatMcpResponse({
          success: true,
          action: "cancelled",
          message: wasCancelled
            ? "Cancelled scheduled pause after track."
            : "No pause was currently scheduled.",
        });
      }

      if (action === "status") {
        if (activeWatcher) {
          return formatMcpResponse({
            scheduled: true,
            track: {
              id: activeWatcher.trackId,
              title: activeWatcher.title,
              artist: activeWatcher.artist,
              duration_seconds: activeWatcher.duration,
            },
            scheduled_at: activeWatcher.scheduledAt,
          });
        }
        return formatMcpResponse({
          scheduled: false,
          message: "No pause is currently scheduled.",
        });
      }

      // action === "schedule"
      try {
        const state = await bridgeClient.getPlaybackState();
        if (state.status !== "playing" || !state.current_track) {
          return formatMcpResponse({
            success: false,
            message: `Playback is currently ${state.status}. Cannot schedule a pause when no track is actively playing.`,
          });
        }

        const trackId = state.current_track.id;
        const trackTitle = state.current_track.title;
        const artist = state.current_track.artist;
        const duration = state.duration_seconds || state.current_track.duration_seconds || 0;
        const remaining = Math.max(0, duration - state.position_seconds);

        // Cancel any previous watcher
        cancelWatcher();

        const abortController = new AbortController();
        const watcher: ActivePauseWatcher = {
          trackId,
          title: trackTitle,
          artist,
          scheduledAt: Date.now(),
          duration,
          abortController,
        };
        activeWatcher = watcher;

        // Background monitor loop
        (async () => {
          try {
            while (!abortController.signal.aborted) {
              let curState: PlaybackState;
              try {
                curState = await bridgeClient.getPlaybackState();
              } catch {
                break;
              }

              if (abortController.signal.aborted) break;

              // Player paused or stopped manually
              if (curState.status !== "playing") {
                break;
              }

              // Track transitioned to next track
              if (curState.current_track?.id !== trackId) {
                await bridgeClient.controlPlayback({ action: "pause" }).catch(() => {});
                await bridgeClient.controlPlayback({ action: "seek", position_seconds: 0 }).catch(() => {});
                break;
              }

              const curDuration = curState.duration_seconds || duration;
              const timeLeft = curDuration - curState.position_seconds;

              // Reached near end of track (within 0.25s)
              if (timeLeft <= 0.25) {
                await bridgeClient.controlPlayback({ action: "pause" }).catch(() => {});
                break;
              }

              const pollInterval = timeLeft <= 3 ? 100 : 1000;
              await new Promise((resolve) => {
                const timer = setTimeout(resolve, pollInterval);
                abortController.signal.addEventListener(
                  "abort",
                  () => {
                    clearTimeout(timer);
                    resolve(null);
                  },
                  { once: true }
                );
              });
            }
          } finally {
            if (activeWatcher === watcher) {
              activeWatcher = null;
            }
          }
        })();

        const mins = Math.floor(remaining / 60);
        const secs = Math.floor(remaining % 60);
        const timeStr = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;

        return formatMcpResponse({
          success: true,
          action: "scheduled",
          message: `Playback will pause automatically when "${trackTitle}" finishes (~${timeStr} remaining).`,
          track: {
            id: trackId,
            title: trackTitle,
            artist,
            duration_seconds: duration,
            remaining_seconds: Math.round(remaining),
          },
        });
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
