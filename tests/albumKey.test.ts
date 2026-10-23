import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, unlinkSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { KNOWN_SCHEMA_VERSION } from "../src/constants.ts";
import {
  albumKey,
  getAlbumProfile,
  sameAlbum,
  updateAlbumProfile,
  updateTrackMetadata,
} from "../src/db/curation.ts";
import fixtureCases from "./fixtures/albumKey.fixture.json";

describe("Album Identity & Folded Keys (albumKey)", () => {
  it("matches shared Luminous fixture cases exactly", () => {
    expect(fixtureCases.length).toBeGreaterThan(0);
    for (const testCase of fixtureCases) {
      expect(albumKey(testCase.input)).toBe(testCase.key);
    }
  });

  it("handles null, undefined, and non-ASCII cases", () => {
    expect(albumKey(null)).toBe("");
    expect(albumKey(undefined)).toBe("");
    expect(albumKey("   ")).toBe("");
    expect(albumKey("  Élan  ")).toBe("élan");
    expect(albumKey("ÉLAN")).toBe("élan");
  });

  it("correctly compares album titles with sameAlbum", () => {
    expect(sameAlbum("Songs of the Sea", "songs of the sea")).toBe(true);
    expect(sameAlbum("  Songs of the Sea \t", "Songs Of The Sea")).toBe(true);
    expect(sameAlbum("Élan", "ÉLAN")).toBe(true);
    expect(sameAlbum("Album A", "Album B")).toBe(false);
    expect(sameAlbum(null, undefined)).toBe(true);
    expect(sameAlbum("   ", "")).toBe(true);
  });
});

describe("Database Folded Keys (Schema 62+ vs Legacy)", () => {
  let tempDbPath: string;

  beforeEach(() => {
    tempDbPath = path.join(
      os.tmpdir(),
      `test_album_key_${Date.now()}_${Math.random().toString(36).substring(7)}.db`
    );
  });

  afterEach(() => {
    for (const suffix of ["", "-wal", "-shm"]) {
      const file = `${tempDbPath}${suffix}`;
      if (existsSync(file)) {
        try {
          unlinkSync(file);
        } catch {
          // ignore cleanup failures
        }
      }
    }
  });

  function setupDb(hasAlbumKey: boolean): Database {
    const db = new Database(tempDbPath);
    db.run("PRAGMA journal_mode = WAL;");
    db.run("PRAGMA foreign_keys = ON;");

    db.run("CREATE TABLE schema_version (version INTEGER PRIMARY KEY);");
    db.run(`INSERT INTO schema_version (version) VALUES (${KNOWN_SCHEMA_VERSION});`);

    if (hasAlbumKey) {
      db.run(`
        CREATE TABLE songs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          title TEXT NOT NULL,
          artist TEXT NOT NULL,
          album TEXT,
          album_key TEXT,
          album_artist TEXT,
          composer TEXT,
          performer TEXT,
          year INTEGER,
          genre TEXT,
          lyrics TEXT,
          track INTEGER,
          disc INTEGER,
          path TEXT,
          musicbrainz_recording_id TEXT,
          musicbrainz_artist_id TEXT,
          musicbrainz_album_id TEXT,
          musicbrainz_release_group_id TEXT,
          unavailable BOOLEAN NOT NULL DEFAULT 0
        );
      `);
      db.run("CREATE INDEX idx_songs_album_key ON songs(album_key);");
    } else {
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
          path TEXT,
          musicbrainz_recording_id TEXT,
          musicbrainz_artist_id TEXT,
          musicbrainz_album_id TEXT,
          musicbrainz_release_group_id TEXT,
          unavailable BOOLEAN NOT NULL DEFAULT 0
        );
      `);
    }

    db.run(`
      CREATE TABLE IF NOT EXISTS album_profiles (
        album_key TEXT PRIMARY KEY,
        artist_key TEXT,
        description TEXT,
        website TEXT,
        tags TEXT NOT NULL DEFAULT '[]',
        links TEXT NOT NULL DEFAULT '[]'
      );
    `);

    return db;
  }

  describe("updateTrackMetadata", () => {
    it("updates album and computes album_key when column exists", () => {
      const db = setupDb(true);
      db.run(
        "INSERT INTO songs (id, title, artist, album, album_key) VALUES (1, 'Track 1', 'Nightwish', 'Old Album', 'old album');"
      );

      const result = updateTrackMetadata(db, {
        track_id: 1,
        album: "  Élan  ",
      });

      expect(result.success).toBe(true);
      expect(result.tracks[0].album).toBe("  Élan  ");

      const row = db
        .query<{ album: string; album_key: string }, [number]>(
          "SELECT album, album_key FROM songs WHERE id = ?1"
        )
        .get(1);
      expect(row?.album).toBe("  Élan  ");
      expect(row?.album_key).toBe("élan");

      db.close();
    });

    it("sets album_key to NULL when album is set to empty or whitespace", () => {
      const db = setupDb(true);
      db.run(
        "INSERT INTO songs (id, title, artist, album, album_key) VALUES (1, 'Track 1', 'Nightwish', 'Old Album', 'old album');"
      );

      updateTrackMetadata(db, {
        track_id: 1,
        album: "   ",
      });

      const row = db
        .query<{ album: string; album_key: string | null }, [number]>(
          "SELECT album, album_key FROM songs WHERE id = ?1"
        )
        .get(1);
      expect(row?.album).toBe("   ");
      expect(row?.album_key).toBeNull();

      db.close();
    });

    it("updates album without error when album_key column is absent (legacy schema)", () => {
      const db = setupDb(false);
      db.run(
        "INSERT INTO songs (id, title, artist, album) VALUES (1, 'Track 1', 'Nightwish', 'Old Album');"
      );

      const result = updateTrackMetadata(db, {
        track_id: 1,
        album: "Songs of the Sea",
      });

      expect(result.success).toBe(true);
      expect(result.tracks[0].album).toBe("Songs of the Sea");

      const row = db
        .query<{ album: string }, [number]>("SELECT album FROM songs WHERE id = ?1")
        .get(1);
      expect(row?.album).toBe("Songs of the Sea");

      db.close();
    });
  });

  describe("getAlbumProfile", () => {
    it("resolves non-ASCII Unicode folded album and picks dominant display spelling", () => {
      const db = setupDb(true);
      db.run(
        "INSERT INTO songs (id, title, artist, album, album_key) VALUES (1, 'Track 1', 'Nightwish', 'Élan', 'élan');"
      );
      db.run(
        "INSERT INTO songs (id, title, artist, album, album_key) VALUES (2, 'Track 2', 'Nightwish', 'Élan', 'élan');"
      );
      db.run(
        "INSERT INTO songs (id, title, artist, album, album_key) VALUES (3, 'Track 3', 'Nightwish', 'ÉLAN', 'élan');"
      );

      db.run(
        "INSERT INTO album_profiles (album_key, artist_key, description) VALUES ('élan', 'Nightwish', 'Liner notes');"
      );

      // Query with uppercase variant
      const profile1 = getAlbumProfile(db, { album: "ÉLAN" });
      expect(profile1).not.toBeNull();
      expect(profile1?.album).toBe("Élan"); // Dominant spelling (2 vs 1)
      expect(profile1?.description).toBe("Liner notes");

      // Query with lowercase folded key
      const profile2 = getAlbumProfile(db, { album: "élan" });
      expect(profile2).not.toBeNull();
      expect(profile2?.album).toBe("Élan"); // Still returns display spelling!

      db.close();
    });

    it("returns display title when no songs are present in library", () => {
      const db = setupDb(true);
      db.run(
        "INSERT INTO album_profiles (album_key, artist_key, description) VALUES ('songs of the sea', 'Artist', 'Notes');"
      );

      const profile = getAlbumProfile(db, { album: "Songs of the Sea" });
      expect(profile).not.toBeNull();
      expect(profile?.album).toBe("Songs of the Sea");
      expect(profile?.description).toBe("Notes");

      db.close();
    });

    it("supports legacy schemas using COLLATE NOCASE", () => {
      const db = setupDb(false);
      db.run(
        "INSERT INTO songs (id, title, artist, album) VALUES (1, 'Track 1', 'Nightwish', 'Wishmaster');"
      );
      db.run(
        "INSERT INTO album_profiles (album_key, artist_key, description) VALUES ('Wishmaster', 'Nightwish', 'Classic album');"
      );

      const profile = getAlbumProfile(db, { album: "wishmaster" });
      expect(profile).not.toBeNull();
      expect(profile?.album).toBe("Wishmaster");
      expect(profile?.description).toBe("Classic album");

      db.close();
    });
  });

  describe("updateAlbumProfile", () => {
    it("stores folded album_key in album_profiles and returns display album title", () => {
      const db = setupDb(true);
      db.run(
        "INSERT INTO songs (id, title, artist, album, album_key) VALUES (1, 'Track 1', 'Nightwish', 'Songs of the Sea', 'songs of the sea');"
      );

      const result = updateAlbumProfile(db, {
        album: "Songs of the Sea",
        artist: "Nightwish",
        description: "Official album notes",
        website: "https://example.com/sea",
        tags: ["symphonic", "folk"],
      });

      expect(result.success).toBe(true);
      expect(result.album).toBe("Songs of the Sea"); // Must be display title!
      expect(result.profile.album).toBe("Songs of the Sea"); // Must be display title!

      // Verify row in album_profiles has folded key
      const row = db
        .query<{ album_key: string; description: string }, [string]>(
          "SELECT album_key, description FROM album_profiles WHERE album_key = ?1"
        )
        .get("songs of the sea");
      expect(row).not.toBeNull();
      expect(row?.album_key).toBe("songs of the sea");
      expect(row?.description).toBe("Official album notes");

      db.close();
    });

    it("upserts existing profile correctly when album casing varies", () => {
      const db = setupDb(true);
      db.run(
        "INSERT INTO songs (id, title, artist, album, album_key) VALUES (1, 'Track 1', 'Bruno Mars', '24K Magic', '24k magic');"
      );

      // Initial profile
      updateAlbumProfile(db, {
        album: "24K Magic",
        description: "Initial description",
        tags: ["funk"],
      });

      // Update with different casing
      const updateResult = updateAlbumProfile(db, {
        album: "24K MAGIC ",
        description: "Updated description",
      });

      expect(updateResult.success).toBe(true);
      expect(updateResult.album).toBe("24K Magic");
      expect(updateResult.profile.album).toBe("24K Magic");
      expect(updateResult.profile.description).toBe("Updated description");
      expect(updateResult.profile.tags).toEqual(["funk"]);

      // Verify only ONE row exists in album_profiles
      const rows = db
        .query<{ album_key: string }, []>("SELECT album_key FROM album_profiles")
        .all();
      expect(rows.length).toBe(1);
      expect(rows[0].album_key).toBe("24k magic");

      db.close();
    });

    it("preserves legacy behavior on older schemas", () => {
      const db = setupDb(false);
      db.run(
        "INSERT INTO songs (id, title, artist, album) VALUES (1, 'Track 1', 'Artist', 'Legacy Album');"
      );

      const result = updateAlbumProfile(db, {
        album: "Legacy Album",
        description: "Legacy notes",
      });

      expect(result.success).toBe(true);
      expect(result.album).toBe("Legacy Album");
      expect(result.profile.album).toBe("Legacy Album");

      db.close();
    });
  });
});
