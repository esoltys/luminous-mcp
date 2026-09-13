import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { KNOWN_SCHEMA_VERSION } from "../src/constants.ts";
import { LuminousBridgeClient } from "../src/bridge/client.ts";
import {
  auditMetadata,
  extractBioLinks,
  getAlbumProfile,
  getArtistProfile,
  getGenreHierarchy,
  lookupMusicBrainz,
  updateAlbumProfile,
  updateArtistProfile,
  updateTrackMetadata,
} from "../src/db/curation.ts";
import { createMcpServer } from "../src/server.ts";

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

function setupCurationTestDb(dbPath: string): Database {
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
      composer TEXT,
      performer TEXT,
      year INTEGER,
      genre TEXT,
      lyrics TEXT,
      track INTEGER,
      disc INTEGER,
      art_embedded BOOLEAN NOT NULL DEFAULT 0,
      art_automatic TEXT,
      art_manual TEXT,
      ebur128_integrated_loudness_lufs REAL,
      path TEXT,
      musicbrainz_recording_id TEXT,
      musicbrainz_artist_id TEXT,
      musicbrainz_album_id TEXT,
      musicbrainz_release_group_id TEXT,
      unavailable BOOLEAN NOT NULL DEFAULT 0
    );
  `);

  db.run(`
    CREATE VIRTUAL TABLE songs_fts USING fts5(
      title, artist, album, album_artist, composer, performer, genre,
      content='songs',
      content_rowid='id'
    );
  `);

  db.run(`
    CREATE TRIGGER songs_ai AFTER INSERT ON songs BEGIN
      INSERT INTO songs_fts(rowid, title, artist, album, album_artist, composer, performer, genre)
      VALUES (new.id, new.title, new.artist, new.album, new.album_artist, new.composer, new.performer, new.genre);
    END;
  `);

  db.run(`
    CREATE TRIGGER songs_au AFTER UPDATE ON songs BEGIN
      INSERT INTO songs_fts(songs_fts, rowid, title, artist, album, album_artist, composer, performer, genre)
      VALUES ('delete', old.id, old.title, old.artist, old.album, old.album_artist, old.composer, old.performer, old.genre);
      INSERT INTO songs_fts(rowid, title, artist, album, album_artist, composer, performer, genre)
      VALUES (new.id, new.title, new.artist, new.album, new.album_artist, new.composer, new.performer, new.genre);
    END;
  `);

  db.run(`
    CREATE TABLE tag_groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE COLLATE NOCASE,
      color_index INTEGER NOT NULL DEFAULT 0,
      sort_order INTEGER NOT NULL DEFAULT 0
    );
  `);

  db.run(`
    CREATE TABLE tag_assignments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tag_name TEXT NOT NULL UNIQUE COLLATE NOCASE,
      group_id INTEGER NOT NULL REFERENCES tag_groups(id) ON DELETE CASCADE,
      sort_order INTEGER NOT NULL DEFAULT 0
    );
  `);

  db.run(`
    CREATE TABLE tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL COLLATE NOCASE
    );
  `);

  db.run(`
    CREATE TABLE artist_profiles (
      artist_key TEXT PRIMARY KEY,
      website TEXT,
      tags TEXT NOT NULL DEFAULT '[]',
      social_links TEXT NOT NULL DEFAULT '[]',
      bio TEXT
    );
  `);

  db.run(`
    CREATE TABLE album_profiles (
      album_key TEXT PRIMARY KEY,
      artist_key TEXT,
      description TEXT,
      website TEXT,
      tags TEXT NOT NULL DEFAULT '[]',
      links TEXT NOT NULL DEFAULT '[]'
    );
  `);

  db.run(`
    CREATE TABLE artist_context_enrichment (
      artist_id TEXT PRIMARY KEY,
      wikidata_id TEXT,
      wikipedia_extract TEXT,
      wikipedia_page_url TEXT,
      wikipedia_thumbnail_url TEXT,
      fetched_at INTEGER NOT NULL
    );
  `);

  db.run(`
    CREATE TABLE context_enrichment (
      release_group_id TEXT PRIMARY KEY,
      mb_rating REAL,
      mb_rating_votes INTEGER,
      mb_tags TEXT NOT NULL DEFAULT '[]',
      mb_release_country TEXT,
      critiquebrainz_rating REAL,
      critiquebrainz_review_count INTEGER,
      critiquebrainz_review_links TEXT NOT NULL DEFAULT '[]',
      fetched_at INTEGER NOT NULL
    );
  `);

  // Seed sample tracks
  // Track 1: Completely clean track
  db.run(`
    INSERT INTO songs (
      id, title, artist, album, album_artist, composer, year, genre, lyrics,
      art_embedded, art_automatic, ebur128_integrated_loudness_lufs, path,
      musicbrainz_recording_id, musicbrainz_artist_id, musicbrainz_album_id, musicbrainz_release_group_id
    ) VALUES (
      1, 'Clean Track', 'Clean Artist', 'Clean Album', 'Clean Artist', 'Clean Composer',
      2022, 'Progressive Metal', 'Verse 1 lyrics here', 1, NULL, -14.2, '/music/clean.flac',
      '01319197-fa4c-4905-b87b-74991ff494f3', '9c935736-7530-41e4-b776-1dbcf534c061',
      'ab023b45-e9f7-46fa-8fde-431f87074472', '68ee0e21-a7c2-467d-8808-fd38fec2ffb8'
    );
  `);

  // Track 2: Missing year (null) and lyrics (null)
  db.run(`
    INSERT INTO songs (
      id, title, artist, album, album_artist, composer, year, genre, lyrics,
      art_embedded, art_automatic, ebur128_integrated_loudness_lufs, path
    ) VALUES (
      2, 'No Year Track', 'Folk Artist', 'Folk Album', 'Folk Artist', 'Folk Composer',
      NULL, 'Folk', NULL, 0, '/covers/folk.jpg', -15.0, '/music/folk.flac'
    );
  `);

  // Track 3: Missing genre, composer, art, loudness
  db.run(`
    INSERT INTO songs (
      id, title, artist, album, album_artist, composer, year, genre, lyrics,
      art_embedded, art_automatic, ebur128_integrated_loudness_lufs, path
    ) VALUES (
      3, 'Mystery Track', 'Mystery Artist', 'Mystery Album', 'Mystery Artist', '',
      2020, '', 'Some lyrics here', 0, NULL, NULL, '/music/mystery.mp3'
    );
  `);

  // Track 4: Year is 0, missing art
  db.run(`
    INSERT INTO songs (
      id, title, artist, album, album_artist, composer, year, genre, lyrics,
      art_embedded, art_automatic, ebur128_integrated_loudness_lufs, path
    ) VALUES (
      4, 'Zero Year Track', 'Electronic Artist', 'Synth Album', 'Electronic Artist', 'Synth Composer',
      0, 'Ambient', 'Ambient vocoder', 0, '', -12.5, '/music/synth.flac'
    );
  `);

  // Track 5: Unavailable track (should be excluded from audit)
  db.run(`
    INSERT INTO songs (
      id, title, artist, album, album_artist, composer, year, genre, lyrics,
      art_embedded, art_automatic, ebur128_integrated_loudness_lufs, path, unavailable
    ) VALUES (
      5, 'Missing File', 'Ghost Artist', 'Ghost Album', 'Ghost Artist', NULL,
      NULL, NULL, NULL, 0, NULL, NULL, '/music/ghost.flac', 1
    );
  `);

  // Seed tag groups
  db.run("INSERT INTO tag_groups (id, name, color_index, sort_order) VALUES (1, 'Metal', 0, 1);");
  db.run("INSERT INTO tag_groups (id, name, color_index, sort_order) VALUES (2, 'Electronic', 5, 2);");

  // Seed tag assignments
  db.run("INSERT INTO tag_assignments (id, tag_name, group_id, sort_order) VALUES (1, 'Progressive Metal', 1, 1);");
  db.run("INSERT INTO tag_assignments (id, tag_name, group_id, sort_order) VALUES (2, 'Ambient', 2, 1);");

  // Seed tags table
  db.run("INSERT INTO tags (id, name) VALUES (1, 'Progressive Metal');");
  db.run("INSERT INTO tags (id, name) VALUES (2, 'Post-Rock');"); // Tag in tags table but unassigned to any group

  // Seed artist profile and enrichment
  db.run(`
    INSERT INTO artist_profiles (artist_key, website, tags, social_links, bio)
    VALUES ('Clean Artist', 'https://cleanartist.example.com', '["progressive metal","ambient"]', '[{"platform":"instagram","handle_or_url":"@cleanartist"}]', 'Clean Artist is an acclaimed progressive metal artist.');
  `);
  db.run(`
    INSERT INTO artist_context_enrichment (artist_id, wikidata_id, wikipedia_extract, wikipedia_page_url, wikipedia_thumbnail_url, fetched_at)
    VALUES ('9c935736-7530-41e4-b776-1dbcf534c061', 'Q12345', 'Clean Artist is a music project formed in 2020.', 'https://en.wikipedia.org/wiki/Clean_Artist', 'https://example.com/thumb.jpg', 1789280000);
  `);
  db.run(`
    INSERT INTO context_enrichment (release_group_id, mb_rating, critiquebrainz_rating, mb_tags, mb_release_country, critiquebrainz_review_count, critiquebrainz_review_links, fetched_at)
    VALUES ('68ee0e21-a7c2-467d-8808-fd38fec2ffb8', 4.5, 4.0, '["progressive metal"]', 'CA', 2, '[]', 1789280000);
  `);
  db.run(`
    INSERT INTO album_profiles (album_key, artist_key, description, website, tags, links)
    VALUES ('Clean Album', 'Clean Artist', 'Acclaimed progressive metal masterpiece. Sources: [Wikipedia](https://en.wikipedia.org/wiki/Clean_Album) and [Pitchfork Review](https://pitchfork.com/reviews/clean-album). Also see https://bandcamp.com/clean-album', 'https://cleanartist.example.com/clean-album', '["concept album","remaster"]', '[{"platform":"bandcamp","title":"Bandcamp Store","url":"https://cleanartist.bandcamp.com/album/clean-album","category":"store"}]');
  `);

  return db;
}

describe("Metadata Hygiene & Curation Database Layer", () => {
  let tempDir: string;
  let tempDbPath: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "luminous-curation-test-"));
    tempDbPath = path.join(tempDir, "luminous.db");
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error
    }
  });

  describe("auditMetadata", () => {
    it("computes accurate library-wide hygiene metrics", () => {
      const db = setupCurationTestDb(tempDbPath);
      const result = auditMetadata(db);

      // 4 available tracks (track 5 is unavailable)
      expect(result.summary.total_tracks).toBe(4);
      expect(result.summary.clean_tracks_count).toBe(1); // Track 1 is completely clean

      // Missing counts across the 4 tracks:
      // Track 1: clean (none missing)
      // Track 2: missing year (null), missing lyrics (null)
      // Track 3: missing genre (''), missing composer (''), missing art (art_embedded=0, art_auto=null), missing loudness (null)
      // Track 4: missing year (0), missing art (art_embedded=0, art_auto='')
      expect(result.summary.missing_year_count).toBe(2); // Tracks 2 and 4
      expect(result.summary.missing_genre_count).toBe(1); // Track 3
      expect(result.summary.missing_composer_count).toBe(1); // Track 3
      expect(result.summary.missing_lyrics_count).toBe(1); // Track 2
      expect(result.summary.missing_art_count).toBe(2); // Tracks 3 and 4
      expect(result.summary.missing_loudness_count).toBe(1); // Track 3

      db.close();
    });

    it("filters sample tracks by specific missing fields with operator any", () => {
      const db = setupCurationTestDb(tempDbPath);

      // Tracks missing year or art
      const result = auditMetadata(db, {
        missing_fields: ["year", "art"],
        operator: "any",
      });

      // Track 2 has missing year
      // Track 3 has missing art
      // Track 4 has missing year and art
      expect(result.pagination.total_matching).toBe(3);
      const trackIds = result.tracks.map((t) => t.id);
      expect(trackIds).toContain(2);
      expect(trackIds).toContain(3);
      expect(trackIds).toContain(4);
      expect(trackIds).not.toContain(1);

      db.close();
    });

    it("filters sample tracks by specific missing fields with operator all", () => {
      const db = setupCurationTestDb(tempDbPath);

      // Tracks missing BOTH year and art
      const result = auditMetadata(db, {
        missing_fields: ["year", "art"],
        operator: "all",
      });

      // Only Track 4 has both missing year (0) and missing art
      expect(result.pagination.total_matching).toBe(1);
      expect(result.tracks[0].id).toBe(4);
      expect(result.tracks[0].missing_fields).toContain("year");
      expect(result.tracks[0].missing_fields).toContain("art");

      db.close();
    });

    it("filters sample tracks by artist and album", () => {
      const db = setupCurationTestDb(tempDbPath);

      const result = auditMetadata(db, {
        artist: "Folk",
        missing_fields: ["lyrics"],
      });

      expect(result.pagination.total_matching).toBe(1);
      expect(result.tracks[0].id).toBe(2);
      expect(result.tracks[0].title).toBe("No Year Track");

      db.close();
    });

    it("paginates sample tracks with limit and offset", () => {
      const db = setupCurationTestDb(tempDbPath);

      const page1 = auditMetadata(db, {
        limit: 2,
        offset: 0,
      });

      expect(page1.tracks.length).toBe(2);
      expect(page1.pagination.limit).toBe(2);
      expect(page1.pagination.offset).toBe(0);
      expect(page1.pagination.has_more).toBe(true);

      const page2 = auditMetadata(db, {
        limit: 2,
        offset: 2,
      });

      expect(page2.tracks.length).toBe(1);
      expect(page2.pagination.offset).toBe(2);
      expect(page2.pagination.has_more).toBe(false);

      db.close();
    });

    it("handles database without songs table gracefully", () => {
      const emptyDb = new Database(tempDbPath);
      const result = auditMetadata(emptyDb);

      expect(result.summary.total_tracks).toBe(0);
      expect(result.tracks.length).toBe(0);
      expect(result.pagination.total_matching).toBe(0);

      emptyDb.close();
    });
  });

  describe("getGenreHierarchy", () => {
    it("returns structured tag groups and assignments", () => {
      const db = setupCurationTestDb(tempDbPath);
      const result = getGenreHierarchy(db);

      expect(result.total_groups).toBe(2);
      expect(result.total_assigned_tags).toBe(2);

      const metalGroup = result.groups.find((g) => g.name === "Metal");
      expect(metalGroup).toBeDefined();
      expect(metalGroup?.color_index).toBe(0);
      expect(metalGroup?.tags.length).toBe(1);
      expect(metalGroup?.tags[0].tag_name).toBe("Progressive Metal");

      const electronicGroup = result.groups.find((g) => g.name === "Electronic");
      expect(electronicGroup).toBeDefined();
      expect(electronicGroup?.color_index).toBe(5);
      expect(electronicGroup?.tags.length).toBe(1);
      expect(electronicGroup?.tags[0].tag_name).toBe("Ambient");

      db.close();
    });

    it("identifies unassigned genre tags from songs and tags table", () => {
      const db = setupCurationTestDb(tempDbPath);
      const result = getGenreHierarchy(db, { include_unassigned: true });

      // In songs: Track 2 has genre 'Folk' (not assigned to any group)
      // In tags: 'Post-Rock' exists (not assigned to any group)
      expect(result.unassigned_tags).toContain("Folk");
      expect(result.unassigned_tags).toContain("Post-Rock");
      expect(result.total_unassigned_tags).toBeGreaterThanOrEqual(2);

      db.close();
    });

    it("excludes unassigned tags when include_unassigned is false", () => {
      const db = setupCurationTestDb(tempDbPath);
      const result = getGenreHierarchy(db, { include_unassigned: false });

      expect(result.unassigned_tags.length).toBe(0);
      expect(result.total_unassigned_tags).toBe(0);

      db.close();
    });

    it("gracefully falls back when tag_groups and tag_assignments tables are absent", () => {
      const minimalDb = new Database(tempDbPath);
      minimalDb.run("CREATE TABLE songs (id INTEGER PRIMARY KEY, genre TEXT, unavailable BOOLEAN DEFAULT 0);");
      minimalDb.run("INSERT INTO songs (id, genre) VALUES (1, 'Jazz'), (2, 'Blues');");

      const result = getGenreHierarchy(minimalDb);

      expect(result.groups.length).toBe(0);
      expect(result.total_groups).toBe(0);
      expect(result.unassigned_tags).toEqual(["Blues", "Jazz"]);

      minimalDb.close();
    });
  });

  describe("updateTrackMetadata", () => {
    it("updates metadata fields on a single track", () => {
      const db = setupCurationTestDb(tempDbPath);

      const updateResult = updateTrackMetadata(db, {
        track_id: 3,
        genre: "Post-Rock",
        year: 2023,
        composer: "New Composer",
      });

      expect(updateResult.success).toBe(true);
      expect(updateResult.updated_count).toBe(1);
      expect(updateResult.updated_track_ids).toEqual([3]);
      expect(updateResult.updated_fields).toEqual({
        genre: "Post-Rock",
        year: 2023,
        composer: "New Composer",
      });

      // Verify row in database
      const row = db
        .query<{ genre: string; year: number; composer: string }, [number]>(
          "SELECT genre, year, composer FROM songs WHERE id = ?"
        )
        .get(3);

      expect(row?.genre).toBe("Post-Rock");
      expect(row?.year).toBe(2023);
      expect(row?.composer).toBe("New Composer");

      // Verify FTS virtual table was kept in sync via trigger
      const ftsMatches = db
        .query<{ rowid: number }, [string]>(
          "SELECT rowid FROM songs_fts WHERE songs_fts MATCH ?"
        )
        .all('"Post-Rock"');

      expect(ftsMatches.some((m) => m.rowid === 3)).toBe(true);

      db.close();
    });

    it("updates metadata in batch across multiple tracks", () => {
      const db = setupCurationTestDb(tempDbPath);

      const updateResult = updateTrackMetadata(db, {
        track_ids: [2, 4],
        genre: "Nordic Ambient",
        year: 2024,
      });

      expect(updateResult.success).toBe(true);
      expect(updateResult.updated_count).toBe(2);
      expect(updateResult.updated_track_ids).toEqual([2, 4]);

      const rows = db
        .query<{ id: number; genre: string; year: number }, []>(
          "SELECT id, genre, year FROM songs WHERE id IN (2, 4) ORDER BY id ASC"
        )
        .all();

      expect(rows[0].genre).toBe("Nordic Ambient");
      expect(rows[0].year).toBe(2024);
      expect(rows[1].genre).toBe("Nordic Ambient");
      expect(rows[1].year).toBe(2024);

      db.close();
    });

    it("rejects request when neither track_id nor track_ids is provided", () => {
      const db = setupCurationTestDb(tempDbPath);

      expect(() => {
        updateTrackMetadata(db, { genre: "Rock" });
      }).toThrow("Either track_id or track_ids must be provided");

      db.close();
    });

    it("rejects request when no metadata fields are specified", () => {
      const db = setupCurationTestDb(tempDbPath);

      expect(() => {
        updateTrackMetadata(db, { track_id: 1 });
      }).toThrow("At least one metadata field must be specified");

      db.close();
    });

    it("rejects request when track ID does not exist", () => {
      const db = setupCurationTestDb(tempDbPath);

      expect(() => {
        updateTrackMetadata(db, { track_id: 999, genre: "Pop" });
      }).toThrow("Track ID(s) not found in library: 999");

      db.close();
    });
  });

  describe("getArtistProfile", () => {
    it("retrieves artist profile and Wikipedia context enrichment", () => {
      const db = setupCurationTestDb(tempDbPath);

      const profile = getArtistProfile(db, { artist: "Clean Artist" });

      expect(profile).not.toBeNull();
      expect(profile?.artist).toBe("Clean Artist");
      expect(profile?.website).toBe("https://cleanartist.example.com");
      expect(profile?.bio).toContain("Clean Artist is an acclaimed progressive metal artist.");
      expect(profile?.tags).toEqual(["progressive metal", "ambient"]);
      expect(profile?.social_links.length).toBe(1);
      expect(profile?.musicbrainz_artist_id).toBe("9c935736-7530-41e4-b776-1dbcf534c061");
      expect(profile?.wikipedia?.extract).toContain("Clean Artist is a music project formed in 2020.");
      expect(profile?.wikipedia?.wikidata_id).toBe("Q12345");

      db.close();
    });

    it("retrieves artist profile by artist_id MBID", () => {
      const db = setupCurationTestDb(tempDbPath);

      const profile = getArtistProfile(db, { artist_id: "9c935736-7530-41e4-b776-1dbcf534c061" });

      expect(profile).not.toBeNull();
      expect(profile?.artist).toBe("Clean Artist");
      expect(profile?.musicbrainz_artist_id).toBe("9c935736-7530-41e4-b776-1dbcf534c061");

      db.close();
    });

    it("returns null when artist is not found in database", () => {
      const db = setupCurationTestDb(tempDbPath);

      const profile = getArtistProfile(db, { artist: "Nonexistent Artist" });

      expect(profile).toBeNull();

      db.close();
    });
  });

  describe("updateArtistProfile", () => {
    it("creates a new artist profile when none exists", () => {
      const db = setupCurationTestDb(tempDbPath);

      const result = updateArtistProfile(db, {
        artist: "New Artist",
        website: "https://newartist.example.com",
        bio: "Bio for new artist",
        tags: ["indie", "electronic"],
        social_links: [{ platform: "twitter", handle_or_url: "@newartist" }],
      });

      expect(result.success).toBe(true);
      expect(result.artist).toBe("New Artist");
      expect(result.profile.website).toBe("https://newartist.example.com");
      expect(result.profile.bio).toBe("Bio for new artist");
      expect(result.profile.tags).toEqual(["indie", "electronic"]);

      db.close();
    });

    it("updates an existing artist profile preserving untouched fields", () => {
      const db = setupCurationTestDb(tempDbPath);

      const result = updateArtistProfile(db, {
        artist: "Clean Artist",
        bio: "Updated bio for clean artist.",
      });

      expect(result.success).toBe(true);
      expect(result.profile.bio).toBe("Updated bio for clean artist.");
      expect(result.profile.website).toBe("https://cleanartist.example.com");
      expect(result.profile.tags).toEqual(["progressive metal", "ambient"]);

      db.close();
    });

    it("rejects update when artist name is empty", () => {
      const db = setupCurationTestDb(tempDbPath);

      expect(() => {
        updateArtistProfile(db, { artist: "", bio: "Hello" });
      }).toThrow("Artist name must not be empty");

      db.close();
    });

    it("rejects update when no fields are specified", () => {
      const db = setupCurationTestDb(tempDbPath);

      expect(() => {
        updateArtistProfile(db, { artist: "Some Artist" });
      }).toThrow("At least one profile field");

      db.close();
    });
  });

  describe("extractBioLinks", () => {
    it("extracts markdown links and bare URLs without duplicate entries", () => {
      const text =
        "Debut studio album released in 2021. Citations: [Wikipedia Article](https://en.wikipedia.org/wiki/Clean_Album) and [Pitchfork Review](https://pitchfork.com/reviews/clean-album). Also check https://bandcamp.com/clean-album and https://cleanartist.example.com.";
      const links = extractBioLinks(text);

      expect(links.length).toBe(4);
      expect(links[0]).toEqual({
        title: "Wikipedia Article",
        url: "https://en.wikipedia.org/wiki/Clean_Album",
      });
      expect(links[1]).toEqual({
        title: "Pitchfork Review",
        url: "https://pitchfork.com/reviews/clean-album",
      });
      expect(links[2]).toEqual({
        title: "bandcamp.com",
        url: "https://bandcamp.com/clean-album",
      });
      expect(links[3]).toEqual({
        title: "cleanartist.example.com",
        url: "https://cleanartist.example.com",
      });
    });

    it("returns empty array for text with no links or null/undefined", () => {
      expect(extractBioLinks("Just plain text with no links.")).toEqual([]);
      expect(extractBioLinks(null)).toEqual([]);
      expect(extractBioLinks(undefined)).toEqual([]);
    });
  });

  describe("getAlbumProfile", () => {
    it("retrieves album profile by album name with tags, links, and extracted sources", () => {
      const db = setupCurationTestDb(tempDbPath);

      const profile = getAlbumProfile(db, { album: "Clean Album" });

      expect(profile).not.toBeNull();
      expect(profile?.album).toBe("Clean Album");
      expect(profile?.artist).toBe("Clean Artist");
      expect(profile?.website).toBe("https://cleanartist.example.com/clean-album");
      expect(profile?.description).toContain("Acclaimed progressive metal masterpiece.");
      expect(profile?.tags).toEqual(["concept album", "remaster"]);
      expect(profile?.links.length).toBe(1);
      expect(profile?.release_group_mbid).toBe("68ee0e21-a7c2-467d-8808-fd38fec2ffb8");

      // Verify sources extracted from markdown description
      expect(profile?.sources).toBeDefined();
      expect(profile?.sources?.length).toBe(3);
      expect(profile?.sources?.[0].title).toBe("Wikipedia");
      expect(profile?.sources?.[0].url).toBe("https://en.wikipedia.org/wiki/Clean_Album");
      expect(profile?.sources?.[1].title).toBe("Pitchfork Review");
      expect(profile?.sources?.[1].url).toBe("https://pitchfork.com/reviews/clean-album");
      expect(profile?.sources?.[2].url).toBe("https://bandcamp.com/clean-album");

      // Verify context enrichment
      expect(profile?.context_enrichment).toBeDefined();
      expect(profile?.context_enrichment?.mb_rating).toBe(4.5);
      expect(profile?.context_enrichment?.mb_release_country).toBe("CA");

      db.close();
    });

    it("retrieves album profile by release_group_id MBID", () => {
      const db = setupCurationTestDb(tempDbPath);

      const profile = getAlbumProfile(db, {
        release_group_id: "68ee0e21-a7c2-467d-8808-fd38fec2ffb8",
      });

      expect(profile).not.toBeNull();
      expect(profile?.album).toBe("Clean Album");
      expect(profile?.release_group_mbid).toBe("68ee0e21-a7c2-467d-8808-fd38fec2ffb8");

      db.close();
    });

    it("returns null when album is not found in database", () => {
      const db = setupCurationTestDb(tempDbPath);

      const profile = getAlbumProfile(db, { album: "Nonexistent Album" });

      expect(profile).toBeNull();

      db.close();
    });

    it("throws error when neither album nor release_group_id is provided", () => {
      const db = setupCurationTestDb(tempDbPath);

      expect(() => {
        getAlbumProfile(db, {});
      }).toThrow("Either album or release_group_id must be provided");

      db.close();
    });
  });

  describe("updateAlbumProfile", () => {
    it("creates a new album profile when none exists", () => {
      const db = setupCurationTestDb(tempDbPath);

      const result = updateAlbumProfile(db, {
        album: "New Album",
        artist: "New Artist",
        description: "Fresh new release notes citing [AllMusic](https://www.allmusic.com/album/new).",
        website: "https://newalbum.example.com",
        tags: ["debut", "electronic"],
        links: [
          {
            platform: "bandcamp",
            title: "Bandcamp",
            url: "https://newartist.bandcamp.com/album/new",
            category: "store",
          },
        ],
      });

      expect(result.success).toBe(true);
      expect(result.album).toBe("New Album");
      expect(result.profile.artist).toBe("New Artist");
      expect(result.profile.description).toContain("Fresh new release notes");
      expect(result.profile.website).toBe("https://newalbum.example.com");
      expect(result.profile.tags).toEqual(["debut", "electronic"]);
      expect(result.profile.links.length).toBe(1);
      expect(result.profile.sources?.length).toBe(1);
      expect(result.profile.sources?.[0]).toEqual({
        title: "AllMusic",
        url: "https://www.allmusic.com/album/new",
      });

      db.close();
    });

    it("updates an existing album profile preserving untouched fields", () => {
      const db = setupCurationTestDb(tempDbPath);

      const result = updateAlbumProfile(db, {
        album: "Clean Album",
        description: "Updated description for clean album with [Rolling Stone](https://rollingstone.com/clean).",
      });

      expect(result.success).toBe(true);
      expect(result.profile.description).toContain("Updated description for clean album");
      expect(result.profile.website).toBe("https://cleanartist.example.com/clean-album");
      expect(result.profile.tags).toEqual(["concept album", "remaster"]);
      expect(result.profile.artist).toBe("Clean Artist");
      expect(result.profile.sources?.[0].title).toBe("Rolling Stone");

      db.close();
    });

    it("rejects update when album name is empty", () => {
      const db = setupCurationTestDb(tempDbPath);

      expect(() => {
        updateAlbumProfile(db, { album: "", description: "Hello" });
      }).toThrow("Album name must not be empty");

      db.close();
    });

    it("rejects update when no fields are specified", () => {
      const db = setupCurationTestDb(tempDbPath);

      expect(() => {
        updateAlbumProfile(db, { album: "Some Album" });
      }).toThrow("At least one profile field");

      db.close();
    });
  });

  describe("lookupMusicBrainz", () => {
    it("looks up track MBIDs and returns local context enrichment", async () => {
      const db = setupCurationTestDb(tempDbPath);

      const result = await lookupMusicBrainz(db, {
        track_id: 1,
        fetch_live: false,
      });

      expect(result.track).toBeDefined();
      expect(result.track?.title).toBe("Clean Track");
      expect(result.mbid).toBe("01319197-fa4c-4905-b87b-74991ff494f3");
      expect(result.local_enrichment?.artist_context?.wikipedia_extract).toContain("Clean Artist is a music project");
      expect(result.local_enrichment?.release_group_context?.critiquebrainz_rating).toBe(4.0);
      expect(result.source).toBe("local_cache");

      db.close();
    });

    it("returns not_found when track has no MBID", async () => {
      const db = setupCurationTestDb(tempDbPath);

      const result = await lookupMusicBrainz(db, {
        track_id: 3, // Mystery Track has no MBIDs
        fetch_live: false,
      });

      expect(result.status).toBe("not_found");
      expect(result.mbid).toBeNull();

      db.close();
    });
  });
});

describe("MCP Curation Tools Integration", () => {
  let tempDir: string;
  let tempDbPath: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "luminous-mcp-curation-test-"));
    tempDbPath = path.join(tempDir, "luminous.db");
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error
    }
  });

  it("lists all curation tools alongside existing tools", async () => {
    setupCurationTestDb(tempDbPath);
    const { server, db } = createMcpServer({ dbPath: tempDbPath });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test-client", version: "1.0.0" }, { capabilities: {} });

    await server.connect(serverTransport);
    await client.connect(clientTransport);

    const toolsResult = await client.listTools();
    const toolNames = toolsResult.tools.map((t) => t.name);

    expect(toolNames).toContain("audit_metadata");
    expect(toolNames).toContain("get_genre_hierarchy");
    expect(toolNames).toContain("update_track_metadata");
    expect(toolNames).toContain("get_artist_profile");
    expect(toolNames).toContain("update_artist_profile");
    expect(toolNames).toContain("lookup_musicbrainz");

    await client.close();
    await server.close();
    db.close();
  });

  it("calls audit_metadata tool via MCP", async () => {
    setupCurationTestDb(tempDbPath);
    const { server, db } = createMcpServer({ dbPath: tempDbPath });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test-client", version: "1.0.0" }, { capabilities: {} });

    await server.connect(serverTransport);
    await client.connect(clientTransport);

    const result = await client.callTool({
      name: "audit_metadata",
      arguments: {
        missing_fields: ["year", "art"],
        operator: "any",
        limit: 10,
      },
    });

    const firstContent = getTextContent(result);
    const parsed = JSON.parse(firstContent.text);

    expect(parsed.summary).toBeDefined();
    expect(parsed.summary.total_tracks).toBe(4);
    expect(parsed.tracks).toBeDefined();
    expect(parsed.pagination.total_matching).toBe(3);

    await client.close();
    await server.close();
    db.close();
  });

  it("calls get_genre_hierarchy tool via MCP", async () => {
    setupCurationTestDb(tempDbPath);
    const { server, db } = createMcpServer({ dbPath: tempDbPath });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test-client", version: "1.0.0" }, { capabilities: {} });

    await server.connect(serverTransport);
    await client.connect(clientTransport);

    const result = await client.callTool({
      name: "get_genre_hierarchy",
      arguments: {
        include_unassigned: true,
      },
    });

    const firstContent = getTextContent(result);
    const parsed = JSON.parse(firstContent.text);

    expect(parsed.groups).toBeDefined();
    expect(parsed.groups.length).toBe(2);
    expect(parsed.unassigned_tags).toContain("Folk");

    await client.close();
    await server.close();
    db.close();
  });

  it("calls update_track_metadata tool via MCP", async () => {
    setupCurationTestDb(tempDbPath);
    const { server, db } = createMcpServer({ dbPath: tempDbPath });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test-client", version: "1.0.0" }, { capabilities: {} });

    await server.connect(serverTransport);
    await client.connect(clientTransport);

    const result = await client.callTool({
      name: "update_track_metadata",
      arguments: {
        track_id: 2,
        genre: "Nordic Folk",
        year: 2021,
      },
    });

    const firstContent = getTextContent(result);
    const parsed = JSON.parse(firstContent.text);

    expect(parsed.success).toBe(true);
    expect(parsed.updated_count).toBe(1);
    expect(parsed.updated_track_ids).toEqual([2]);

    await client.close();
    await server.close();
    db.close();
  });

  it("calls get_artist_profile tool via MCP", async () => {
    setupCurationTestDb(tempDbPath);
    const { server, db } = createMcpServer({ dbPath: tempDbPath });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test-client", version: "1.0.0" }, { capabilities: {} });

    await server.connect(serverTransport);
    await client.connect(clientTransport);

    const result = await client.callTool({
      name: "get_artist_profile",
      arguments: {
        artist: "Clean Artist",
      },
    });

    const firstContent = getTextContent(result);
    const parsed = JSON.parse(firstContent.text);

    expect(parsed.artist).toBe("Clean Artist");
    expect(parsed.website).toBe("https://cleanartist.example.com");
    expect(parsed.tags).toContain("progressive metal");

    await client.close();
    await server.close();
    db.close();
  });

  it("calls update_artist_profile tool via MCP", async () => {
    setupCurationTestDb(tempDbPath);
    const { server, db } = createMcpServer({ dbPath: tempDbPath });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test-client", version: "1.0.0" }, { capabilities: {} });

    await server.connect(serverTransport);
    await client.connect(clientTransport);

    const result = await client.callTool({
      name: "update_artist_profile",
      arguments: {
        artist: "Clean Artist",
        bio: "Updated bio via MCP tool call.",
        website: "https://cleanartist.org",
      },
    });

    const firstContent = getTextContent(result);
    const parsed = JSON.parse(firstContent.text);

    expect(parsed.success).toBe(true);
    expect(parsed.profile.bio).toBe("Updated bio via MCP tool call.");
    expect(parsed.profile.website).toBe("https://cleanartist.org");

    await client.close();
    await server.close();
    db.close();
  });

  it("calls get_album_profile tool via MCP", async () => {
    setupCurationTestDb(tempDbPath);
    const { server, db } = createMcpServer({ dbPath: tempDbPath });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test-client", version: "1.0.0" }, { capabilities: {} });

    await server.connect(serverTransport);
    await client.connect(clientTransport);

    const result = await client.callTool({
      name: "get_album_profile",
      arguments: {
        album: "Clean Album",
      },
    });

    const firstContent = getTextContent(result);
    const parsed = JSON.parse(firstContent.text);

    expect(parsed.album).toBe("Clean Album");
    expect(parsed.artist).toBe("Clean Artist");
    expect(parsed.tags).toContain("concept album");
    expect(parsed.links.length).toBe(1);
    expect(parsed.sources.length).toBe(3);
    expect(parsed.sources[0].title).toBe("Wikipedia");

    await client.close();
    await server.close();
    db.close();
  });

  it("calls update_album_profile tool via MCP", async () => {
    setupCurationTestDb(tempDbPath);
    const { server, db } = createMcpServer({ dbPath: tempDbPath });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test-client", version: "1.0.0" }, { capabilities: {} });

    await server.connect(serverTransport);
    await client.connect(clientTransport);

    const result = await client.callTool({
      name: "update_album_profile",
      arguments: {
        album: "Clean Album",
        description: "Curated masterpiece with [Pitchfork Review](https://pitchfork.com/clean) reference.",
        website: "https://cleanartist.org/album",
        tags: ["progressive metal", "masterpiece"],
        links: [
          {
            platform: "bandcamp",
            title: "Bandcamp",
            url: "https://cleanartist.bandcamp.com",
          },
        ],
      },
    });

    const firstContent = getTextContent(result);
    const parsed = JSON.parse(firstContent.text);

    expect(parsed.success).toBe(true);
    expect(parsed.album).toBe("Clean Album");
    expect(parsed.profile.description).toContain("Curated masterpiece");
    expect(parsed.profile.website).toBe("https://cleanartist.org/album");
    expect(parsed.profile.tags).toEqual(["progressive metal", "masterpiece"]);
    expect(parsed.profile.links.length).toBe(1);
    expect(parsed.profile.sources.length).toBe(1);
    expect(parsed.profile.sources[0]).toEqual({
      title: "Pitchfork Review",
      url: "https://pitchfork.com/clean",
    });

    await client.close();
    await server.close();
    db.close();
  });

  describe("extractBioLinks", () => {
    it("parses Wikipedia disambiguation URLs containing parentheses in markdown links", () => {
      const bio =
        "British synthwave band formed in 2014. [Wikipedia](https://en.wikipedia.org/wiki/Gunship_(band)) and [Official](https://gunshipmusic.com).";
      const links = extractBioLinks(bio);

      expect(links).toEqual([
        {
          title: "Wikipedia",
          url: "https://en.wikipedia.org/wiki/Gunship_(band)",
        },
        {
          title: "Official",
          url: "https://gunshipmusic.com",
        },
      ]);
    });

    it("parses bare Wikipedia URLs with parentheses and preserves them", () => {
      const bio =
        "Formed in 2014: see https://en.wikipedia.org/wiki/Gunship_(band) for details.";
      const links = extractBioLinks(bio);

      expect(links).toEqual([
        {
          title: "en.wikipedia.org",
          url: "https://en.wikipedia.org/wiki/Gunship_(band)",
        },
      ]);
    });

    it("strips unmatched closing parenthesis from prose surrounding bare URLs", () => {
      const bio =
        "Formed in 2014 (more details at https://gunshipmusic.com). Also see (https://en.wikipedia.org/wiki/Gunship_(band)).";
      const links = extractBioLinks(bio);

      expect(links).toEqual([
        {
          title: "gunshipmusic.com",
          url: "https://gunshipmusic.com",
        },
        {
          title: "en.wikipedia.org",
          url: "https://en.wikipedia.org/wiki/Gunship_(band)",
        },
      ]);
    });
  });

  it("calls lookup_musicbrainz tool via MCP", async () => {
    setupCurationTestDb(tempDbPath);
    const { server, db } = createMcpServer({ dbPath: tempDbPath });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test-client", version: "1.0.0" }, { capabilities: {} });

    await server.connect(serverTransport);
    await client.connect(clientTransport);

    const result = await client.callTool({
      name: "lookup_musicbrainz",
      arguments: {
        track_id: 1,
        fetch_live: false,
      },
    });

    const firstContent = getTextContent(result);
    const parsed = JSON.parse(firstContent.text);

    expect(parsed.track_id).toBe(1);
    expect(parsed.mbid).toBe("01319197-fa4c-4905-b87b-74991ff494f3");
    expect(parsed.local_enrichment).toBeDefined();

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
      name: "audit_metadata",
      arguments: {},
    });

    expect((result as any).isError).toBe(true);
    const firstContent = getTextContent(result);
    expect(firstContent.text).toContain("Luminous database file not found");

    await client.close();
    await server.close();
    db.close();
  });

  describe("Real-Time UI State Sync on Curation Mutations", () => {
    let mockServer: any;
    let mockBaseUrl: string;
    let lastReceivedEvent: { event: string; data?: any } | null = null;

    beforeEach(() => {
      lastReceivedEvent = null;
      mockServer = Bun.serve({
        port: 0,
        fetch(req) {
          const url = new URL(req.url);
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
      mockBaseUrl = `http://127.0.0.1:${mockServer.port}`;
    });

    afterEach(() => {
      mockServer?.stop(true);
    });

    it("triggers library-changed notification on update_artist_profile", async () => {
      setupCurationTestDb(tempDbPath);
      const bridgeClient = new LuminousBridgeClient({ baseUrl: mockBaseUrl });
      const { server, db } = createMcpServer({
        dbPath: tempDbPath,
        bridgeClient,
      });

      const [cTrans, sTrans] = InMemoryTransport.createLinkedPair();
      await server.connect(sTrans);
      const client = new Client({ name: "artist-sync-test", version: "1.0.0" }, { capabilities: {} });
      await client.connect(cTrans);

      const res = await client.callTool({
        name: "update_artist_profile",
        arguments: {
          artist: "GUNSHIP",
          bio: "Synthwave band formed in 2014.",
        },
      });

      expect((res as any).isError).toBeFalsy();
      expect(lastReceivedEvent).not.toBeNull();
      expect(lastReceivedEvent?.event).toBe("library-changed");
      expect(lastReceivedEvent?.data?.entity).toBe("artist");
      expect(lastReceivedEvent?.data?.artist).toBe("GUNSHIP");

      await client.close();
      await server.close();
      db.close();
    });

    it("triggers library-changed notification on update_album_profile", async () => {
      setupCurationTestDb(tempDbPath);
      const bridgeClient = new LuminousBridgeClient({ baseUrl: mockBaseUrl });
      const { server, db } = createMcpServer({
        dbPath: tempDbPath,
        bridgeClient,
      });

      const [cTrans, sTrans] = InMemoryTransport.createLinkedPair();
      await server.connect(sTrans);
      const client = new Client({ name: "album-sync-test", version: "1.0.0" }, { capabilities: {} });
      await client.connect(cTrans);

      const res = await client.callTool({
        name: "update_album_profile",
        arguments: {
          album: "Unicorn",
          artist: "GUNSHIP",
          description: "Unicorn is the third studio album by GUNSHIP.",
        },
      });

      expect((res as any).isError).toBeFalsy();
      expect(lastReceivedEvent).not.toBeNull();
      expect(lastReceivedEvent?.event).toBe("library-changed");
      expect(lastReceivedEvent?.data?.entity).toBe("album");
      expect(lastReceivedEvent?.data?.album).toBe("Unicorn");

      await client.close();
      await server.close();
      db.close();
    });

    it("triggers library-changed notification on update_track_metadata", async () => {
      setupCurationTestDb(tempDbPath);
      const bridgeClient = new LuminousBridgeClient({ baseUrl: mockBaseUrl });
      const { server, db } = createMcpServer({
        dbPath: tempDbPath,
        bridgeClient,
      });

      const [cTrans, sTrans] = InMemoryTransport.createLinkedPair();
      await server.connect(sTrans);
      const client = new Client({ name: "track-sync-test", version: "1.0.0" }, { capabilities: {} });
      await client.connect(cTrans);

      const res = await client.callTool({
        name: "update_track_metadata",
        arguments: {
          track_id: 1,
          genre: "Synthwave",
        },
      });

      expect((res as any).isError).toBeFalsy();
      expect(lastReceivedEvent).not.toBeNull();
      expect(lastReceivedEvent?.event).toBe("library-changed");
      expect(lastReceivedEvent?.data?.entity).toBe("track");
      expect(lastReceivedEvent?.data?.track_ids).toEqual([1]);

      await client.close();
      await server.close();
      db.close();
    });

    it("curation mutations succeed even if desktop player bridge is offline", async () => {
      setupCurationTestDb(tempDbPath);
      const offlineBridge = new LuminousBridgeClient({ baseUrl: "http://127.0.0.1:59999" });
      const { server, db } = createMcpServer({
        dbPath: tempDbPath,
        bridgeClient: offlineBridge,
      });

      const [cTrans, sTrans] = InMemoryTransport.createLinkedPair();
      await server.connect(sTrans);
      const client = new Client({ name: "offline-sync-test", version: "1.0.0" }, { capabilities: {} });
      await client.connect(cTrans);

      const res = await client.callTool({
        name: "update_album_profile",
        arguments: {
          album: "Unicorn",
          description: "Offline update description.",
        },
      });

      expect((res as any).isError).toBeFalsy();

      await client.close();
      await server.close();
      db.close();
    });
  });
});
