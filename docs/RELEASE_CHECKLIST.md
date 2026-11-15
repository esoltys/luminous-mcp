# Release Checklist

Steps for cutting a luminous-mcp release. Pushing a `v*` tag runs
[`release.yml`](../.github/workflows/release.yml), which builds, signs and publishes
everything; the steps below are what happens around it.

## Scope

- [ ] `git log <last-tag>..main --oneline`: every user-facing change has an issue. Chores
      (deps, tests, docs) don't need to be listed in the release notes.

## Compatibility with Luminous

- [ ] Compare `KNOWN_SCHEMA_VERSION` in `src/constants.ts` with Luminous's
      `CURRENT_SCHEMA_VERSION` (`src-tauri/src/db.rs`). `get_server_info` reports a newer
      database as incompatible, so bump it for each app migration this server has been
      checked against (it sat at 82 against schema 85 until #117).
- [ ] Optional but worth it: run `main` read-only against a real library
      (`get_server_info`, `get_artist_profile`, `list_artists`, `list_artist_tags`).

## Content

- [ ] Write `docs/release-notes/vX.Y.Z.md` in the style of luminous's: emoji section
      headings, bullets that link the issues, no chores.
- [ ] README and tool descriptions match the tools that ship.

## Verification

- [ ] `bun run typecheck`, `bun test`, `bun run build`
- [ ] Audit workflow green on `main`.
- [ ] `bun run package:mcpb`, then list the bundle's tools (on Windows, terminate the
      lingering background task once it prints "Successfully generated").

## Cut the release

- [ ] Bump the version in `package.json`, `src/constants.ts` and
      `.claude-plugin/plugin.json`; open a PR (never push to `main`); merge once every
      check has finished.
- [ ] After it merges: `git checkout main && git pull`, then
      `git tag -a vX.Y.Z -m "Release vX.Y.Z"` and `git push origin vX.Y.Z`. The workflow
      fails unless the tag matches `package.json`.
- [ ] `gh run watch <run-id> --exit-status` until the whole run finishes.

## Post-build

- [ ] The workflow publishes the release with generated notes. Replace them:
      `gh release edit vX.Y.Z --notes-file docs/release-notes/vX.Y.Z.md`.
- [ ] Confirm the assets: five platform `.mcpb` bundles, `SHA256SUMS.txt` and its
      `.sigstore.json`; and that the MCP Registry publish step succeeded.
- [ ] Install the signed `.mcpb` in Claude Desktop (Settings > Extensions), restart it,
      and check `get_server_info` shows the new version.
- [ ] Close the resolved issues and set them to Done on the Luminous MCP project board.
