import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { LuminousDatabase } from "../db/connection.ts";
import {
  auditMetadata,
  getArtistProfile,
  getGenreHierarchy,
  lookupMusicBrainz,
  updateArtistProfile,
  updateTrackMetadata,
  type AuditMetadataOptions,
  type LookupMusicBrainzParams,
  type MissingMetadataField,
  type MusicBrainzEntityType,
  type UpdateArtistProfileParams,
  type UpdateTrackMetadataParams,
} from "../db/curation.ts";
import { formatMcpResponse } from "../utils/response.ts";

/**
 * Registers metadata hygiene and curation assistant tools on the MCP server instance.
 */
export function registerCurationTools(server: McpServer, db: LuminousDatabase): void {
  server.tool(
    "audit_metadata",
    "Audit the music library for missing metadata (artwork, lyrics, release year, genre, composer, loudness) with summary counts and paginated track samples.",
    {
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
    }
  );

  server.tool(
    "get_genre_hierarchy",
    "Get the user's curated genre hierarchy and tag taxonomy from Luminous (tag groups, assigned tags, and unassigned library tags).",
    {
      include_unassigned: z
        .boolean()
        .default(true)
        .optional()
        .describe(
          "Whether to include unassigned genres/tags found in the library that have no tag group assignment (default true)"
        ),
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
    }
  );

  server.tool(
    "update_track_metadata",
    "Update metadata fields (genre, release year, composer, title, artist, album, album artist, lyrics) for one or more tracks in the Luminous database.",
    {
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
    }
  );

  server.tool(
    "get_artist_profile",
    "Get an artist's curated profile (biography, official website, tags, social links, Wikipedia extract, and MusicBrainz ID).",
    {
      artist: z.string().optional().describe("Artist name to inspect"),
      artist_id: z.string().optional().describe("MusicBrainz artist UUID"),
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
          return {
            isError: true,
            content: [
              {
                type: "text" as const,
                text: `Artist profile not found for: "${params.artist ?? params.artist_id}".`,
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
              text: `Failed to retrieve artist profile: ${err.message ?? String(err)}`,
            },
          ],
        };
      }
    }
  );

  server.tool(
    "update_artist_profile",
    "Update or create an artist's curated profile (biography, official website URL, tags, social media links) in the Luminous database.",
    {
      artist: z.string().min(1).describe("Artist name whose profile is being updated"),
      bio: z.string().optional().describe("Biographical notes or summary for the artist"),
      website: z.string().optional().describe("Official website URL for the artist"),
      tags: z.array(z.string()).optional().describe("Curated tags or style labels for the artist"),
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
        .describe("Social media profile URLs or platform handles"),
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
        const handle = db.getHandle();
        const updateParams: UpdateArtistProfileParams = {
          artist: params.artist,
          bio: params.bio,
          website: params.website,
          tags: params.tags,
          social_links: params.social_links as any,
        };

        const result = updateArtistProfile(handle, updateParams);

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
    }
  );

  server.tool(
    "lookup_musicbrainz",
    "Look up rich metadata for a track, album, release group, or artist using MusicBrainz IDs (MBIDs), inspecting both local Luminous cache and live MusicBrainz Web API.",
    {
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
    }
  );
}
