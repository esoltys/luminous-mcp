# Issue Priority & Status

Priority (P1–P4) and Status (Todo/In Progress/Done/Parked) are tracked exclusively as fields on
the "Luminous MCP" GitHub Project (\gh project\ number \5\, owner \soltys\) — never as
labels. Both are readable and settable directly through the \gh project\ CLI; there's no need to
ask the user to update them by hand or fall back to a label as a substitute.

## Adding a new issue to the board

A freshly created issue isn't a Project item yet, so it has no Priority/Status to read or set
until it's added:

\\\ash
gh project item-add 5 --owner esoltys --url <issue-url>
\\\

## Reading current values

\\\ash
gh project item-list 5 --owner esoltys --format json
\\\

Each item in the result includes \priority\ and \status\ directly, plus \content.number\ so you
can match it to a specific issue.

## Setting a value

Find the item's \id\ from the \item-list\ output above (matching on \content.number\), then:

\\\ash
gh project item-edit --project-id PVT_kwHOAAE3ZM4BjPpD --id <item-id> \
  --field-id <field-id> --single-select-option-id <option-id>
\\\

**Priority** — field id \PVTSSF_lAHOAAE3ZM4BjPpDzhiEupI\:

| Option | id |
| --- | --- |
| P1 | \8b9338b1\ |
| P2 | \567c1de3\ |
| P3 | \996cb43\ |
| P4 | \97524b7b\ |

**Status** — field id \PVTSSF_lAHOAAE3ZM4BjPpDzhiEulw\:

| Option | id |
| --- | --- |
| Todo | \75ad846\ |
| In Progress | \47fc9ee4\ |
| Done | \98236657\ |
| Parked | \9e808b96\ |

If the Project's fields are ever recreated, these IDs will change — re-run \gh project field-list
5 --owner esoltys --format json\ and update this table.

## Priority scheme

Every bug/feature issue gets a Priority when it's created — set Status to "Todo" and assign a
Priority using this scheme:

### Bugs
- **P1** — Critical bug stopping the MCP server from running or answering queries.
- **P2** — Severe defect, incorrect tool results, workaround exists.
- **P3** — Limited impact, single tool parameter or edge case affected.
- **P4** — Inconvenience, cosmetic / minor logging issue.

### Features
- **P1** — Foundational infrastructure: MCP stdio server, SQLite schema auto-discovery, core search tools.
- **P2** — Core intelligence tools: analytics, playlist management, metadata hygiene, tag curation.
- **P3** — Live desktop bridge: real-time playback control and queue synchronization.
- **P4** — Speculative or peripheral tools: standalone terminal/CLI companion, experimental features.

Don't default new issues to P2/P3 — assign a priority using the criteria above.