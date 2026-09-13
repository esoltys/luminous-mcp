import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { KNOWN_SCHEMA_VERSION } from "../src/constants.ts";
import {
  addTracksToPlaylist,
  createPlaylist,
  getPlaylistTracks,
  isReservedPlaylistName,
  listPlaylists,
} from "../src/db/playlists.ts";
import { createMcpServer } from "../src/server.ts";

function setupFullTestDb(dbPath: string): Database {
  const db = new Database(dbPath);

  db.run("PRAGMA journal_mode = WAL;");
  db.run("PRAGMA foreign_keys = ON;");

  db.run(`
    CREATE TABLE schema_version (
      version INTEGER PRIMARY KEY
    );
  `);
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

  const insertSong = db.prepare(`
    INSERT INTO songs (
      id, title, artist, album, album_artist, year, genre,
      length_nanosec, path, playcount, skipcount, unavailable
    ) VALUES (
      $id, $title, $artist, $album, $album_artist, $year, $genre,
      $length_nanosec, $path, $playcount, $skipcount, $unavailable
    );
  `);

  const sampleSongs = [
    {
      $id: 1,
      $title: "Midnight City",
      $artist: "M83",
      $album: "Hurry Up, We're Dreaming",
      $album_artist: "M83",
      $year: 2011,
      $genre: "Electronic",
      $length_nanosec: 243_000_000_000,
      $path: "/music/m83/midnight_city.flac",
      $playcount: 45,
      $skipcount: 2,
      $unavailable: 0,
    },
    {
      $id: 2,
      $title: "Wait",
      $artist: "M83",
      $album: "Hurry Up, We're Dreaming",
      $album_artist: "M83",
      $year: 2011,
      $genre: "Electronic",
      $length_nanosec: 343_000_000_000,
      $path: "/music/m83/wait.flac",
      $playcount: 30,
      $skipcount: 1,
      $unavailable: 0,
    },
    {
      $id: 3,
      $title: "So What",
      $artist: "Miles Davis",
      $album: "Kind of Blue",
      $album_artist: "Miles Davis",
      $year: 1959,
      $genre: "Jazz",
      $length_nanosec: 562_000_000_000,
      $path: "/music/jazz/so_what.flac",
      $playcount: 18,
      $skipcount: 0,
      $unavailable: 0,
    },
    {
      $id: 4,
      $title: "Blue in Green",
      $artist: "Miles Davis",
      $album: "Kind of Blue",
      $album_artist: "Miles Davis",
      $year: 1959,
      $genre: "Jazz",
      $length_nanosec: 337_000_000_000,
      $path: "/music/jazz/blue_in_green.flac",
      $playcount: 12,
      $skipcount: 0,
      $unavailable: 0,
    },
    {
      $id: 5,
      $title: "Strobe",
      $artist: "deadmau5",
      $album: "For Lack of a Better Name",
      $album_artist: "deadmau5",
      $year: 2009,
      $genre: "Progressive House",
      $length_nanosec: 637_000_000_000,
      $path: "/music/deadmau5/strobe.flac",
      $playcount: 55,
      $skipcount: 3,
      $unavailable: 0,
    },
  ];

  for (const song of sampleSongs) {
    insertSong.run(song);
  }

  // Insert initial playlists
  db.run(`
    INSERT INTO playlists (id, name, dynamic_enabled, dynamic_spec, created, updated)
    VALUES (1, 'Chill Electronic', 0, NULL, 1700000000, 1700001000);
  `);
  db.run(`
    INSERT INTO playlists (id, name, dynamic_enabled, dynamic_spec, created, updated)
    VALUES (2, 'Top Rated Jazz', 1, 'genre:Jazz', 1700002000, 1700002000);
  `);

  // Insert items for playlist 1
  db.run(`
    INSERT INTO playlist_items (id, playlist_id, song_id, position, uuid, type)
    VALUES (1, 1, 1, 0, 'uuid-item-1', 0);
  `);
  db.run(`
    INSERT INTO playlist_items (id, playlist_id, song_id, position, uuid, type)
    VALUES (2, 1, 2, 1, 'uuid-item-2', 0);
  `);

  return db;
}

function getTextContent(result: any): { type: "text"; text: string } {
  if (!result || !Array.isArray(result.content) || result.content.length === 0) {
    throw new Error(`Expected text content in MCP result, got: ${JSON.stringify(result)}`);
  }
  return result.content[0];
}

describe("Playlist Database Layer", () => {
  let tempDir: string;
  let tempDbPath: string;
  let db: Database;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "luminous-playlist-test-"));
    tempDbPath = path.join(tempDir, "luminous.db");
    db = setupFullTestDb(tempDbPath);
  });

  afterEach(() => {
    try {
      db.close();
    } catch {}
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  describe("isReservedPlaylistName", () => {
    it("identifies reserved queue names in multiple languages case-insensitively", () => {
      expect(isReservedPlaylistName("Queue")).toBe(true);
      expect(isReservedPlaylistName("queue")).toBe(true);
      expect(isReservedPlaylistName("  QUEUE  ")).toBe(true);
      expect(isReservedPlaylistName("File d'attente")).toBe(true);
      expect(isReservedPlaylistName("file d'attente")).toBe(true);
      expect(isReservedPlaylistName("My Playlist")).toBe(false);
      expect(isReservedPlaylistName("Queue Favorites")).toBe(false);
    });
  });

  describe("listPlaylists", () => {
    it("returns all playlists with item counts and timestamps", () => {
      const lists = listPlaylists(db);
      expect(lists.length).toBe(2);

      const chill = lists.find((p) => p.name === "Chill Electronic");
      expect(chill).toBeDefined();
      expect(chill!.id).toBe(1);
      expect(chill!.is_dynamic).toBe(false);
      expect(chill!.track_count).toBe(2);
      expect(chill!.created_timestamp).toBe(1700000000);
      expect(chill!.created_at).toBeTruthy();
      expect(chill!.updated_timestamp).toBe(1700001000);

      const jazz = lists.find((p) => p.name === "Top Rated Jazz");
      expect(jazz).toBeDefined();
      expect(jazz!.id).toBe(2);
      expect(jazz!.is_dynamic).toBe(true);
      expect(jazz!.track_count).toBe(0);
    });

    it("filters by query string", () => {
      const results = listPlaylists(db, { query: "electronic" });
      expect(results.length).toBe(1);
      expect(results[0].name).toBe("Chill Electronic");
    });

    it("filters out dynamic playlists when include_dynamic is false", () => {
      const results = listPlaylists(db, { include_dynamic: false });
      expect(results.length).toBe(1);
      expect(results[0].name).toBe("Chill Electronic");
      expect(results[0].is_dynamic).toBe(false);
    });

    it("returns empty array if playlists table is missing", () => {
      const emptyDb = new Database(":memory:");
      const results = listPlaylists(emptyDb);
      expect(results).toEqual([]);
      emptyDb.close();
    });
  });

  describe("getPlaylistTracks", () => {
    it("retrieves ordered tracks by playlist_id", () => {
      const res = getPlaylistTracks(db, { playlist_id: 1 });
      expect(res.playlist.id).toBe(1);
      expect(res.playlist.name).toBe("Chill Electronic");
      expect(res.total_tracks).toBe(2);
      expect(res.tracks.length).toBe(2);

      expect(res.tracks[0].position).toBe(0);
      expect(res.tracks[0].uuid).toBe("uuid-item-1");
      expect(res.tracks[0].track_id).toBe(1);
      expect(res.tracks[0].title).toBe("Midnight City");
      expect(res.tracks[0].artist).toBe("M83");
      expect(res.tracks[0].duration_seconds).toBe(243);

      expect(res.tracks[1].position).toBe(1);
      expect(res.tracks[1].uuid).toBe("uuid-item-2");
      expect(res.tracks[1].track_id).toBe(2);
      expect(res.tracks[1].title).toBe("Wait");
    });

    it("retrieves tracks by playlist_name case-insensitively", () => {
      const res = getPlaylistTracks(db, { playlist_name: "chill electronic" });
      expect(res.playlist.id).toBe(1);
      expect(res.total_tracks).toBe(2);
    });

    it("applies limit and offset pagination", () => {
      const res = getPlaylistTracks(db, { playlist_id: 1, limit: 1, offset: 1 });
      expect(res.total_tracks).toBe(2);
      expect(res.tracks.length).toBe(1);
      expect(res.tracks[0].position).toBe(1);
      expect(res.tracks[0].title).toBe("Wait");
    });

    it("throws error when neither playlist_id nor playlist_name is provided", () => {
      expect(() => getPlaylistTracks(db, {})).toThrow(
        "Either playlist_id or playlist_name must be provided."
      );
    });

    it("throws error when playlist ID does not exist", () => {
      expect(() => getPlaylistTracks(db, { playlist_id: 999 })).toThrow(
        "Playlist with ID 999 not found."
      );
    });

    it("throws error when playlist name does not exist", () => {
      expect(() => getPlaylistTracks(db, { playlist_name: "Nonexistent" })).toThrow(
        'Playlist with name "Nonexistent" not found.'
      );
    });
  });

  describe("createPlaylist", () => {
    it("creates a new empty playlist", () => {
      const res = createPlaylist(db, { name: "Focus Beats" });
      expect(res.playlist_id).toBeGreaterThan(2);
      expect(res.name).toBe("Focus Beats");
      expect(res.tracks_added).toBe(0);
      expect(res.track_ids).toEqual([]);
      expect(res.created_at).toBeTruthy();

      const playlists = listPlaylists(db);
      const created = playlists.find((p) => p.name === "Focus Beats");
      expect(created).toBeDefined();
      expect(created!.track_count).toBe(0);
      expect(created!.is_dynamic).toBe(false);
    });

    it("creates a new playlist with initial track IDs", () => {
      const res = createPlaylist(db, {
        name: "Late Night Mix",
        track_ids: [3, 4, 5],
      });

      expect(res.tracks_added).toBe(3);
      expect(res.track_ids).toEqual([3, 4, 5]);

      const details = getPlaylistTracks(db, { playlist_id: res.playlist_id });
      expect(details.total_tracks).toBe(3);
      expect(details.tracks[0].position).toBe(0);
      expect(details.tracks[0].track_id).toBe(3);
      expect(details.tracks[0].title).toBe("So What");
      expect(details.tracks[0].uuid).toBeTruthy();

      expect(details.tracks[1].position).toBe(1);
      expect(details.tracks[1].track_id).toBe(4);

      expect(details.tracks[2].position).toBe(2);
      expect(details.tracks[2].track_id).toBe(5);
    });

    it("rejects empty playlist name", () => {
      expect(() => createPlaylist(db, { name: "" })).toThrow(
        "Playlist name cannot be empty."
      );
      expect(() => createPlaylist(db, { name: "   " })).toThrow(
        "Playlist name cannot be empty."
      );
    });

    it("rejects reserved playlist names", () => {
      expect(() => createPlaylist(db, { name: "Queue" })).toThrow(
        '"Queue" is reserved for the app\'s built-in Queue playlist.'
      );
      expect(() => createPlaylist(db, { name: "file d'attente" })).toThrow(
        '"file d\'attente" is reserved for the app\'s built-in Queue playlist.'
      );
    });

    it("rejects non-existent track IDs", () => {
      expect(() =>
        createPlaylist(db, {
          name: "Invalid Tracks Playlist",
          track_ids: [1, 9999],
        })
      ).toThrow("The following track IDs were not found in the music library: 9999.");
    });
  });

  describe("addTracksToPlaylist", () => {
    it("appends tracks to an existing playlist maintaining contiguous positions", () => {
      // Playlist 1 initially has 2 tracks (positions 0 and 1)
      const res = addTracksToPlaylist(db, {
        playlist_id: 1,
        track_ids: [3, 5],
      });

      expect(res.playlist_id).toBe(1);
      expect(res.playlist_name).toBe("Chill Electronic");
      expect(res.tracks_added).toBe(2);
      expect(res.total_tracks).toBe(4);

      const details = getPlaylistTracks(db, { playlist_id: 1 });
      expect(details.total_tracks).toBe(4);
      expect(details.tracks.map((t) => t.position)).toEqual([0, 1, 2, 3]);
      expect(details.tracks[2].track_id).toBe(3);
      expect(details.tracks[3].track_id).toBe(5);
      expect(details.tracks[2].uuid).not.toBe(details.tracks[3].uuid);
    });

    it("appends tracks using playlist_name", () => {
      const res = addTracksToPlaylist(db, {
        playlist_name: "chill electronic",
        track_ids: [4],
      });

      expect(res.playlist_id).toBe(1);
      expect(res.tracks_added).toBe(1);
      expect(res.total_tracks).toBe(3);
    });

    it("rejects adding tracks to dynamic playlists", () => {
      expect(() =>
        addTracksToPlaylist(db, {
          playlist_id: 2, // dynamic playlist
          track_ids: [1],
        })
      ).toThrow("Cannot manually add tracks to dynamic/smart playlist");
    });

    it("rejects empty track_ids array", () => {
      expect(() =>
        addTracksToPlaylist(db, {
          playlist_id: 1,
          track_ids: [],
        })
      ).toThrow("track_ids must be a non-empty array of song IDs.");
    });

    it("rejects non-existent track IDs", () => {
      expect(() =>
        addTracksToPlaylist(db, {
          playlist_id: 1,
          track_ids: [8888, 9999],
        })
      ).toThrow("The following track IDs were not found in the music library: 8888, 9999.");
    });
  });
});

describe("MCP Playlist Tools Integration", () => {
  let tempDir: string;
  let tempDbPath: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "luminous-mcp-playlist-test-"));
    tempDbPath = path.join(tempDir, "luminous.db");
    const writer = setupFullTestDb(tempDbPath);
    writer.close();
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  it("lists all playlist tools alongside existing tools", async () => {
    const { server, db } = createMcpServer({ dbPath: tempDbPath });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test-client", version: "1.0.0" }, { capabilities: {} });

    await server.connect(serverTransport);
    await client.connect(clientTransport);

    const toolsResult = await client.listTools();
    const toolNames = toolsResult.tools.map((t) => t.name);

    expect(toolNames).toContain("list_playlists");
    expect(toolNames).toContain("get_playlist_tracks");
    expect(toolNames).toContain("create_playlist");
    expect(toolNames).toContain("add_tracks_to_playlist");

    // Pre-existing tools also present
    expect(toolNames).toContain("ping");
    expect(toolNames).toContain("get_server_info");
    expect(toolNames).toContain("search_library");
    expect(toolNames).toContain("get_listening_stats");

    await client.close();
    await server.close();
    db.close();
  });

  it("calls list_playlists tool via MCP", async () => {
    const { server, db } = createMcpServer({ dbPath: tempDbPath });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test-client", version: "1.0.0" }, { capabilities: {} });

    await server.connect(serverTransport);
    await client.connect(clientTransport);

    const result = await client.callTool({
      name: "list_playlists",
      arguments: {},
    });

    const firstContent = getTextContent(result);
    const parsed = JSON.parse(firstContent.text);

    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBe(2);
    expect(parsed[0].name).toBe("Chill Electronic");
    expect(parsed[0].track_count).toBe(2);

    await client.close();
    await server.close();
    db.close();
  });

  it("calls create_playlist tool via MCP", async () => {
    const { server, db } = createMcpServer({ dbPath: tempDbPath });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test-client", version: "1.0.0" }, { capabilities: {} });

    await server.connect(serverTransport);
    await client.connect(clientTransport);

    const result = await client.callTool({
      name: "create_playlist",
      arguments: {
        name: "Morning Energy",
        track_ids: [1, 5],
      },
    });

    const firstContent = getTextContent(result);
    const parsed = JSON.parse(firstContent.text);

    expect(parsed.name).toBe("Morning Energy");
    expect(parsed.tracks_added).toBe(2);
    expect(parsed.playlist_id).toBeGreaterThan(2);

    await client.close();
    await server.close();
    db.close();
  });

  it("calls add_tracks_to_playlist tool via MCP", async () => {
    const { server, db } = createMcpServer({ dbPath: tempDbPath });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test-client", version: "1.0.0" }, { capabilities: {} });

    await server.connect(serverTransport);
    await client.connect(clientTransport);

    const result = await client.callTool({
      name: "add_tracks_to_playlist",
      arguments: {
        playlist_name: "Chill Electronic",
        track_ids: [3, 4],
      },
    });

    const firstContent = getTextContent(result);
    const parsed = JSON.parse(firstContent.text);

    expect(parsed.playlist_name).toBe("Chill Electronic");
    expect(parsed.tracks_added).toBe(2);
    expect(parsed.total_tracks).toBe(4);

    await client.close();
    await server.close();
    db.close();
  });

  it("calls get_playlist_tracks tool via MCP", async () => {
    const { server, db } = createMcpServer({ dbPath: tempDbPath });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test-client", version: "1.0.0" }, { capabilities: {} });

    await server.connect(serverTransport);
    await client.connect(clientTransport);

    const result = await client.callTool({
      name: "get_playlist_tracks",
      arguments: {
        playlist_id: 1,
      },
    });

    const firstContent = getTextContent(result);
    const parsed = JSON.parse(firstContent.text);

    expect(parsed.playlist.id).toBe(1);
    expect(parsed.total_tracks).toBe(2);
    expect(parsed.tracks.length).toBe(2);
    expect(parsed.tracks[0].title).toBe("Midnight City");

    await client.close();
    await server.close();
    db.close();
  });

  it("returns error message when creating a reserved playlist name via MCP", async () => {
    const { server, db } = createMcpServer({ dbPath: tempDbPath });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test-client", version: "1.0.0" }, { capabilities: {} });

    await server.connect(serverTransport);
    await client.connect(clientTransport);

    const result = await client.callTool({
      name: "create_playlist",
      arguments: {
        name: "Queue",
      },
    });

    expect(result.isError).toBe(true);
    const firstContent = getTextContent(result);
    expect(firstContent.text).toContain("reserved");

    await client.close();
    await server.close();
    db.close();
  });

  it("returns error message when database file is missing", async () => {
    const missingDbPath = path.join(tempDir, "missing-luminous.db");
    const { server, db } = createMcpServer({ dbPath: missingDbPath });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test-client", version: "1.0.0" }, { capabilities: {} });

    await server.connect(serverTransport);
    await client.connect(clientTransport);

    const result = await client.callTool({
      name: "list_playlists",
      arguments: {},
    });

    expect(result.isError).toBe(true);
    const firstContent = getTextContent(result);
    expect(firstContent.text).toContain("database file not found");

    await client.close();
    await server.close();
    db.close();
  });
});
