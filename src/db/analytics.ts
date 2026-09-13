import type { Database } from "bun:sqlite";

/**
 * Supported categories for getListeningStats.
 */
export type ListeningStatsCategory =
  | "overview"
  | "top_artists"
  | "top_tracks"
  | "forgotten_favorites"
  | "frequently_skipped";

/**
 * Metric to rank frequently skipped tracks by.
 */
export type SkipMetric = "skip_count" | "skip_ratio";

export interface ListeningStatsParams {
  category?: ListeningStatsCategory;
  limit?: number;
  year_min?: number;
  year_max?: number;
  genre?: string;
  artist?: string;
  unplayed_months?: number;
  min_play_count?: number;
  skip_metric?: SkipMetric;
}

export interface TopArtistItem {
  artist: string;
  total_plays: number;
  total_skips: number;
  track_count: number;
}

export interface TrackStatsItem {
  id: number;
  title: string | null;
  artist: string | null;
  album: string | null;
  year: number | null;
  genre: string | null;
  play_count: number;
  skip_count: number;
  skip_ratio: number;
  last_played_iso: string | null;
}

export interface LibraryOverviewSummary {
  total_tracks: number;
  total_plays: number;
  total_skips: number;
  tracks_played: number;
  tracks_unplayed: number;
}

export interface ListeningStatsOverviewResult {
  category: "overview";
  summary: LibraryOverviewSummary;
  top_artists: TopArtistItem[];
  top_tracks: TrackStatsItem[];
  forgotten_favorites: TrackStatsItem[];
  frequently_skipped: TrackStatsItem[];
}

export interface ListeningStatsCategoryResult<T> {
  category: ListeningStatsCategory;
  count: number;
  params: {
    limit: number;
    year_min?: number;
    year_max?: number;
    genre?: string;
    artist?: string;
    unplayed_months?: number;
    min_play_count?: number;
    skip_metric?: SkipMetric;
  };
  items: T[];
}

export type ListeningStatsResult =
  | ListeningStatsOverviewResult
  | ListeningStatsCategoryResult<TopArtistItem>
  | ListeningStatsCategoryResult<TrackStatsItem>;

export interface RecentHistoryParams {
  limit?: number;
  since?: string | number;
  until?: string | number;
  context_type?: string;
  playlist_id?: number;
  artist?: string;
  track_id?: number;
  order?: "desc" | "asc";
}

export interface PlayHistoryItem {
  history_id: number;
  played_at_iso: string;
  duration_seconds: number | null;
  context: {
    type: string;
    playlist_id: number | null;
    playlist_name: string | null;
  };
  track: {
    id: number;
    title: string | null;
    artist: string | null;
    album: string | null;
    year: number | null;
    genre: string | null;
  };
}

export interface RecentHistoryResult {
  count: number;
  history: PlayHistoryItem[];
  message?: string;
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
 * Checks if a column exists in a given table.
 */
function hasColumn(db: Database, tableName: string, columnName: string): boolean {
  try {
    const rows = db.query<any, []>(`PRAGMA table_info(${tableName})`).all();
    return rows.some((col: any) => col.name === columnName);
  } catch {
    return false;
  }
}

/**
 * Parses an ISO 8601 string or numeric timestamp into epoch seconds.
 */
export function parseTimestamp(input: string | number | undefined): number | undefined {
  if (input === undefined || input === null) return undefined;
  if (typeof input === "number") return Math.floor(input);
  const trimmed = input.trim();
  if (/^\d+$/.test(trimmed)) {
    return parseInt(trimmed, 10);
  }
  const parsed = Date.parse(trimmed);
  if (!isNaN(parsed)) {
    return Math.floor(parsed / 1000);
  }
  return undefined;
}

/**
 * Builds standard filter conditions for the songs table.
 */
function buildSongFilterClauses(
  params: {
    year_min?: number;
    year_max?: number;
    genre?: string;
    artist?: string;
  },
  alias: string = "s"
): { clauses: string[]; bindings: Record<string, unknown> } {
  const clauses: string[] = [`${alias}.unavailable = 0`];
  const bindings: Record<string, unknown> = {};

  if (params.year_min !== undefined) {
    bindings.$yearMin = params.year_min;
    clauses.push(`${alias}.year >= $yearMin`);
  }

  if (params.year_max !== undefined) {
    bindings.$yearMax = params.year_max;
    clauses.push(`${alias}.year <= $yearMax`);
  }

  if (params.genre && params.genre.trim() !== "") {
    bindings.$genre = `%${params.genre.trim()}%`;
    clauses.push(`${alias}.genre LIKE $genre`);
  }

  if (params.artist && params.artist.trim() !== "") {
    bindings.$artist = `%${params.artist.trim()}%`;
    clauses.push(`(${alias}.artist LIKE $artist OR ${alias}.album_artist LIKE $artist)`);
  }

  return { clauses, bindings };
}

/**
 * Formats a raw database row into a TrackStatsItem.
 */
function formatTrackStatsRow(r: any, _nowSec: number): TrackStatsItem {
  const plays = r.playcount ?? 0;
  const skips = r.skipcount ?? 0;
  const total = plays + skips;
  const rawRatio = total > 0 ? skips / total : 0;
  const skipRatio = Math.round(rawRatio * 1000) / 1000;

  let lastPlayedIso: string | null = null;

  if (r.lastplayed != null && r.lastplayed > 0) {
    try {
      lastPlayedIso = new Date(r.lastplayed * 1000).toISOString();
    } catch {
      lastPlayedIso = null;
    }
  }

  return {
    id: r.id,
    title: r.title ?? null,
    artist: r.artist ?? null,
    album: r.album ?? null,
    year: r.year ?? null,
    genre: r.genre ?? null,
    play_count: plays,
    skip_count: skips,
    skip_ratio: skipRatio,
    last_played_iso: lastPlayedIso,
  };
}

/**
 * Query top artists ranked by playcount.
 */
function queryTopArtists(
  db: Database,
  filterClauses: string[],
  bindings: Record<string, unknown>,
  limit: number
): TopArtistItem[] {
  const sql = `
    SELECT
      COALESCE(NULLIF(s.album_artist, ''), s.artist) AS artist_name,
      SUM(s.playcount) AS total_plays,
      SUM(s.skipcount) AS total_skips,
      COUNT(*) AS track_count
    FROM songs s
    WHERE ${filterClauses.join(" AND ")}
      AND COALESCE(NULLIF(s.album_artist, ''), s.artist) IS NOT NULL
      AND TRIM(COALESCE(NULLIF(s.album_artist, ''), s.artist)) != ''
    GROUP BY artist_name
    ORDER BY total_plays DESC, total_skips ASC, artist_name COLLATE NOCASE ASC
    LIMIT $limit;
  `;

  try {
    const rows = db.query<any, any>(sql).all({ ...bindings, $limit: limit });
    return rows.map((r) => ({
      artist: r.artist_name,
      total_plays: Number(r.total_plays ?? 0),
      total_skips: Number(r.total_skips ?? 0),
      track_count: Number(r.track_count ?? 0),
    }));
  } catch {
    return [];
  }
}

/**
 * Query top tracks ranked by playcount.
 */
function queryTopTracks(
  db: Database,
  filterClauses: string[],
  bindings: Record<string, unknown>,
  limit: number,
  nowSec: number
): TrackStatsItem[] {
  const sql = `
    SELECT
      s.id,
      s.title,
      s.artist,
      s.album,
      s.year,
      s.genre,
      s.playcount,
      s.skipcount,
      s.lastplayed
    FROM songs s
    WHERE ${filterClauses.join(" AND ")}
    ORDER BY s.playcount DESC, s.skipcount ASC, s.id ASC
    LIMIT $limit;
  `;

  try {
    const rows = db.query<any, any>(sql).all({ ...bindings, $limit: limit });
    return rows.map((r) => formatTrackStatsRow(r, nowSec));
  } catch {
    return [];
  }
}

/**
 * Query forgotten favorites: tracks with high playcount (> 5 default) but unplayed for N months.
 */
function queryForgottenFavorites(
  db: Database,
  filterClauses: string[],
  bindings: Record<string, unknown>,
  minPlayCount: number,
  cutoffTimestamp: number,
  limit: number,
  nowSec: number
): TrackStatsItem[] {
  const sql = `
    SELECT
      s.id,
      s.title,
      s.artist,
      s.album,
      s.year,
      s.genre,
      s.playcount,
      s.skipcount,
      s.lastplayed
    FROM songs s
    WHERE ${filterClauses.join(" AND ")}
      AND s.playcount >= $minPlayCount
      AND s.lastplayed IS NOT NULL
      AND s.lastplayed > 0
      AND s.lastplayed <= $cutoffTimestamp
    ORDER BY s.playcount DESC, s.lastplayed ASC
    LIMIT $limit;
  `;

  try {
    const rows = db.query<any, any>(sql).all({
      ...bindings,
      $minPlayCount: minPlayCount,
      $cutoffTimestamp: cutoffTimestamp,
      $limit: limit,
    });
    return rows.map((r) => formatTrackStatsRow(r, nowSec));
  } catch {
    return [];
  }
}

/**
 * Query frequently skipped tracks by skip count or skip ratio.
 */
function queryFrequentlySkipped(
  db: Database,
  filterClauses: string[],
  bindings: Record<string, unknown>,
  skipMetric: SkipMetric,
  limit: number,
  nowSec: number
): TrackStatsItem[] {
  const orderBy =
    skipMetric === "skip_ratio"
      ? "(CAST(s.skipcount AS REAL) / (s.playcount + s.skipcount)) DESC, s.skipcount DESC"
      : "s.skipcount DESC, (CAST(s.skipcount AS REAL) / (s.playcount + s.skipcount)) DESC";

  const sql = `
    SELECT
      s.id,
      s.title,
      s.artist,
      s.album,
      s.year,
      s.genre,
      s.playcount,
      s.skipcount,
      s.lastplayed
    FROM songs s
    WHERE ${filterClauses.join(" AND ")}
      AND s.skipcount > 0
    ORDER BY ${orderBy}, s.playcount ASC
    LIMIT $limit;
  `;

  try {
    const rows = db.query<any, any>(sql).all({ ...bindings, $limit: limit });
    return rows.map((r) => formatTrackStatsRow(r, nowSec));
  } catch {
    return [];
  }
}

/**
 * Query aggregate library summary stats.
 */
function queryLibrarySummary(
  db: Database,
  filterClauses: string[],
  bindings: Record<string, unknown>
): LibraryOverviewSummary {
  const sql = `
    SELECT
      COUNT(*) AS total_tracks,
      COALESCE(SUM(s.playcount), 0) AS total_plays,
      COALESCE(SUM(s.skipcount), 0) AS total_skips,
      COUNT(CASE WHEN s.playcount > 0 THEN 1 END) AS tracks_played,
      COUNT(CASE WHEN s.playcount = 0 THEN 1 END) AS tracks_unplayed
    FROM songs s
    WHERE ${filterClauses.join(" AND ")};
  `;

  try {
    const row = db.query<any, any>(sql).get(bindings);
    return {
      total_tracks: Number(row?.total_tracks ?? 0),
      total_plays: Number(row?.total_plays ?? 0),
      total_skips: Number(row?.total_skips ?? 0),
      tracks_played: Number(row?.tracks_played ?? 0),
      tracks_unplayed: Number(row?.tracks_unplayed ?? 0),
    };
  } catch {
    return {
      total_tracks: 0,
      total_plays: 0,
      total_skips: 0,
      tracks_played: 0,
      tracks_unplayed: 0,
    };
  }
}

/**
 * Retrieves listening analytics, top items, forgotten favorites, and skip insights.
 */
export function getListeningStats(
  db: Database,
  params: ListeningStatsParams = {}
): ListeningStatsResult {
  const category = params.category ?? "overview";
  const limit = Math.max(1, Math.min(100, params.limit ?? 10));
  const unplayedMonths = Math.max(1, params.unplayed_months ?? 6);
  const minPlayCount = Math.max(1, params.min_play_count ?? 5);
  const skipMetric: SkipMetric = params.skip_metric ?? "skip_count";

  const nowSec = Math.floor(Date.now() / 1000);
  // Approximate month as 30.4375 days in seconds
  const cutoffTimestamp = nowSec - Math.floor(unplayedMonths * 30.4375 * 86400);

  const { clauses, bindings } = buildSongFilterClauses(params, "s");

  if (category === "top_artists") {
    const items = queryTopArtists(db, clauses, bindings, limit);
    return {
      category: "top_artists",
      count: items.length,
      params: {
        limit,
        year_min: params.year_min,
        year_max: params.year_max,
        genre: params.genre,
        artist: params.artist,
      },
      items,
    };
  }

  if (category === "top_tracks") {
    const items = queryTopTracks(db, clauses, bindings, limit, nowSec);
    return {
      category: "top_tracks",
      count: items.length,
      params: {
        limit,
        year_min: params.year_min,
        year_max: params.year_max,
        genre: params.genre,
        artist: params.artist,
      },
      items,
    };
  }

  if (category === "forgotten_favorites") {
    const items = queryForgottenFavorites(
      db,
      clauses,
      bindings,
      minPlayCount,
      cutoffTimestamp,
      limit,
      nowSec
    );
    return {
      category: "forgotten_favorites",
      count: items.length,
      params: {
        limit,
        year_min: params.year_min,
        year_max: params.year_max,
        genre: params.genre,
        artist: params.artist,
        unplayed_months: unplayedMonths,
        min_play_count: minPlayCount,
      },
      items,
    };
  }

  if (category === "frequently_skipped") {
    const items = queryFrequentlySkipped(db, clauses, bindings, skipMetric, limit, nowSec);
    return {
      category: "frequently_skipped",
      count: items.length,
      params: {
        limit,
        year_min: params.year_min,
        year_max: params.year_max,
        genre: params.genre,
        artist: params.artist,
        skip_metric: skipMetric,
      },
      items,
    };
  }

  // Overview mode: summary with top 5 of each category
  const overviewLimit = Math.min(5, limit);
  const summary = queryLibrarySummary(db, clauses, bindings);
  const topArtists = queryTopArtists(db, clauses, bindings, overviewLimit);
  const topTracks = queryTopTracks(db, clauses, bindings, overviewLimit, nowSec);
  const forgottenFavorites = queryForgottenFavorites(
    db,
    clauses,
    bindings,
    minPlayCount,
    cutoffTimestamp,
    overviewLimit,
    nowSec
  );
  const frequentlySkipped = queryFrequentlySkipped(
    db,
    clauses,
    bindings,
    skipMetric,
    overviewLimit,
    nowSec
  );

  return {
    category: "overview",
    summary,
    top_artists: topArtists,
    top_tracks: topTracks,
    forgotten_favorites: forgottenFavorites,
    frequently_skipped: frequentlySkipped,
  };
}

/**
 * Retrieves chronological playback history rows from play_history table.
 */
export function getRecentHistory(
  db: Database,
  params: RecentHistoryParams = {}
): RecentHistoryResult {
  if (!hasTable(db, "play_history")) {
    return {
      count: 0,
      history: [],
      message: "The play_history table does not exist in this database.",
    };
  }

  const limit = Math.max(1, Math.min(100, params.limit ?? 25));
  const order = params.order === "asc" ? "ASC" : "DESC";
  const whereClauses: string[] = ["s.unavailable = 0"];
  const bindings: Record<string, unknown> = {
    $limit: limit,
  };

  const sinceTimestamp = parseTimestamp(params.since);
  if (sinceTimestamp !== undefined) {
    bindings.$since = sinceTimestamp;
    whereClauses.push("ph.played_at >= $since");
  }

  const untilTimestamp = parseTimestamp(params.until);
  if (untilTimestamp !== undefined) {
    bindings.$until = untilTimestamp;
    whereClauses.push("ph.played_at <= $until");
  }

  if (params.context_type && params.context_type.trim() !== "") {
    bindings.$contextType = params.context_type.trim();
    whereClauses.push("ph.context_type = $contextType");
  }

  if (params.playlist_id !== undefined) {
    bindings.$playlistId = params.playlist_id;
    whereClauses.push("ph.playlist_id = $playlistId");
  }

  if (params.artist && params.artist.trim() !== "") {
    bindings.$artist = `%${params.artist.trim()}%`;
    whereClauses.push("(s.artist LIKE $artist OR s.album_artist LIKE $artist)");
  }

  if (params.track_id !== undefined) {
    bindings.$trackId = params.track_id;
    whereClauses.push("ph.song_id = $trackId");
  }

  const hasDurationSecs = hasColumn(db, "play_history", "duration_secs");
  const durationSelect = hasDurationSecs ? "ph.duration_secs" : "0 AS duration_secs";

  const playlistsAvailable = hasTable(db, "playlists");
  const playlistJoin = playlistsAvailable ? "LEFT JOIN playlists p ON ph.playlist_id = p.id" : "";
  const playlistSelect = playlistsAvailable ? "p.name AS playlist_name" : "NULL AS playlist_name";

  const sql = `
    SELECT
      ph.id AS history_id,
      ph.context_type,
      ph.song_id,
      ph.playlist_id,
      ph.played_at,
      ${durationSelect},
      ${playlistSelect},
      s.title,
      s.artist,
      s.album,
      s.year,
      s.genre,
      s.length_nanosec
    FROM play_history ph
    JOIN songs s ON ph.song_id = s.id
    ${playlistJoin}
    WHERE ${whereClauses.join(" AND ")}
    ORDER BY ph.played_at ${order}, ph.id ${order}
    LIMIT $limit;
  `;

  let rows: any[] = [];
  try {
    rows = db.query<any, any>(sql).all(bindings);
  } catch (err: any) {
    return {
      count: 0,
      history: [],
      message: `Failed to query play_history: ${err.message ?? String(err)}`,
    };
  }

  const history: PlayHistoryItem[] = rows.map((r) => {
    let playedAtIso = "";
    try {
      playedAtIso = new Date(r.played_at * 1000).toISOString();
    } catch {
      playedAtIso = String(r.played_at);
    }

    const durationSec =
      r.duration_secs > 0
        ? r.duration_secs
        : r.length_nanosec != null
          ? Math.round((r.length_nanosec / 1e9) * 100) / 100
          : null;

    return {
      history_id: r.history_id,
      played_at_iso: playedAtIso,
      duration_seconds: durationSec,
      context: {
        type: r.context_type,
        playlist_id: r.playlist_id ?? null,
        playlist_name: r.playlist_name ?? null,
      },
      track: {
        id: r.song_id,
        title: r.title ?? null,
        artist: r.artist ?? null,
        album: r.album ?? null,
        year: r.year ?? null,
        genre: r.genre ?? null,
      },
    };
  });

  return {
    count: history.length,
    history,
  };
}
