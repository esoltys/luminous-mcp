import type { Database } from "bun:sqlite";

/**
 * Human-readable audio file format names mapped from Luminous FileType enum.
 */
export const FILE_TYPE_NAMES: Record<number, string> = {
  0: "Unknown",
  1: "MP3",
  2: "FLAC",
  3: "Ogg FLAC",
  4: "Ogg Vorbis",
  5: "Ogg Opus",
  6: "Ogg Speex",
  7: "AAC",
  8: "ALAC",
  9: "AIFF",
  10: "WAV",
  11: "WavPack",
  12: "MPC",
  13: "TrueAudio",
  14: "APE",
  15: "DSF",
  16: "DSDIFF",
  17: "ASF",
  18: "Stream",
};

export interface SearchLibraryParams {
  query?: string;
  artist?: string;
  album?: string;
  genre?: string;
  composer?: string;
  year_min?: number;
  year_max?: number;
  bpm_min?: number;
  bpm_max?: number;
  lufs_min?: number;
  lufs_max?: number;
  limit?: number;
  detail_level?: DetailLevel;
}

export type DetailLevel = "compact" | "full";

export interface SearchLibraryTrackItem {
  id: number;
  title: string | null;
  artist: string | null;
  album: string | null;
  year: number | null;
  duration_seconds: number | null;
  album_artist?: string | null;
  composer?: string | null;
  performer?: string | null;
  genre?: string | null;
  track?: number | null;
  disc?: number | null;
  bpm?: number | null;
  loudness_lufs?: number | null;
  play_count?: number;
}

export interface SearchLibraryResult {
  count: number;
  tracks: SearchLibraryTrackItem[];
}

export interface TrackDetails {
  id: number;
  metadata: {
    title: string | null;
    artist: string | null;
    album: string | null;
    album_artist: string | null;
    composer: string | null;
    performer: string | null;
    genre: string | null;
    year: number | null;
    original_year: number | null;
    disc: number | null;
    track: number | null;
    comment: string | null;
    grouping: string | null;
    compilation: boolean;
  };
  technical_specs: {
    path: string | null;
    file_type: string;
    sample_rate_hz: number | null;
    bit_depth: number | null;
    bitrate_kbps: number | null;
    channels: number | null;
    file_size_bytes: number | null;
    duration_seconds: number | null;
  };
  acoustic_measurements: {
    loudness_lufs: number | null;
    loudness_range_lu: number | null;
    bpm: number | null;
    initial_key: string | null;
    replaygain_track_gain_db: number | null;
    replaygain_album_gain_db: number | null;
    dynamic_range: number | null;
  };
  lyrics: {
    has_lyrics: boolean;
    is_synced: boolean;
    text: string | null;
  };
  identifiers: {
    musicbrainz_recording_id: string | null;
    musicbrainz_track_id: string | null;
    musicbrainz_release_group_id: string | null;
    musicbrainz_album_id: string | null;
    musicbrainz_artist_id: string | null;
    musicbrainz_album_artist_id: string | null;
    musicbrainz_work_id: string | null;
    musicbrainz_release_type: string | null;
    musicbrainz_release_country: string | null;
    barcode: string | null;
    catalog_number: string | null;
  };
  stats: {
    rating: number;
    play_count: number;
    skip_count: number;
    last_played: number | null;
    added: number | null;
  };
}

export interface ArtistAlbumItem {
  name: string;
  year: number | null;
  track_count: number;
}

export interface ArtistSummary {
  artist: string;
  found: boolean;
  total_tracks: number;
  total_albums: number;
  albums: ArtistAlbumItem[];
  genres: string[];
  collaborators: string[];
  composers: string[];
  producers: string[];
  stats: {
    total_play_count: number;
    total_skip_count: number;
    most_played_tracks: Array<{
      id: number;
      title: string | null;
      album: string | null;
      play_count: number;
    }>;
  };
}

/**
 * Splits multi-value metadata strings delimited by '; ' or ';' into unique trimmed values.
 */
export function splitMultiValue(value: string | null | undefined): string[] {
  if (!value) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const part of value.split(";")) {
    const trimmed = part.trim();
    if (trimmed && !seen.has(trimmed.toLowerCase())) {
      seen.add(trimmed.toLowerCase());
      result.push(trimmed);
    }
  }
  return result;
}

/**
 * Prepares an FTS5 search expression by wrapping terms in quotes with prefix wildcards.
 */
function buildFtsQuery(raw: string): string {
  const words = raw.trim().replace(/["*^]/g, "").split(/\s+/).filter(Boolean);
  if (words.length === 0) return "";
  return words.map((w) => `"${w}"*`).join(" ");
}

/**
 * Checks if a table exists in the database.
 */
function hasTable(db: Database, tableName: string): boolean {
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
 * Executes library search with FTS5 and structured filters.
 */
export function searchLibrary(db: Database, params: SearchLibraryParams = {}): SearchLibraryResult {
  const limit = Math.max(1, Math.min(100, params.limit ?? 25));
  const whereClauses: string[] = ["s.unavailable = 0"];
  const queryParams: Record<string, unknown> = {
    $limit: limit,
  };

  const ftsTableAvailable = hasTable(db, "songs_fts");

  if (params.query && params.query.trim() !== "") {
    const trimmedQuery = params.query.trim();
    const likePattern = `%${trimmedQuery}%`;
    queryParams.$queryLike = likePattern;

    if (ftsTableAvailable) {
      const ftsExpression = buildFtsQuery(trimmedQuery);
      if (ftsExpression) {
        queryParams.$ftsQuery = ftsExpression;
        whereClauses.push(
          "(s.id IN (SELECT rowid FROM songs_fts WHERE songs_fts MATCH $ftsQuery) OR s.lyrics LIKE $queryLike OR s.title LIKE $queryLike OR s.artist LIKE $queryLike OR s.album LIKE $queryLike)"
        );
      } else {
        whereClauses.push(
          "(s.title LIKE $queryLike OR s.artist LIKE $queryLike OR s.album LIKE $queryLike OR s.lyrics LIKE $queryLike)"
        );
      }
    } else {
      whereClauses.push(
        "(s.title LIKE $queryLike OR s.artist LIKE $queryLike OR s.album LIKE $queryLike OR s.album_artist LIKE $queryLike OR s.composer LIKE $queryLike OR s.performer LIKE $queryLike OR s.genre LIKE $queryLike OR s.lyrics LIKE $queryLike)"
      );
    }
  }

  if (params.artist && params.artist.trim() !== "") {
    queryParams.$artist = `%${params.artist.trim()}%`;
    whereClauses.push("(s.artist LIKE $artist OR s.album_artist LIKE $artist)");
  }

  if (params.album && params.album.trim() !== "") {
    queryParams.$album = `%${params.album.trim()}%`;
    whereClauses.push("s.album LIKE $album");
  }

  if (params.genre && params.genre.trim() !== "") {
    queryParams.$genre = `%${params.genre.trim()}%`;
    whereClauses.push("s.genre LIKE $genre");
  }

  if (params.composer && params.composer.trim() !== "") {
    queryParams.$composer = `%${params.composer.trim()}%`;
    whereClauses.push("s.composer LIKE $composer");
  }

  if (params.year_min !== undefined) {
    queryParams.$yearMin = params.year_min;
    whereClauses.push("s.year >= $yearMin");
  }

  if (params.year_max !== undefined) {
    queryParams.$yearMax = params.year_max;
    whereClauses.push("s.year <= $yearMax");
  }

  if (params.bpm_min !== undefined) {
    queryParams.$bpmMin = params.bpm_min;
    whereClauses.push("s.bpm >= $bpmMin");
  }

  if (params.bpm_max !== undefined) {
    queryParams.$bpmMax = params.bpm_max;
    whereClauses.push("s.bpm <= $bpmMax");
  }

  if (params.lufs_min !== undefined) {
    queryParams.$lufsMin = params.lufs_min;
    whereClauses.push("s.ebur128_integrated_loudness_lufs >= $lufsMin");
  }

  if (params.lufs_max !== undefined) {
    queryParams.$lufsMax = params.lufs_max;
    whereClauses.push("s.ebur128_integrated_loudness_lufs <= $lufsMax");
  }

  const sql = `
    SELECT
      s.id,
      s.title,
      s.artist,
      s.album,
      s.album_artist,
      s.composer,
      s.performer,
      s.genre,
      s.track,
      s.disc,
      s.year,
      s.bpm,
      s.ebur128_integrated_loudness_lufs,
      s.length_nanosec,
      s.playcount
    FROM songs s
    WHERE ${whereClauses.join(" AND ")}
    ORDER BY COALESCE(s.album_artist_sort, s.album_artist, s.artist), COALESCE(s.albumsort, s.album), s.disc, s.track
    LIMIT $limit;
  `;

  let rows: any[] = [];
  try {
    rows = db.query(sql).all(queryParams as any);
  } catch {
    // If FTS5 failed (e.g. malformed syntax), retry with pure LIKE matching
    if (params.query && queryParams.$ftsQuery) {
      delete queryParams.$ftsQuery;
      const fallbackWhere = whereClauses.map((clause) => {
        if (clause.includes("songs_fts")) {
          return "(s.title LIKE $queryLike OR s.artist LIKE $queryLike OR s.album LIKE $queryLike OR s.lyrics LIKE $queryLike)";
        }
        return clause;
      });
      const fallbackSql = `
        SELECT
          s.id,
          s.title,
          s.artist,
          s.album,
          s.album_artist,
          s.composer,
          s.performer,
          s.genre,
          s.track,
          s.disc,
          s.year,
          s.bpm,
          s.ebur128_integrated_loudness_lufs,
          s.length_nanosec,
          s.playcount
        FROM songs s
        WHERE ${fallbackWhere.join(" AND ")}
        ORDER BY COALESCE(s.album_artist_sort, s.album_artist, s.artist), COALESCE(s.albumsort, s.album), s.disc, s.track
        LIMIT $limit;
      `;
      rows = db.query(fallbackSql).all(queryParams as any);
    } else {
      rows = [];
    }
  }

  const detailLevel = params.detail_level ?? "compact";

  const tracks: SearchLibraryTrackItem[] = rows.map((r) => {
    const durationSeconds =
      r.length_nanosec != null ? Math.round((r.length_nanosec / 1e9) * 100) / 100 : null;

    if (detailLevel === "compact") {
      return {
        id: r.id,
        title: r.title ?? null,
        artist: r.artist ?? null,
        album: r.album ?? null,
        year: r.year ?? null,
        duration_seconds: durationSeconds,
      };
    }

    return {
      id: r.id,
      title: r.title ?? null,
      artist: r.artist ?? null,
      album: r.album ?? null,
      album_artist: r.album_artist ?? null,
      composer: r.composer ?? null,
      performer: r.performer ?? null,
      genre: r.genre ?? null,
      track: r.track ?? null,
      disc: r.disc ?? null,
      year: r.year ?? null,
      bpm: r.bpm != null ? Math.round(r.bpm * 10) / 10 : null,
      loudness_lufs:
        r.ebur128_integrated_loudness_lufs != null
          ? Math.round(r.ebur128_integrated_loudness_lufs * 100) / 100
          : null,
      duration_seconds: durationSeconds,
      play_count: r.playcount ?? 0,
    };
  });

  return {
    count: tracks.length,
    tracks,
  };
}

export interface GetTrackDetailsOptions {
  include_lyrics?: boolean;
}

/**
 * Retrieves deep metadata inspection for a single track by its primary key ID.
 */
export function getTrackDetails(
  db: Database,
  trackId: number,
  options?: GetTrackDetailsOptions
): TrackDetails | null {
  const row = db.query("SELECT * FROM songs WHERE id = ?").get(trackId) as any;
  if (!row) {
    return null;
  }

  const fileTypeName = FILE_TYPE_NAMES[row.filetype] ?? "Unknown";
  const lengthNanosec: number | null = row.length_nanosec ?? null;
  const durationSeconds = lengthNanosec != null ? Math.round((lengthNanosec / 1e9) * 100) / 100 : null;

  const includeLyrics = options?.include_lyrics ?? false;
  const rawLyrics: string | null = row.lyrics && row.lyrics.trim() !== "" ? row.lyrics : null;
  const isSyncedLyrics = rawLyrics != null ? /^\[\d{2}:\d{2}(?:\.\d{1,3})?\]/m.test(rawLyrics) : false;

  return {
    id: row.id,
    metadata: {
      title: row.title ?? null,
      artist: row.artist ?? null,
      album: row.album ?? null,
      album_artist: row.album_artist ?? null,
      composer: row.composer ?? null,
      performer: row.performer ?? null,
      genre: row.genre ?? null,
      year: row.year ?? null,
      original_year: row.originalyear ?? null,
      disc: row.disc ?? null,
      track: row.track ?? null,
      comment: row.comment ?? null,
      grouping: row.grouping ?? null,
      compilation: Boolean(row.compilation),
    },
    technical_specs: {
      path: row.path ?? null,
      file_type: fileTypeName,
      sample_rate_hz: row.samplerate ?? null,
      bit_depth: row.bitdepth ?? null,
      bitrate_kbps: row.bitrate ?? null,
      channels: row.channels ?? null,
      file_size_bytes: row.filesize ?? null,
      duration_seconds: durationSeconds,
    },
    acoustic_measurements: {
      loudness_lufs:
        row.ebur128_integrated_loudness_lufs != null
          ? Math.round(row.ebur128_integrated_loudness_lufs * 100) / 100
          : null,
      loudness_range_lu:
        row.ebur128_loudness_range_lu != null
          ? Math.round(row.ebur128_loudness_range_lu * 100) / 100
          : null,
      bpm: row.bpm != null ? Math.round(row.bpm * 10) / 10 : null,
      initial_key: row.initial_key ?? null,
      replaygain_track_gain_db:
        row.replaygain_track_gain != null
          ? Math.round(row.replaygain_track_gain * 100) / 100
          : null,
      replaygain_album_gain_db:
        row.replaygain_album_gain != null
          ? Math.round(row.replaygain_album_gain * 100) / 100
          : null,
      dynamic_range: row.dynamic_range ?? null,
    },
    lyrics: {
      has_lyrics: rawLyrics !== null,
      is_synced: isSyncedLyrics,
      text: includeLyrics ? rawLyrics : null,
    },
    identifiers: {
      musicbrainz_recording_id: row.musicbrainz_recording_id ?? null,
      musicbrainz_track_id: row.musicbrainz_track_id ?? null,
      musicbrainz_release_group_id: row.musicbrainz_release_group_id ?? null,
      musicbrainz_album_id: row.musicbrainz_album_id ?? null,
      musicbrainz_artist_id: row.musicbrainz_artist_id ?? null,
      musicbrainz_album_artist_id: row.musicbrainz_album_artist_id ?? null,
      musicbrainz_work_id: row.musicbrainz_work_id ?? null,
      musicbrainz_release_type: row.musicbrainz_release_type ?? null,
      musicbrainz_release_country: row.musicbrainz_release_country ?? null,
      barcode: row.barcode ?? null,
      catalog_number: row.catalog_number ?? null,
    },
    stats: {
      rating: row.rating ?? -1,
      play_count: row.playcount ?? 0,
      skip_count: row.skipcount ?? 0,
      last_played: row.lastplayed ?? null,
      added: row.added ?? null,
    },
  };
}

/**
 * Escapes characters for SQLite LIKE parameter matching.
 */
function escapeLike(str: string): string {
  return str.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

/**
 * Aggregates artist catalog details, collaborators, genres, and listening statistics.
 */
export function getArtistSummary(db: Database, artistName: string): ArtistSummary {
  const trimmed = artistName.trim();
  if (!trimmed) {
    return {
      artist: artistName,
      found: false,
      total_tracks: 0,
      total_albums: 0,
      albums: [],
      genres: [],
      collaborators: [],
      composers: [],
      producers: [],
      stats: {
        total_play_count: 0,
        total_skip_count: 0,
        most_played_tracks: [],
      },
    };
  }

  const escaped = escapeLike(trimmed);
  const pattern = `%${escaped}%`;
  const delimPattern = `%;${escaped};%`;

  const sql = `
    SELECT
      id,
      title,
      artist,
      album_artist,
      album,
      year,
      genre,
      composer,
      performer,
      playcount,
      skipcount
    FROM songs
    WHERE unavailable = 0
      AND (
        artist LIKE $pattern ESCAPE '\\'
        OR album_artist LIKE $pattern ESCAPE '\\'
        OR (';' || REPLACE(COALESCE(artist, ''), '; ', ';') || ';') LIKE $delimPattern ESCAPE '\\'
        OR (';' || REPLACE(COALESCE(album_artist, ''), '; ', ';') || ';') LIKE $delimPattern ESCAPE '\\'
      )
    ORDER BY playcount DESC;
  `;

  let rows: any[] = [];
  try {
    rows = db.query(sql).all({
      $pattern: pattern,
      $delimPattern: delimPattern,
    } as any);
  } catch {
    rows = [];
  }

  if (rows.length === 0) {
    return {
      artist: trimmed,
      found: false,
      total_tracks: 0,
      total_albums: 0,
      albums: [],
      genres: [],
      collaborators: [],
      composers: [],
      producers: [],
      stats: {
        total_play_count: 0,
        total_skip_count: 0,
        most_played_tracks: [],
      },
    };
  }

  const albumMap = new Map<string, { year: number | null; count: number }>();
  const genreSet = new Set<string>();
  const collaboratorSet = new Set<string>();
  const composerSet = new Set<string>();
  const producerSet = new Set<string>();
  let totalPlayCount = 0;
  let totalSkipCount = 0;

  const targetLower = trimmed.toLowerCase();

  for (const row of rows) {
    totalPlayCount += row.playcount ?? 0;
    totalSkipCount += row.skipcount ?? 0;

    const albumName = row.album?.trim();
    if (albumName) {
      const existing = albumMap.get(albumName);
      if (existing) {
        existing.count++;
        if (!existing.year && row.year) {
          existing.year = row.year;
        }
      } else {
        albumMap.set(albumName, {
          year: row.year ?? null,
          count: 1,
        });
      }
    }

    for (const g of splitMultiValue(row.genre)) {
      genreSet.add(g);
    }

    for (const c of splitMultiValue(row.composer)) {
      if (c.toLowerCase() !== targetLower) {
        composerSet.add(c);
      }
    }

    for (const p of splitMultiValue(row.performer)) {
      if (p.toLowerCase() !== targetLower) {
        producerSet.add(p);
      }
    }

    for (const a of splitMultiValue(row.artist)) {
      if (a.toLowerCase() !== targetLower) {
        collaboratorSet.add(a);
      }
    }
  }

  const albums: ArtistAlbumItem[] = Array.from(albumMap.entries())
    .map(([name, info]) => ({
      name,
      year: info.year,
      track_count: info.count,
    }))
    .sort((a, b) => {
      if (a.year != null && b.year != null && a.year !== b.year) {
        return a.year - b.year;
      }
      return a.name.localeCompare(b.name);
    });

  const mostPlayed = rows.slice(0, 5).map((r) => ({
    id: r.id,
    title: r.title ?? null,
    album: r.album ?? null,
    play_count: r.playcount ?? 0,
  }));

  return {
    artist: trimmed,
    found: true,
    total_tracks: rows.length,
    total_albums: albumMap.size,
    albums,
    genres: Array.from(genreSet).sort(),
    collaborators: Array.from(collaboratorSet).sort(),
    composers: Array.from(composerSet).sort(),
    producers: Array.from(producerSet).sort(),
    stats: {
      total_play_count: totalPlayCount,
      total_skip_count: totalSkipCount,
      most_played_tracks: mostPlayed,
    },
  };
}
