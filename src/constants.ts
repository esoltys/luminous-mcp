export const SERVER_NAME = "luminous-mcp";
export const SERVER_VERSION = "0.1.0";

/**
 * Current database schema version supported by this server,
 * matching Luminous Music Player's CURRENT_SCHEMA_VERSION.
 */
export const KNOWN_SCHEMA_VERSION = 34;

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
