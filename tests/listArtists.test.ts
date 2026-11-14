import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createMcpServer } from "../src/server.ts";
import { listArtists } from "../src/db/library.ts";

let tmpDir: string;
let dbPath: string;

function seed(withProfiles: boolean, withAlbumArtist = true): void {
  const db = new Database(dbPath);
  db.run(
    `CREATE TABLE songs (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, artist TEXT, ${
      withAlbumArtist ? "album_artist TEXT," : ""
    } year INTEGER, playcount INTEGER NOT NULL DEFAULT 0)`
  );
  const ins = db.prepare(
    withAlbumArtist
      ? "INSERT INTO songs (title, artist, album_artist, year, playcount) VALUES (?1, ?2, ?3, ?4, ?5)"
      : "INSERT INTO songs (title, artist, year, playcount) VALUES (?1, ?2, ?4, ?5)"
  );
  // [title, artist, album_artist, year, playcount]
  const rows: [string, string | null, string | null, number | null, number][] = [
    ["a1", "ABBA", "ABBA", 1976, 5], // same name in both columns: counts once
    ["a2", "Abba", null, null, 0], // case variant, year-less, unplayed
    ["b1", "Bjork", "Bjork", null, 0], // year-less, zero plays
    ["c1", "Guest Singer", "Various Artists", 2001, 0], // album artist only name too
    ["d1", "  ", "", 2020, 1], // blank names ignored
    ["e1", "100%_Real", null, 2010, 2], // LIKE wildcards in name
  ];
  for (const r of rows) ins.run(...r);
  ins.finalize();
  if (withProfiles) {
    db.run(
      "CREATE TABLE artist_profiles (artist_key TEXT PRIMARY KEY, website TEXT, tags TEXT NOT NULL DEFAULT '[]', social_links TEXT NOT NULL DEFAULT '[]', bio TEXT)"
    );
    db.run("INSERT INTO artist_profiles (artist_key, bio) VALUES ('abba', 'Swedish pop group')");
    db.run("INSERT INTO artist_profiles (artist_key, bio) VALUES ('Bjork', '')"); // empty row
  }
  db.close();
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "luminous-list-artists-"));
  dbPath = path.join(tmpDir, "luminous.db");
});

afterEach(() => {
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // Windows may briefly hold the SQLite file; temp dir cleanup is best-effort.
  }
});

function open(): Database {
  return new Database(dbPath, { readonly: true });
}

describe("listArtists", () => {
  it("includes year-less, zero-play and album-artist-only names; merges case variants", () => {
    seed(true);
    const db = open();
    const { artists, pagination } = listArtists(db);
    expect(artists.map((a) => a.artist)).toEqual([
      "100%_Real",
      "ABBA",
      "Bjork",
      "Guest Singer",
      "Various Artists",
    ]);
    expect(pagination.total_matching).toBe(5);
    expect(pagination.has_more).toBe(false);
    // a1 and a2 are two distinct tracks even though a1 names ABBA twice
    expect(artists.find((a) => a.artist === "ABBA")!.track_count).toBe(2);
    db.close();
  });

  it("reports has_profile only for rows with non-empty content", () => {
    seed(true);
    const db = open();
    const byName = Object.fromEntries(listArtists(db).artists.map((a) => [a.artist, a.has_profile]));
    expect(byName["ABBA"]).toBe(true); // key 'abba' matches case-insensitively
    expect(byName["Bjork"]).toBe(false); // empty row is not a curated profile
    expect(listArtists(db, { has_profile: true }).artists.map((a) => a.artist)).toEqual(["ABBA"]);
    const without = listArtists(db, { has_profile: false });
    expect(without.pagination.total_matching).toBe(4);
    expect(without.artists.some((a) => a.artist === "ABBA")).toBe(false);
    db.close();
  });

  it("walks the full set by pages with no gaps or duplicates", () => {
    seed(true);
    const db = open();
    const all = listArtists(db).artists.map((a) => a.artist);
    for (const sort of ["name", "track_count"] as const) {
      const full = listArtists(db, { sort }).artists.map((a) => a.artist);
      const seen: string[] = [];
      let offset = 0;
      for (;;) {
        const page = listArtists(db, { sort, limit: 2, offset });
        seen.push(...page.artists.map((a) => a.artist));
        if (!page.pagination.has_more) break;
        offset += 2;
      }
      expect(seen).toEqual(full);
      expect(new Set(seen).size).toBe(all.length);
    }
    db.close();
  });

  it("sorts by track_count descending, ties by name", () => {
    seed(true);
    const db = open();
    const names = listArtists(db, { sort: "track_count" }).artists.map((a) => a.artist);
    expect(names[0]).toBe("ABBA");
    expect(names.slice(1)).toEqual(["100%_Real", "Bjork", "Guest Singer", "Various Artists"]);
    db.close();
  });

  it("filters by name substring, escaping LIKE wildcards, and ignores blank filter", () => {
    seed(true);
    const db = open();
    expect(listArtists(db, { name: "BB" }).artists.map((a) => a.artist)).toEqual(["ABBA"]);
    expect(listArtists(db, { name: "%" }).artists.map((a) => a.artist)).toEqual(["100%_Real"]);
    expect(listArtists(db, { name: "_" }).artists.map((a) => a.artist)).toEqual(["100%_Real"]);
    expect(listArtists(db, { name: "   " }).pagination.total_matching).toBe(5);
    db.close();
  });

  it("returns an empty page past the end", () => {
    seed(true);
    const db = open();
    const r = listArtists(db, { offset: 99 });
    expect(r.artists).toEqual([]);
    expect(r.pagination.has_more).toBe(false);
    expect(r.pagination.total_matching).toBe(5);
    db.close();
  });

  it("treats a missing artist_profiles table as no profiles", () => {
    seed(false);
    const db = open();
    const r = listArtists(db);
    expect(r.artists.every((a) => a.has_profile === false)).toBe(true);
    expect(listArtists(db, { has_profile: true }).artists).toEqual([]);
    db.close();
  });

  it("falls back to artist only when album_artist column is absent", () => {
    seed(false, false);
    const db = open();
    expect(listArtists(db).artists.map((a) => a.artist)).toEqual([
      "100%_Real",
      "ABBA",
      "Bjork",
      "Guest Singer",
    ]);
    db.close();
  });
});

describe("list_artists tool", () => {
  it("is registered and returns paginated results over MCP", async () => {
    seed(true);
    const { server, db } = createMcpServer({ dbPath });
    const client = new Client({ name: "test", version: "1.0.0" });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(st), client.connect(ct)]);
    try {
      const res = (await client.callTool({
        name: "list_artists",
        arguments: { limit: 2 },
      })) as { content: { text: string }[] };
      const body = JSON.parse(res.content[0]!.text);
      expect(body.artists.length).toBe(2);
      expect(body.pagination.total_matching).toBe(5);
      expect(body.pagination.has_more).toBe(true);
    } finally {
      await client.close();
      await server.close();
      db.close();
    }
  });
});
