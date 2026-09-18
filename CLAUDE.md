# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

An MCP (Model Context Protocol) server that lets AI assistants query and control [Luminous Music Player](https://github.com/esoltys/luminous) — a local desktop music player. It reads Luminous's SQLite library database directly (read-mostly, with writes for curation) and talks to a running Luminous desktop instance over a loopback HTTP "bridge" for playback control and live UI sync.

## Commands

- Install: `bun install`
- Run server: `bun run start`
- Run SSE server (network/container): `bun run start:sse`
- Type check: `bun run typecheck` (`tsc --noEmit`)
- Test all: `bun test`
- Test single file: `bun test tests/library.test.ts`
- Test by name: `bun test -t "search_library"`
- Build (bundled JS): `bun run build`
- Build standalone binary: `bun run build:binary`
- Package MCP Bundle (.mcpb): `bun run package` (alias for `package:mcpb`). On Windows this can appear to hang as a background task due to lingering child stdio handles — check output for `Successfully generated MCP Bundles` and treat that as done rather than waiting for the process to exit.

No lint script is defined; rely on `bun run typecheck` and `bun test`.

## Branching & PR rules (see [AGENTS.md](AGENTS.md) for full detail)

- Never commit or push directly to `main`; all changes ship via PR targeting `main`.
- Work happens in a dedicated worktree (`.claude/worktrees/<name>/`); don't edit the main checkout while a worktree for that branch exists, and don't run `bun install` there either (dirties `bun.lock`).
- Only merge once every PR check has actually finished (`gh pr checks <pr>` shows no pending/in_progress rows).
- GitHub issue Priority/Status are tracked as Project fields (project #5, owner `esoltys`), never as `P1`–`P4` labels — see [docs/ISSUE_PRIORITY.md](docs/ISSUE_PRIORITY.md).

## Architecture

**Two independent data paths, both wired together in [src/server.ts](src/server.ts):**

1. **SQLite read/write path** ([src/db/connection.ts](src/db/connection.ts), [src/db/paths.ts](src/db/paths.ts)) — `LuminousDatabase` lazily opens Luminous's `luminous.db` via `bun:sqlite`. The DB path is resolved once at startup by `resolveDbPath()`: explicit `LUMINOUS_DB_PATH` / `LUMINOUS_DATA_DIR` env vars win, otherwise it probes OS-specific default locations (Windows: `%APPDATA%/<MSIX identity>/luminous.db` with a fallback identifier; macOS: `~/Library/Application Support/org.luminous.music/`; Linux: XDG dirs) and picks the first that exists. Query/mutation logic per domain lives in `src/db/*.ts` (`library.ts`, `analytics.ts`, `curation.ts`, `playlists.ts`); tools never touch `bun:sqlite` directly, they call into these.
2. **Desktop bridge (HTTP loopback)** ([src/bridge/client.ts](src/bridge/client.ts)) — `LuminousBridgeClient` talks to a *running* Luminous desktop process on `127.0.0.1:21849` (overridable via `LUMINOUS_BRIDGE_URL`/`LUMINOUS_BRIDGE_PORT`) for things the DB alone can't do: live playback state/control (`/playback`, `/playback/control`, `/playback/play`) and one-way event notifications (`/events/notify`, e.g. `library-changed`) so an open Luminous window refreshes its UI immediately after an MCP-driven mutation. Bridge calls are timeout-guarded and connection failures are surfaced as a distinct `LuminousBridgeError.isConnectionError` case (Luminous just isn't running) versus a real error — notification calls in particular are non-blocking and swallow failures so DB writes never fail because the desktop app is closed.

**Tool registration** ([src/server.ts](src/server.ts)): `createMcpServer()` constructs the `LuminousDatabase` and `LuminousBridgeClient`, then calls one `register*Tools(server, db[, bridge])` function per domain from `src/tools/` (`system`, `library`, `analytics`, `playlists`, `curation`, `playback`). Tools that mutate the library (playlists, curation) hold a `bridge` reference purely to call `notifyEvent(...)` after a successful write. New tools follow the existing pattern: define a Zod schema for params, delegate all DB logic to `src/db/*.ts`, and format the result with `formatMcpResponse()`.

**Response formatting** ([src/utils/response.ts](src/utils/response.ts)): all tool responses go through `formatMcpResponse()`, which JSON-serializes compactly (no whitespace, unless `LUMINOUS_PRETTY_JSON=1`) and strips null/undefined/empty-string fields by default via `stripNullAndEmpty()` to minimize token usage — this is a deliberate token-efficiency strategy documented in [README.md](README.md), not incidental; don't add manual `JSON.stringify` calls in tools, and don't defeat the stripping by pre-filling fields with `""`/`null` for "completeness."

**Testing pattern** (see [tests/library.test.ts](tests/library.test.ts)): tests spin up a real in-memory-equivalent SQLite file (temp path via `bun:sqlite`), manually create the subset of Luminous's schema needed (e.g. `schema_version`, `songs`), then connect an MCP `Client`/`Server` pair over `InMemoryTransport` against `createMcpServer()` to exercise tools end-to-end rather than mocking the DB layer.

## Environment variables

- `LUMINOUS_DB_PATH` — absolute path to `luminous.db`, overrides all default-location detection.
- `LUMINOUS_DATA_DIR` — directory containing `luminous.db`, used if `LUMINOUS_DB_PATH` isn't set.
- `LUMINOUS_BRIDGE_URL` / `LUMINOUS_BRIDGE_PORT` — override the desktop bridge target (default `http://127.0.0.1:21849`).
- `LUMINOUS_MCP_PORT` — port for the SSE server (default `21850`).
- `LUMINOUS_MCP_HOST` — bind host for the SSE server (default `0.0.0.0`).
- `LUMINOUS_PRETTY_JSON=1` — pretty-print tool response JSON (debugging only; increases token usage).
