import type { Database } from "bun:sqlite";

export type MissingMetadataField =
  | "year"
  | "genre"
  | "composer"
  | "lyrics"
  | "art"
  | "loudness";

export interface AuditMetadataOptions {
  missing_fields?: MissingMetadataField[];
  operator?: "any" | "all";
  artist?: string;
  album?: string;
  genre?: string;
  limit?: number;
  offset?: number;
}

export interface MetadataHygieneSummary {
  total_tracks: number;
  clean_tracks_count: number;
  missing_year_count: number;
  missing_genre_count: number;
  missing_composer_count: number;
  missing_lyrics_count: number;
  missing_art_count: number;
  missing_loudness_count: number;
}

export interface AuditedTrackItem {
  id: number;
  title: string | null;
  artist: string | null;
  album: string | null;
  album_artist: string | null;
  year: number | null;
  genre: string | null;
  composer: string | null;
  has_lyrics: boolean;
  has_art: boolean;
  loudness_lufs: number | null;
  missing_fields: MissingMetadataField[];
  path: string | null;
}

export interface AuditMetadataResult {
  summary: MetadataHygieneSummary;
  tracks: AuditedTrackItem[];
  pagination: {
    total_matching: number;
    offset: number;
    limit: number;
    has_more: boolean;
  };
}

export interface TagAssignmentItem {
  id: number;
  tag_name: string;
  sort_order: number;
}

export interface TagGroupItem {
  id: number;
  name: string;
  color_index: number;
  sort_order: number;
  tags: TagAssignmentItem[];
}

export interface GenreHierarchyResult {
  groups: TagGroupItem[];
  unassigned_tags: string[];
  total_groups: number;
  total_assigned_tags: number;
  total_unassigned_tags: number;
}

export interface UpdateTrackMetadataParams {
  track_id?: number;
  track_ids?: number[];
  genre?: string;
  year?: number;
  composer?: string;
  title?: string;
  artist?: string;
  album?: string;
  album_artist?: string;
  lyrics?: string;
}

export interface UpdatedTrackItem {
  id: number;
  title: string | null;
  artist: string | null;
  album: string | null;
  path: string | null;
}

export interface UpdateTrackMetadataResult {
  success: boolean;
  updated_count: number;
  updated_track_ids: number[];
  updated_fields: Record<string, unknown>;
  tracks: UpdatedTrackItem[];
}

export interface BioSourceLink {
  title: string;
  url: string;
}

export interface ArtistProfile {
  artist: string;
  bio: string | null;
  website: string | null;
  tags: string[];
  social_links: Array<{ platform?: string; handle_or_url?: string } | string>;
  sources?: BioSourceLink[];
  wikipedia: {
    extract: string | null;
    page_url: string | null;
    thumbnail_url: string | null;
    wikidata_id: string | null;
  } | null;
  musicbrainz_artist_id: string | null;
}

export interface UpdateArtistProfileParams {
  artist: string;
  bio?: string | null;
  website?: string | null;
  tags?: string[];
  social_links?: Array<{ platform?: string; handle_or_url?: string } | string>;
  links?: Array<{ platform?: string; handle_or_url?: string } | string>;
}

export interface UpdateArtistProfileResult {
  success: boolean;
  artist: string;
  updated_fields: Record<string, unknown>;
  profile: ArtistProfile;
}

export interface AlbumLinkItem {
  platform?: string;
  title?: string;
  url: string;
  category?: string;
}

export interface AlbumProfile {
  album: string;
  artist: string | null;
  description: string | null;
  website: string | null;
  tags: string[];
  links: Array<AlbumLinkItem | string>;
  sources?: BioSourceLink[];
  release_group_mbid?: string | null;
  context_enrichment?: {
    mb_rating: number | null;
    mb_rating_votes: number | null;
    mb_tags: string[];
    mb_release_country: string | null;
    critiquebrainz_rating: number | null;
    critiquebrainz_review_count: number | null;
    critiquebrainz_review_links: string[];
  } | null;
}

export interface UpdateAlbumProfileParams {
  album: string;
  artist?: string | null;
  description?: string | null;
  website?: string | null;
  tags?: string[];
  links?: Array<AlbumLinkItem | string>;
}

export interface UpdateAlbumProfileResult {
  success: boolean;
  album: string;
  updated_fields: Record<string, unknown>;
  profile: AlbumProfile;
}

export type MusicBrainzEntityType =
  | "recording"
  | "release"
  | "release-group"
  | "artist"
  | "work";

export interface LookupMusicBrainzParams {
  track_id?: number;
  mbid?: string;
  entity_type?: MusicBrainzEntityType;
  fetch_live?: boolean;
}

export interface LookupMusicBrainzResult {
  entity_type: MusicBrainzEntityType;
  mbid: string | null;
  track_id?: number;
  track?: {
    title: string | null;
    artist: string | null;
    album: string | null;
    year: number | null;
    musicbrainz_recording_id: string | null;
    musicbrainz_artist_id: string | null;
    musicbrainz_album_id: string | null;
    musicbrainz_release_group_id: string | null;
  };
  local_enrichment?: {
    artist_context?: {
      wikipedia_extract: string | null;
      wikipedia_page_url: string | null;
      wikipedia_thumbnail_url: string | null;
      wikidata_id: string | null;
    } | null;
    release_group_context?: {
      mb_rating: number | null;
      critiquebrainz_rating: number | null;
      mb_tags: string[];
      mb_release_country: string | null;
    } | null;
  };
  live_data?: Record<string, unknown>;
  source: "local_cache" | "live_api" | "both" | "none";
  status: "success" | "partial" | "not_found" | "api_unavailable";
  message?: string;
}

/**
 * Checks if a table or virtual table exists in the SQLite database.
 */
export function hasTable(db: Database, tableName: string): boolean {
  try {
    const row = db
      .query<{ count: number }, [string]>(
        "SELECT COUNT(*) as count FROM sqlite_master WHERE type IN ('table', 'virtual') AND name = ?"
      )
      .get(tableName);
    return (row?.count ?? 0) > 0;
  } catch {
    return false;
  }
}

/**
 * Checks if a column exists in a given table in the SQLite database.
 */
export function hasColumn(db: Database, tableName: string, columnName: string): boolean {
  try {
    const columns = db.query<{ name: string }, []>(`PRAGMA table_info(${tableName})`).all();
    return columns.some((col) => col.name.toLowerCase() === columnName.toLowerCase());
  } catch {
    return false;
  }
}

/**
 * Extracts structured citation links from biography or description text.
 * Parses both Markdown-style links [Title](https://...) and bare URLs (https://...).
 */
export function extractBioLinks(text: string | null | undefined): BioSourceLink[] {
  if (!text || typeof text !== "string") return [];

  const results: BioSourceLink[] = [];
  const seenUrls = new Set<string>();

  // 1. Match markdown links: [Title](https://...)
  // Support balanced/nested parentheses inside the target URL (e.g. Wikipedia disambiguation URLs)
  const mdRegex = /\[([^\]]+)\]\((https?:\/\/(?:[^\s()]|\((?:[^\s()]|\([^\s()]*\))*\))+)\)/g;
  let match: RegExpExecArray | null;

  while ((match = mdRegex.exec(text)) !== null) {
    const title = match[1].trim();
    const url = match[2].trim();
    if (url && !seenUrls.has(url)) {
      seenUrls.add(url);
      results.push({ title, url });
    }
  }

  // 2. Match bare URLs: https?://... (not already captured by markdown syntax)
  const textWithoutMd = text.replace(mdRegex, "");
  const urlRegex = /(https?:\/\/[^\s\],]+)/g;
  while ((match = urlRegex.exec(textWithoutMd)) !== null) {
    let url = match[1].trim();
    // Trim trailing punctuation, preserving balanced closing parentheses (e.g. Wikipedia URLs)
    while (url.length > 0) {
      const lastChar = url[url.length - 1];
      if (/[.,;:]/.test(lastChar)) {
        url = url.slice(0, -1);
      } else if (lastChar === ")") {
        const openCount = (url.match(/\(/g) || []).length;
        const closeCount = (url.match(/\)/g) || []).length;
        if (closeCount > openCount) {
          url = url.slice(0, -1);
        } else {
          break;
        }
      } else {
        break;
      }
    }

    if (url && !seenUrls.has(url)) {
      seenUrls.add(url);
      try {
        const parsedUrl = new URL(url);
        results.push({ title: parsedUrl.hostname.replace(/^www\./, ""), url });
      } catch {
        results.push({ title: url, url });
      }
    }
  }

  return results;
}

/**
 * SQL expressions defining missing status for each metadata field.
 */
const MISSING_EXPRESSIONS: Record<MissingMetadataField, string> = {
  year: "(year IS NULL OR year <= 0)",
  genre: "(genre IS NULL OR trim(genre) = '')",
  composer: "(composer IS NULL OR trim(composer) = '')",
  lyrics: "(lyrics IS NULL OR trim(lyrics) = '')",
  art: "(art_embedded = 0 AND (art_automatic IS NULL OR trim(art_automatic) = '') AND (art_manual IS NULL OR trim(art_manual) = ''))",
  loudness: "(ebur128_integrated_loudness_lufs IS NULL)",
};

/**
 * Audits the music library for missing metadata fields, returning overall counts
 * and paginated track samples matching the audit filter.
 */
export function auditMetadata(
  db: Database,
  options: AuditMetadataOptions = {}
): AuditMetadataResult {
  if (!hasTable(db, "songs")) {
    return {
      summary: {
        total_tracks: 0,
        clean_tracks_count: 0,
        missing_year_count: 0,
        missing_genre_count: 0,
        missing_composer_count: 0,
        missing_lyrics_count: 0,
        missing_art_count: 0,
        missing_loudness_count: 0,
      },
      tracks: [],
      pagination: {
        total_matching: 0,
        offset: 0,
        limit: options.limit ?? 50,
        has_more: false,
      },
    };
  }

  const limit = Math.max(1, Math.min(200, options.limit ?? 50));
  const offset = Math.max(0, options.offset ?? 0);

  // 1. Calculate overall summary statistics
  const summaryRow = db
    .query<
      {
        total_tracks: number;
        missing_year_count: number;
        missing_genre_count: number;
        missing_composer_count: number;
        missing_lyrics_count: number;
        missing_art_count: number;
        missing_loudness_count: number;
        clean_tracks_count: number;
      },
      []
    >(
      `SELECT
        COUNT(*) AS total_tracks,
        COALESCE(SUM(CASE WHEN ${MISSING_EXPRESSIONS.year} THEN 1 ELSE 0 END), 0) AS missing_year_count,
        COALESCE(SUM(CASE WHEN ${MISSING_EXPRESSIONS.genre} THEN 1 ELSE 0 END), 0) AS missing_genre_count,
        COALESCE(SUM(CASE WHEN ${MISSING_EXPRESSIONS.composer} THEN 1 ELSE 0 END), 0) AS missing_composer_count,
        COALESCE(SUM(CASE WHEN ${MISSING_EXPRESSIONS.lyrics} THEN 1 ELSE 0 END), 0) AS missing_lyrics_count,
        COALESCE(SUM(CASE WHEN ${MISSING_EXPRESSIONS.art} THEN 1 ELSE 0 END), 0) AS missing_art_count,
        COALESCE(SUM(CASE WHEN ${MISSING_EXPRESSIONS.loudness} THEN 1 ELSE 0 END), 0) AS missing_loudness_count,
        COALESCE(SUM(CASE WHEN (
          NOT ${MISSING_EXPRESSIONS.year} AND
          NOT ${MISSING_EXPRESSIONS.genre} AND
          NOT ${MISSING_EXPRESSIONS.composer} AND
          NOT ${MISSING_EXPRESSIONS.lyrics} AND
          NOT ${MISSING_EXPRESSIONS.art} AND
          NOT ${MISSING_EXPRESSIONS.loudness}
        ) THEN 1 ELSE 0 END), 0) AS clean_tracks_count
      FROM songs
      WHERE unavailable = 0`
    )
    .get();

  const summary: MetadataHygieneSummary = {
    total_tracks: summaryRow?.total_tracks ?? 0,
    clean_tracks_count: summaryRow?.clean_tracks_count ?? 0,
    missing_year_count: summaryRow?.missing_year_count ?? 0,
    missing_genre_count: summaryRow?.missing_genre_count ?? 0,
    missing_composer_count: summaryRow?.missing_composer_count ?? 0,
    missing_lyrics_count: summaryRow?.missing_lyrics_count ?? 0,
    missing_art_count: summaryRow?.missing_art_count ?? 0,
    missing_loudness_count: summaryRow?.missing_loudness_count ?? 0,
  };

  // 2. Build where clauses for paginated sample tracks
  const whereClauses: string[] = ["unavailable = 0"];
  const queryParams: Record<string, unknown> = {};

  if (options.artist && options.artist.trim() !== "") {
    queryParams.$artist = `%${options.artist.trim()}%`;
    whereClauses.push("(artist LIKE $artist OR album_artist LIKE $artist)");
  }

  if (options.album && options.album.trim() !== "") {
    queryParams.$album = `%${options.album.trim()}%`;
    whereClauses.push("album LIKE $album");
  }

  if (options.genre && options.genre.trim() !== "") {
    queryParams.$genre = `%${options.genre.trim()}%`;
    whereClauses.push("genre LIKE $genre");
  }

  // Filter by requested missing fields
  const missingFields = options.missing_fields && options.missing_fields.length > 0
    ? options.missing_fields
    : (["year", "genre", "composer", "lyrics", "art", "loudness"] as MissingMetadataField[]);

  const operator = options.operator === "all" ? " AND " : " OR ";
  const missingConditions = missingFields.map((field) => MISSING_EXPRESSIONS[field]);
  whereClauses.push(`(${missingConditions.join(operator)})`);

  const whereSql = whereClauses.join(" AND ");

  // 3. Count total matching rows
  const countRow = db
    .query<{ total: number }, any>(
      `SELECT COUNT(*) AS total FROM songs WHERE ${whereSql}`
    )
    .get(queryParams as any);

  const totalMatching = countRow?.total ?? 0;

  // 4. Retrieve paginated sample tracks
  queryParams.$limit = limit;
  queryParams.$offset = offset;

  interface RawSongRow {
    id: number;
    title: string | null;
    artist: string | null;
    album: string | null;
    album_artist: string | null;
    year: number | null;
    genre: string | null;
    composer: string | null;
    lyrics: string | null;
    art_embedded: number;
    art_automatic: string | null;
    art_manual: string | null;
    ebur128_integrated_loudness_lufs: number | null;
    path: string | null;
  }

  const rows = db
    .query<RawSongRow, any>(
      `SELECT
        id, title, artist, album, album_artist, year, genre, composer,
        lyrics, art_embedded, art_automatic, art_manual,
        ebur128_integrated_loudness_lufs, path
      FROM songs
      WHERE ${whereSql}
      ORDER BY artist ASC, album ASC, track ASC, id ASC
      LIMIT $limit OFFSET $offset`
    )
    .all(queryParams as any);

  const tracks: AuditedTrackItem[] = rows.map((r) => {
    const missingYear = r.year === null || r.year <= 0;
    const missingGenre = !r.genre || r.genre.trim() === "";
    const missingComposer = !r.composer || r.composer.trim() === "";
    const missingLyrics = !r.lyrics || r.lyrics.trim() === "";
    const hasArt = Boolean(
      r.art_embedded ||
      (r.art_automatic && r.art_automatic.trim() !== "") ||
      (r.art_manual && r.art_manual.trim() !== "")
    );
    const missingArt = !hasArt;
    const missingLoudness = r.ebur128_integrated_loudness_lufs === null;

    const detectedMissing: MissingMetadataField[] = [];
    if (missingYear) detectedMissing.push("year");
    if (missingGenre) detectedMissing.push("genre");
    if (missingComposer) detectedMissing.push("composer");
    if (missingLyrics) detectedMissing.push("lyrics");
    if (missingArt) detectedMissing.push("art");
    if (missingLoudness) detectedMissing.push("loudness");

    return {
      id: r.id,
      title: r.title,
      artist: r.artist,
      album: r.album,
      album_artist: r.album_artist,
      year: r.year,
      genre: r.genre,
      composer: r.composer,
      has_lyrics: !missingLyrics,
      has_art: hasArt,
      loudness_lufs: r.ebur128_integrated_loudness_lufs,
      missing_fields: detectedMissing,
      path: r.path,
    };
  });

  return {
    summary,
    tracks,
    pagination: {
      total_matching: totalMatching,
      offset,
      limit,
      has_more: offset + tracks.length < totalMatching,
    },
  };
}

/**
 * Retrieves the user's genre taxonomy and hierarchy from Luminous (tag_groups and tag_assignments),
 * along with any unassigned tags currently in the library.
 */
export function getGenreHierarchy(
  db: Database,
  options: { include_unassigned?: boolean } = {}
): GenreHierarchyResult {
  const includeUnassigned = options.include_unassigned ?? true;
  const groupsTableExists = hasTable(db, "tag_groups");
  const assignmentsTableExists = hasTable(db, "tag_assignments");

  const groups: TagGroupItem[] = [];
  const assignedTagNames = new Set<string>();

  if (groupsTableExists) {
    interface RawGroup {
      id: number;
      name: string;
      color_index: number;
      sort_order: number;
    }

    const groupRows = db
      .query<RawGroup, []>(
        "SELECT id, name, color_index, sort_order FROM tag_groups ORDER BY sort_order ASC, name ASC"
      )
      .all();

    interface RawAssignment {
      id: number;
      tag_name: string;
      group_id: number;
      sort_order: number;
    }

    const assignmentRows = assignmentsTableExists
      ? db
          .query<RawAssignment, []>(
            "SELECT id, tag_name, group_id, sort_order FROM tag_assignments ORDER BY sort_order ASC, tag_name ASC"
          )
          .all()
      : [];

    const assignmentsByGroup = new Map<number, TagAssignmentItem[]>();
    for (const assignment of assignmentRows) {
      assignedTagNames.add(assignment.tag_name.toLowerCase());
      const list = assignmentsByGroup.get(assignment.group_id) ?? [];
      list.push({
        id: assignment.id,
        tag_name: assignment.tag_name,
        sort_order: assignment.sort_order,
      });
      assignmentsByGroup.set(assignment.group_id, list);
    }

    for (const group of groupRows) {
      groups.push({
        id: group.id,
        name: group.name,
        color_index: group.color_index,
        sort_order: group.sort_order,
        tags: assignmentsByGroup.get(group.id) ?? [],
      });
    }
  }

  // Find unassigned tags if requested
  const unassignedSet = new Set<string>();

  if (includeUnassigned && hasTable(db, "songs")) {
    interface GenreRow {
      genre: string;
    }
    const genreRows = db
      .query<GenreRow, []>(
        "SELECT DISTINCT genre FROM songs WHERE unavailable = 0 AND genre IS NOT NULL AND trim(genre) != ''"
      )
      .all();

    for (const row of genreRows) {
      const parts = row.genre.split(/[;/]/).map((p) => p.trim());
      for (const part of parts) {
        if (part && !assignedTagNames.has(part.toLowerCase())) {
          unassignedSet.add(part);
        }
      }
    }

    if (hasTable(db, "tags")) {
      interface TagRow {
        name: string;
      }
      const tagRows = db.query<TagRow, []>("SELECT name FROM tags").all();
      for (const tag of tagRows) {
        const trimmed = tag.name.trim();
        if (trimmed && !assignedTagNames.has(trimmed.toLowerCase())) {
          unassignedSet.add(trimmed);
        }
      }
    }
  }

  const unassignedTags = Array.from(unassignedSet).sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: "base" })
  );

  const totalAssigned = groups.reduce((acc, g) => acc + g.tags.length, 0);

  return {
    groups,
    unassigned_tags: unassignedTags,
    total_groups: groups.length,
    total_assigned_tags: totalAssigned,
    total_unassigned_tags: unassignedTags.length,
  };
}

/**
 * Updates metadata fields (genre, year, composer, title, artist, album, album_artist, lyrics)
 * for one or more tracks in the Luminous database.
 */
export function updateTrackMetadata(
  db: Database,
  params: UpdateTrackMetadataParams
): UpdateTrackMetadataResult {
  if (!hasTable(db, "songs")) {
    throw new Error("Luminous 'songs' table not found in database.");
  }

  const ids: number[] = [];
  if (typeof params.track_id === "number") {
    ids.push(params.track_id);
  }
  if (Array.isArray(params.track_ids)) {
    for (const id of params.track_ids) {
      if (typeof id === "number" && !ids.includes(id)) {
        ids.push(id);
      }
    }
  }

  if (ids.length === 0) {
    throw new Error("Either track_id or track_ids must be provided.");
  }

  // Validate that at least one metadata field is specified
  const fieldsToUpdate: Record<string, unknown> = {};
  const setClauses: string[] = [];

  if (params.genre !== undefined) {
    fieldsToUpdate.genre = params.genre;
    setClauses.push("genre = $genre");
  }
  if (params.year !== undefined) {
    fieldsToUpdate.year = params.year;
    setClauses.push("year = $year");
  }
  if (params.composer !== undefined) {
    fieldsToUpdate.composer = params.composer;
    setClauses.push("composer = $composer");
  }
  if (params.title !== undefined) {
    fieldsToUpdate.title = params.title;
    setClauses.push("title = $title");
  }
  if (params.artist !== undefined) {
    fieldsToUpdate.artist = params.artist;
    setClauses.push("artist = $artist");
  }
  if (params.album !== undefined) {
    fieldsToUpdate.album = params.album;
    setClauses.push("album = $album");
  }
  if (params.album_artist !== undefined) {
    fieldsToUpdate.album_artist = params.album_artist;
    setClauses.push("album_artist = $album_artist");
  }
  if (params.lyrics !== undefined) {
    fieldsToUpdate.lyrics = params.lyrics;
    setClauses.push("lyrics = $lyrics");
  }

  if (setClauses.length === 0) {
    throw new Error(
      "At least one metadata field must be specified for update (e.g. genre, year, composer, lyrics)."
    );
  }

  // Verify all track IDs exist
  const placeholders = ids.map(() => "?").join(",");
  const existingRows = db
    .query<{ id: number; title: string | null; artist: string | null; album: string | null; path: string | null }, number[]>(
      `SELECT id, title, artist, album, path FROM songs WHERE id IN (${placeholders})`
    )
    .all(...ids);

  const existingIdSet = new Set(existingRows.map((r) => r.id));
  const missingIds = ids.filter((id) => !existingIdSet.has(id));

  if (missingIds.length > 0) {
    throw new Error(`Track ID(s) not found in library: ${missingIds.join(", ")}`);
  }

  // Execute update inside transaction
  const updateSql = `UPDATE songs SET ${setClauses.join(", ")} WHERE id = $id`;
  const updateStmt = db.prepare(updateSql);

  db.transaction(() => {
    for (const id of ids) {
      const bindParams: Record<string, unknown> = {
        $id: id,
      };
      if (params.genre !== undefined) bindParams.$genre = params.genre;
      if (params.year !== undefined) bindParams.$year = params.year;
      if (params.composer !== undefined) bindParams.$composer = params.composer;
      if (params.title !== undefined) bindParams.$title = params.title;
      if (params.artist !== undefined) bindParams.$artist = params.artist;
      if (params.album !== undefined) bindParams.$album = params.album;
      if (params.album_artist !== undefined) bindParams.$album_artist = params.album_artist;
      if (params.lyrics !== undefined) bindParams.$lyrics = params.lyrics;

      updateStmt.run(bindParams as any);
    }
  })();

  // Fetch updated track rows
  const updatedRows = db
    .query<{ id: number; title: string | null; artist: string | null; album: string | null; path: string | null }, number[]>(
      `SELECT id, title, artist, album, path FROM songs WHERE id IN (${placeholders})`
    )
    .all(...ids);

  const tracks: UpdatedTrackItem[] = updatedRows.map((r) => ({
    id: r.id,
    title: r.title,
    artist: r.artist,
    album: r.album,
    path: r.path,
  }));

  return {
    success: true,
    updated_count: ids.length,
    updated_track_ids: ids,
    updated_fields: fieldsToUpdate,
    tracks,
  };
}

/**
 * Retrieves an artist's curated profile (bio, website, tags, social links)
 * and Wikipedia context enrichment from the database.
 */
export function getArtistProfile(
  db: Database,
  options: { artist?: string; artist_id?: string }
): ArtistProfile | null {
  const artistName = options.artist?.trim();
  let mbid = options.artist_id?.trim() ?? null;

  if (!artistName && !mbid) {
    throw new Error("Either artist or artist_id must be provided.");
  }

  // Find musicbrainz_artist_id or artist name from songs table if needed
  let resolvedArtistName = artistName ?? "";
  let songArtistFound = false;
  if (hasTable(db, "songs")) {
    if (artistName && !mbid) {
      const songRow = db
        .query<{ musicbrainz_artist_id: string | null }, [string, string]>(
          "SELECT musicbrainz_artist_id FROM songs WHERE (artist = ?1 OR album_artist = ?2) LIMIT 1"
        )
        .get(artistName, artistName);
      if (songRow) {
        songArtistFound = true;
        if (songRow.musicbrainz_artist_id) {
          mbid = songRow.musicbrainz_artist_id;
        }
      }
    } else if (mbid && !artistName) {
      const songRow = db
        .query<{ artist: string | null; album_artist: string | null }, [string]>(
          "SELECT artist, album_artist FROM songs WHERE musicbrainz_artist_id = ?1 LIMIT 1"
        )
        .get(mbid);
      if (songRow) {
        songArtistFound = true;
        resolvedArtistName = songRow.artist ?? songRow.album_artist ?? "";
      }
    }
  }

  // Check artist_profiles table
  interface RawProfile {
    artist_key: string;
    website: string | null;
    tags: string;
    social_links: string;
    bio: string | null;
  }

  let rawProfile: RawProfile | null = null;
  if (hasTable(db, "artist_profiles")) {
    if (resolvedArtistName) {
      rawProfile = db
        .query<RawProfile, [string]>(
          "SELECT artist_key, website, tags, social_links, bio FROM artist_profiles WHERE artist_key = ?1 COLLATE NOCASE"
        )
        .get(resolvedArtistName);
    }
  }

  // Check artist_context_enrichment table
  interface RawContext {
    artist_id: string;
    wikidata_id: string | null;
    wikipedia_extract: string | null;
    wikipedia_page_url: string | null;
    wikipedia_thumbnail_url: string | null;
  }

  let rawContext: RawContext | null = null;
  if (mbid && hasTable(db, "artist_context_enrichment")) {
    rawContext = db
      .query<RawContext, [string]>(
        "SELECT artist_id, wikidata_id, wikipedia_extract, wikipedia_page_url, wikipedia_thumbnail_url FROM artist_context_enrichment WHERE artist_id = ?1"
      )
      .get(mbid);
  }

  if (!rawProfile && !rawContext && !songArtistFound) {
    return null;
  }

  let parsedTags: string[] = [];
  if (rawProfile?.tags) {
    try {
      parsedTags = JSON.parse(rawProfile.tags);
    } catch {
      parsedTags = [];
    }
  }

  let parsedSocial: Array<{ platform?: string; handle_or_url?: string } | string> = [];
  if (rawProfile?.social_links) {
    try {
      parsedSocial = JSON.parse(rawProfile.social_links);
    } catch {
      parsedSocial = [];
    }
  }

  const bioSources = extractBioLinks(rawProfile?.bio);

  return {
    artist: rawProfile?.artist_key ?? resolvedArtistName,
    bio: rawProfile?.bio ?? null,
    website: rawProfile?.website ?? null,
    tags: parsedTags,
    social_links: parsedSocial,
    sources: bioSources.length > 0 ? bioSources : undefined,
    wikipedia: rawContext
      ? {
          extract: rawContext.wikipedia_extract,
          page_url: rawContext.wikipedia_page_url,
          thumbnail_url: rawContext.wikipedia_thumbnail_url,
          wikidata_id: rawContext.wikidata_id,
        }
      : null,
    musicbrainz_artist_id: mbid,
  };
}

/**
 * Creates or updates an artist's profile (bio, website, tags, social links)
 * in the Luminous database.
 */
export function updateArtistProfile(
  db: Database,
  params: UpdateArtistProfileParams
): UpdateArtistProfileResult {
  const artistName = params.artist?.trim();
  if (!artistName) {
    throw new Error("Artist name must not be empty.");
  }

  const effectiveSocial = params.social_links !== undefined ? params.social_links : params.links;

  if (
    params.bio === undefined &&
    params.website === undefined &&
    params.tags === undefined &&
    effectiveSocial === undefined
  ) {
    throw new Error(
      "At least one profile field (bio, website, tags, social_links) must be provided."
    );
  }

  // Ensure table exists
  db.run(`
    CREATE TABLE IF NOT EXISTS artist_profiles (
      artist_key TEXT PRIMARY KEY,
      website TEXT,
      tags TEXT NOT NULL DEFAULT '[]',
      social_links TEXT NOT NULL DEFAULT '[]',
      bio TEXT
    );
  `);

  // Check existing row
  const existing = db
    .query<{ artist_key: string; website: string | null; tags: string; social_links: string; bio: string | null }, [string]>(
      "SELECT artist_key, website, tags, social_links, bio FROM artist_profiles WHERE artist_key = ?1 COLLATE NOCASE"
    )
    .get(artistName);

  const keyToUse = existing?.artist_key ?? artistName;
  const newWebsite = params.website !== undefined ? params.website : (existing?.website ?? null);
  const newBio = params.bio !== undefined ? params.bio : (existing?.bio ?? null);
  const newTags = params.tags !== undefined ? JSON.stringify(params.tags) : (existing?.tags ?? "[]");
  const newSocial = effectiveSocial !== undefined
    ? JSON.stringify(effectiveSocial)
    : (existing?.social_links ?? "[]");

  const fieldsUpdated: Record<string, unknown> = {};
  if (params.website !== undefined) fieldsUpdated.website = params.website;
  if (params.bio !== undefined) fieldsUpdated.bio = params.bio;
  if (params.tags !== undefined) fieldsUpdated.tags = params.tags;
  if (effectiveSocial !== undefined) fieldsUpdated.social_links = effectiveSocial;

  db.run(
    `INSERT INTO artist_profiles (artist_key, website, tags, social_links, bio)
     VALUES (?1, ?2, ?3, ?4, ?5)
     ON CONFLICT(artist_key) DO UPDATE SET
       website = excluded.website,
       tags = excluded.tags,
       social_links = excluded.social_links,
       bio = excluded.bio`,
    [keyToUse, newWebsite, newTags, newSocial, newBio]
  );

  const updatedProfile = getArtistProfile(db, { artist: keyToUse })!;

  return {
    success: true,
    artist: keyToUse,
    updated_fields: fieldsUpdated,
    profile: updatedProfile,
  };
}

/**
 * Retrieves an album's curated profile (description, website, tags, links/sources)
 * and MusicBrainz release-group context enrichment from the database.
 */
export function getAlbumProfile(
  db: Database,
  options: { album?: string; release_group_id?: string }
): AlbumProfile | null {
  const albumName = options.album?.trim();
  let releaseGroupMbid = options.release_group_id?.trim() ?? null;

  if (!albumName && !releaseGroupMbid) {
    throw new Error("Either album or release_group_id must be provided.");
  }

  let resolvedAlbumName = albumName ?? "";
  let resolvedArtistName: string | null = null;
  let songFound = false;

  if (hasTable(db, "songs")) {
    if (albumName && !releaseGroupMbid) {
      const hasMbRg = hasColumn(db, "songs", "musicbrainz_release_group_id");
      const querySql = hasMbRg
        ? "SELECT album, album_artist, artist, musicbrainz_release_group_id FROM songs WHERE album = ?1 COLLATE NOCASE LIMIT 1"
        : "SELECT album, album_artist, artist FROM songs WHERE album = ?1 COLLATE NOCASE LIMIT 1";
      const songRow = db.query<any, [string]>(querySql).get(albumName);
      if (songRow) {
        songFound = true;
        resolvedAlbumName = songRow.album ?? albumName;
        resolvedArtistName = songRow.album_artist || songRow.artist || null;
        if (songRow.musicbrainz_release_group_id) {
          releaseGroupMbid = songRow.musicbrainz_release_group_id;
        }
      }
    } else if (releaseGroupMbid && !albumName) {
      if (hasColumn(db, "songs", "musicbrainz_release_group_id")) {
        const songRow = db
          .query<any, [string]>(
            "SELECT album, album_artist, artist FROM songs WHERE musicbrainz_release_group_id = ?1 LIMIT 1"
          )
          .get(releaseGroupMbid);
        if (songRow && songRow.album) {
          songFound = true;
          resolvedAlbumName = songRow.album;
          resolvedArtistName = songRow.album_artist || songRow.artist || null;
        }
      }
    }
  }

  interface RawAlbumProfile {
    album_key: string;
    artist_key: string | null;
    description: string | null;
    website: string | null;
    tags: string;
    links: string;
  }

  let rawProfile: RawAlbumProfile | null = null;
  if (hasTable(db, "album_profiles")) {
    if (resolvedAlbumName) {
      rawProfile = db
        .query<RawAlbumProfile, [string]>(
          "SELECT album_key, artist_key, description, website, tags, links FROM album_profiles WHERE album_key = ?1 COLLATE NOCASE"
        )
        .get(resolvedAlbumName);
    }
  }

  interface RawReleaseContext {
    release_group_id: string;
    mb_rating: number | null;
    mb_rating_votes: number | null;
    mb_tags: string;
    mb_release_country: string | null;
    critiquebrainz_rating: number | null;
    critiquebrainz_review_count: number | null;
    critiquebrainz_review_links: string;
  }

  let rawContext: RawReleaseContext | null = null;
  if (releaseGroupMbid && hasTable(db, "context_enrichment")) {
    rawContext = db
      .query<RawReleaseContext, [string]>(
        "SELECT release_group_id, mb_rating, mb_rating_votes, mb_tags, mb_release_country, critiquebrainz_rating, critiquebrainz_review_count, critiquebrainz_review_links FROM context_enrichment WHERE release_group_id = ?1"
      )
      .get(releaseGroupMbid);
  }

  if (!rawProfile && !rawContext && !songFound) {
    return null;
  }

  let parsedTags: string[] = [];
  if (rawProfile?.tags) {
    try {
      parsedTags = JSON.parse(rawProfile.tags);
    } catch {
      parsedTags = [];
    }
  }

  let parsedLinks: Array<AlbumLinkItem | string> = [];
  if (rawProfile?.links) {
    try {
      parsedLinks = JSON.parse(rawProfile.links);
    } catch {
      parsedLinks = [];
    }
  }

  let contextEnrichment: AlbumProfile["context_enrichment"] = null;
  if (rawContext) {
    let mbTags: string[] = [];
    try {
      mbTags = JSON.parse(rawContext.mb_tags);
    } catch {
      mbTags = [];
    }
    let reviewLinks: string[] = [];
    try {
      reviewLinks = JSON.parse(rawContext.critiquebrainz_review_links);
    } catch {
      reviewLinks = [];
    }
    contextEnrichment = {
      mb_rating: rawContext.mb_rating,
      mb_rating_votes: rawContext.mb_rating_votes,
      mb_tags: mbTags,
      mb_release_country: rawContext.mb_release_country,
      critiquebrainz_rating: rawContext.critiquebrainz_rating,
      critiquebrainz_review_count: rawContext.critiquebrainz_review_count,
      critiquebrainz_review_links: reviewLinks,
    };
  }

  const bioSources = extractBioLinks(rawProfile?.description);

  return {
    album: rawProfile?.album_key ?? resolvedAlbumName,
    artist: rawProfile?.artist_key ?? resolvedArtistName,
    description: rawProfile?.description ?? null,
    website: rawProfile?.website ?? null,
    tags: parsedTags,
    links: parsedLinks,
    sources: bioSources.length > 0 ? bioSources : undefined,
    release_group_mbid: releaseGroupMbid,
    context_enrichment: contextEnrichment,
  };
}

/**
 * Creates or updates an album's curated profile (description, artist, website, tags, links/sources)
 * in the Luminous database.
 */
export function updateAlbumProfile(
  db: Database,
  params: UpdateAlbumProfileParams
): UpdateAlbumProfileResult {
  const albumName = params.album?.trim();
  if (!albumName) {
    throw new Error("Album name must not be empty.");
  }

  if (
    params.description === undefined &&
    params.website === undefined &&
    params.tags === undefined &&
    params.links === undefined &&
    params.artist === undefined
  ) {
    throw new Error(
      "At least one profile field (description, website, tags, links, artist) must be provided."
    );
  }

  // Ensure table exists
  db.run(`
    CREATE TABLE IF NOT EXISTS album_profiles (
      album_key TEXT PRIMARY KEY,
      artist_key TEXT,
      description TEXT,
      website TEXT,
      tags TEXT NOT NULL DEFAULT '[]',
      links TEXT NOT NULL DEFAULT '[]'
    );
  `);

  // Check existing row
  const existing = db
    .query<
      {
        album_key: string;
        artist_key: string | null;
        description: string | null;
        website: string | null;
        tags: string;
        links: string;
      },
      [string]
    >(
      "SELECT album_key, artist_key, description, website, tags, links FROM album_profiles WHERE album_key = ?1 COLLATE NOCASE"
    )
    .get(albumName);

  const keyToUse = existing?.album_key ?? albumName;
  const newArtist = params.artist !== undefined ? params.artist : (existing?.artist_key ?? null);
  const newDescription =
    params.description !== undefined ? params.description : (existing?.description ?? null);
  const newWebsite =
    params.website !== undefined ? params.website : (existing?.website ?? null);
  const newTags =
    params.tags !== undefined ? JSON.stringify(params.tags) : (existing?.tags ?? "[]");
  const newLinks =
    params.links !== undefined ? JSON.stringify(params.links) : (existing?.links ?? "[]");

  const fieldsUpdated: Record<string, unknown> = {};
  if (params.artist !== undefined) fieldsUpdated.artist = params.artist;
  if (params.description !== undefined) fieldsUpdated.description = params.description;
  if (params.website !== undefined) fieldsUpdated.website = params.website;
  if (params.tags !== undefined) fieldsUpdated.tags = params.tags;
  if (params.links !== undefined) fieldsUpdated.links = params.links;

  db.run(
    `INSERT INTO album_profiles (album_key, artist_key, description, website, tags, links)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6)
     ON CONFLICT(album_key) DO UPDATE SET
       artist_key = excluded.artist_key,
       description = excluded.description,
       website = excluded.website,
       tags = excluded.tags,
       links = excluded.links`,
    [keyToUse, newArtist, newDescription, newWebsite, newTags, newLinks]
  );

  const updatedProfile = getAlbumProfile(db, { album: keyToUse })!;

  return {
    success: true,
    album: keyToUse,
    updated_fields: fieldsUpdated,
    profile: updatedProfile,
  };
}

/**
 * Looks up additional metadata for a track, album, or artist using MusicBrainz IDs (MBIDs).
 * Inspects both local enrichment caches in Luminous and optional live MusicBrainz API responses.
 */
export async function lookupMusicBrainz(
  db: Database,
  params: LookupMusicBrainzParams
): Promise<LookupMusicBrainzResult> {
  let mbid = params.mbid?.trim() ?? null;
  let entityType = params.entity_type;
  const fetchLive = params.fetch_live ?? true;

  let trackInfo: LookupMusicBrainzResult["track"] | undefined;
  let localEnrichment: LookupMusicBrainzResult["local_enrichment"] | undefined;

  if (typeof params.track_id === "number") {
    if (!hasTable(db, "songs")) {
      throw new Error("Luminous 'songs' table not found in database.");
    }

    interface TrackRow {
      id: number;
      title: string | null;
      artist: string | null;
      album: string | null;
      year: number | null;
      musicbrainz_recording_id: string | null;
      musicbrainz_artist_id: string | null;
      musicbrainz_album_id: string | null;
      musicbrainz_release_group_id: string | null;
    }

    const row = db
      .query<TrackRow, [number]>(
        `SELECT id, title, artist, album, year,
                musicbrainz_recording_id, musicbrainz_artist_id, musicbrainz_album_id, musicbrainz_release_group_id
         FROM songs WHERE id = ?1`
      )
      .get(params.track_id);

    if (!row) {
      throw new Error(`Track with ID ${params.track_id} was not found in the library.`);
    }

    trackInfo = {
      title: row.title,
      artist: row.artist,
      album: row.album,
      year: row.year,
      musicbrainz_recording_id: row.musicbrainz_recording_id,
      musicbrainz_artist_id: row.musicbrainz_artist_id,
      musicbrainz_album_id: row.musicbrainz_album_id,
      musicbrainz_release_group_id: row.musicbrainz_release_group_id,
    };

    if (!mbid) {
      if (!entityType || entityType === "recording") {
        mbid = row.musicbrainz_recording_id;
        entityType = "recording";
      } else if (entityType === "artist") {
        mbid = row.musicbrainz_artist_id;
      } else if (entityType === "release") {
        mbid = row.musicbrainz_album_id;
      } else if (entityType === "release-group") {
        mbid = row.musicbrainz_release_group_id;
      }
    }

    // Check local context enrichment tables
    let artistContext: any = null;
    if (row.musicbrainz_artist_id && hasTable(db, "artist_context_enrichment")) {
      artistContext = db
        .query<any, [string]>(
          "SELECT wikidata_id, wikipedia_extract, wikipedia_page_url, wikipedia_thumbnail_url FROM artist_context_enrichment WHERE artist_id = ?1"
        )
        .get(row.musicbrainz_artist_id);
    }

    let releaseContext: any = null;
    if (row.musicbrainz_release_group_id && hasTable(db, "context_enrichment")) {
      const rc = db
        .query<any, [string]>(
          "SELECT mb_rating, critiquebrainz_rating, mb_tags, mb_release_country FROM context_enrichment WHERE release_group_id = ?1"
        )
        .get(row.musicbrainz_release_group_id);
      if (rc) {
        let tags: string[] = [];
        try {
          tags = JSON.parse(rc.mb_tags);
        } catch {
          tags = [];
        }
        releaseContext = {
          mb_rating: rc.mb_rating,
          critiquebrainz_rating: rc.critiquebrainz_rating,
          mb_tags: tags,
          mb_release_country: rc.mb_release_country,
        };
      }
    }

    if (artistContext || releaseContext) {
      localEnrichment = {
        artist_context: artistContext,
        release_group_context: releaseContext,
      };
    }
  }

  if (!entityType) {
    entityType = "recording";
  }

  if (!mbid && !localEnrichment) {
    return {
      entity_type: entityType,
      mbid: null,
      track_id: params.track_id,
      track: trackInfo,
      source: "none",
      status: "not_found",
      message: "No MusicBrainz ID (MBID) found for this query or track.",
    };
  }

  let liveData: Record<string, unknown> | undefined;
  let apiMessage: string | undefined;

  if (fetchLive && mbid) {
    const incParamMap: Record<MusicBrainzEntityType, string> = {
      recording: "artists+releases+genres+tags",
      release: "artists+recordings+genres+tags",
      "release-group": "artists+genres+tags+ratings",
      artist: "genres+tags+ratings+url-rels",
      work: "tags+genres",
    };
    const incParam = incParamMap[entityType] ?? "genres+tags";
    const url = `https://musicbrainz.org/ws/2/${entityType}/${encodeURIComponent(mbid)}?fmt=json&inc=${incParam}`;

    try {
      const response = await fetch(url, {
        headers: {
          "User-Agent": "LuminousMCP/0.1.0 ( https://github.com/esoltys/luminous-mcp; esoltys@users.noreply.github.com )",
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(5000),
      });

      if (response.ok) {
        liveData = (await response.json()) as Record<string, unknown>;
      } else if (response.status === 503) {
        apiMessage = "MusicBrainz API rate limit reached or server busy (503). Returning local data if available.";
      } else if (response.status === 404) {
        apiMessage = `Entity not found on MusicBrainz (404) for MBID: ${mbid}`;
      } else {
        apiMessage = `MusicBrainz returned HTTP status ${response.status}.`;
      }
    } catch (err: any) {
      apiMessage = `Network error contacting MusicBrainz: ${err.message ?? String(err)}`;
    }
  }

  const hasLocal = Boolean(localEnrichment);
  const hasLive = Boolean(liveData);

  let source: LookupMusicBrainzResult["source"] = "none";
  if (hasLocal && hasLive) source = "both";
  else if (hasLive) source = "live_api";
  else if (hasLocal) source = "local_cache";

  let status: LookupMusicBrainzResult["status"] = "success";
  if (hasLive) {
    status = "success";
  } else if (hasLocal) {
    status = "partial";
  } else if (apiMessage) {
    status = "api_unavailable";
  } else {
    status = "not_found";
  }

  return {
    entity_type: entityType,
    mbid,
    track_id: params.track_id,
    track: trackInfo,
    local_enrichment: localEnrichment,
    live_data: liveData,
    source,
    status,
    message: apiMessage,
  };
}
