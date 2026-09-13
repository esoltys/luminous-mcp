import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createMcpServer } from "../src/server.ts";
import {
  getListeningStats,
  getRecentHistory,
  parseTimestamp,
  type ListeningStatsCategoryResult,
  type ListeningStatsOverviewResult,
  type TopArtistItem,
  type TrackStatsItem,
} from "../src/db/analytics.ts";

interface TextContent {
  type: "text";
  text: string;
}

function getTextContent(result: unknown): TextContent {
  const r = result as { content?: unknown[] };
  if (!Array.isArray(r.content) || r.content.length === 0) {
    throw new Error("Expected result.content to be a non-empty array");
  }
  const item = r.content[0] as TextContent;
  if (item.type !== "text") {
    throw new Error(`Expected text content, got ${item.type}`);
  }
  return item;
}

const NOW = Math.floor(Date.now() / 1000);
const DAY = 86400;

function initTestDb(dbPath: string): void {
  const db = new Database(dbPath);
  db.run("CREATE TABLE schema_version (version INTEGER PRIMARY KEY);");
  db.run("INSERT INTO schema_version (version) VALUES (34);");

  db.run(`
    CREATE TABLE songs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source INTEGER NOT NULL DEFAULT (0),
      filetype INTEGER NOT NULL DEFAULT (0),
      path TEXT,
      url TEXT,
      stream_url TEXT,
      title TEXT,
      titlesort TEXT,
      artist TEXT,
      artistsort TEXT,
      album TEXT,
      albumsort TEXT,
      album_artist TEXT,
      album_artist_sort TEXT,
      composer TEXT,
      composersort TEXT,
      performer TEXT,
      performersort TEXT,
      grouping TEXT,
      comment TEXT,
      lyrics TEXT,
      track INTEGER,
      disc INTEGER,
      year INTEGER,
      originalyear INTEGER,
      genre TEXT,
      compilation BOOLEAN NOT NULL DEFAULT (0),
      bpm REAL,
      initial_key TEXT,
      length_nanosec INTEGER,
      beginning_nanosec INTEGER NOT NULL DEFAULT (0),
      end_nanosec INTEGER NOT NULL DEFAULT (0),
      bitrate INTEGER,
      samplerate INTEGER,
      bitdepth INTEGER,
      channels INTEGER,
      filesize INTEGER,
      mtime INTEGER,
      rating REAL NOT NULL DEFAULT (-1),
      playcount INTEGER NOT NULL DEFAULT (0),
      skipcount INTEGER NOT NULL DEFAULT (0),
      lastplayed INTEGER,
      lastseen INTEGER,
      art_embedded BOOLEAN NOT NULL DEFAULT (0),
      art_automatic TEXT,
      art_manual TEXT,
      art_unset BOOLEAN NOT NULL DEFAULT (0),
      cue_path TEXT,
      musicbrainz_album_artist_id TEXT,
      musicbrainz_artist_id TEXT,
      musicbrainz_original_artist_id TEXT,
      musicbrainz_album_id TEXT,
      musicbrainz_original_album_id TEXT,
      musicbrainz_recording_id TEXT,
      musicbrainz_track_id TEXT,
      musicbrainz_disc_id TEXT,
      musicbrainz_release_group_id TEXT,
      musicbrainz_work_id TEXT,
      ebur128_integrated_loudness_lufs REAL,
      ebur128_loudness_range_lu REAL,
      artist_id TEXT,
      album_id TEXT,
      song_id TEXT,
      added INTEGER DEFAULT (strftime('%s', 'now')),
      unavailable BOOLEAN NOT NULL DEFAULT (0),
      replaygain_track_gain REAL,
      replaygain_album_gain REAL,
      is_vbr BOOLEAN,
      is_instrumental BOOLEAN NOT NULL DEFAULT (0),
      genresort TEXT,
      not_included BOOLEAN NOT NULL DEFAULT (0),
      musicbrainz_release_type TEXT,
      musicbrainz_release_country TEXT,
      barcode TEXT,
      catalog_number TEXT,
      dynamic_range INTEGER,
      dynamic_range_peak REAL,
      dynamic_range_rms REAL,
      dynamic_range_album INTEGER,
      dr_log_mtime INTEGER
    );
  `);

  db.run(`
    CREATE TABLE playlists (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      dynamic_enabled BOOLEAN NOT NULL DEFAULT 0,
      dynamic_spec TEXT,
      last_played_row INTEGER,
      created INTEGER DEFAULT (strftime('%s', 'now'))
    );
  `);

  db.run(`
    CREATE TABLE play_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      context_type TEXT NOT NULL,
      song_id INTEGER NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
      playlist_id INTEGER REFERENCES playlists(id) ON DELETE CASCADE,
      played_at INTEGER NOT NULL,
      duration_secs INTEGER NOT NULL DEFAULT 0
    );
  `);

  const insertSong = db.prepare(`
    INSERT INTO songs (
      id, title, artist, album, album_artist, year, genre,
      length_nanosec, playcount, skipcount, lastplayed, unavailable
    ) VALUES (
      $id, $title, $artist, $album, $album_artist, $year, $genre,
      $length_nanosec, $playcount, $skipcount, $lastplayed, $unavailable
    );
  `);

  const songs = [
    {
      $id: 1,
      $title: "Midnight City",
      $artist: "M83",
      $album: "Hurry Up, We're Dreaming",
      $album_artist: "M83",
      $year: 2011,
      $genre: "Synthwave; Electronic",
      $length_nanosec: 244000000000,
      $playcount: 40,
      $skipcount: 1,
      $lastplayed: NOW - 5 * DAY,
      $unavailable: 0,
    },
    {
      $id: 2,
      $title: "Resonance",
      $artist: "HOME",
      $album: "Odyssey",
      $album_artist: "HOME",
      $year: 2014,
      $genre: "Synthwave; Chillwave",
      $length_nanosec: 212000000000,
      $playcount: 15,
      $skipcount: 20,
      $lastplayed: NOW - 10 * DAY,
      $unavailable: 0,
    },
    {
      $id: 3,
      $title: "Smells Like Teen Spirit",
      $artist: "Nirvana",
      $album: "Nevermind",
      $album_artist: "Nirvana",
      $year: 1991,
      $genre: "Grunge; Rock",
      $length_nanosec: 301000000000,
      $playcount: 30,
      $skipcount: 2,
      $lastplayed: NOW - 250 * DAY, // ~8.2 months ago
      $unavailable: 0,
    },
    {
      $id: 4,
      $title: "Black",
      $artist: "Pearl Jam",
      $album: "Ten",
      $album_artist: "Pearl Jam",
      $year: 1991,
      $genre: "Grunge; Rock",
      $length_nanosec: 343000000000,
      $playcount: 25,
      $skipcount: 1,
      $lastplayed: NOW - 210 * DAY, // ~6.9 months ago
      $unavailable: 0,
    },
    {
      $id: 5,
      $title: "Enter Sandman",
      $artist: "Metallica",
      $album: "Metallica",
      $album_artist: "Metallica",
      $year: 1991,
      $genre: "Heavy Metal; Rock",
      $length_nanosec: 331000000000,
      $playcount: 12,
      $skipcount: 0,
      $lastplayed: NOW - 2 * DAY, // recently played
      $unavailable: 0,
    },
    {
      $id: 6,
      $title: "So What",
      $artist: "Miles Davis",
      $album: "Kind of Blue",
      $album_artist: "Miles Davis",
      $year: 1959,
      $genre: "Jazz",
      $length_nanosec: 562000000000,
      $playcount: 50,
      $skipcount: 0,
      $lastplayed: NOW - 300 * DAY, // ~9.8 months ago
      $unavailable: 0,
    },
    {
      $id: 7,
      $title: "Disliked Song",
      $artist: "Annoying Artist",
      $album: "Pop Noise",
      $album_artist: "Annoying Artist",
      $year: 2022,
      $genre: "Pop",
      $length_nanosec: 180000000000,
      $playcount: 1,
      $skipcount: 10,
      $lastplayed: NOW - 100 * DAY,
      $unavailable: 0,
    },
    {
      $id: 8,
      $title: "Never Played",
      $artist: "Indie Artist",
      $album: "Unheard",
      $album_artist: "Indie Artist",
      $year: 2023,
      $genre: "Indie",
      $length_nanosec: 200000000000,
      $playcount: 0,
      $skipcount: 0,
      $lastplayed: null,
      $unavailable: 0,
    },
    {
      $id: 9,
      $title: "Deleted Track",
      $artist: "Ghost",
      $album: "Phantom",
      $album_artist: "Ghost",
      $year: 1995,
      $genre: "Rock",
      $length_nanosec: 150000000000,
      $playcount: 100,
      $skipcount: 0,
      $lastplayed: NOW - 400 * DAY,
      $unavailable: 1, // Unavailable
    },
  ];

  for (const s of songs) {
    insertSong.run(s as any);
  }

  db.run("INSERT INTO playlists (id, name) VALUES (1, '90s Rock Classics');");
  db.run("INSERT INTO playlists (id, name) VALUES (2, 'Night Drives');");

  const insertHistory = db.prepare(`
    INSERT INTO play_history (id, context_type, song_id, playlist_id, played_at, duration_secs)
    VALUES ($id, $context_type, $song_id, $playlist_id, $played_at, $duration_secs);
  `);

  const history = [
    {
      $id: 1,
      $context_type: "playlist",
      $song_id: 1,
      $playlist_id: 2,
      $played_at: NOW - 3600, // 1 hour ago
      $duration_secs: 244,
    },
    {
      $id: 2,
      $context_type: "playlist",
      $song_id: 5,
      $playlist_id: 1,
      $played_at: NOW - 86400, // yesterday
      $duration_secs: 330,
    },
    {
      $id: 3,
      $context_type: "song",
      $song_id: 2,
      $playlist_id: null,
      $played_at: NOW - 90000, // yesterday evening
      $duration_secs: 212,
    },
    {
      $id: 4,
      $context_type: "album",
      $song_id: 6,
      $playlist_id: null,
      $played_at: NOW - 20000000, // months ago
      $duration_secs: 562,
    },
  ];

  for (const h of history) {
    insertHistory.run(h as any);
  }

  db.close();
}

describe("Listening Analytics & Insights Database Layer", () => {
  let tempDir: string;
  let tempDbPath: string;
  let db: Database;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "luminous-analytics-test-"));
    tempDbPath = path.join(tempDir, "luminous.db");
    initTestDb(tempDbPath);
    db = new Database(tempDbPath, { readonly: true });
  });

  afterEach(() => {
    db.close();
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore
    }
  });

  describe("parseTimestamp", () => {
    it("returns undefined for undefined or null", () => {
      expect(parseTimestamp(undefined)).toBeUndefined();
      expect(parseTimestamp(undefined)).toBeUndefined();
    });

    it("parses numeric values and strings", () => {
      expect(parseTimestamp(1710000000)).toBe(1710000000);
      expect(parseTimestamp("1710000000")).toBe(1710000000);
    });

    it("parses ISO 8601 date strings", () => {
      const iso = "2026-09-10T12:00:00Z";
      const expected = Math.floor(Date.parse(iso) / 1000);
      expect(parseTimestamp(iso)).toBe(expected);
    });
  });

  describe("getListeningStats - overview", () => {
    it("returns composite library overview and top slices", () => {
      const res = getListeningStats(db, { category: "overview" }) as ListeningStatsOverviewResult;
      expect(res.category).toBe("overview");
      expect(res.summary.total_tracks).toBe(8); // excluding unavailable track 9
      expect(res.summary.total_plays).toBe(173); // 40+15+30+25+12+50+1+0
      expect(res.summary.total_skips).toBe(34); // 1+20+2+1+0+0+10+0
      expect(res.summary.tracks_played).toBe(7);
      expect(res.summary.tracks_unplayed).toBe(1);

      expect(res.top_artists.length).toBeGreaterThan(0);
      expect(res.top_artists[0].artist).toBe("Miles Davis");
      expect(res.top_tracks[0].title).toBe("So What");
    });
  });

  describe("getListeningStats - top_artists", () => {
    it("ranks artists by total plays across tracks", () => {
      const res = getListeningStats(db, {
        category: "top_artists",
        limit: 5,
      }) as ListeningStatsCategoryResult<TopArtistItem>;

      expect(res.category).toBe("top_artists");
      expect(res.items.length).toBe(5);
      expect(res.items[0].artist).toBe("Miles Davis");
      expect(res.items[0].total_plays).toBe(50);
      expect(res.items[1].artist).toBe("M83");
      expect(res.items[1].total_plays).toBe(40);
    });

    it("filters top artists by genre", () => {
      const res = getListeningStats(db, {
        category: "top_artists",
        genre: "Grunge",
      }) as ListeningStatsCategoryResult<TopArtistItem>;

      expect(res.items.map((a) => a.artist)).toContain("Nirvana");
      expect(res.items.map((a) => a.artist)).toContain("Pearl Jam");
      expect(res.items.map((a) => a.artist)).not.toContain("Miles Davis");
    });
  });

  describe("getListeningStats - top_tracks", () => {
    it("ranks tracks by playcount descending", () => {
      const res = getListeningStats(db, {
        category: "top_tracks",
        limit: 3,
      }) as ListeningStatsCategoryResult<TrackStatsItem>;

      expect(res.category).toBe("top_tracks");
      expect(res.items.length).toBe(3);
      expect(res.items[0].title).toBe("So What");
      expect(res.items[0].play_count).toBe(50);
      expect(res.items[1].title).toBe("Midnight City");
      expect(res.items[1].play_count).toBe(40);
      expect(res.items[2].title).toBe("Smells Like Teen Spirit");
      expect(res.items[2].play_count).toBe(30);
    });
  });

  describe("getListeningStats - forgotten_favorites", () => {
    it("identifies tracks with high playcount unplayed in past N months", () => {
      // Natural language query test:
      // "What are my top 10 most played tracks from the 1990s that I haven't listened to in the past 6 months?"
      const res = getListeningStats(db, {
        category: "forgotten_favorites",
        year_min: 1990,
        year_max: 1999,
        unplayed_months: 6,
        limit: 10,
      }) as ListeningStatsCategoryResult<TrackStatsItem>;

      expect(res.category).toBe("forgotten_favorites");
      const titles = res.items.map((t) => t.title);

      // Nirvana (1991, 250 days ago) and Pearl Jam (1991, 210 days ago) should appear
      expect(titles).toContain("Smells Like Teen Spirit");
      expect(titles).toContain("Black");

      // Metallica (1991, but played 2 days ago) should NOT appear
      expect(titles).not.toContain("Enter Sandman");

      // Miles Davis (1959, not 1990s) should NOT appear
      expect(titles).not.toContain("So What");

      // Check ranking: Smells Like Teen Spirit (playcount 30) before Black (playcount 25)
      expect(res.items[0].title).toBe("Smells Like Teen Spirit");
      expect(res.items[1].title).toBe("Black");
      expect(res.items[0].days_since_last_played).toBeGreaterThanOrEqual(240);
    });
  });

  describe("getListeningStats - frequently_skipped", () => {
    it("ranks by absolute skip count when skip_metric is skip_count", () => {
      // Natural language query test:
      // "Which tracks in my library have the highest skip count?"
      const res = getListeningStats(db, {
        category: "frequently_skipped",
        skip_metric: "skip_count",
        limit: 2,
      }) as ListeningStatsCategoryResult<TrackStatsItem>;

      expect(res.category).toBe("frequently_skipped");
      expect(res.items.length).toBe(2);
      expect(res.items[0].title).toBe("Resonance");
      expect(res.items[0].skip_count).toBe(20);
      expect(res.items[1].title).toBe("Disliked Song");
      expect(res.items[1].skip_count).toBe(10);
    });

    it("ranks by proportional skip ratio when skip_metric is skip_ratio", () => {
      const res = getListeningStats(db, {
        category: "frequently_skipped",
        skip_metric: "skip_ratio",
        limit: 2,
      }) as ListeningStatsCategoryResult<TrackStatsItem>;

      expect(res.category).toBe("frequently_skipped");
      expect(res.items.length).toBe(2);
      // Disliked Song has 10 skips / (1 play + 10 skips) = 90.9%
      // Resonance has 20 skips / (15 plays + 20 skips) = 57.1%
      expect(res.items[0].title).toBe("Disliked Song");
      expect(res.items[0].skip_ratio).toBeGreaterThan(0.9);
      expect(res.items[1].title).toBe("Resonance");
    });
  });

  describe("getRecentHistory", () => {
    it("returns chronological playback rows with timestamps and context", () => {
      const res = getRecentHistory(db, { limit: 10 });
      expect(res.count).toBe(4);
      expect(res.history[0].track.title).toBe("Midnight City");
      expect(res.history[0].context.type).toBe("playlist");
      expect(res.history[0].context.playlist_name).toBe("Night Drives");
      expect(res.history[0].duration_seconds).toBe(244);
      expect(res.history[0].played_at_iso).toBeDefined();
    });

    it("filters history by time window (since / until)", () => {
      // "Show me my listening history from yesterday evening"
      // Row 2 is at NOW - 86400, Row 3 is at NOW - 90000
      const since = NOW - 95000;
      const until = NOW - 50000;

      const res = getRecentHistory(db, { since, until });
      expect(res.count).toBe(2);
      const titles = res.history.map((h) => h.track.title);
      expect(titles).toContain("Enter Sandman");
      expect(titles).toContain("Resonance");
      expect(titles).not.toContain("Midnight City"); // Played 1 hour ago
    });

    it("filters history by context_type and playlist_id", () => {
      const res = getRecentHistory(db, { context_type: "playlist", playlist_id: 1 });
      expect(res.count).toBe(1);
      expect(res.history[0].track.title).toBe("Enter Sandman");
      expect(res.history[0].context.playlist_name).toBe("90s Rock Classics");
    });

    it("respects order ascending", () => {
      const res = getRecentHistory(db, { order: "asc" });
      expect(res.count).toBe(4);
      expect(res.history[0].track.title).toBe("So What"); // Oldest play
    });

    it("handles missing play_history table safely", () => {
      const emptyDb = new Database(":memory:");
      const res = getRecentHistory(emptyDb);
      expect(res.count).toBe(0);
      expect(res.history).toEqual([]);
      expect(res.message).toContain("play_history table does not exist");
      emptyDb.close();
    });
  });
});

describe("MCP Analytics Tools Integration", () => {
  let tempDir: string;
  let tempDbPath: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "luminous-mcp-analytics-test-"));
    tempDbPath = path.join(tempDir, "luminous.db");
    initTestDb(tempDbPath);
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore
    }
  });

  it("registers get_listening_stats and get_recent_history on server", async () => {
    const { server, db } = createMcpServer({ dbPath: tempDbPath });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test-client", version: "1.0.0" }, { capabilities: {} });

    await server.connect(serverTransport);
    await client.connect(clientTransport);

    const toolsResult = await client.listTools();
    const toolNames = toolsResult.tools.map((t) => t.name);

    expect(toolNames).toContain("get_listening_stats");
    expect(toolNames).toContain("get_recent_history");

    await client.close();
    await server.close();
    db.close();
  });

  it("calls get_listening_stats tool via MCP", async () => {
    const { server, db } = createMcpServer({ dbPath: tempDbPath });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test-client", version: "1.0.0" }, { capabilities: {} });

    await server.connect(serverTransport);
    await client.connect(clientTransport);

    const result = await client.callTool({
      name: "get_listening_stats",
      arguments: {
        category: "forgotten_favorites",
        year_min: 1990,
        year_max: 1999,
        unplayed_months: 6,
      },
    });

    const content = getTextContent(result);
    const parsed = JSON.parse(content.text);

    expect(parsed.category).toBe("forgotten_favorites");
    expect(parsed.count).toBe(2);
    expect(parsed.items[0].title).toBe("Smells Like Teen Spirit");

    await client.close();
    await server.close();
    db.close();
  });

  it("calls get_recent_history tool via MCP", async () => {
    const { server, db } = createMcpServer({ dbPath: tempDbPath });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test-client", version: "1.0.0" }, { capabilities: {} });

    await server.connect(serverTransport);
    await client.connect(clientTransport);

    const result = await client.callTool({
      name: "get_recent_history",
      arguments: {
        limit: 5,
        context_type: "playlist",
      },
    });

    const content = getTextContent(result);
    const parsed = JSON.parse(content.text);

    expect(parsed.count).toBe(2);
    expect(parsed.history[0].track.title).toBe("Midnight City");
    expect(parsed.history[0].context.playlist_name).toBe("Night Drives");
    expect(parsed.history[0].track.composer).toBeUndefined();

    await client.close();
    await server.close();
    db.close();
  });

  it("returns error message when database file is missing", async () => {
    const missingDb = path.join(tempDir, "nonexistent.db");
    const { server, db } = createMcpServer({ dbPath: missingDb });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test-client", version: "1.0.0" }, { capabilities: {} });

    await server.connect(serverTransport);
    await client.connect(clientTransport);

    const result = await client.callTool({
      name: "get_listening_stats",
      arguments: {},
    });

    expect(result.isError).toBe(true);
    const content = getTextContent(result);
    expect(content.text).toContain("Luminous database file not found");

    await client.close();
    await server.close();
    db.close();
  });
});
