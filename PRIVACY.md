# Privacy

Luminous MCP runs entirely on your own computer.

- It reads (and, for curation tools you invoke, writes) your local Luminous library database and talks to the Luminous desktop app over a loopback connection (127.0.0.1).
- It collects no telemetry and sends nothing to the author.
- The only outbound request is the optional `lookup_musicbrainz` live lookup, which sends a MusicBrainz ID to musicbrainz.org. It is skipped when Luminous is in Offline mode or when `fetch_live` is false.
- Tool results are returned to the AI assistant you connected; what that assistant does with them is governed by that assistant's own privacy policy.

Questions: https://github.com/esoltys/luminous-mcp/issues
