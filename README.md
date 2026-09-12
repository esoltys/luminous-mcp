# Luminous MCP Server

A [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) server for [Luminous Music Player](https://github.com/esoltys/luminous).

Connects your AI assistants (Claude Desktop, Antigravity, Cursor, Zed, Goose, Ollama) to your local music library.

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

### Adding to Claude Desktop / MCP Clients

Add to your `claude_desktop_config.json` or MCP client configuration:

```json
{
  "mcpServers": {
    "luminous": {
      "command": "bun",
      "args": ["run", "C:/Users/ericj/source/luminous-mcp/src/index.ts"],
      "env": {
        "LUMINOUS_DB_PATH": ""
      }
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