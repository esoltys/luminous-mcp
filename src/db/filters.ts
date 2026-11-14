import type { Database } from "bun:sqlite";
import { OPENED_FILE_SOURCE_ID } from "../constants.ts";

/**
 * Checks if a table or virtual table exists in the SQLite database.
 */
export function hasTable(db: Database, tableName: string): boolean {
  try {
    const row = db
      .query<{ count: number }, [string]>(
        "SELECT COUNT(*) as count FROM sqlite_master WHERE type IN ('table', 'virtual') AND name = ?1"
      )
      .get(tableName);
    return (row?.count ?? 0) > 0;
  } catch {
    return false;
  }
}

/**
 * Checks if a column exists on a given table.
 */
export function hasColumn(db: Database, tableName: string, columnName: string): boolean {
  try {
    const rows = db.query<{ name: string }, []>(`PRAGMA table_info(${tableName})`).all();
    return rows.some((col) => col.name.toLowerCase() === columnName.toLowerCase());
  } catch {
    return false;
  }
}

/**
 * Returns the SQL WHERE predicate identifying browsable library songs:
 * available (`unavailable = 0`) and not an external `OpenedFile` (`source != 12`).
 * Gracefully falls back when the `source` column is absent in minimal test schemas.
 */
export function librarySongWhere(db: Database, alias?: string): string {
  const prefix = alias ? `${alias}.` : "";
  const base = `${prefix}unavailable = 0`;
  if (hasColumn(db, "songs", "source")) {
    return `${base} AND COALESCE(${prefix}source, 0) != ${OPENED_FILE_SOURCE_ID}`;
  }
  return base;
}
