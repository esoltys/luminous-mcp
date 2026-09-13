#!/usr/bin/env bun
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, copyFileSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";

const projectRoot = path.resolve(import.meta.dir, "..");
const pkgPath = path.join(projectRoot, "package.json");
const distDir = path.join(projectRoot, "dist");
const assetsDir = path.join(projectRoot, "assets");
const iconSource = path.join(assetsDir, "icon.png");

if (!existsSync(pkgPath)) {
  console.error("package.json not found in project root");
  process.exit(1);
}

if (!existsSync(iconSource)) {
  console.error(`icon.png not found at ${iconSource}`);
  process.exit(1);
}

const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
const version = pkg.version || "0.1.0";
const stagingDir = path.join(os.tmpdir(), `luminous-mcpb-staging-${Date.now()}`);

console.log(`Building MCP Bundle for ${pkg.name} v${version}...`);

if (!existsSync(distDir)) {
  mkdirSync(distDir, { recursive: true });
}

if (!existsSync(stagingDir)) {
  mkdirSync(stagingDir, { recursive: true });
}

try {
  const binaryName = process.platform === "win32" ? "luminous-mcp.exe" : "luminous-mcp";
  const stagingBinary = path.join(stagingDir, binaryName);
  const distBinary = path.join(distDir, binaryName);

  console.log(`1. Compiling standalone executable: ${binaryName}`);
  const compileResult = spawnSync("bun", [
    "build",
    path.join(projectRoot, "src", "index.ts"),
    "--compile",
    `--outfile=${stagingBinary}`,
  ], {
    cwd: projectRoot,
    stdio: "inherit",
  });

  if (compileResult.status !== 0) {
    throw new Error(`Failed to compile standalone binary (exit code: ${compileResult.status})`);
  }

  // Also copy to dist for standalone binary usage
  copyFileSync(stagingBinary, distBinary);

  console.log("2. Copying icon asset...");
  copyFileSync(iconSource, path.join(stagingDir, "icon.png"));

  console.log("3. Generating MCPB manifest.json...");
  const manifest = {
    $schema: "https://modelcontextprotocol.io/schemas/mcpb/v0.3/manifest.schema.json",
    manifest_version: "0.3",
    name: pkg.name,
    display_name: "Luminous Music Player",
    version,
    description: pkg.description || "MCP server for Luminous Music Player",
    long_description:
      "Connects Claude Desktop and other MCP hosts to your local Luminous Music Player library and database. " +
      "Provides direct access to your music metadata, schema, and playback information.",
    author: {
      name: typeof pkg.author === "string" ? pkg.author : pkg.author?.name ?? "Eric James Soltys",
      url: "https://github.com/esoltys/luminous-mcp",
    },
    homepage: "https://github.com/esoltys/luminous-mcp",
    repository: {
      type: "git",
      url: "https://github.com/esoltys/luminous-mcp.git",
    },
    license: pkg.license || "MIT",
    icon: "icon.png",
    server: {
      type: "binary",
      entry_point: binaryName,
      mcp_config: {
        command: `\${__dirname}/${binaryName}`,
        args: [],
        env: {},
      },
    },
    tools: [
      {
        name: "ping",
        description: "Check server connectivity, uptime, and basic health",
      },
      {
        name: "get_server_info",
        description: "Get Luminous MCP server metadata, database resolution status, schema version, and library size",
      },
      {
        name: "search_library",
        description: "Search music library tracks with full-text search and structured filters (genre, year, BPM, loudness)",
      },
      {
        name: "get_track_details",
        description: "Get comprehensive metadata, audio specs, acoustic measurements, lyrics, and IDs for a track",
      },
      {
        name: "get_artist_summary",
        description: "Get artist summary including catalog size, albums, genres, collaborators, and listening stats",
      },
      {
        name: "get_listening_stats",
        description: "Analyze listening habits, top tracks, top artists, forgotten favorites, and frequently skipped music",
      },
      {
        name: "get_recent_history",
        description: "Get chronological playback history from play_history table with timestamps and playback context",
      },
    ],
    keywords: ["music", "audio", "luminous", "library", "player", "metadata"],
    compatibility: {
      claude_desktop: ">=0.10.0",
      platforms: [process.platform === "win32" ? "win32" : process.platform],
    },
  };

  const manifestPath = path.join(stagingDir, "manifest.json");
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf8");

  const localMcpbBin = path.join(
    projectRoot,
    "node_modules",
    ".bin",
    process.platform === "win32" ? "mcpb.cmd" : "mcpb"
  );

  const runMcpb = (args: string[]) => {
    if (existsSync(localMcpbBin)) {
      return spawnSync(localMcpbBin, args, {
        cwd: projectRoot,
        stdio: "inherit",
      });
    }
    return spawnSync("bun", ["x", "@anthropic-ai/mcpb", ...args], {
      cwd: projectRoot,
      stdio: "inherit",
    });
  };

  console.log("4. Validating manifest with mcpb...");
  const validateResult = runMcpb(["validate", manifestPath]);

  if (validateResult.status !== 0) {
    throw new Error(`Manifest validation failed with status ${validateResult.status}`);
  }

  const outputMcpb = path.join(distDir, "luminous-mcp.mcpb");
  const outputDxt = path.join(distDir, "luminous-mcp.dxt");

  console.log(`5. Packing bundle to ${outputMcpb}...`);
  const packResult = runMcpb(["pack", stagingDir, outputMcpb]);

  if (packResult.status !== 0) {
    throw new Error(`mcpb pack failed with status ${packResult.status}`);
  }

  // Also create .dxt copy for backward compatibility
  copyFileSync(outputMcpb, outputDxt);

  console.log("\n Successfully generated MCP Bundles:");
  console.log(`  - ${outputMcpb}`);
  console.log(`  - ${outputDxt}`);
  console.log("Ready for one-click drag-and-drop installation into Claude Desktop!");
} finally {
  try {
    rmSync(stagingDir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup error
  }
}

process.exit(0);
