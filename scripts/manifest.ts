import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "../src/server.ts";

export type McpbPlatform = "win32" | "darwin" | "linux";

export interface ManifestOptions {
  name: string;
  version: string;
  description: string;
  authorName: string;
  license: string;
  binaryName: string;
  platform: McpbPlatform;
  screenshots: string[];
}

const REPO_URL = "https://github.com/esoltys/luminous-mcp";

/**
 * Lists the tools the server really registers, so the manifest can never drift
 * from the code. Descriptions are trimmed to their first sentence for the store card.
 */
export async function listRegisteredTools(): Promise<Array<{ name: string; description: string }>> {
  const { server, db } = createMcpServer({ readonly: true });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "manifest-generator", version: "1.0.0" }, { capabilities: {} });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    const { tools } = await client.listTools();
    return tools.map((t) => ({
      name: t.name,
      description: (t.description ?? "").split(/(?<=\.)\s/)[0]!.trim(),
    }));
  } finally {
    await client.close();
    await server.close();
    db.close();
  }
}

export async function buildManifest(opts: ManifestOptions) {
  return {
    $schema: "https://modelcontextprotocol.io/schemas/mcpb/v0.3/manifest.schema.json",
    manifest_version: "0.3",
    name: opts.name,
    display_name: "Luminous Music Player",
    version: opts.version,
    description: opts.description,
    long_description:
      "Connects Claude Desktop and other MCP hosts to your local Luminous Music Player library and database. " +
      "Provides direct access to your music metadata, schema, and playback information.",
    author: { name: opts.authorName, url: REPO_URL },
    homepage: REPO_URL,
    support: `${REPO_URL}/issues`,
    repository: { type: "git", url: `${REPO_URL}.git` },
    license: opts.license,
    privacy_policies: [`${REPO_URL}/blob/main/PRIVACY.md`],
    icon: "icon.png",
    screenshots: opts.screenshots,
    server: {
      type: "binary",
      entry_point: opts.binaryName,
      mcp_config: {
        command: `\${__dirname}/${opts.binaryName}`,
        args: [],
        env: { LUMINOUS_DB_PATH: "${user_config.db_path}" },
      },
    },
    user_config: {
      db_path: {
        type: "file",
        title: "Luminous database",
        description:
          "Path to luminous.db. Leave empty to auto-detect; set it for portable Luminous installs (<luminous folder>/data/luminous.db) or custom locations.",
        required: false,
      },
    },
    tools: await listRegisteredTools(),
    keywords: ["music", "audio", "luminous", "library", "player", "metadata"],
    compatibility: {
      claude_desktop: ">=0.10.0",
      platforms: [opts.platform],
    },
  };
}
