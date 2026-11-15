export const SERVER_NAME = "luminous-mcp";
export const SERVER_VERSION = "1.12.1";

/**
 * Current database schema version supported by this server,
 * matching Luminous Music Player's CURRENT_SCHEMA_VERSION.
 *
 * 83 made `artist_profiles.artist_key` case-insensitive, 84 added
 * `artist_profiles.country` and 85 added `artist_context_enrichment.country`;
 * this server reads and writes the first two. `get_server_info` reports a
 * database newer than this as incompatible, so bump it with each app migration
 * the server has been checked against.
 */
export const KNOWN_SCHEMA_VERSION = 85;

/**
 * SongSource discriminant for files opened directly from outside watched folders
 * (Luminous schema v72, #1842). Excluded from browsable library queries, but
 * included in listening history and stats.
 */
export const OPENED_FILE_SOURCE_ID = 12;

/**
 * Database filename within the app data directory.
 */
export const DB_FILENAME = "luminous.db";

/**
 * Platform app identifiers.
 *
 * On Windows, Luminous uses the Microsoft Store MSIX package identity
 * "39231EricJamesSoltys.LuminousMusicPlayer" as defined in tauri.windows.conf.json.
 * The base identifier "org.luminous.music" serves as a fallback.
 */
export const WINDOWS_IDENTIFIER = "39231EricJamesSoltys.LuminousMusicPlayer";
export const WINDOWS_FALLBACK_IDENTIFIER = "org.luminous.music";
export const MACOS_IDENTIFIER = "org.luminous.music";
export const LINUX_IDENTIFIER = "org.luminous.music";

/**
 * Default loopback host, port, and URL for Luminous desktop communication bridge.
 */
export const DEFAULT_BRIDGE_HOST = "127.0.0.1";
export const DEFAULT_BRIDGE_PORT = 21849;
export const DEFAULT_BRIDGE_URL = `http://${DEFAULT_BRIDGE_HOST}:${DEFAULT_BRIDGE_PORT}`;

/**
 * Default host and port for the Luminous MCP SSE/HTTP transport server.
 */
export const DEFAULT_SSE_HOST = "0.0.0.0";
export const DEFAULT_SSE_PORT = 21850;

