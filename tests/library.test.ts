import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createMcpServer } from "../src/server.ts";
import {
  getArtistSummary,
  getTrackDetails,
  searchLibrary,
  splitMultiValue,
} from "../src/db/library.ts";

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
    CREATE VIRTUAL TABLE songs_fts USING fts5(
      title, artist, album, album_artist, composer, performer, genre,
      content='songs',
      content_rowid='id'
    );
  `);

  // Insert seed tracks
  const insertSong = db.prepare(`
    INSERT INTO songs (
      id, title, artist, album, album_artist, composer, performer, genre,
      year, track, disc, bpm, ebur128_integrated_loudness_lufs, ebur128_loudness_range_lu,
      length_nanosec, bitrate, samplerate, bitdepth, channels, filesize, playcount, skipcount,
      rating, lyrics, unavailable, filetype, musicbrainz_recording_id, barcode
    ) VALUES (
      $id, $title, $artist, $album, $album_artist, $composer, $performer, $genre,
      $year, $track, $disc, $bpm, $lufs, $lra,
      $length_nanosec, $bitrate, $samplerate, $bitdepth, $channels, $filesize, $playcount, $skipcount,
      $rating, $lyrics, $unavailable, $filetype, $musicbrainz_recording_id, $barcode
    );
  `);

  const insertFts = db.prepare(`
    INSERT INTO songs_fts (rowid, title, artist, album, album_artist, composer, performer, genre)
    VALUES ($rowid, $title, $artist, $album, $album_artist, $composer, $performer, $genre);
  `);

  const sampleTracks = [
    {
      $id: 1,
      $title: "Midnight City",
      $artist: "M83",
      $album: "Hurry Up, We're Dreaming",
      $album_artist: "M83",
      $composer: "Anthony Gonzalez; Yann Gonzalez",
      $performer: "Rick Rubin",
      $genre: "Synthwave; Electronic",
      $year: 2019,
      $track: 1,
      $disc: 1,
      $bpm: 125.0,
      $lufs: -10.5,
      $lra: 6.2,
      $length_nanosec: 244000000000,
      $bitrate: 1000,
      $samplerate: 44100,
      $bitdepth: 16,
      $channels: 2,
      $filesize: 30000000,
      $playcount: 15,
      $skipcount: 1,
      $rating: 5.0,
      $lyrics: "[00:15.00] Waiting in a car\n[00:18.00] Waiting for the right time in the midnight rain",
      $unavailable: 0,
      $filetype: 2, // FLAC
      $musicbrainz_recording_id: "mb-rec-1",
      $barcode: "123456789",
    },
    {
      $id: 2,
      $title: "Resonance",
      $artist: "HOME",
      $album: "Odyssey",
      $album_artist: "HOME",
      $composer: "Randy Goffe",
      $performer: null,
      $genre: "Synthwave; Chillwave",
      $year: 2014,
      $track: 3,
      $disc: 1,
      $bpm: 105.0,
      $lufs: -13.2,
      $lra: 4.8,
      $length_nanosec: 212000000000,
      $bitrate: 320,
      $samplerate: 44100,
      $bitdepth: 16,
      $channels: 2,
      $filesize: 12000000,
      $playcount: 42,
      $skipcount: 0,
      $rating: 4.0,
      $lyrics: null,
      $unavailable: 0,
      $filetype: 1, // MP3
      $musicbrainz_recording_id: "mb-rec-2",
      $barcode: null,
    },
    {
      $id: 3,
      $title: "So What",
      $artist: "Miles Davis; John Coltrane",
      $album: "Kind of Blue",
      $album_artist: "Miles Davis",
      $composer: "Miles Davis",
      $performer: "Bill Evans; Cannonball Adderley",
      $genre: "Jazz; Modal Jazz",
      $year: 1959,
      $track: 1,
      $disc: 1,
      $bpm: 136.0,
      $lufs: -18.4,
      $lra: 9.1,
      $length_nanosec: 562000000000,
      $bitrate: 850,
      $samplerate: 96000,
      $bitdepth: 24,
      $channels: 2,
      $filesize: 80000000,
      $playcount: 20,
      $skipcount: 2,
      $rating: 5.0,
      $lyrics: "Unsynchronized modal jazz classic instrumental poem",
      $unavailable: 0,
      $filetype: 2, // FLAC
      $musicbrainz_recording_id: "mb-rec-3",
      $barcode: "987654321",
    },
    {
      $id: 4,
      $title: "Blue in Green",
      $artist: "Miles Davis",
      $album: "Kind of Blue",
      $album_artist: "Miles Davis",
      $composer: "Miles Davis; Bill Evans",
      $performer: "Bill Evans",
      $genre: "Jazz",
      $year: 1959,
      $track: 3,
      $disc: 1,
      $bpm: 56.0,
      $lufs: -21.0,
      $lra: 8.0,
      $length_nanosec: 337000000000,
      $bitrate: 820,
      $samplerate: 96000,
      $bitdepth: 24,
      $channels: 2,
      $filesize: 45000000,
      $playcount: 8,
      $skipcount: 0,
      $rating: 4.5,
      $lyrics: null,
      $unavailable: 0,
      $filetype: 2, // FLAC
      $musicbrainz_recording_id: "mb-rec-4",
      $barcode: "987654321",
    },
    {
      $id: 5,
      $title: "Missing Track",
      $artist: "Ghost",
      $album: "Phantom",
      $album_artist: "Ghost",
      $composer: null,
      $performer: null,
      $genre: "Rock",
      $year: 2020,
      $track: 1,
      $disc: 1,
      $bpm: 120.0,
      $lufs: -9.0,
      $lra: 5.0,
      $length_nanosec: 180000000000,
      $bitrate: 320,
      $samplerate: 44100,
      $bitdepth: 16,
      $channels: 2,
      $filesize: 8000000,
      $playcount: 1,
      $skipcount: 0,
      $rating: -1,
      $lyrics: null,
      $unavailable: 1, // Unavailable
      $filetype: 1,
      $musicbrainz_recording_id: null,
      $barcode: null,
    },
  ];

  for (const t of sampleTracks) {
    insertSong.run(t as any);
    insertFts.run({
      $rowid: t.$id,
      $title: t.$title,
      $artist: t.$artist,
      $album: t.$album,
      $album_artist: t.$album_artist,
      $composer: t.$composer,
      $performer: t.$performer,
      $genre: t.$genre,
    });
  }

  db.close();
}

describe("Library Database Functions", () => {
  let tempDir: string;
  let tempDbPath: string;
  let db: Database;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "luminous-lib-test-"));
    tempDbPath = path.join(tempDir, "luminous.db");
    initTestDb(tempDbPath);
    db = new Database(tempDbPath, { readonly: true });
  });

  afterEach(() => {
    db.close();
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error
    }
  });

  describe("splitMultiValue", () => {
    it("splits strings on semicolon and trims/dedupes", () => {
      expect(splitMultiValue("Rock; Pop; rock; Jazz")).toEqual(["Rock", "Pop", "Jazz"]);
      expect(splitMultiValue(null)).toEqual([]);
      expect(splitMultiValue("")).toEqual([]);
    });
  });

  describe("searchLibrary", () => {
    it("searches with full-text query", () => {
      const res = searchLibrary(db, { query: "Midnight" });
      expect(res.count).toBe(1);
      expect(res.tracks[0].title).toBe("Midnight City");
    });

    it("matches lyrics in query search", () => {
      const res = searchLibrary(db, { query: "midnight rain" });
      expect(res.count).toBe(1);
      expect(res.tracks[0].title).toBe("Midnight City");
    });

    it("applies structured filters: genre, year_min, bpm_min", () => {
      const res = searchLibrary(db, {
        genre: "Synthwave",
        year_min: 2018,
        bpm_min: 120,
      });
      expect(res.count).toBe(1);
      expect(res.tracks[0].title).toBe("Midnight City");
    });

    it("applies loudness LUFS filters", () => {
      const res = searchLibrary(db, {
        lufs_min: -15.0,
        lufs_max: -10.0,
      });
      expect(res.count).toBe(2);
      const titles = res.tracks.map((t) => t.title);
      expect(titles).toContain("Midnight City");
      expect(titles).toContain("Resonance");
    });

    it("filters out unavailable tracks", () => {
      const res = searchLibrary(db, { query: "Missing Track" });
      expect(res.count).toBe(0);
    });

    it("respects limit parameter", () => {
      const res = searchLibrary(db, { limit: 2 });
      expect(res.count).toBe(2);
      expect(res.tracks.length).toBe(2);
    });
  });

  describe("getTrackDetails", () => {
    it("retrieves full metadata and technical specs", () => {
      const track = getTrackDetails(db, 1);
      expect(track).not.toBeNull();
      if (!track) return;

      expect(track.id).toBe(1);
      expect(track.metadata.title).toBe("Midnight City");
      expect(track.metadata.artist).toBe("M83");
      expect(track.metadata.performer).toBe("Rick Rubin");
      expect(track.technical_specs.file_type).toBe("FLAC");
      expect(track.technical_specs.sample_rate_hz).toBe(44100);
      expect(track.technical_specs.bit_depth).toBe(16);
      expect(track.technical_specs.channels).toBe(2);
      expect(track.technical_specs.duration_seconds).toBe(244);
      expect(track.acoustic_measurements.loudness_lufs).toBe(-10.5);
      expect(track.acoustic_measurements.loudness_range_lu).toBe(6.2);
      expect(track.acoustic_measurements.bpm).toBe(125);
      expect(track.lyrics.has_lyrics).toBe(true);
      expect(track.lyrics.is_synced).toBe(true);
      expect(track.lyrics.text).toBeNull();
      expect(track.identifiers.musicbrainz_recording_id).toBe("mb-rec-1");
      expect(track.identifiers.barcode).toBe("123456789");
    });

    it("includes lyrics text when include_lyrics is true", () => {
      const track = getTrackDetails(db, 1, { include_lyrics: true });
      expect(track).not.toBeNull();
      if (!track) return;

      expect(track.lyrics.has_lyrics).toBe(true);
      expect(track.lyrics.is_synced).toBe(true);
      expect(track.lyrics.text).toContain("Waiting in a car");
    });

    it("detects unsynchronized lyrics correctly", () => {
      const track = getTrackDetails(db, 3);
      expect(track).not.toBeNull();
      if (!track) return;

      expect(track.lyrics.has_lyrics).toBe(true);
      expect(track.lyrics.is_synced).toBe(false);
    });

    it("returns null for nonexistent track ID", () => {
      const track = getTrackDetails(db, 9999);
      expect(track).toBeNull();
    });
  });

  describe("getArtistSummary", () => {
    it("aggregates catalog, collaborators, composers, and listening stats", () => {
      const summary = getArtistSummary(db, "Miles Davis");
      expect(summary.found).toBe(true);
      expect(summary.total_tracks).toBe(2);
      expect(summary.total_albums).toBe(1);
      expect(summary.albums[0].name).toBe("Kind of Blue");
      expect(summary.albums[0].year).toBe(1959);
      expect(summary.genres).toContain("Jazz");
      expect(summary.genres).toContain("Modal Jazz");
      expect(summary.collaborators).toContain("John Coltrane");
      expect(summary.composers).toContain("Bill Evans");
      expect(summary.producers).toContain("Cannonball Adderley");
      expect(summary.stats.total_play_count).toBe(28); // 20 + 8
      expect(summary.stats.total_skip_count).toBe(2); // 2 + 0
      expect(summary.stats.most_played_tracks[0].title).toBe("So What");
      expect(summary.stats.most_played_tracks[0].play_count).toBe(20);
    });

    it("returns empty result when artist is not found", () => {
      const summary = getArtistSummary(db, "Nonexistent Artist");
      expect(summary.found).toBe(false);
      expect(summary.total_tracks).toBe(0);
      expect(summary.total_albums).toBe(0);
    });
  });
});

describe("MCP Library Tools Integration", () => {
  let tempDir: string;
  let tempDbPath: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "luminous-mcp-lib-test-"));
    tempDbPath = path.join(tempDir, "luminous.db");
    initTestDb(tempDbPath);
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error
    }
  });

  it("lists all library tools alongside system tools", async () => {
    const { server, db } = createMcpServer({ dbPath: tempDbPath });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test-client", version: "1.0.0" }, { capabilities: {} });

    await server.connect(serverTransport);
    await client.connect(clientTransport);

    const toolsResult = await client.listTools();
    const toolNames = toolsResult.tools.map((t) => t.name);

    expect(toolNames).toContain("ping");
    expect(toolNames).toContain("get_server_info");
    expect(toolNames).toContain("search_library");
    expect(toolNames).toContain("get_track_details");
    expect(toolNames).toContain("get_artist_summary");

    await client.close();
    await server.close();
    db.close();
  });

  it("calls search_library tool via MCP", async () => {
    const { server, db } = createMcpServer({ dbPath: tempDbPath });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test-client", version: "1.0.0" }, { capabilities: {} });

    await server.connect(serverTransport);
    await client.connect(clientTransport);

    const result = await client.callTool({
      name: "search_library",
      arguments: {
        query: "synthwave",
        bpm_min: 110,
      },
    });

    const firstContent = getTextContent(result);
    const parsed = JSON.parse(firstContent.text);

    expect(parsed.count).toBe(1);
    expect(parsed.tracks[0].title).toBe("Midnight City");
    expect(parsed.tracks[0].composer).toBe("Anthony Gonzalez; Yann Gonzalez");
    expect(parsed.tracks[0].performer).toBe("Rick Rubin");

    await client.close();
    await server.close();
    db.close();
  });

  it("calls search_library tool via MCP and strips null fields on tracks", async () => {
    const { server, db } = createMcpServer({ dbPath: tempDbPath });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test-client", version: "1.0.0" }, { capabilities: {} });

    await server.connect(serverTransport);
    await client.connect(clientTransport);

    const result = await client.callTool({
      name: "search_library",
      arguments: {
        query: "Resonance",
      },
    });

    const firstContent = getTextContent(result);
    const parsed = JSON.parse(firstContent.text);

    expect(parsed.count).toBe(1);
    expect(parsed.tracks[0].title).toBe("Resonance");
    expect(parsed.tracks[0].composer).toBe("Randy Goffe");
    // Performer is null in DB, so it must be stripped
    expect(parsed.tracks[0].performer).toBeUndefined();

    await client.close();
    await server.close();
    db.close();
  });

  it("calls get_track_details tool via MCP", async () => {
    const { server, db } = createMcpServer({ dbPath: tempDbPath });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test-client", version: "1.0.0" }, { capabilities: {} });

    await server.connect(serverTransport);
    await client.connect(clientTransport);

    const result = await client.callTool({
      name: "get_track_details",
      arguments: {
        track_id: 1,
      },
    });

    const firstContent = getTextContent(result);
    const parsed = JSON.parse(firstContent.text);

    expect(parsed.id).toBe(1);
    expect(parsed.metadata.title).toBe("Midnight City");
    expect(parsed.metadata.artist).toBe("M83");
    expect(parsed.technical_specs.file_type).toBe("FLAC");
    expect(parsed.metadata.comment).toBeUndefined();
    expect(parsed.identifiers?.musicbrainz_album_id).toBeUndefined();
    expect(parsed.lyrics.has_lyrics).toBe(true);
    expect(parsed.lyrics.text).toBeUndefined();

    await client.close();
    await server.close();
    db.close();
  });

  it("calls get_track_details tool via MCP with include_lyrics: true", async () => {
    const { server, db } = createMcpServer({ dbPath: tempDbPath });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test-client", version: "1.0.0" }, { capabilities: {} });

    await server.connect(serverTransport);
    await client.connect(clientTransport);

    const result = await client.callTool({
      name: "get_track_details",
      arguments: {
        track_id: 1,
        include_lyrics: true,
      },
    });

    const firstContent = getTextContent(result);
    const parsed = JSON.parse(firstContent.text);

    expect(parsed.id).toBe(1);
    expect(parsed.lyrics.has_lyrics).toBe(true);
    expect(parsed.lyrics.text).toContain("Waiting in a car");

    await client.close();
    await server.close();
    db.close();
  });

  it("calls get_artist_summary tool via MCP", async () => {
    const { server, db } = createMcpServer({ dbPath: tempDbPath });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test-client", version: "1.0.0" }, { capabilities: {} });

    await server.connect(serverTransport);
    await client.connect(clientTransport);

    const result = await client.callTool({
      name: "get_artist_summary",
      arguments: {
        artist: "Miles Davis",
      },
    });

    const firstContent = getTextContent(result);
    const parsed = JSON.parse(firstContent.text);

    expect(parsed.found).toBe(true);
    expect(parsed.total_tracks).toBe(2);
    expect(parsed.albums[0].name).toBe("Kind of Blue");
    expect(parsed.collaborators).toContain("John Coltrane");

    await client.close();
    await server.close();
    db.close();
  });

  it("returns error message when track_id is not found", async () => {
    const { server, db } = createMcpServer({ dbPath: tempDbPath });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test-client", version: "1.0.0" }, { capabilities: {} });

    await server.connect(serverTransport);
    await client.connect(clientTransport);

    const result = await client.callTool({
      name: "get_track_details",
      arguments: {
        track_id: 99999,
      },
    });

    expect(result.isError).toBe(true);
    const firstContent = getTextContent(result);
    expect(firstContent.text).toContain("Track with ID 99999 was not found");

    await client.close();
    await server.close();
    db.close();
  });

  it("returns error message when database file is missing", async () => {
    const missingDb = path.join(tempDir, "missing.db");
    const { server, db } = createMcpServer({ dbPath: missingDb });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test-client", version: "1.0.0" }, { capabilities: {} });

    await server.connect(serverTransport);
    await client.connect(clientTransport);

    const result = await client.callTool({
      name: "search_library",
      arguments: { query: "test" },
    });

    expect(result.isError).toBe(true);
    const firstContent = getTextContent(result);
    expect(firstContent.text).toContain("Luminous database file not found");

    await client.close();
    await server.close();
    db.close();
  });
});
