import { Database } from "bun:sqlite";
import { existsSync, statSync } from "node:fs";
import { KNOWN_SCHEMA_VERSION } from "../constants.ts";

export interface DbStats {
  dbPath: string;
  exists: boolean;
  isOpen: boolean;
  fileSizeBytes: number | null;
  schemaVersion: number;
  knownSchemaVersion: number;
  isCompatible: boolean;
  trackCount: number;
}

export interface DatabaseOptions {
  readonly?: boolean;
}

export class LuminousDatabase {
  private db: Database | null = null;
  public readonly isReadonly: boolean;

  constructor(public readonly dbPath: string, options: DatabaseOptions = {}) {
    this.isReadonly = options.readonly ?? false;
  }

  /**
   * Checks whether the database file exists on disk.
   */
  exists(): boolean {
    return existsSync(this.dbPath);
  }

  /**
   * Checks whether the database connection is currently open.
   */
  isOpen(): boolean {
    return this.db !== null;
  }

  /**
   * Returns the underlying bun:sqlite Database instance.
   * Lazily opens the database connection if not already connected.
   *
   * @throws Error if the database file does not exist on disk.
   */
  getHandle(): Database {
    if (this.db) {
      return this.db;
    }

    if (!this.exists()) {
      throw new Error(
        `Luminous database file not found at: "${this.dbPath}". ` +
        `Ensure Luminous Music Player has been launched at least once, or set LUMINOUS_DB_PATH.`
      );
    }

    const db = this.isReadonly
      ? new Database(this.dbPath, { readonly: true })
      : new Database(this.dbPath);
    // Optimize concurrency with Luminous desktop app
    db.run("PRAGMA busy_timeout = 5000;");
    this.db = db;
    return this.db;
  }

  /**
   * Retrieves the current schema version from schema_version table.
   * Returns 0 if the table does not exist or database is uninitialized.
   */
  getSchemaVersion(): number {
    if (!this.exists()) return 0;
    try {
      const handle = this.getHandle();
      const row = handle
        .query<{ v: number }, []>("SELECT COALESCE(MAX(version), 0) AS v FROM schema_version;")
        .get();
      return row?.v ?? 0;
    } catch {
      return 0;
    }
  }

  /**
   * Retrieves the total track count from the songs table.
   * Returns 0 if songs table does not exist.
   */
  getTrackCount(): number {
    if (!this.exists()) return 0;
    try {
      const handle = this.getHandle();
      const row = handle
        .query<{ count: number }, []>("SELECT COUNT(*) AS count FROM songs;")
        .get();
      return row?.count ?? 0;
    } catch {
      return 0;
    }
  }

  /**
   * Returns health and metadata stats about the database.
   */
  getStats(): DbStats {
    const exists = this.exists();
    let fileSizeBytes: number | null = null;
    let schemaVersion = 0;
    let trackCount = 0;

    if (exists) {
      try {
        const st = statSync(this.dbPath);
        fileSizeBytes = st.size;
      } catch {
        fileSizeBytes = null;
      }

      schemaVersion = this.getSchemaVersion();
      trackCount = this.getTrackCount();
    }

    const isCompatible = schemaVersion > 0 && schemaVersion <= KNOWN_SCHEMA_VERSION;

    return {
      dbPath: this.dbPath,
      exists,
      isOpen: this.isOpen(),
      fileSizeBytes,
      schemaVersion,
      knownSchemaVersion: KNOWN_SCHEMA_VERSION,
      isCompatible,
      trackCount,
    };
  }

  /**
   * Closes the database connection.
   */
  close(): void {
    if (this.db) {
      try {
        this.db.close();
      } catch {
        // Ignore close errors
      }
      this.db = null;
    }
  }
}
