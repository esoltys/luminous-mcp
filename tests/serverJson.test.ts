import { describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
  MCP_REGISTRY_SCHEMA,
  RELEASE_TARGETS,
  buildServerJson,
  generateServerJsonFromDist,
  parseSha256Sums,
} from "../scripts/server-json.ts";

const projectRoot = path.resolve(import.meta.dir, "..");

const fakeHash = (fill: string) => fill.repeat(64);

function makeAllChecksums(): Map<string, string> {
  const map = new Map<string, string>();
  RELEASE_TARGETS.forEach((target, idx) => {
    map.set(`luminous-mcp-${target}.mcpb`, fakeHash(String(idx)));
  });
  return map;
}

describe("MCP Registry server.json generator", () => {
  it("parses standard and binary-mode sha256sum lines", () => {
    const input = [
      `${fakeHash("a")}  luminous-mcp-windows-x64.mcpb`,
      `${fakeHash("B")} *dist/luminous-mcp-linux-x64.mcpb`,
      "",
    ].join("\n");

    const parsed = parseSha256Sums(input);
    expect(parsed.size).toBe(2);
    expect(parsed.get("luminous-mcp-windows-x64.mcpb")).toBe(fakeHash("a"));
    expect(parsed.get("luminous-mcp-linux-x64.mcpb")).toBe(fakeHash("b"));
  });

  it("throws on malformed SHA256SUMS lines", () => {
    expect(() => parseSha256Sums("not-a-valid-line")).toThrow("Malformed SHA256SUMS line");
  });

  it("builds valid server.json with all 5 platform mcpb packages", () => {
    const checksums = makeAllChecksums();
    const serverJson = buildServerJson({
      version: "v1.12.0",
      description: "Model Context Protocol (MCP) server for Luminous Music Player",
      checksums,
    });

    expect(serverJson.$schema).toBe(MCP_REGISTRY_SCHEMA);
    expect(serverJson.name).toBe("io.github.esoltys/luminous-mcp");
    expect(serverJson.version).toBe("1.12.0");
    expect(serverJson.repository).toEqual({
      url: "https://github.com/esoltys/luminous-mcp",
      source: "github",
    });
    expect(serverJson.icons[0]?.src).toBe(
      "https://raw.githubusercontent.com/esoltys/luminous-mcp/main/assets/icon.png"
    );
    expect(serverJson.packages).toHaveLength(RELEASE_TARGETS.length);

    for (const [idx, pkg] of serverJson.packages.entries()) {
      const target = RELEASE_TARGETS[idx]!;
      expect(pkg).toEqual({
        registryType: "mcpb",
        identifier: `https://github.com/esoltys/luminous-mcp/releases/download/v1.12.0/luminous-mcp-${target}.mcpb`,
        fileSha256: fakeHash(String(idx)),
        transport: { type: "stdio" },
      });
    }
  });

  it("throws when any expected platform bundle checksum is missing", () => {
    const checksums = makeAllChecksums();
    checksums.delete("luminous-mcp-darwin-arm64.mcpb");

    expect(() =>
      buildServerJson({
        version: "1.12.0",
        description: "Test",
        checksums,
      })
    ).toThrow("Missing SHA-256 checksum for release bundle \"luminous-mcp-darwin-arm64.mcpb\"");
  });

  it("generates server.json on disk from package.json and SHA256SUMS.txt", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "luminous-server-json-"));
    try {
      fs.writeFileSync(
        path.join(tmpDir, "package.json"),
        JSON.stringify({ version: "1.12.0", description: "Test MCP server" }),
        "utf8"
      );
      fs.mkdirSync(path.join(tmpDir, "dist"));
      const sumsContent = RELEASE_TARGETS.map(
        (t, idx) => `${fakeHash(String(idx))}  luminous-mcp-${t}.mcpb`
      ).join("\n");
      fs.writeFileSync(path.join(tmpDir, "dist", "SHA256SUMS.txt"), sumsContent, "utf8");

      const outPath = path.join(tmpDir, "server.json");
      const { serverJson: generated, outPath: writtenPath } = generateServerJsonFromDist(tmpDir, {
        outPath,
      });

      expect(writtenPath).toBe(outPath);
      expect(fs.existsSync(outPath)).toBe(true);
      const written = JSON.parse(fs.readFileSync(outPath, "utf8"));
      expect(written).toEqual(generated);
      expect(written.version).toBe("1.12.0");
      expect(written.packages).toHaveLength(RELEASE_TARGETS.length);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("keeps RELEASE_TARGETS in sync with .github/workflows/release.yml", () => {
    const workflow = fs.readFileSync(
      path.join(projectRoot, ".github", "workflows", "release.yml"),
      "utf8"
    );
    for (const target of RELEASE_TARGETS) {
      expect(workflow).toContain(`bun-${target}`);
    }
  });
});
