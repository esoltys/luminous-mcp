import type { Database } from "bun:sqlite";
import { hasTable } from "./filters.ts";
import {
  classifyTag,
  getTagVocabulary,
  suggestTags,
  type TagStatus,
  type TagVocabulary,
} from "./tagVocabulary.ts";

/**
 * Tags from a stored JSON column. Anything that isn't a JSON array of strings
 * (NULL, corrupt JSON, other shapes) yields an empty or filtered list rather
 * than an error: tag columns are written by the desktop app too.
 */
export function parseTagList(json: string | null | undefined): string[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed.filter((t): t is string => typeof t === "string") : [];
  } catch {
    return [];
  }
}

export interface ArtistTagSpelling {
  spelling: string;
  artist_count: number;
}

export interface ArtistTagSummary {
  /** Most common spelling (ties: alphabetical). */
  tag: string;
  artist_count: number;
  status: TagStatus;
  /** Vocabulary category for allowed and denied tags. */
  category?: string;
  /** Every spelling in use; present only when there is more than one. */
  spellings?: ArtistTagSpelling[];
  /** Nearest allowed tags; present for tags that are not allowed. */
  suggestions?: string[];
}

export interface ListArtistTagsOptions {
  /** Case-insensitive substring filter on the tag. */
  query?: string;
  status?: TagStatus;
  /** Only tags written with more than one spelling. */
  variants_only?: boolean;
  limit?: number;
  offset?: number;
}

export interface ListArtistTagsResult {
  /** Totals over every tag in use, before query/status/variants_only filtering. */
  summary: {
    artists_with_tags: number;
    distinct_tags: number;
    denied_tags: number;
    unknown_tags: number;
    tags_with_spelling_variants: number;
  };
  tags: ArtistTagSummary[];
  pagination: { total_matching: number; offset: number; limit: number; has_more: boolean };
}

/**
 * Every tag in use on artist profiles, grouped case-insensitively, classified
 * against the vocabulary. Read-only: violations are reported, never rewritten.
 */
export function listArtistTags(
  db: Database,
  options: ListArtistTagsOptions = {},
  vocab: TagVocabulary = getTagVocabulary()
): ListArtistTagsResult {
  const limit = options.limit ?? 100;
  const offset = options.offset ?? 0;

  // group key -> spelling -> artists using it (a Set, so an artist listing a tag twice counts once)
  const groups = new Map<string, Map<string, Set<string>>>();
  const artistsWithTags = new Set<string>();
  if (hasTable(db, "artist_profiles")) {
    const rows = db
      .query<{ artist_key: string; tags: string }, []>("SELECT artist_key, tags FROM artist_profiles")
      .all();
    for (const row of rows) {
      for (const raw of parseTagList(row.tags)) {
        const spelling = raw.trim();
        if (!spelling) continue;
        artistsWithTags.add(row.artist_key.toLowerCase());
        const key = spelling.toLowerCase();
        const bySpelling = groups.get(key) ?? new Map<string, Set<string>>();
        const artists = bySpelling.get(spelling) ?? new Set<string>();
        artists.add(row.artist_key.toLowerCase());
        bySpelling.set(spelling, artists);
        groups.set(key, bySpelling);
      }
    }
  }

  const all: ArtistTagSummary[] = [];
  for (const bySpelling of groups.values()) {
    const spellings = [...bySpelling].map(([spelling, artists]) => ({
      spelling,
      artist_count: artists.size,
    }));
    spellings.sort((a, b) => b.artist_count - a.artist_count || a.spelling.localeCompare(b.spelling));
    const artistCount = new Set([...bySpelling.values()].flatMap((s) => [...s])).size;
    const { status, category } = classifyTag(vocab, spellings[0].spelling);
    const entry: ArtistTagSummary = { tag: spellings[0].spelling, artist_count: artistCount, status };
    if (category) entry.category = category;
    if (spellings.length > 1) entry.spellings = spellings;
    if (status !== "allowed") {
      const suggestions = suggestTags(vocab, entry.tag);
      if (suggestions.length > 0) entry.suggestions = suggestions;
    }
    all.push(entry);
  }
  all.sort((a, b) => b.artist_count - a.artist_count || a.tag.localeCompare(b.tag));

  const query = options.query?.trim().toLowerCase();
  const filtered = all.filter(
    (t) =>
      (!query || t.tag.toLowerCase().includes(query)) &&
      (!options.status || t.status === options.status) &&
      (!options.variants_only || t.spellings !== undefined)
  );
  const page = filtered.slice(offset, offset + limit);

  return {
    summary: {
      artists_with_tags: artistsWithTags.size,
      distinct_tags: all.length,
      denied_tags: all.filter((t) => t.status === "denied").length,
      unknown_tags: all.filter((t) => t.status === "unknown").length,
      tags_with_spelling_variants: all.filter((t) => t.spellings !== undefined).length,
    },
    tags: page,
    pagination: {
      total_matching: filtered.length,
      offset,
      limit,
      has_more: offset + page.length < filtered.length,
    },
  };
}
