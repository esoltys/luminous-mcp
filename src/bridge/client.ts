import {
  DEFAULT_BRIDGE_HOST,
  DEFAULT_BRIDGE_PORT,
  DEFAULT_BRIDGE_URL,
} from "../constants.ts";
import type {
  BridgeClientOptions,
  PlaybackControlParams,
  PlaybackState,
  PlayTracksParams,
} from "./types.ts";

export class LuminousBridgeError extends Error {
  public readonly isConnectionError: boolean;

  constructor(message: string, isConnectionError = false) {
    super(message);
    this.name = "LuminousBridgeError";
    this.isConnectionError = isConnectionError;
  }
}

/**
 * HTTP loopback client for communicating with an active Luminous Music Player desktop instance.
 */
export class LuminousBridgeClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchFn: typeof fetch;

  constructor(options: BridgeClientOptions = {}) {
    if (options.baseUrl && options.baseUrl.trim() !== "") {
      this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    } else if (process.env.LUMINOUS_BRIDGE_URL && process.env.LUMINOUS_BRIDGE_URL.trim() !== "") {
      this.baseUrl = process.env.LUMINOUS_BRIDGE_URL.trim().replace(/\/+$/, "");
    } else {
      const port =
        options.port ??
        (process.env.LUMINOUS_BRIDGE_PORT
          ? Number.parseInt(process.env.LUMINOUS_BRIDGE_PORT, 10)
          : DEFAULT_BRIDGE_PORT);
      this.baseUrl = `http://${DEFAULT_BRIDGE_HOST}:${Number.isNaN(port) ? DEFAULT_BRIDGE_PORT : port}`;
    }

    this.timeoutMs = options.timeoutMs ?? 1500;
    this.fetchFn = options.fetchFn ?? globalThis.fetch;
  }

  public getBaseUrl(): string {
    return this.baseUrl;
  }

  /**
   * Helper to perform fetch with timeout.
   */
  private async request<T = unknown>(
    endpoint: string,
    init: RequestInit = {},
    customTimeoutMs?: number
  ): Promise<T> {
    const url = `${this.baseUrl}${endpoint.startsWith("/") ? endpoint : `/${endpoint}`}`;
    const controller = new AbortController();
    const timeout = customTimeoutMs ?? this.timeoutMs;
    const timer = setTimeout(() => controller.abort(), timeout);

    try {
      const res = await this.fetchFn(url, {
        ...init,
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          ...(init.headers ?? {}),
        },
      });

      clearTimeout(timer);

      if (!res.ok) {
        let errMsg = `Bridge request failed with status ${res.status}`;
        try {
          const body = (await res.json()) as any;
          if (body && (body.error || body.message)) {
            errMsg = body.error || body.message;
          }
        } catch {
          // ignore non-json error responses
        }
        throw new LuminousBridgeError(errMsg, false);
      }

      return (await res.json()) as T;
    } catch (err: any) {
      clearTimeout(timer);
      if (err instanceof LuminousBridgeError) {
        throw err;
      }
      const isConn =
        err.name === "AbortError" ||
        err.code === "ECONNREFUSED" ||
        err.code === "ENOTFOUND" ||
        err.message?.includes("fetch failed") ||
        err.message?.includes("connect ECONNREFUSED") ||
        err.message?.includes("Unable to connect") ||
        err.message?.includes("Failed to connect") ||
        err.message?.includes("connection refused");

      if (isConn) {
        throw new LuminousBridgeError(
          `Luminous Music Player desktop application is not currently running or the bridge is unreachable at ${this.baseUrl}. Please ensure Luminous is open to control playback.`,
          true
        );
      }
      throw new LuminousBridgeError(`Bridge error: ${err.message ?? String(err)}`, false);
    }
  }

  /**
   * Checks whether Luminous desktop bridge is reachable.
   */
  public async isLuminousRunning(): Promise<boolean> {
    try {
      await this.request("/health", { method: "GET" }, 500);
      return true;
    } catch {
      // Fall back to trying /playback
      try {
        await this.request("/playback", { method: "GET" }, 500);
        return true;
      } catch {
        return false;
      }
    }
  }

  /**
   * Retrieves the current live playback state from Luminous desktop.
   */
  public async getPlaybackState(): Promise<PlaybackState> {
    return this.request<PlaybackState>("/playback", { method: "GET" });
  }

  /**
   * Dispatches a transport control action (play, pause, next, seek, volume, etc.).
   */
  public async controlPlayback(
    params: PlaybackControlParams
  ): Promise<{ success: boolean; state?: PlaybackState; message?: string }> {
    return this.request<{ success: boolean; state?: PlaybackState; message?: string }>(
      "/playback/control",
      {
        method: "POST",
        body: JSON.stringify(params),
      }
    );
  }

  /**
   * Replaces the active queue with track IDs and starts playback.
   */
  public async playTracks(
    params: PlayTracksParams
  ): Promise<{ success: boolean; state?: PlaybackState; message?: string }> {
    return this.request<{ success: boolean; state?: PlaybackState; message?: string }>(
      "/playback/play",
      {
        method: "POST",
        body: JSON.stringify({
          track_ids: params.track_ids,
          start_index: params.start_index ?? 0,
        }),
      }
    );
  }

  /**
   * Emits a real-time event notification to the running Luminous desktop instance (e.g. "playlists-changed").
   * Non-blocking and swallows connection errors so database writes never fail when desktop is closed.
   */
  public async notifyEvent(
    event: "playlists-changed" | string,
    data?: Record<string, unknown>
  ): Promise<boolean> {
    try {
      await this.request(
        "/events/notify",
        {
          method: "POST",
          body: JSON.stringify({ event, data }),
        },
        500
      );
      return true;
    } catch {
      // Intentionally non-blocking and silent on failure
      return false;
    }
  }
}
