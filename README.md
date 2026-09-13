# Luminous MCP Server

A [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) server for [Luminous Music Player](https://github.com/esoltys/luminous).

Connects your AI assistants (Claude Desktop, Antigravity, Cursor, Zed, Ollama) to your local music library.

![screenshot-02](./docs/screenshot-02.jpg)

## ✨ Features

- **Library Search & Filtering**: Search tracks, albums, artists, genres, composers, and lyrics using SQLite FTS5. Filter by BPM, LUFS loudness, dynamic range, and bit depth.
- **Listening Analytics**: Inspect play counts, skip rates, top tracks/artists, and forgotten favorites.
- **Playlist Management**: Query, generate, and populate static and dynamic playlists.
- **Metadata Hygiene**: Audit library for missing tags (album art, composer, year, lyrics) and assist in custom genre taxonomy assignment.
- **Playback Control**: Interact with running Luminous instances for transport controls (play, pause, next, seek, volume).

## ⚡ Token Efficiency & Optimization

Luminous MCP implements strict token-efficiency and context window optimization best practices designed specifically for LLMs:

| Optimization Feature | Implementation | Token & Context Window Impact |
| :--- | :--- | :--- |
| **Compact JSON Serialization** | Stripped indentation whitespace by default (`JSON.stringify(obj)`); optional pretty printing via `pretty` argument or `LUMINOUS_PRETTY_JSON=1` | **15%–25% reduction** across all tool responses |
| **Sparse Field Pruning** | Recursively strips `null`, `undefined`, and empty strings (`""`) while preserving semantic falsy values (`0`, `false`, `[]`) | **25%–35% reduction** across metadata-dense inspection tools |
| **On-Demand Lyrics Gating** | Full song lyrics gated behind explicit `include_lyrics: true` flag in `get_track_details` (defaults to boolean indicator `has_lyrics`) | **500–1,500+ tokens saved per track** lookup |
| **Search Detail Levels** | `search_library` defaults to compact essential fields (`id`, `title`, `artist`, `album`, `year`, `duration_seconds`); `detail_level: "full"` on demand | **50%–70% reduction** on search listings |
| **Metric Deduplication** | Canonical ISO 8601 timestamps (`last_played_iso`, `played_at_iso`), single float ratios (`skip_ratio`), and seconds durations (`duration_seconds`) | **15%–20% reduction** on analytics and history queries |
| **Bounded Collections** | Caps artist summary entity lists (`collaborators`, `composers`, `producers`) to top 20 frequency-ranked entries, while returning total counts | Prevents **1,000–3,000+ token explosions** on prolific artists |
| **Offset Pagination** | Incremental `limit` & `offset` pagination with `total_matches` and `has_more` metadata for `search_library` and `get_recent_history` | Eliminates redundant page re-fetching during multi-turn exploration |

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