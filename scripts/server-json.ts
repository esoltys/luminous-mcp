#!/usr/bin/env bun
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import * as path from "node:path";

export const MCP_REGISTRY_SCHEMA =
  "https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json";

export const DEFAULT_SERVER_NAME = "io.github.esoltys/luminous-mcp";
export const DEFAULT_SERVER_TITLE = "Luminous Music Player";
export const DEFAULT_REPO_URL = "https://github.com/esoltys/luminous-mcp";

/**
 * Platform labels matching the `--target bun-<label>` matrix in `.github/workflows/release.yml`.
 */
export const RELEASE_TARGETS = [
  "windows-x64",
  "darwin-arm64",
  "darwin-x64",
  "linux-x64",
  "linux-arm64",
] as const;

export interface McpbPackageEntry {
  registryType: "mcpb";
  identifier: string;
  fileSha256: string;
  transport: { type: "stdio" };
}

export interface ServerJson {
  $schema: string;
  name: string;
  title: string;
  description: string;
  version: string;
  websiteUrl: string;
  repository: {
    url: string;
    source: "github";
  };
  icons: Array<{
    src: string;
    mimeType: string;
  }>;
  packages: McpbPackageEntry[];
}

export interface ServerJsonOptions {
  version: string;
  description: string;
  checksums: Map<string, string>;
  name?: string;
  title?: string;
  repoUrl?: string;
  targets?: readonly string[];
}

/**
 * Parses `sha256sum` output (`<hex>  <filename>` or `<hex> *<filename>`) into a
 * filename -> lowercase sha256 map.
 */
export function parseSha256Sums(content: string): Map<string, string> {
  const checksums = new Map<string, string>();
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    const match = /^([a-fA-F0-9]{64})\s+\*?(.+)$/.exec(line);
    if (!match) {
      throw new Error(`Malformed SHA256SUMS line: "${rawLine}"`);
    }

    const hash = match[1]!.toLowerCase();
    const filename = path.posix.basename(match[2]!.trim().replace(/\\/g, "/"));
    checksums.set(filename, hash);
  }
  return checksums;
}

/**
 * Builds an official MCP Registry `server.json` manifest with `mcpb` package entries
 * pointing at the per-platform GitHub Release assets.
 */
export function buildServerJson(opts: ServerJsonOptions): ServerJson {
  const version = opts.version.replace(/^v/, "");
  if (!version) {
    throw new Error("Version must not be empty");
  }

  const repoUrl = (opts.repoUrl ?? DEFAULT_REPO_URL).replace(/\/+$/, "");
  const targets = opts.targets ?? RELEASE_TARGETS;
  const rawBaseUrl = repoUrl.replace(
    /^https:\/\/github\.com\//,
    "https://raw.githubusercontent.com/"
  );

  const packages: McpbPackageEntry[] = targets.map((target) => {
    const filename = `luminous-mcp-${target}.mcpb`;
    const fileSha256 = opts.checksums.get(filename);
    if (!fileSha256) {
      throw new Error(`Missing SHA-256 checksum for release bundle "${filename}"`);
    }

    return {
      registryType: "mcpb",
      identifier: `${repoUrl}/releases/download/v${version}/${filename}`,
      fileSha256,
      transport: { type: "stdio" },
    };
  });

  return {
    $schema: MCP_REGISTRY_SCHEMA,
    name: opts.name ?? DEFAULT_SERVER_NAME,
    title: opts.title ?? DEFAULT_SERVER_TITLE,
    description: opts.description,
    version,
    websiteUrl: repoUrl,
    repository: {
      url: repoUrl,
      source: "github",
    },
    icons: [
      {
        src: `${rawBaseUrl}/main/assets/icon.png`,
        mimeType: "image/png",
      },
    ],
    packages,
  };
}

/**
 * Reads `package.json` and `dist/SHA256SUMS.txt` under `projectRoot`, generates
 * `server.json`, and writes it to `outPath` (defaults to `dist/server.json`).
 */
export function generateServerJsonFromDist(
  projectRoot: string,
  opts?: { version?: string; outPath?: string; sumsPath?: string }
): { serverJson: ServerJson; outPath: string } {
  const pkgPath = path.join(projectRoot, "package.json");
  if (!existsSync(pkgPath)) {
    throw new Error(`package.json not found at ${pkgPath}`);
  }
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as {
    version?: string;
    description?: string;
  };

  const sumsPath = opts?.sumsPath ?? path.join(projectRoot, "dist", "SHA256SUMS.txt");
  if (!existsSync(sumsPath)) {
    throw new Error(`SHA256SUMS.txt not found at ${sumsPath}`);
  }

  const checksums = parseSha256Sums(readFileSync(sumsPath, "utf8"));
  const serverJson = buildServerJson({
    version: opts?.version ?? pkg.version ?? "",
    description: pkg.description ?? "Model Context Protocol (MCP) server for Luminous Music Player",
    checksums,
  });

  const outPath = opts?.outPath ?? path.join(projectRoot, "dist", "server.json");
  mkdirSync(path.dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(serverJson, null, 2)}\n`, "utf8");
  return { serverJson, outPath };
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const getArg = (flag: string): string | undefined => {
    const idx = args.indexOf(flag);
    if (idx === -1) return undefined;
    const value = args[idx + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for ${flag}`);
    }
    return value;
  };

  const projectRoot = path.resolve(import.meta.dir, "..");
  const outArg = getArg("--out");
  const outPath = outArg ? path.resolve(projectRoot, outArg) : undefined;
  const version = getArg("--version");

  const { serverJson, outPath: writtenPath } = generateServerJsonFromDist(projectRoot, {
    outPath,
    version,
  });
  console.log(
    `Generated ${writtenPath} (${serverJson.packages.length} mcpb packages, v${serverJson.version})`
  );
}
