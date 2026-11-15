import type { LuminousDatabase } from "../db/connection.ts";
import type { McpResponse } from "../utils/response.ts";

/**
 * Wraps a tool handler so it only runs when the Luminous database file exists;
 * otherwise the caller gets the standard "database not found" error response.
 * Wrap every handler that touches the database so the check cannot be forgotten.
 */
export function withDb<Args extends unknown[], R>(
  db: LuminousDatabase,
  handler: (...args: Args) => Promise<R>,
): (...args: Args) => Promise<R | McpResponse> {
  return async (...args) => {
    if (!db.exists()) {
      return {
        isError: true,
        content: [{ type: "text", text: db.missingMessage() }],
      };
    }
    return handler(...args);
  };
}
