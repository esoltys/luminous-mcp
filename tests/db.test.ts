import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { KNOWN_SCHEMA_VERSION } from "../src/constants.ts";
import { LuminousDatabase } from "../src/db/connection.ts";

describe("LuminousDatabase", () => {
  let tempDir: string;
  let tempDbPath: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "luminous-test-"));
    tempDbPath = path.join(tempDir, "luminous.db");
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error
    }
  });

  it("handles non-existent database file safely", () => {
    const missingPath = path.join(tempDir, "does-not-exist.db");
    const db = new LuminousDatabase(missingPath);

    expect(db.exists()).toBe(false);
    expect(db.isOpen()).toBe(false);
    expect(db.getSchemaVersion()).toBe(0);
    expect(db.getTrackCount()).toBe(0);

    const stats = db.getStats();
    expect(stats.exists).toBe(false);
    expect(stats.isOpen).toBe(false);
    expect(stats.fileSizeBytes).toBeNull();
    expect(stats.schemaVersion).toBe(0);
    expect(stats.isCompatible).toBe(false);
    expect(stats.trackCount).toBe(0);

    expect(() => db.getHandle()).toThrow("Luminous database file not found");
  });

  it("reads schema version and track count from a valid database", () => {
    // Initialize temporary database with schema and data
    const writer = new Database(tempDbPath);
    writer.run("CREATE TABLE schema_version (version INTEGER PRIMARY KEY);");
    writer.run(`INSERT INTO schema_version (version) VALUES (${KNOWN_SCHEMA_VERSION});`);
    writer.run("CREATE TABLE songs (id INTEGER PRIMARY KEY, title TEXT, artist TEXT);");
    writer.run("INSERT INTO songs (title, artist) VALUES ('Track 1', 'Artist A');");
    writer.run("INSERT INTO songs (title, artist) VALUES ('Track 2', 'Artist B');");
    writer.run("INSERT INTO songs (title, artist) VALUES ('Track 3', 'Artist C');");
    writer.close();

    const db = new LuminousDatabase(tempDbPath);
    expect(db.exists()).toBe(true);
    expect(db.isOpen()).toBe(false);

    expect(db.getSchemaVersion()).toBe(KNOWN_SCHEMA_VERSION);
    expect(db.isOpen()).toBe(true);
    expect(db.getTrackCount()).toBe(3);

    const stats = db.getStats();
    expect(stats.exists).toBe(true);
    expect(stats.isOpen).toBe(true);
    expect(stats.schemaVersion).toBe(KNOWN_SCHEMA_VERSION);
    expect(stats.knownSchemaVersion).toBe(KNOWN_SCHEMA_VERSION);
    expect(stats.isCompatible).toBe(true);
    expect(stats.trackCount).toBe(3);
    expect(stats.fileSizeBytes).toBeGreaterThan(0);

    // Enforce read-only constraint
    const handle = db.getHandle();
    expect(() => {
      handle.run("INSERT INTO songs (title, artist) VALUES ('Track 4', 'Artist D');");
    }).toThrow();

    db.close();
    expect(db.isOpen()).toBe(false);
  });

  it("handles missing tables gracefully in initialized database", () => {
    // Database exists but empty
    const writer = new Database(tempDbPath);
    writer.run("CREATE TABLE some_other_table (id INTEGER PRIMARY KEY);");
    writer.close();

    const db = new LuminousDatabase(tempDbPath);
    expect(db.exists()).toBe(true);
    expect(db.getSchemaVersion()).toBe(0);
    expect(db.getTrackCount()).toBe(0);

    const stats = db.getStats();
    expect(stats.schemaVersion).toBe(0);
    expect(stats.isCompatible).toBe(false);
    expect(stats.trackCount).toBe(0);

    db.close();
  });
});
