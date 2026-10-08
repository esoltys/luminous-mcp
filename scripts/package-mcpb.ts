#!/usr/bin/env bun
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, copyFileSync, cpSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { buildManifest, type McpbPlatform } from "./manifest.ts";

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

// Optional cross-compile: `--target bun-linux-x64` (bun-{windows|darwin|linux}-{x64|arm64}).
const targetArg = process.argv.includes("--target") ? process.argv[process.argv.indexOf("--target") + 1] : undefined;
const target = targetArg ? parseTarget(targetArg) : undefined;

function parseTarget(bunTarget: string): { bunTarget: string; platform: McpbPlatform; label: string } {
  const m = /^bun-(windows|darwin|linux)-(x64|arm64)(?:-.+)?$/.exec(bunTarget);
  if (!m) {
    console.error(`Unsupported --target "${bunTarget}" (expected bun-{windows|darwin|linux}-{x64|arm64})`);
    process.exit(1);
  }
  const platform: McpbPlatform = m[1] === "windows" ? "win32" : (m[1] as McpbPlatform);
  return { bunTarget, platform, label: `${m[1]}-${m[2]}` };
}
const stagingDir = path.join(os.tmpdir(), `luminous-mcpb-staging-${Date.now()}`);

console.log(`Building MCP Bundle for ${pkg.name} v${version}...`);

if (!existsSync(distDir)) {
  mkdirSync(distDir, { recursive: true });
}

if (!existsSync(stagingDir)) {
  mkdirSync(stagingDir, { recursive: true });
}

try {
  const bundlePlatform = target ? target.platform : (process.platform as McpbPlatform);
  const binaryName = bundlePlatform === "win32" ? "luminous-mcp.exe" : "luminous-mcp";
  const stagingBinary = path.join(stagingDir, binaryName);
  const distBinary = path.join(distDir, binaryName);

  console.log(`1. Compiling standalone executable: ${binaryName}`);
  const compileResult = spawnSync("bun", [
    "build",
    path.join(projectRoot, "src", "index.ts"),
    "--compile",
    ...(target ? [`--target=${target.bunTarget}`] : []),
    `--outfile=${stagingBinary}`,
  ], {
    cwd: projectRoot,
    stdio: "inherit",
  });

  if (compileResult.status !== 0) {
    throw new Error(`Failed to compile standalone binary (exit code: ${compileResult.status})`);
  }

  // Also copy to dist for standalone binary usage (native builds only)
  if (!target) copyFileSync(stagingBinary, distBinary);

  console.log("2. Copying icon asset...");
  copyFileSync(iconSource, path.join(stagingDir, "icon.png"));

  const skillsSource = path.join(projectRoot, "skills");
  if (existsSync(skillsSource)) {
    console.log("3. Copying skills directory...");
    cpSync(skillsSource, path.join(stagingDir, "skills"), { recursive: true });
  }

  const docsDir = path.join(projectRoot, "docs");
  const screenshotNames = existsSync(docsDir)
    ? readdirSync(docsDir).filter((f) => /^screenshot-.*\.(png|jpe?g)$/.test(f)).sort()
    : [];
  if (screenshotNames.length > 0) {
    mkdirSync(path.join(stagingDir, "screenshots"), { recursive: true });
    for (const f of screenshotNames) {
      copyFileSync(path.join(docsDir, f), path.join(stagingDir, "screenshots", f));
    }
  }

  console.log("4. Generating MCPB manifest.json...");
  const manifest = await buildManifest({
    name: pkg.name,
    version,
    description: pkg.description || "MCP server for Luminous Music Player",
    authorName: typeof pkg.author === "string" ? pkg.author : pkg.author?.name ?? "Eric James Soltys",
    license: pkg.license || "MIT",
    binaryName,
    platform: bundlePlatform,
    screenshots: screenshotNames.map((f) => `screenshots/${f}`),
  });

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

  console.log("5. Validating manifest with mcpb...");
  const validateResult = runMcpb(["validate", manifestPath]);

  if (validateResult.status !== 0) {
    throw new Error(`Manifest validation failed with status ${validateResult.status}`);
  }

  const outputMcpb = path.join(distDir, target ? `luminous-mcp-${target.label}.mcpb` : "luminous-mcp.mcpb");
  const outputDxt = path.join(distDir, "luminous-mcp.dxt");

  console.log(`6. Packing bundle to ${outputMcpb}...`);
  const packResult = runMcpb(["pack", stagingDir, outputMcpb]);

  if (packResult.status !== 0) {
    throw new Error(`mcpb pack failed with status ${packResult.status}`);
  }

  console.log("\n Successfully generated MCP Bundles:");
  console.log(`  - ${outputMcpb}`);
  if (!target) {
    // Also create .dxt copy for backward compatibility
    copyFileSync(outputMcpb, outputDxt);
    console.log(`  - ${outputDxt}`);
  }
  console.log("Ready for one-click drag-and-drop installation into Claude Desktop!");
} finally {
  try {
    rmSync(stagingDir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup error
  }
}

process.exit(0);
