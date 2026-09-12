import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { KNOWN_SCHEMA_VERSION, SERVER_NAME, SERVER_VERSION } from "../src/constants.ts";
import { createMcpServer } from "../src/server.ts";

interface TextContent {
  type: "text";
  text: string;
}

function getTextContent(result: unknown): TextContent {
  const r = result as { content?: unknown[] };
  if (!Array.isArray(r.content) || r.content.length === 0) {
    throw new Error("Expected result.content to be a non-empty array");
  }
  const item = r.content[0] as TextContent;
  if (item.type !== "text") {
    throw new Error(`Expected text content, got ${item.type}`);
  }
  return item;
}

describe("MCP System Tools", () => {
  let tempDir: string;
  let tempDbPath: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "luminous-tools-test-"));
    tempDbPath = path.join(tempDir, "luminous.db");
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error
    }
  });

  it("lists system tools ping and get_server_info", async () => {
    const { server, db } = createMcpServer({ dbPath: tempDbPath });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test-client", version: "1.0.0" }, { capabilities: {} });

    await server.connect(serverTransport);
    await client.connect(clientTransport);

    const toolsResult = await client.listTools();
    const toolNames = toolsResult.tools.map((t) => t.name);

    expect(toolNames).toContain("ping");
    expect(toolNames).toContain("get_server_info");

    await client.close();
    await server.close();
    db.close();
  });

  it("calls ping and returns ok status", async () => {
    const { server, db } = createMcpServer({ dbPath: tempDbPath });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test-client", version: "1.0.0" }, { capabilities: {} });

    await server.connect(serverTransport);
    await client.connect(clientTransport);

    const result = await client.callTool({ name: "ping", arguments: {} });
    const firstContent = getTextContent(result);
    const parsed = JSON.parse(firstContent.text);

    expect(parsed.status).toBe("ok");
    expect(parsed.server.name).toBe(SERVER_NAME);
    expect(parsed.server.version).toBe(SERVER_VERSION);
    expect(parsed.timestamp).toBeDefined();

    await client.close();
    await server.close();
    db.close();
  });

  it("calls get_server_info on initialized database", async () => {
    // Populate temp database
    const writer = new Database(tempDbPath);
    writer.run("CREATE TABLE schema_version (version INTEGER PRIMARY KEY);");
    writer.run(`INSERT INTO schema_version (version) VALUES (${KNOWN_SCHEMA_VERSION});`);
    writer.run("CREATE TABLE songs (id INTEGER PRIMARY KEY, title TEXT);");
    writer.run("INSERT INTO songs (title) VALUES ('Song 1'), ('Song 2');");
    writer.close();

    const { server, db } = createMcpServer({ dbPath: tempDbPath });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test-client", version: "1.0.0" }, { capabilities: {} });

    await server.connect(serverTransport);
    await client.connect(clientTransport);

    const result = await client.callTool({ name: "get_server_info", arguments: {} });
    const firstContent = getTextContent(result);
    const parsed = JSON.parse(firstContent.text);

    expect(parsed.server.name).toBe(SERVER_NAME);
    expect(parsed.server.version).toBe(SERVER_VERSION);
    expect(parsed.database.exists).toBe(true);
    expect(parsed.database.schemaVersion).toBe(KNOWN_SCHEMA_VERSION);
    expect(parsed.database.knownSchemaVersion).toBe(KNOWN_SCHEMA_VERSION);
    expect(parsed.database.isCompatible).toBe(true);
    expect(parsed.database.trackCount).toBe(2);
    expect(parsed.database.path).toBe(tempDbPath);

    await client.close();
    await server.close();
    db.close();
  });

  it("calls get_server_info when database file does not exist", async () => {
    const missingDb = path.join(tempDir, "nonexistent.db");
    const { server, db } = createMcpServer({ dbPath: missingDb });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test-client", version: "1.0.0" }, { capabilities: {} });

    await server.connect(serverTransport);
    await client.connect(clientTransport);

    const result = await client.callTool({ name: "get_server_info", arguments: {} });
    const firstContent = getTextContent(result);
    const parsed = JSON.parse(firstContent.text);

    expect(parsed.database.exists).toBe(false);
    expect(parsed.database.trackCount).toBe(0);
    expect(parsed.database.schemaVersion).toBe(0);
    expect(parsed.database.isCompatible).toBe(false);

    await client.close();
    await server.close();
    db.close();
  });
});
