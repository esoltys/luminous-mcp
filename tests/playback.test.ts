import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { LuminousBridgeClient, LuminousBridgeError } from "../src/bridge/client.ts";
import type { PlaybackState } from "../src/bridge/types.ts";
import { KNOWN_SCHEMA_VERSION } from "../src/constants.ts";
import { createMcpServer } from "../src/server.ts";

function createTestDatabase(): { dbPath: string; dir: string } {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "luminous-mcp-playback-test-"));
  const dbPath = path.join(tmpDir, "luminous.db");
  const db = new Database(dbPath);

  db.run("PRAGMA journal_mode = WAL;");
  db.run("PRAGMA foreign_keys = ON;");
  db.run("CREATE TABLE schema_version (version INTEGER PRIMARY KEY);");
  db.run(`INSERT INTO schema_version (version) VALUES (${KNOWN_SCHEMA_VERSION});`);

  db.run(`
    CREATE TABLE songs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      artist TEXT NOT NULL,
      album TEXT,
      album_artist TEXT,
      year INTEGER,
      genre TEXT,
      length_nanosec INTEGER,
      path TEXT,
      playcount INTEGER NOT NULL DEFAULT 0,
      skipcount INTEGER NOT NULL DEFAULT 0,
      unavailable BOOLEAN NOT NULL DEFAULT 0
    );
  `);

  db.run(`
    CREATE TABLE playlists (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      dynamic_enabled BOOLEAN NOT NULL DEFAULT 0,
      dynamic_spec TEXT,
      last_played_row INTEGER,
      created INTEGER DEFAULT (strftime('%s', 'now')),
      updated INTEGER
    );
  `);

  db.run(`
    CREATE TABLE playlist_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      playlist_id INTEGER NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
      song_id INTEGER REFERENCES songs(id) ON DELETE SET NULL,
      position INTEGER NOT NULL,
      uuid TEXT NOT NULL,
      type INTEGER NOT NULL DEFAULT 0,
      url TEXT,
      stream_url TEXT,
      additional_metadata TEXT
    );
  `);

  db.run(`
    INSERT INTO songs (id, title, artist, album, length_nanosec) VALUES
      (1, 'Strobe', 'deadmau5', 'For Lack of a Better Name', 637000000000),
      (2, 'Ghosts n Stuff', 'deadmau5', 'For Lack of a Better Name', 328000000000),
      (3, 'I Remember', 'deadmau5 & Kaskade', 'Random Album Title', 593000000000);
  `);

  db.close();
  return { dbPath, dir: tmpDir };
}

describe("Luminous Desktop Playback & Transport Control Bridge", () => {
  let mockServer: any;
  let mockPort: number;
  let mockBaseUrl: string;
  let lastReceivedEvent: { event: string; data?: any } | null = null;
  let lastControlParams: any = null;
  let lastPlayTracksParams: any = null;

  const mockPlaybackState: PlaybackState = {
    status: "playing",
    current_track: {
      id: 42,
      title: "Strobe",
      artist: "deadmau5",
      album: "For Lack of a Better Name",
      duration_seconds: 637,
      path: "/music/deadmau5/strobe.flac",
    },
    position_seconds: 120.5,
    duration_seconds: 637,
    volume: 0.85,
    shuffle: "off",
    repeat: "all",
    queue_count: 10,
    queue_index: 2,
  };

  beforeAll(() => {
    // Start an in-process mock HTTP server using Bun.serve
    mockServer = Bun.serve({
      port: 0, // randomly assigned available port
      fetch(req) {
        const url = new URL(req.url);

        if (url.pathname === "/health") {
          return new Response(JSON.stringify({ status: "ok" }), {
            headers: { "Content-Type": "application/json" },
          });
        }

        if (url.pathname === "/playback" && req.method === "GET") {
          return new Response(JSON.stringify(mockPlaybackState), {
            headers: { "Content-Type": "application/json" },
          });
        }

        if (url.pathname === "/playback/control" && req.method === "POST") {
          return req.json().then((body: any) => {
            lastControlParams = body;
            return new Response(
              JSON.stringify({
                success: true,
                message: `Action ${body.action} executed successfully`,
                state: {
                  ...mockPlaybackState,
                  ...(body.action === "pause" ? { status: "paused" } : {}),
                  ...(body.action === "play" ? { status: "playing" } : {}),
                  ...(body.action === "set_volume" ? { volume: body.volume } : {}),
                  ...(body.action === "seek" ? { position_seconds: body.position_seconds } : {}),
                  ...(body.action === "set_shuffle" ? { shuffle: body.shuffle } : {}),
                  ...(body.action === "set_repeat" ? { repeat: body.repeat } : {}),
                },
              }),
              { headers: { "Content-Type": "application/json" } }
            );
          });
        }

        if (url.pathname === "/playback/play" && req.method === "POST") {
          return req.json().then((body: any) => {
            lastPlayTracksParams = body;
            return new Response(
              JSON.stringify({
                success: true,
                message: `Loaded ${body.track_ids.length} tracks into queue and started playback`,
                state: {
                  ...mockPlaybackState,
                  status: "playing",
                  queue_count: body.track_ids.length,
                  queue_index: body.start_index ?? 0,
                },
              }),
              { headers: { "Content-Type": "application/json" } }
            );
          });
        }

        if (url.pathname === "/events/notify" && req.method === "POST") {
          return req.json().then((body: any) => {
            lastReceivedEvent = body;
            return new Response(JSON.stringify({ success: true }), {
              headers: { "Content-Type": "application/json" },
            });
          });
        }

        return new Response(JSON.stringify({ error: "Not found" }), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        });
      },
    });

    mockPort = mockServer.port;
    mockBaseUrl = `http://127.0.0.1:${mockPort}`;
  });

  afterAll(() => {
    if (mockServer) {
      mockServer.stop();
    }
  });

  describe("LuminousBridgeClient", () => {
    test("resolves options, default ports, and environment overrides", () => {
      const defaultClient = new LuminousBridgeClient();
      expect(defaultClient.getBaseUrl()).toBe("http://127.0.0.1:21849");

      const portClient = new LuminousBridgeClient({ port: 9999 });
      expect(portClient.getBaseUrl()).toBe("http://127.0.0.1:9999");

      const customClient = new LuminousBridgeClient({ baseUrl: "http://localhost:8080/" });
      expect(customClient.getBaseUrl()).toBe("http://localhost:8080");
    });

    test("checks health and detects running Luminous desktop instance", async () => {
      const client = new LuminousBridgeClient({ baseUrl: mockBaseUrl });
      const isRunning = await client.isLuminousRunning();
      expect(isRunning).toBe(true);

      const offlineClient = new LuminousBridgeClient({ baseUrl: "http://127.0.0.1:59999" });
      const isOfflineRunning = await offlineClient.isLuminousRunning();
      expect(isOfflineRunning).toBe(false);
    });

    test("fetches live playback state", async () => {
      const client = new LuminousBridgeClient({ baseUrl: mockBaseUrl });
      const state = await client.getPlaybackState();
      expect(state.status).toBe("playing");
      expect(state.current_track?.title).toBe("Strobe");
      expect(state.current_track?.artist).toBe("deadmau5");
      expect(state.volume).toBe(0.85);
      expect(state.shuffle).toBe("off");
      expect(state.repeat).toBe("all");
    });

    test("sends control actions to bridge", async () => {
      const client = new LuminousBridgeClient({ baseUrl: mockBaseUrl });
      const res = await client.controlPlayback({
        action: "seek",
        position_seconds: 45.0,
      });

      expect(res.success).toBe(true);
      expect(lastControlParams.action).toBe("seek");
      expect(lastControlParams.position_seconds).toBe(45.0);
    });

    test("replaces queue and starts playback with playTracks", async () => {
      const client = new LuminousBridgeClient({ baseUrl: mockBaseUrl });
      const res = await client.playTracks({
        track_ids: [101, 102, 103],
        start_index: 1,
      });

      expect(res.success).toBe(true);
      expect(lastPlayTracksParams.track_ids).toEqual([101, 102, 103]);
      expect(lastPlayTracksParams.start_index).toBe(1);
    });

    test("emits real-time event notifications", async () => {
      const client = new LuminousBridgeClient({ baseUrl: mockBaseUrl });
      const ok = await client.notifyEvent("playlists-changed", { playlist_id: 5 });
      expect(ok).toBe(true);
      expect(lastReceivedEvent?.event).toBe("playlists-changed");
      expect(lastReceivedEvent?.data?.playlist_id).toBe(5);
    });

    test("swallows notification errors when desktop bridge is offline", async () => {
      const offlineClient = new LuminousBridgeClient({ baseUrl: "http://127.0.0.1:59999" });
      const ok = await offlineClient.notifyEvent("playlists-changed", { playlist_id: 12 });
      expect(ok).toBe(false);
    });

    test("throws descriptive connection error when bridge is unreachable for transport commands", async () => {
      const offlineClient = new LuminousBridgeClient({ baseUrl: "http://127.0.0.1:59999" });
      try {
        await offlineClient.getPlaybackState();
        expect.unreachable("should have thrown LuminousBridgeError");
      } catch (err: any) {
        expect(err).toBeInstanceOf(LuminousBridgeError);
        expect(err.isConnectionError).toBe(true);
        expect(err.message).toContain("Luminous Music Player desktop application is not currently running");
      }
    });
  });

  describe("MCP Playback Tools Integration", () => {
    let client: Client;
    let serverContext: ReturnType<typeof createMcpServer>;

    beforeAll(async () => {
      const testDb = createTestDatabase();
      const bridgeClient = new LuminousBridgeClient({ baseUrl: mockBaseUrl });

      serverContext = createMcpServer({
        dbPath: testDb.dbPath,
        bridgeClient,
      });

      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      await serverContext.server.connect(serverTransport);

      client = new Client({ name: "test-client", version: "1.0.0" });
      await client.connect(clientTransport);
    });

    afterAll(async () => {
      await client.close();
      await serverContext.server.close();
      serverContext.db.close();
    });

    test("registers get_playback_state, control_playback, play_tracks, and pause_after_track in MCP tools", async () => {
      const tools = await client.listTools();
      const names = tools.tools.map((t) => t.name);

      expect(names).toContain("get_playback_state");
      expect(names).toContain("control_playback");
      expect(names).toContain("play_tracks");
      expect(names).toContain("pause_after_track");
    });

    test("calls get_playback_state via MCP", async () => {
      const res = await client.callTool({
        name: "get_playback_state",
        arguments: {},
      });

      expect(res.isError).toBeFalsy();
      const content = res.content as Array<{ type: string; text: string }>;
      const parsed = JSON.parse(content[0].text);

      expect(parsed.status).toBe("playing");
      expect(parsed.current_track.title).toBe("Strobe");
      expect(parsed.current_track.artist).toBe("deadmau5");
      expect(parsed.volume).toBe(0.85);
    });

    test("calls control_playback with pause and resume", async () => {
      const res = await client.callTool({
        name: "control_playback",
        arguments: {
          action: "pause",
        },
      });

      expect(res.isError).toBeFalsy();
      const content = res.content as Array<{ type: string; text: string }>;
      const parsed = JSON.parse(content[0].text);
      expect(parsed.success).toBe(true);
      expect(lastControlParams.action).toBe("pause");
    });

    test("calls control_playback with volume percentage normalization", async () => {
      const res = await client.callTool({
        name: "control_playback",
        arguments: {
          action: "set_volume",
          volume: 75, // percentage 75% -> should normalize to 0.75
        },
      });

      expect(res.isError).toBeFalsy();
      expect(lastControlParams.action).toBe("set_volume");
      expect(lastControlParams.volume).toBe(0.75);
    });

    test("calls control_playback with shuffle boolean normalization", async () => {
      const res = await client.callTool({
        name: "control_playback",
        arguments: {
          action: "set_shuffle",
          shuffle: true, // boolean true -> should normalize to "all"
        },
      });

      expect(res.isError).toBeFalsy();
      expect(lastControlParams.action).toBe("set_shuffle");
      expect(lastControlParams.shuffle).toBe("all");
    });

    test("validates required action parameters", async () => {
      // Seek without position_seconds
      const seekRes = await client.callTool({
        name: "control_playback",
        arguments: {
          action: "seek",
        },
      });
      expect(seekRes.isError).toBe(true);
      const seekContent = seekRes.content as Array<{ type: string; text: string }>;
      expect(seekContent[0].text).toContain("position_seconds");

      // set_volume without volume
      const volRes = await client.callTool({
        name: "control_playback",
        arguments: {
          action: "set_volume",
        },
      });
      expect(volRes.isError).toBe(true);
      const volContent = volRes.content as Array<{ type: string; text: string }>;
      expect(volContent[0].text).toContain("volume");
    });

    test("calls play_tracks via MCP", async () => {
      const res = await client.callTool({
        name: "play_tracks",
        arguments: {
          track_ids: [1, 2, 3],
          start_index: 0,
        },
      });

      expect(res.isError).toBeFalsy();
      const content = res.content as Array<{ type: string; text: string }>;
      const parsed = JSON.parse(content[0].text);
      expect(parsed.success).toBe(true);
      expect(lastPlayTracksParams.track_ids).toEqual([1, 2, 3]);
    });

    test("calls pause_after_track with status when nothing is scheduled", async () => {
      const res = await client.callTool({
        name: "pause_after_track",
        arguments: { action: "status" },
      });

      expect(res.isError).toBeFalsy();
      const content = res.content as Array<{ type: string; text: string }>;
      const parsed = JSON.parse(content[0].text);
      expect(parsed.scheduled).toBe(false);
      expect(parsed.message).toContain("No pause is currently scheduled");
    });

    test("calls pause_after_track with schedule when playing and checks status then cancel", async () => {
      const res = await client.callTool({
        name: "pause_after_track",
        arguments: { action: "schedule" },
      });

      expect(res.isError).toBeFalsy();
      const content = res.content as Array<{ type: string; text: string }>;
      const parsed = JSON.parse(content[0].text);
      expect(parsed.success).toBe(true);
      expect(parsed.action).toBe("scheduled");
      expect(parsed.track.id).toBe(42);
      expect(parsed.track.title).toBe("Strobe");

      // Verify status reflects scheduled watcher
      const statusRes = await client.callTool({
        name: "pause_after_track",
        arguments: { action: "status" },
      });
      const statusParsed = JSON.parse((statusRes.content as any)[0].text);
      expect(statusParsed.scheduled).toBe(true);
      expect(statusParsed.track.id).toBe(42);

      // Cancel the scheduled pause
      const cancelRes = await client.callTool({
        name: "pause_after_track",
        arguments: { action: "cancel" },
      });
      const cancelParsed = JSON.parse((cancelRes.content as any)[0].text);
      expect(cancelParsed.success).toBe(true);
      expect(cancelParsed.action).toBe("cancelled");
      expect(cancelParsed.message).toContain("Cancelled scheduled pause");
    });

    test("calls pause_after_track with schedule when player is paused", async () => {
      mockPlaybackState.status = "paused";
      try {
        const res = await client.callTool({
          name: "pause_after_track",
          arguments: { action: "schedule" },
        });

        expect(res.isError).toBeFalsy();
        const content = res.content as Array<{ type: string; text: string }>;
        const parsed = JSON.parse(content[0].text);
        expect(parsed.success).toBe(false);
        expect(parsed.message).toContain("Playback is currently paused");
      } finally {
        mockPlaybackState.status = "playing";
      }
    });

    test("executes pause and seek(0) when track transition is detected by watcher", async () => {
      lastControlParams = null;
      // Start near end of track (less than 1s remaining)
      mockPlaybackState.position_seconds = 636.5;
      mockPlaybackState.duration_seconds = 637;

      const res = await client.callTool({
        name: "pause_after_track",
        arguments: { action: "schedule" },
      });
      expect(res.isError).toBeFalsy();

      // Simulate track transition to next track in mock server
      mockPlaybackState.current_track = {
        id: 43,
        title: "Ghosts n Stuff",
        artist: "deadmau5",
        duration_seconds: 328,
      };
      mockPlaybackState.position_seconds = 0.5;

      // Wait for the tight poller loop to detect the change and fire controlPlayback
      await new Promise((r) => setTimeout(r, 350));

      expect(lastControlParams).toBeDefined();
      expect(lastControlParams.action).toBe("seek");
      expect(lastControlParams.position_seconds).toBe(0);

      // Restore mockPlaybackState
      mockPlaybackState.current_track = {
        id: 42,
        title: "Strobe",
        artist: "deadmau5",
        album: "For Lack of a Better Name",
        duration_seconds: 637,
        path: "/music/deadmau5/strobe.flac",
      };
      mockPlaybackState.position_seconds = 120.5;
      mockPlaybackState.status = "playing";
    });

    test("returns descriptive error when desktop player is closed", async () => {
      const offlineBridge = new LuminousBridgeClient({ baseUrl: "http://127.0.0.1:59999" });
      const testDb = createTestDatabase();
      const offlineContext = createMcpServer({
        dbPath: testDb.dbPath,
        bridgeClient: offlineBridge,
      });

      const [cTrans, sTrans] = InMemoryTransport.createLinkedPair();
      await offlineContext.server.connect(sTrans);
      const offlineClient = new Client({ name: "offline-test", version: "1.0.0" });
      await offlineClient.connect(cTrans);

      const res = await offlineClient.callTool({
        name: "get_playback_state",
        arguments: {},
      });

      expect(res.isError).toBe(true);
      const content = res.content as Array<{ type: string; text: string }>;
      expect(content[0].text).toContain("Luminous Music Player desktop application is not currently running");

      await offlineClient.close();
      await offlineContext.server.close();
      offlineContext.db.close();
    });
  });

  describe("Real-Time UI State Sync on Playlist Mutations", () => {
    test("triggers playlists-changed notification on create_playlist and add_tracks_to_playlist", async () => {
      lastReceivedEvent = null;
      const testDb = createTestDatabase();
      const bridgeClient = new LuminousBridgeClient({ baseUrl: mockBaseUrl });

      const serverContext = createMcpServer({
        dbPath: testDb.dbPath,
        bridgeClient,
      });

      const [cTrans, sTrans] = InMemoryTransport.createLinkedPair();
      await serverContext.server.connect(sTrans);
      const client = new Client({ name: "playlist-sync-test", version: "1.0.0" });
      await client.connect(cTrans);

      // Create playlist
      const createRes = await client.callTool({
        name: "create_playlist",
        arguments: {
          name: "Bridge Notification Playlist",
          track_ids: [1, 2],
        },
      });
      expect(createRes.isError).toBeFalsy();
      const eventAfterCreate = lastReceivedEvent as { event: string; data?: any } | null;
      expect(eventAfterCreate?.event).toBe("playlists-changed");
      expect(eventAfterCreate?.data?.playlist_id).toBeDefined();

      const createdId = eventAfterCreate?.data?.playlist_id;

      // Add tracks to playlist
      lastReceivedEvent = null;
      const addRes = await client.callTool({
        name: "add_tracks_to_playlist",
        arguments: {
          playlist_id: createdId,
          track_ids: [3],
        },
      });
      expect(addRes.isError).toBeFalsy();
      const eventAfterAdd = lastReceivedEvent as { event: string; data?: any } | null;
      expect(eventAfterAdd?.event).toBe("playlists-changed");
      expect(eventAfterAdd?.data?.playlist_id).toBe(createdId);

      await client.close();
      await serverContext.server.close();
      serverContext.db.close();
    });

    test("playlist mutations succeed even if desktop player is offline", async () => {
      const testDb = createTestDatabase();
      const offlineBridge = new LuminousBridgeClient({ baseUrl: "http://127.0.0.1:59999" });

      const serverContext = createMcpServer({
        dbPath: testDb.dbPath,
        bridgeClient: offlineBridge,
      });

      const [cTrans, sTrans] = InMemoryTransport.createLinkedPair();
      await serverContext.server.connect(sTrans);
      const client = new Client({ name: "playlist-offline-test", version: "1.0.0" });
      await client.connect(cTrans);

      const createRes = await client.callTool({
        name: "create_playlist",
        arguments: {
          name: "Offline Playlist",
          track_ids: [1],
        },
      });
      expect(createRes.isError).toBeFalsy();

      await client.close();
      await serverContext.server.close();
      serverContext.db.close();
    });
  });
});
