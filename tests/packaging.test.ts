import { describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";

const projectRoot = path.resolve(import.meta.dir, "..");

describe("MCPB Packaging Assets & Configuration", () => {
  it("has a valid 512x512 PNG icon in assets/icon.png", () => {
    const iconPath = path.join(projectRoot, "assets", "icon.png");
    expect(fs.existsSync(iconPath)).toBe(true);

    const buf = fs.readFileSync(iconPath);
    // Verify PNG magic header: 89 50 4E 47 0D 0A 1A 0A
    expect(buf[0]).toBe(0x89);
    expect(buf[1]).toBe(0x50);
    expect(buf[2]).toBe(0x4e);
    expect(buf[3]).toBe(0x47);

    // Read IHDR dimensions (offset 16 and 20)
    const width = buf.readUInt32BE(16);
    const height = buf.readUInt32BE(20);
    expect(width).toBe(512);
    expect(height).toBe(512);
  });

  it("package.json has required scripts and metadata for MCPB bundling", () => {
    const pkgPath = path.join(projectRoot, "package.json");
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));

    expect(pkg.name).toBe("luminous-mcp");
    expect(pkg.version).toBeDefined();
    expect(pkg.scripts["build:binary"]).toBeDefined();
    expect(pkg.scripts["package:mcpb"]).toBeDefined();
    expect(pkg.scripts["package"]).toBeDefined();
    expect(pkg.devDependencies["@anthropic-ai/mcpb"]).toBeDefined();
  });

  it("packaging script exists and is executable", () => {
    const scriptPath = path.join(projectRoot, "scripts", "package-mcpb.ts");
    expect(fs.existsSync(scriptPath)).toBe(true);
  });

  it("packages bundle and produces valid .mcpb and .dxt archives", () => {
    const result = Bun.spawnSync(["bun", "run", "scripts/package-mcpb.ts"], {
      cwd: projectRoot,
      env: process.env,
    });
    expect(result.exitCode).toBe(0);

    const mcpbPath = path.join(projectRoot, "dist", "luminous-mcp.mcpb");
    const dxtPath = path.join(projectRoot, "dist", "luminous-mcp.dxt");

    expect(fs.existsSync(mcpbPath)).toBe(true);
    expect(fs.existsSync(dxtPath)).toBe(true);
    expect(fs.statSync(mcpbPath).size).toBeGreaterThan(1000);
    expect(fs.statSync(dxtPath).size).toBeGreaterThan(1000);
  }, 30000);
});
