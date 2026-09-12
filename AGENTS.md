# Luminous MCP Server

A Model Context Protocol (MCP) server for Luminous Music Player, enabling AI assistants and LLM tools to interact with local music libraries, metadata, playlists, and playback.

## Branching & PR Rules

- NEVER commit or push directly to \main\. All changes ship via PR, even release version bumps and docs-only edits.
- Merging is allowed once — and only once — every check on the PR has actually finished. Confirm via \gh pr checks <pr> --watch\ or \gh pr checks <pr>\ showing zero \pending\/\in_progress\ rows, then run \gh pr merge <pr>\. Tell the user once it's merged.
- PR base branch targets \main\.
- Before creating a branch, confirm the base: \git fetch origin && git switch -c <branch> origin/main\.

## Worktrees

- All feature work happens in a dedicated worktree under the standard worktree root (\.claude/worktrees/\ for Claude, \.worktrees/<name>/\ for other assistants). NEVER edit files in the main checkout while a worktree exists for that branch.
- Before any Edit/Write, confirm the path is the intended worktree.
- Never run \un install\ in the main checkout during worktree work — it dirties \un.lock\.

## Tech Stack

- **Runtime**: Bun
- **Language**: TypeScript (strict mode)
- **Protocol**: Model Context Protocol (\@modelcontextprotocol/sdk\)
- **Validation**: Zod
- **Database**: SQLite (\un:sqlite\) accessing Luminous's \luminous.db\

## Quick Start Commands

- **Install dependencies**: \un install\
- **Type check**: \un run typecheck\
- **Run tests**: \un test\
- **Run server**: \un run start\
- **Build**: \un run build\

## Issue Priority & Status Tracking

**NEVER apply a \P1\/\P2\/\P3\/\P4\ label to an issue, and never pass \--label P1\ to \gh issue create\.** Priority and Status are tracked exclusively as fields on the "Luminous MCP" GitHub Project (\gh project\ number \5\, owner \soltys\). See [docs/ISSUE_PRIORITY.md](docs/ISSUE_PRIORITY.md) for the CLI commands to set Priority and Status.