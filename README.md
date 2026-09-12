# Luminous MCP Server

A [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) server for [Luminous Music Player](https://github.com/esoltys/luminous).

Connects your AI assistants (Claude Desktop, Antigravity, Cursor, Zed, Ollama) to your local music library.

## ✨ Features

- **Library Search & Filtering**: Search tracks, albums, artists, genres, composers, and lyrics using SQLite FTS5. Filter by BPM, LUFS loudness, dynamic range, and bit depth.
- **Listening Analytics**: Inspect play counts, skip rates, top tracks/artists, and forgotten favorites.
- **Playlist Management**: Query, generate, and populate static and dynamic playlists.
- **Metadata Hygiene**: Audit library for missing tags (album art, composer, year, lyrics) and assist in custom genre taxonomy assignment.
- **Playback Control**: Interact with running Luminous instances for transport controls (play, pause, next, seek, volume).

## 🚀 Getting Started

### Prerequisites

- [Bun](https://bun.sh) (v1.1+)
- [Luminous Music Player](https://github.com/esoltys/luminous) installed with a music library scanned

### Installation

```bash
git clone https://github.com/esoltys/luminous-mcp.git
cd luminous-mcp
bun install
bun run build
```

### Running the Server

```bash
bun run start
```

### One-Click Install (Claude Desktop)

Install directly via the official [MCP Bundle (.mcpb)](https://github.com/modelcontextprotocol/mcpb) format:

1. Build the bundle:
   ```bash
   bun run package:mcpb
   ```
2. Open Claude Desktop, go to **Settings > Extensions**, and drag `dist/luminous-mcp.mcpb` into the window.
3. Click **Install**. The extension runs a self-contained binary with zero external dependencies.

### Manual Configuration (Claude Desktop, Antigravity, Cursor)

Alternatively, add `luminous` to your `claude_desktop_config.json` or MCP client configuration:

```json
{
  "mcpServers": {
    "luminous": {
      "command": "bun",
      "args": ["run", "C:/path/to/luminous-mcp/src/index.ts"]
    }
  }
}
```

## 🛠️ Development

- **Typecheck**: `bun run typecheck`
- **Tests**: `bun test`
- **Build**: `bun run build`

## 📄 License

MIT © Eric James Soltys