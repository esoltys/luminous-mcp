---
name: update-artist-bio
description: Research and write/update an artist's curated biography in the Luminous library via the Luminous MCP server's update_artist_profile tool. Use when the user asks to add, write, generate, fix, or update an artist bio, or to fill in missing artist profile info in Luminous.
---

# Update Artist Bio

Write or refresh a curated biography for an artist in the Luminous library, then save it
with `update_artist_profile` (Luminous MCP). Follow these content rules — they are not
optional formatting suggestions, they are hard constraints on what gets written to the DB.

## Content rules

1. **No track lists.** Never enumerate songs, singles, or albums track-by-track. A bio
   describes the artist (origin, career arc, style, notable achievements), not a discography.
   Album/release names may be mentioned in passing as part of a narrative sentence, but no
   bulleted or numbered lists of tracks.
2. **No Twitter/X links.** Never include a twitter.com or x.com URL, anywhere — not in the
   bio text, not in `social_links`/`links`.
3. **Official links only.** Only include links the artist (or their label/management)
   controls directly: official website, official artist page on a streaming/store platform
   (Spotify, Apple Music, Bandcamp), official label page, Wikipedia (as a source citation,
   not a "link"), or verified official social accounts (Instagram, Facebook, YouTube channel,
   etc. — excluding Twitter/X per rule 2). Never include fan sites, lyrics sites, unofficial
   wikis, forums, or aggregator/discovery sites you can't confirm are artist-controlled.
4. **Length limit.** Keep the bio to roughly 150–300 words (aim for ~1,200–1,800 characters).
   This is a curated summary for a music player UI, not a full biography — be concise and
   prioritize the most notable facts (origin, breakout moment, genre/style, major
   accolades/impact).
5. **Cite sources at the end, in Markdown — as a distinct trailing section, not an inline
   citation.** After the bio prose, add a blank line, then a `Sources:` line, then one Markdown
   link per source on its own line:

   ```
   <bio prose ends here.>

   Sources:
   - [Wikipedia](https://en.wikipedia.org/wiki/...)
   - [AllMusic](https://www.allmusic.com/...)
   ```

   Do **not** drop a single `[Source](url)` link mid-sentence or at the tail of the last
   sentence — every source used must be listed in the `Sources:` section, even if there's
   only one. This is separate from the "official links" in rule 3 — a source citation (e.g.
   Wikipedia, AllMusic, a reputable interview) does not need to be an official
   artist-controlled link, but it must be a real, checkable reference for the facts stated
   above it.

## Workflow

1. **Check for an existing profile.** Call `get_artist_profile` with the artist name (or
   `artist_id` if known) to see what's already curated, and whether a MusicBrainz ID is on
   file. If the request is to "update" rather than write from scratch, preserve any existing
   accurate content and only revise what's needed.
2. **Ground the artist.** If there's no MBID yet, use `lookup_musicbrainz` (or
   `get_artist_summary` for what's already in the local library — genres, collaborators, era)
   to disambiguate the artist and pull structured facts before writing prose.
3. **Research.** Use web search/fetch for biographical facts and for locating the artist's
   official website and official social profiles. Prefer a small number of solid sources
   (official site, Wikipedia, a reputable music encyclopedia/press feature) over many weak
   ones. Do not copy long verbatim passages — write an original summary and cite sources per
   rule 5.
4. **Draft the bio** following all five content rules above.
5. **Save it** with `update_artist_profile`:
   - `artist`: the artist name (match the existing library entry's spelling/casing)
   - `bio`: the drafted biography, ending with the `Sources:` Markdown links section
   - `website`: the official site URL, if found
   - `links` (or `social_links`): official-only links (rule 3), each as
     `{ platform, handle_or_url }` or a plain URL string — no Twitter/X, no fan sites
   - `tags`: optional curated artist-attribute tags only — nationality (e.g. "Canadian") and
     notable awards/honors (e.g. "Grammy Award", "Brit Award"). Never genre or style tags
     (tracked elsewhere in the library) and never decade/era-active tags such as "80s",
     "1980s", or "eighties" (derivable from the library's own data, not curated). If you
     aren't certain a candidate tag is a nationality or a named award, leave it out.
6. **Confirm** by showing the user the saved bio (or calling `get_artist_profile` again) so
   they can review the result.
