import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { countryDisplayName, normalizeCountryCode } from "../src/db/country.ts";
import {
  findArtistsByTag,
  getArtistProfile,
  updateArtistProfile,
  updateArtistProfiles,
} from "../src/db/curation.ts";
import { listArtists } from "../src/db/library.ts";

let tmpDir: string;
let db: Database;

/** Schema subset: `withCountry` mirrors Luminous migration 84, false mirrors older databases. */
function openDb(withCountry: boolean): Database {
  const handle = new Database(path.join(tmpDir, "luminous.db"));
  handle.run(
    `CREATE TABLE songs (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, artist TEXT, album_artist TEXT,
       album TEXT, path TEXT, musicbrainz_artist_id TEXT)`
  );
  handle.run(
    `CREATE TABLE artist_profiles (artist_key TEXT PRIMARY KEY COLLATE NOCASE, website TEXT,
       tags TEXT NOT NULL DEFAULT '[]', social_links TEXT NOT NULL DEFAULT '[]', bio TEXT
       ${withCountry ? ", country TEXT" : ""})`
  );
  handle.run(
    `INSERT INTO songs (title, artist, album_artist, path) VALUES
       ('a', 'Drake', 'Drake', '/1'), ('b', 'Abba', 'Abba', '/2'), ('c', 'Nobody', NULL, '/3')`
  );
  return handle;
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "luminous-country-"));
});

afterEach(() => {
  db?.close();
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // best-effort on Windows
  }
});

describe("country helpers", () => {
  it("uppercases and accepts alpha-2 codes", () => {
    expect(normalizeCountryCode(" ca ")).toBe("CA");
    expect(normalizeCountryCode("GB")).toBe("GB");
  });

  it.each(["Canada", "CAN", "C", "", "1A", "ZZ", "Toronto"])("rejects %p", (input) => {
    expect(() => normalizeCountryCode(input)).toThrow(/alpha-2/);
  });

  it("returns display names, undefined for non-regions", () => {
    expect(countryDisplayName("CA")).toBe("Canada");
    expect(countryDisplayName("ca")).toBe("Canada");
    expect(countryDisplayName("ZZ")).toBeUndefined();
    expect(countryDisplayName(null)).toBeUndefined();
  });
});

describe("artist profile country", () => {
  it("sets, reads back, and clears a country for an artist without an MBID", () => {
    db = openDb(true);
    const created = updateArtistProfile(db, { artist: "drake", country: "ca" });
    expect(created.created).toBe(true);
    expect(created.updated_fields.country).toBe("CA");
    expect(created.profile.country).toBe("CA");
    expect(created.profile.country_name).toBe("Canada");

    const read = getArtistProfile(db, { artist: "Drake" });
    expect(read?.country).toBe("CA");
    expect(read?.country_name).toBe("Canada");

    updateArtistProfile(db, { artist: "Drake", country: null });
    expect(getArtistProfile(db, { artist: "Drake" })?.country).toBeUndefined();
  });

  it("keeps the stored country when a later update omits it", () => {
    db = openDb(true);
    updateArtistProfile(db, { artist: "Drake", country: "CA" });
    updateArtistProfile(db, { artist: "Drake", bio: "Rapper" });
    expect(getArtistProfile(db, { artist: "Drake" })?.country).toBe("CA");
  });

  it("rejects invalid values without writing", () => {
    db = openDb(true);
    expect(() => updateArtistProfile(db, { artist: "Drake", country: "Canada" })).toThrow(/alpha-2/);
    expect(db.query("SELECT COUNT(*) AS n FROM artist_profiles").get()).toEqual({ n: 0 });
  });

  it("reports an identical country write as unchanged in a batch", () => {
    db = openDb(true);
    updateArtistProfile(db, { artist: "Drake", country: "CA" });
    const batch = updateArtistProfiles(db, [
      { artist: "Drake", country: "CA" },
      { artist: "Abba", country: "se" },
      { artist: "Nobody", country: "Sweden" },
    ]);
    expect(batch.results.map((r) => r.status)).toEqual(["unchanged", "created", "error"]);
  });

  it("errors on write, without altering the schema, when the column is missing", () => {
    db = openDb(false);
    expect(() => updateArtistProfile(db, { artist: "Drake", country: "CA" })).toThrow(/country column/);
    const cols = db.query<{ name: string }, []>("PRAGMA table_info(artist_profiles)").all();
    expect(cols.some((c) => c.name === "country")).toBe(false);
  });

  it("still reads and updates other fields on a database without the column", () => {
    db = openDb(false);
    const result = updateArtistProfile(db, { artist: "Drake", bio: "Rapper" });
    expect(result.profile.country).toBeUndefined();
    expect(getArtistProfile(db, { artist: "Drake" })?.bio).toBe("Rapper");
    expect(listArtists(db, { country: "CA" }).artists).toEqual([]);
  });
});

describe("country in listings", () => {
  it("filters list_artists by country, case-insensitively, and shows it on items", () => {
    db = openDb(true);
    updateArtistProfile(db, { artist: "Drake", country: "CA" });
    updateArtistProfile(db, { artist: "Abba", country: "SE" });

    const ca = listArtists(db, { country: "ca" });
    expect(ca.artists).toEqual([
      { artist: "Drake", track_count: 1, has_profile: true, country: "CA", country_name: "Canada" },
    ]);
    expect(ca.pagination.total_matching).toBe(1);

    const all = listArtists(db);
    expect(all.artists.find((a) => a.artist === "Nobody")?.country).toBeUndefined();
    expect(() => listArtists(db, { country: "Canada" })).toThrow(/alpha-2/);
  });

  it("counts a country-only profile as has_profile", () => {
    db = openDb(true);
    updateArtistProfile(db, { artist: "Drake", country: "CA" });
    expect(listArtists(db, { has_profile: true }).artists.map((a) => a.artist)).toEqual(["Drake"]);
  });

  it("includes country on find_artists_by_tag matches", () => {
    db = openDb(true);
    updateArtistProfile(db, { artist: "Drake", country: "CA", tags: ["Canadian"] });
    const result = findArtistsByTag(db, { tag: "canadian" });
    expect(result.artists[0]).toMatchObject({ artist: "Drake", country: "CA", country_name: "Canada" });
  });
});
