import { existsSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  DB_FILENAME,
  LINUX_IDENTIFIER,
  MACOS_IDENTIFIER,
  WINDOWS_FALLBACK_IDENTIFIER,
  WINDOWS_IDENTIFIER,
} from "../constants.ts";

export interface PathResolutionOptions {
  customPath?: string;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  homedir?: string;
}

/**
 * Returns candidate database paths for the given platform in order of preference.
 */
export function getCandidateDbPaths(options: PathResolutionOptions = {}): string[] {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const home = options.homedir ?? os.homedir();

  // 1. Explicit LUMINOUS_DB_PATH override
  if (env.LUMINOUS_DB_PATH && env.LUMINOUS_DB_PATH.trim() !== "") {
    return [path.resolve(env.LUMINOUS_DB_PATH.trim())];
  }

  // 2. Explicit LUMINOUS_DATA_DIR override
  if (env.LUMINOUS_DATA_DIR && env.LUMINOUS_DATA_DIR.trim() !== "") {
    return [path.join(path.resolve(env.LUMINOUS_DATA_DIR.trim()), DB_FILENAME)];
  }

  // 3. Platform-specific candidate paths
  switch (platform) {
    case "win32": {
      const appData = env.APPDATA && env.APPDATA.trim() !== ""
        ? env.APPDATA.trim()
        : path.join(home, "AppData", "Roaming");

      return [
        path.join(appData, WINDOWS_IDENTIFIER, DB_FILENAME),
        path.join(appData, WINDOWS_FALLBACK_IDENTIFIER, DB_FILENAME),
      ];
    }

    case "darwin": {
      return [
        path.join(home, "Library", "Application Support", MACOS_IDENTIFIER, DB_FILENAME),
      ];
    }

    default: {
      const xdgDataHome = env.XDG_DATA_HOME && env.XDG_DATA_HOME.trim() !== ""
        ? env.XDG_DATA_HOME.trim()
        : path.join(home, ".local", "share");

      const xdgConfigHome = env.XDG_CONFIG_HOME && env.XDG_CONFIG_HOME.trim() !== ""
        ? env.XDG_CONFIG_HOME.trim()
        : path.join(home, ".config");

      return [
        path.join(xdgDataHome, LINUX_IDENTIFIER, DB_FILENAME),
        path.join(xdgConfigHome, LINUX_IDENTIFIER, DB_FILENAME),
      ];
    }
  }
}

/**
 * Resolves the path to the Luminous SQLite database (luminous.db).
 *
 * If a custom path or environment override is provided, that path is returned.
 * Otherwise, scans candidate paths for an existing database file and returns the
 * first match found. If none exists, returns the primary default candidate.
 */
export function resolveDbPath(options: PathResolutionOptions | string = {}): string {
  if (typeof options === "string") {
    options = { customPath: options };
  }

  if (options.customPath && options.customPath.trim() !== "") {
    return path.resolve(options.customPath.trim());
  }

  const candidates = getCandidateDbPaths(options);
  if (candidates.length === 0) {
    throw new Error("Unable to determine default database path for this platform.");
  }

  // If LUMINOUS_DB_PATH or LUMINOUS_DATA_DIR was provided, candidates has length 1
  const env = options.env ?? process.env;
  if (
    (env.LUMINOUS_DB_PATH && env.LUMINOUS_DB_PATH.trim() !== "") ||
    (env.LUMINOUS_DATA_DIR && env.LUMINOUS_DATA_DIR.trim() !== "")
  ) {
    return candidates[0];
  }

  // Check if any candidate exists on disk
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  // If none exist, return the primary candidate
  return candidates[0];
}
