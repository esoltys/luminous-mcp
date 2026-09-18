import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createSseServer, type SseServerInstance } from "../src/sse.ts";

describe("SSE HTTP Transport Server", () => {
  let tempDir: string;
  let tempDbPath: string;
  let serverInstance: SseServerInstance | null = null;
  let baseUrl: string;

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "luminous-sse-test-"));
    tempDbPath = path.join(tempDir, "luminous.db");

    const sqlite = new Database(tempDbPath);
    sqlite.run("CREATE TABLE schema_version (version INTEGER PRIMARY KEY);");
    sqlite.run("INSERT INTO schema_version (version) VALUES (34);");
    sqlite.run(`
      CREATE TABLE songs (
        id INTEGER PRIMARY KEY,
        title TEXT,
        artist TEXT,
        album TEXT
      );
    `);
    sqlite.run("INSERT INTO songs (id, title, artist, album) VALUES (1, 'Test Track', 'Test Artist', 'Test Album');");
    sqlite.close();

    // Port 0 lets the OS pick an available ephemeral port
    serverInstance = createSseServer({
      dbPath: tempDbPath,
      port: 0,
      host: "127.0.0.1",
    });

    const { port, host } = await serverInstance.listen();
    baseUrl = `http://${host}:${port}`;
  });

  afterEach(async () => {
    if (serverInstance) {
      await serverInstance.close();
      serverInstance = null;
    }
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error
    }
  });

  it("handles OPTIONS request with CORS headers", async () => {
    const res = await fetch(`${baseUrl}/health`, { method: "OPTIONS" });
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(res.headers.get("access-control-allow-methods")).toContain("GET");
  });

  it("serves /health with server and database metadata", async () => {
    const res = await fetch(`${baseUrl}/health`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");

    const data = (await res.json()) as {
      status: string;
      name: string;
      version: string;
      database: { exists: boolean; trackCount: number; schemaVersion: number };
    };

    expect(data.status).toBe("ok");
    expect(data.name).toBe("luminous-mcp");
    expect(data.database.exists).toBe(true);
    expect(data.database.trackCount).toBe(1);
    expect(data.database.schemaVersion).toBe(34);
  });

  it("returns 404 for unknown endpoints", async () => {
    const res = await fetch(`${baseUrl}/nonexistent`);
    expect(res.status).toBe(404);
  });

  it("initiates SSE stream on GET /sse", async () => {
    const controller = new AbortController();
    const res = await fetch(`${baseUrl}/sse`, {
      signal: controller.signal,
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/event-stream");

    const reader = res.body?.getReader();
    expect(reader).toBeDefined();

    if (reader) {
      const { value } = await reader.read();
      const text = new TextDecoder().decode(value);
      expect(text).toContain("event: endpoint");
      expect(text).toContain("sessionId=");
    }

    controller.abort();
  });

  it("returns 400 when posting messages to an invalid sessionId", async () => {
    const res = await fetch(`${baseUrl}/messages?sessionId=invalid-session-12345`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", method: "ping", id: 1 }),
    });

    expect(res.status).toBe(400);
    const text = await res.text();
    expect(text).toContain("Session not found");
  });
});
