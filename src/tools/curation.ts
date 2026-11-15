import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { LuminousBridgeClient } from "../bridge/client.ts";
import type { LuminousDatabase } from "../db/connection.ts";
import {
  PROFILE_STATUS_DESCRIPTIONS,
  type ProfileStatus,
  auditMetadata,
  findArtistsByTag,
  getAlbumProfile,
  getArtistEvents,
  getArtistProfile,
  getGenreHierarchy,
  lookupMusicBrainz,
  updateAlbumProfile,
  updateArtistProfile,
  updateArtistProfiles,
  updateTrackMetadata,
  type AuditMetadataOptions,
  type FindArtistsByTagOptions,
  type LookupMusicBrainzParams,
  type MissingMetadataField,
  type MusicBrainzEntityType,
  type UpdateAlbumProfileParams,
  type UpdateArtistProfileParams,
  type UpdateTrackMetadataParams,
} from "../db/curation.ts";
import { listArtistTags } from "../db/artistTags.ts";
import { describeTagPolicy, getTagVocabulary } from "../db/tagVocabulary.ts";
import { formatMcpResponse } from "../utils/response.ts";
import { withDb } from "./withDb.ts";
import { READ_ONLY_EXTERNAL, READ_ONLY_LOCAL, WRITE_IDEMPOTENT } from "./annotations.ts";

/** Max entries per update_artist_profiles call (bounds write-lock time and response size). */
const MAX_ARTIST_PROFILE_BATCH = 500;

const PROFILE_STATUS_ENTRIES = Object.entries(PROFILE_STATUS_DESCRIPTIONS);

/**
 * Registers metadata hygiene and curation assistant tools on the MCP server instance.
 */
export function registerCurationTools(
  server: McpServer,
  db: LuminousDatabase,
  bridgeClient?: LuminousBridgeClient
): void {
  server.registerTool(
    "audit_metadata",
    {
      title: "Audit Metadata",
      description:
        "Audit the music library for missing metadata (artwork, lyrics, release year, genre, composer, loudness) with summary counts and paginated track samples.",
      inputSchema: {
      missing_fields: z
        .array(z.enum(["year", "genre", "composer", "lyrics", "art", "loudness"]))
        .optional()
        .describe(
          "Specific missing fields to filter on (e.g. ['year', 'art']). If omitted, samples tracks missing any audited field."
        ),
      operator: z
        .enum(["any", "all"])
        .default("any")
        .optional()
        .describe(
          "Whether sample tracks must match 'any' (default) or 'all' of the specified missing_fields."
        ),
      artist: z.string().optional().describe("Optional filter by artist or album artist name"),
      album: z.string().optional().describe("Optional filter by album name"),
      genre: z.string().optional().describe("Optional filter by genre name"),
      limit: z
        .number()
        .int()
        .min(1)
        .max(200)
        .default(50)
        .optional()
        .describe("Maximum sample tracks to return (default 50, max 200)"),
      offset: z
        .number()
        .int()
        .min(0)
        .default(0)
        .optional()
        .describe("Pagination offset (default 0)"),
      },
      annotations: READ_ONLY_LOCAL,
    },
    withDb(db, async (params) => {
      try {
        const handle = db.getHandle();
        const options: AuditMetadataOptions = {
          missing_fields: params.missing_fields as MissingMetadataField[] | undefined,
          operator: params.operator,
          artist: params.artist,
          album: params.album,
          genre: params.genre,
          limit: params.limit,
          offset: params.offset,
        };

        const results = auditMetadata(handle, options);

        return formatMcpResponse(results);
      } catch (err: any) {
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: `Failed to audit metadata: ${err.message ?? String(err)}`,
            },
          ],
        };
      }
    })
  );

  server.registerTool(
    "get_genre_hierarchy",
    {
      title: "Get Genre Hierarchy",
      description:
        "Get the user's curated genre hierarchy and tag taxonomy from Luminous (tag groups, assigned tags, and unassigned library tags).",
      inputSchema: {
        include_unassigned: z
          .boolean()
          .default(true)
          .optional()
          .describe(
            "Whether to include unassigned genres/tags found in the library that have no tag group assignment (default true)"
          ),
      },
      annotations: READ_ONLY_LOCAL,
    },
    withDb(db, async (params) => {
      try {
        const handle = db.getHandle();
        const results = getGenreHierarchy(handle, {
          include_unassigned: params.include_unassigned,
        });

        return formatMcpResponse(results);
      } catch (err: any) {
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: `Failed to retrieve genre hierarchy: ${err.message ?? String(err)}`,
            },
          ],
        };
      }
    })
  );

  server.registerTool(
    "update_track_metadata",
    {
      title: "Update Track Metadata",
      description:
        "Update metadata fields (genre, release year, composer, title, artist, album, album artist, lyrics) for one or more tracks in the Luminous database.",
      inputSchema: {
      track_id: z
        .number()
        .int()
        .optional()
        .describe("Single numeric track ID to update"),
      track_ids: z
        .array(z.number().int())
        .optional()
        .describe("Array of track IDs for batch metadata update"),
      genre: z.string().optional().describe("New genre value for the track(s)"),
      year: z.number().int().optional().describe("New release year for the track(s)"),
      composer: z.string().optional().describe("New composer for the track(s)"),
      title: z.string().optional().describe("New title for the track(s)"),
      artist: z.string().optional().describe("New artist for the track(s)"),
      album: z.string().optional().describe("New album for the track(s)"),
      album_artist: z.string().optional().describe("New album artist for the track(s)"),
      lyrics: z.string().optional().describe("New lyrics text for the track(s)"),
      },
      annotations: WRITE_IDEMPOTENT,
    },
    withDb(db, async (params) => {
      if (params.track_id === undefined && (!params.track_ids || params.track_ids.length === 0)) {
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: "Either track_id or track_ids must be provided.",
            },
          ],
        };
      }

      try {
        const handle = db.getHandle();
        const updateParams: UpdateTrackMetadataParams = {
          track_id: params.track_id,
          track_ids: params.track_ids,
          genre: params.genre,
          year: params.year,
          composer: params.composer,
          title: params.title,
          artist: params.artist,
          album: params.album,
          album_artist: params.album_artist,
          lyrics: params.lyrics,
        };

        const results = updateTrackMetadata(handle, updateParams);

        // Emit real-time notification to running desktop player (non-blocking)
        if (bridgeClient && results.updated_count > 0) {
          await bridgeClient.notifyEvent("library-changed", {
            entity: "track",
            track_ids: results.updated_track_ids,
          });
        }

        return formatMcpResponse(results);
      } catch (err: any) {
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: `Failed to update track metadata: ${err.message ?? String(err)}`,
            },
          ],
        };
      }
    })
  );

  server.registerTool(
    "get_artist_profile",
    {
      title: "Get Artist Profile",
      description:
        "Get an artist's curated profile (biography with cited sources, official website, tags, social links, Wikipedia extract, and MusicBrainz ID). Always check `status`: " +
        PROFILE_STATUS_ENTRIES.map(([status, meaning]) => `'${status}' (${meaning})`).join(", ") +
        ". Unlike most lookups, an unknown artist is a normal result with status 'not_found', not an error.",
      inputSchema: {
        artist: z.string().optional().describe("Artist name to inspect"),
        artist_id: z.string().optional().describe("MusicBrainz artist UUID"),
      },
      annotations: READ_ONLY_LOCAL,
    },
    withDb(db, async (params) => {
      if (!params.artist && !params.artist_id) {
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: "Either artist or artist_id must be provided.",
            },
          ],
        };
      }

      try {
        const handle = db.getHandle();
        const profile = getArtistProfile(handle, {
          artist: params.artist,
          artist_id: params.artist_id,
        });

        if (!profile) {
          // A normal result (not an error): "unknown artist" is a valid answer
          // distinct from "known artist, no profile yet" (status no_profile).
          const notFound: { artist?: string; status: ProfileStatus } = {
            artist: params.artist ?? params.artist_id,
            status: "not_found",
          };
          return formatMcpResponse(notFound);
        }

        return formatMcpResponse(profile);
      } catch (err: any) {
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: `Failed to retrieve artist profile: ${err.message ?? String(err)}`,
            },
          ],
        };
      }
    })
  );

  server.registerTool(
    "get_artist_events",
    {
      title: "Get Artist Events",
      description:
        "List an artist's upcoming concerts, tour dates and festival appearances from the cache Luminous keeps (MusicBrainz data; read-only, no network). Returns nothing until the artist has been opened in Luminous with Online mode on.",
      inputSchema: {
        artist: z.string().optional().describe("Artist name"),
        artist_id: z.string().optional().describe("MusicBrainz artist UUID"),
        include_past: z
          .boolean()
          .optional()
          .describe("Also include events that already happened (default false)"),
      },
      annotations: READ_ONLY_LOCAL,
    },
    withDb(db, async (params) => {
      if (!params.artist && !params.artist_id) {
        return {
          isError: true,
          content: [{ type: "text" as const, text: "Either artist or artist_id must be provided." }],
        };
      }
      try {
        return formatMcpResponse(getArtistEvents(db.getHandle(), params));
      } catch (err: any) {
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: `Failed to retrieve artist events: ${err.message ?? String(err)}`,
            },
          ],
        };
      }
    })
  );

  // Generated from the vocabulary in force, so the prose matches what is enforced.
  const tagPolicy = describeTagPolicy(getTagVocabulary());

  // Shared by update_artist_profile and each item of update_artist_profiles.
  const artistProfileFields = {
    artist: z.string().min(1).describe("Artist name whose profile is being updated"),
    bio: z
      .string()
      .optional()
      .describe(
        "Biographical summary (~150-300 words). No track lists or discography enumeration. No Twitter/X links. " +
          "Must end with a trailing 'Sources:' section listing every source used as a Markdown link on its own line, e.g.:\n\nSources:\n- [Wikipedia](https://...)\n- [AllMusic](https://...)"
      ),
    website: z.string().optional().describe("Official website URL for the artist"),
    country: z
      .string()
      .nullable()
      .optional()
      .describe(
        "Artist's country as an ISO 3166-1 alpha-2 code, e.g. 'CA' (case-insensitive, stored uppercase). Names, cities and three-letter codes are rejected. null clears it. " +
          "Luminous also fills a blank one from MusicBrainz and never overwrites a value set here; read it back from get_artist_profile."
      ),
    tags: z
      .array(z.string())
      .optional()
      .describe(
        `REPLACES the artist's whole tag list. ${tagPolicy} ` +
          "To change a few tags without reading the profile first, use add_tags/remove_tags instead (cannot be combined with tags)."
      ),
    add_tags: z
      .array(z.string())
      .optional()
      .describe(
        "Tags to add to the existing list (case-insensitive, duplicates skipped, existing tags and order kept). Same vocabulary rules as tags. Cannot be combined with tags."
      ),
    remove_tags: z
      .array(z.string())
      .optional()
      .describe(
        "Tags to remove from the existing list (case-insensitive; tags not present are ignored). Applied before add_tags. Cannot be combined with tags."
      ),
    social_links: z
      .array(
        z.union([
          z.object({
            platform: z.string().optional(),
            handle_or_url: z.string().optional(),
          }),
          z.string(),
        ])
      )
      .optional()
      .describe(
        "Official social media profile URLs or handles only (artist/label-controlled). No Twitter/X. No fan sites, unofficial wikis, or forums."
      ),
    links: z
      .array(
        z.union([
          z.object({
            platform: z.string().optional(),
            handle_or_url: z.string().optional(),
          }),
          z.string(),
        ])
      )
      .optional()
      .describe(
        "External links (alias for social_links) - official artist/label-controlled links only. No Twitter/X, fan sites, unofficial wikis, or forums."
      ),
    allow_unknown_artist: z
      .boolean()
      .optional()
      .describe(
        "Create a profile even if the name matches no library artist (default false). Unknown names are otherwise rejected with nearest-match suggestions; existing profiles are always editable."
      ),
  };

  server.registerTool(
    "update_artist_profile",
    {
      title: "Update Artist Profile",
      description:
        "Update or create an artist's curated profile (biography, official website URL, country code, tags, social media / external source links) in the Luminous database. " +
        "Biography rules: no track lists (describe the artist, don't enumerate songs/albums); no Twitter/X links anywhere; keep it to roughly 150-300 words; " +
        "end with a distinct trailing 'Sources:' section listing every source as one Markdown link per line (e.g. '- [Wikipedia](https://...)'), never a single inline citation. " +
        "tags/links rules below. Use add_tags/remove_tags to edit a few tags without replacing the list (use update_artist_profiles for many artists at once). Names matching no library artist (and with no existing profile) are rejected with nearest-match suggestions unless allow_unknown_artist is true; the result's `created` says whether a new profile was made.",
      inputSchema: artistProfileFields,
      annotations: WRITE_IDEMPOTENT,
    },
    withDb(db, async (params) => {
      try {
        const handle = db.getHandle();
        const updateParams: UpdateArtistProfileParams = {
          artist: params.artist,
          bio: params.bio,
          website: params.website,
          country: params.country,
          tags: params.tags,
          add_tags: params.add_tags,
          remove_tags: params.remove_tags,
          social_links: params.social_links as any,
          links: params.links as any,
          allow_unknown_artist: params.allow_unknown_artist,
        };

        const result = updateArtistProfile(handle, updateParams);

        // Emit real-time notification to running desktop player (non-blocking)
        if (bridgeClient && result.success) {
          await bridgeClient.notifyEvent("library-changed", {
            entity: "artist",
            artist: result.artist,
          });
        }

        return formatMcpResponse(result);
      } catch (err: any) {
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: `Failed to update artist profile: ${err.message ?? String(err)}`,
            },
          ],
        };
      }
    })
  );

  server.registerTool(
    "update_artist_profiles",
    {
      title: "Update Artist Profiles (Batch)",
      description:
        `Apply profile updates to many artists in one call (max ${MAX_ARTIST_PROFILE_BATCH} per call; split larger jobs into chunks). ` +
        "Each entry takes the same fields and rules as update_artist_profile (e.g. {artist, add_tags: ['Canadian']}). " +
        "All entries are applied in one transaction, but a failing entry (unknown artist, invalid tag...) does not affect the others: " +
        "the result lists, per artist, status 'created' | 'updated' | 'unchanged' | 'error' with the resulting tags or the error message. " +
        "The Luminous UI is refreshed once for the whole batch.",
      inputSchema: {
        updates: z
          .array(z.object(artistProfileFields))
          .min(1)
          .max(MAX_ARTIST_PROFILE_BATCH)
          .describe(`Artist updates to apply (1-${MAX_ARTIST_PROFILE_BATCH} entries).`),
        allow_unknown_artist: z
          .boolean()
          .optional()
          .describe(
            "Default for entries that don't set allow_unknown_artist themselves: create profiles for names matching no library artist (default false)."
          ),
      },
      annotations: WRITE_IDEMPOTENT,
    },
    withDb(db, async (params) => {
      try {
        const result = updateArtistProfiles(db.getHandle(), params.updates as UpdateArtistProfileParams[], {
          allow_unknown_artist: params.allow_unknown_artist,
        });

        // One notification for the whole batch, only if something actually changed.
        const changedArtists = result.results
          .filter((r) => r.status === "created" || r.status === "updated")
          .map((r) => r.artist);
        if (bridgeClient && changedArtists.length > 0) {
          await bridgeClient.notifyEvent("library-changed", {
            entity: "artist",
            artists: changedArtists,
          });
        }

        return formatMcpResponse(result);
      } catch (err: any) {
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: `Failed to update artist profiles: ${err.message ?? String(err)}`,
            },
          ],
        };
      }
    })
  );

  server.registerTool(
    "find_artists_by_tag",
    {
      title: "Find Artists by Tag",
      description:
        "Find all artists in the curated library whose artist profile has a given tag (e.g. nationality like 'Canadian' or an award like 'Grammy Award'). Case-insensitive exact match against tags set via update_artist_profile.",
      inputSchema: {
        tag: z.string().min(1).describe("Tag to search for, e.g. 'Canadian' or 'Grammy Award'"),
        limit: z
          .number()
          .int()
          .min(1)
          .max(500)
          .default(100)
          .optional()
          .describe("Maximum matching artists to return (default 100, max 500)"),
        offset: z
          .number()
          .int()
          .min(0)
          .default(0)
          .optional()
          .describe("Pagination offset (default 0)"),
      },
      annotations: READ_ONLY_LOCAL,
    },
    withDb(db, async (params) => {
      try {
        const handle = db.getHandle();
        const options: FindArtistsByTagOptions = {
          tag: params.tag,
          limit: params.limit,
          offset: params.offset,
        };

        const results = findArtistsByTag(handle, options);

        return formatMcpResponse(results);
      } catch (err: any) {
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: `Failed to find artists by tag: ${err.message ?? String(err)}`,
            },
          ],
        };
      }
    })
  );

  server.registerTool(
    "list_artist_tags",
    {
      title: "List Artist Tags",
      description:
        "List every tag in use on artist profiles with artist counts, grouped case-insensitively (spelling variants such as 'Award-Winning' vs 'Award Winning' are shown under `spellings`). " +
        "Each tag is classified against the tag vocabulary: status 'allowed' | 'unknown' | 'denied' plus its category, with nearest allowed suggestions for the rest. " +
        "Read-only: existing tags that break the vocabulary are reported here, never rewritten. The summary counts all tags before filtering. See get_tag_policy for the rules.",
      inputSchema: {
        query: z.string().optional().describe("Only tags containing this text (case-insensitive)"),
        status: z
          .enum(["allowed", "unknown", "denied"])
          .optional()
          .describe("Only tags with this vocabulary status"),
        variants_only: z
          .boolean()
          .optional()
          .describe("Only tags written with more than one spelling (default false)"),
        limit: z.number().int().min(1).max(500).default(100).optional().describe("Maximum tags to return (default 100, max 500)"),
        offset: z.number().int().min(0).default(0).optional().describe("Pagination offset (default 0)"),
      },
      annotations: READ_ONLY_LOCAL,
    },
    async (params) => {
      if (!db.exists()) {
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: `Luminous database file not found at: "${db.dbPath}". Ensure Luminous Music Player is installed and has run at least once.`,
            },
          ],
        };
      }
      try {
        return formatMcpResponse(listArtistTags(db.getHandle(), params));
      } catch (err: any) {
        return {
          isError: true,
          content: [
            { type: "text" as const, text: `Failed to list artist tags: ${err.message ?? String(err)}` },
          ],
        };
      }
    }
  );

  server.registerTool(
    "get_tag_policy",
    {
      title: "Get Tag Policy",
      description:
        "Get the artist tag vocabulary this server enforces on update_artist_profile / update_artist_profiles: allowed and denied categories with their values, patterns and examples, how unknown tags are handled, and where the vocabulary was loaded from. Read it before writing tags.",
      inputSchema: {},
      annotations: READ_ONLY_LOCAL,
    },
    async () => {
      const vocab = getTagVocabulary();
      return formatMcpResponse({
        source: vocab.source,
        unknown_tags: vocab.unknown_tags,
        summary: describeTagPolicy(vocab),
        categories: vocab.categories,
      });
    }
  );

  server.registerTool(
    "get_album_profile",
    {
      title: "Get Album Profile",
      description:
        "Get an album's curated profile (description/liner notes with cited sources, official website, tags, external source/review links, and MusicBrainz release-group context enrichment).",
      inputSchema: {
        album: z.string().optional().describe("Album title to inspect"),
        artist: z
          .string()
          .optional()
          .describe("Optional artist name to disambiguate albums sharing the same title"),
        release_group_id: z.string().optional().describe("MusicBrainz release group UUID"),
      },
      annotations: READ_ONLY_LOCAL,
    },
    withDb(db, async (params) => {
      if (!params.album && !params.release_group_id) {
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: "Either album or release_group_id must be provided.",
            },
          ],
        };
      }

      try {
        const handle = db.getHandle();
        const profile = getAlbumProfile(handle, {
          album: params.album,
          artist: params.artist,
          release_group_id: params.release_group_id,
        });

        if (!profile) {
          return {
            isError: true,
            content: [
              {
                type: "text" as const,
                text: `Album profile not found for: "${params.album ?? params.release_group_id}".`,
              },
            ],
          };
        }

        return formatMcpResponse(profile);
      } catch (err: any) {
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: `Failed to retrieve album profile: ${err.message ?? String(err)}`,
            },
          ],
        };
      }
    })
  );

  server.registerTool(
    "update_album_profile",
    {
      title: "Update Album Profile",
      description:
        "Update or create an album's curated profile (description, artist association, official website URL, tags, external source/review/storefront links) in the Luminous database. " +
        "Put every citation, review, and storefront/streaming link in the structured `links` array (not inline markdown) - the app renders `links` as its own UI section, and any link only written into `description` as prose is invisible there.",
      inputSchema: {
      album: z.string().min(1).describe("Album title whose profile is being updated"),
      artist: z.string().optional().describe("Associated album artist or primary artist name"),
      description: z
        .string()
        .optional()
        .describe(
          "Curated album description, liner notes, or critical summary - prose only. Do not append a 'Sources:' list or inline markdown links here; " +
            "put every citation/review/store link in the `links` array instead, so it renders in the app's UI."
        ),
      website: z.string().optional().describe("Official album landing page, Bandcamp URL, or release website"),
      tags: z.array(z.string()).optional().describe("REPLACES the album's whole tag list. Curated tags or style descriptors for the album. To change a few tags, use add_tags/remove_tags (cannot be combined with tags)."),
      add_tags: z.array(z.string()).optional().describe("Tags to add to the existing list (case-insensitive, duplicates skipped). Cannot be combined with tags."),
      remove_tags: z.array(z.string()).optional().describe("Tags to remove from the existing list (case-insensitive; absent tags ignored). Applied before add_tags. Cannot be combined with tags."),
      links: z
        .array(
          z.union([
            z.object({
              platform: z.string().optional().describe("Platform name (e.g. 'bandcamp', 'discogs', 'pitchfork', 'wikipedia')"),
              title: z.string().optional().describe("Display title (e.g. 'Pitchfork Review', 'Bandcamp Store')"),
              url: z.string().describe("Target URL"),
              category: z.string().optional().describe("Link category (e.g. 'review', 'store', 'source', 'official')"),
            }),
            z.string(),
          ])
        )
        .optional()
        .describe(
          "External links, reviews, storefronts, or reference sources - the canonical, app-rendered home for every URL cited for this album. " +
            "Include every source used to write the description here (category: 'source' or 'review'), plus any storefront/streaming links (category: 'store')."
        ),
      },
      annotations: WRITE_IDEMPOTENT,
    },
    withDb(db, async (params) => {
      try {
        const handle = db.getHandle();
        const updateParams: UpdateAlbumProfileParams = {
          album: params.album,
          artist: params.artist,
          description: params.description,
          website: params.website,
          tags: params.tags,
          add_tags: params.add_tags,
          remove_tags: params.remove_tags,
          links: params.links as any,
        };

        const result = updateAlbumProfile(handle, updateParams);

        // Emit real-time notification to running desktop player (non-blocking)
        if (bridgeClient && result.success) {
          await bridgeClient.notifyEvent("library-changed", {
            entity: "album",
            album: result.album,
          });
        }

        return formatMcpResponse(result);
      } catch (err: any) {
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: `Failed to update album profile: ${err.message ?? String(err)}`,
            },
          ],
        };
      }
    })
  );

  server.registerTool(
    "lookup_musicbrainz",
    {
      title: "Look Up MusicBrainz",
      description:
        "Look up rich metadata for a track, album, release group, or artist using MusicBrainz IDs (MBIDs), inspecting both local Luminous cache and live MusicBrainz Web API.",
      inputSchema: {
      track_id: z
        .number()
        .int()
        .optional()
        .describe("Track ID from library to automatically inspect its stored MBIDs"),
      mbid: z
        .string()
        .optional()
        .describe("MusicBrainz UUID (recording, release, release-group, or artist MBID)"),
      entity_type: z
        .enum(["recording", "release", "release-group", "artist", "work"])
        .optional()
        .describe(
          "MusicBrainz entity type ('recording', 'release', 'release-group', 'artist', 'work'). Defaults to 'recording' or auto-detected."
        ),
      fetch_live: z
        .boolean()
        .default(true)
        .optional()
        .describe("Whether to fetch live metadata from MusicBrainz API if not in local cache (default true)"),
      },
      annotations: READ_ONLY_EXTERNAL,
    },
    withDb(db, async (params) => {
      if (params.track_id === undefined && !params.mbid) {
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: "Either track_id or mbid must be provided.",
            },
          ],
        };
      }

      try {
        const handle = db.getHandle();
        const lookupParams: LookupMusicBrainzParams = {
          track_id: params.track_id,
          mbid: params.mbid,
          entity_type: params.entity_type as MusicBrainzEntityType | undefined,
          fetch_live: params.fetch_live,
        };

        const result = await lookupMusicBrainz(handle, lookupParams);

        return formatMcpResponse(result);
      } catch (err: any) {
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: `Failed to look up MusicBrainz metadata: ${err.message ?? String(err)}`,
            },
          ],
        };
      }
    })
  );
}
