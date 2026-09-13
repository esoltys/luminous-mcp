/**
 * Types and interfaces for Luminous desktop playback and transport control bridge.
 */

export type PlaybackStatus = "playing" | "paused" | "stopped";

export type ShuffleMode = "off" | "all";

export type RepeatMode = "off" | "all" | "one";

export interface PlaybackTrack {
  id: number;
  title: string;
  artist?: string;
  album?: string;
  duration_seconds?: number;
  path?: string;
}

export interface PlaybackState {
  status: PlaybackStatus;
  current_track?: PlaybackTrack | null;
  position_seconds: number;
  duration_seconds?: number;
  volume: number;
  shuffle: ShuffleMode;
  repeat: RepeatMode;
  queue_count?: number;
  queue_index?: number;
}

export type PlaybackControlAction =
  | "play"
  | "pause"
  | "play_pause"
  | "next"
  | "previous"
  | "seek"
  | "set_volume"
  | "set_shuffle"
  | "set_repeat";

export interface PlaybackControlParams {
  action: PlaybackControlAction;
  position_seconds?: number;
  volume?: number;
  shuffle?: "off" | "all" | boolean;
  repeat?: "off" | "all" | "one";
}

export interface PlayTracksParams {
  track_ids: number[];
  start_index?: number;
}

export interface BridgeEventNotification {
  event: "playlists-changed" | string;
  data?: Record<string, unknown>;
}

export interface BridgeClientOptions {
  baseUrl?: string;
  port?: number;
  timeoutMs?: number;
  fetchFn?: typeof fetch;
}
