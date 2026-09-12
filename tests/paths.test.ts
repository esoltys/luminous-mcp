import { describe, expect, it } from "bun:test";
import * as path from "node:path";
import {
  DB_FILENAME,
  LINUX_IDENTIFIER,
  MACOS_IDENTIFIER,
  WINDOWS_FALLBACK_IDENTIFIER,
  WINDOWS_IDENTIFIER,
} from "../src/constants.ts";
import { getCandidateDbPaths, resolveDbPath } from "../src/db/paths.ts";

describe("paths resolution", () => {
  it("uses explicit LUMINOUS_DB_PATH when provided", () => {
    const custom = "C:\\custom\\path\\to\\my-library.db";
    const candidates = getCandidateDbPaths({
      env: { LUMINOUS_DB_PATH: custom },
      platform: "win32",
    });

    expect(candidates).toEqual([path.resolve(custom)]);

    const resolved = resolveDbPath({
      env: { LUMINOUS_DB_PATH: custom },
      platform: "win32",
    });
    expect(resolved).toBe(path.resolve(custom));
  });

  it("uses LUMINOUS_DATA_DIR when provided", () => {
    const dataDir = "C:\\custom\\data\\dir";
    const candidates = getCandidateDbPaths({
      env: { LUMINOUS_DATA_DIR: dataDir },
      platform: "win32",
    });

    expect(candidates).toEqual([path.join(path.resolve(dataDir), DB_FILENAME)]);

    const resolved = resolveDbPath({
      env: { LUMINOUS_DATA_DIR: dataDir },
      platform: "win32",
    });
    expect(resolved).toBe(path.join(path.resolve(dataDir), DB_FILENAME));
  });

  it("prioritizes LUMINOUS_DB_PATH over LUMINOUS_DATA_DIR", () => {
    const dbPath = "C:\\explicit\\db.db";
    const dataDir = "C:\\custom\\data\\dir";
    const resolved = resolveDbPath({
      env: {
        LUMINOUS_DB_PATH: dbPath,
        LUMINOUS_DATA_DIR: dataDir,
      },
      platform: "win32",
    });
    expect(resolved).toBe(path.resolve(dbPath));
  });

  it("generates correct candidates for Windows with MSIX and base identifiers", () => {
    const appData = "C:\\Users\\Test\\AppData\\Roaming";
    const candidates = getCandidateDbPaths({
      env: { APPDATA: appData },
      platform: "win32",
    });

    expect(candidates).toEqual([
      path.join(appData, WINDOWS_IDENTIFIER, DB_FILENAME),
      path.join(appData, WINDOWS_FALLBACK_IDENTIFIER, DB_FILENAME),
    ]);
  });

  it("generates correct candidates for macOS", () => {
    const home = "/Users/testuser";
    const candidates = getCandidateDbPaths({
      env: {},
      platform: "darwin",
      homedir: home,
    });

    expect(candidates).toEqual([
      path.join(home, "Library", "Application Support", MACOS_IDENTIFIER, DB_FILENAME),
    ]);
  });

  it("generates correct candidates for Linux using XDG or home fallback", () => {
    const home = "/home/testuser";
    const xdgData = "/home/testuser/.custom-share";
    const candidates = getCandidateDbPaths({
      env: { XDG_DATA_HOME: xdgData },
      platform: "linux",
      homedir: home,
    });

    expect(candidates[0]).toBe(path.join(xdgData, LINUX_IDENTIFIER, DB_FILENAME));
  });

  it("accepts a string argument directly in resolveDbPath", () => {
    const directPath = "C:\\direct\\path.db";
    const resolved = resolveDbPath(directPath);
    expect(resolved).toBe(path.resolve(directPath));
  });
});
