# Luminous MCP Server

A Model Context Protocol (MCP) server for Luminous Music Player, enabling AI assistants and LLM tools to interact with local music libraries, metadata, playlists, and playback.

## Branching & PR Rules

- NEVER commit or push directly to `main`. All changes ship via PR, even release version bumps and docs-only edits.
- Merging is allowed once — and only once — every check on the PR has actually finished. Confirm via `gh pr checks <pr> --watch` or `gh pr checks <pr>` showing zero `pending`/`in_progress` rows, then run `gh pr merge <pr>`. Tell the user once it's merged.
- PR base branch targets `main`.
- Before creating a branch, confirm the base: `git fetch origin && git switch -c <branch> origin/main`.

## Worktrees

- All feature work happens in a dedicated worktree under the standard worktree root (`.claude/worktrees/` for Claude, `.worktrees/<name>/` for other assistants). NEVER edit files in the main checkout while a worktree exists for that branch.
- Before any Edit/Write, confirm the path is the intended worktree.
- Never run `bun install` in the main checkout during worktree work — it dirties `bun.lock`.

## Tech Stack

- **Runtime**: Bun
- **Language**: TypeScript (strict mode)
- **Protocol**: Model Context Protocol (`@modelcontextprotocol/sdk`)
- **Validation**: Zod
- **Database**: SQLite (`bun:sqlite`) accessing Luminous's `luminous.db`

## Quick Start Commands

- **Install dependencies**: `bun install`
- **Type check**: `bun run typecheck`
- **Run tests**: `bun test`
- **Run server**: `bun run start`
- **Build**: `bun run build`
- **Package bundle**: `bun run package` (Note for agents on Windows: `bun run package` / `scripts/package-mcpb.ts` can linger as a background task even after completing output due to lingering child stdio handles; check output for `Successfully generated MCP Bundles` or terminate the background task once output confirms success rather than waiting indefinitely).

## Issue Priority & Status Tracking

**NEVER apply a `P1`/`P2`/`P3`/`P4` label to an issue, and never pass `--label P1` to `gh issue create`.** Priority and Status are tracked exclusively as fields on the "Luminous MCP" GitHub Project (`gh project` number `5`, owner `esoltys`). See [docs/ISSUE_PRIORITY.md](docs/ISSUE_PRIORITY.md) for the CLI commands to set Priority and Status.