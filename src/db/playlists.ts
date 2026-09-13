import type { Database } from "bun:sqlite";

/**
 * Reserved playlist names in Luminous Music Player.
 * Matches RESERVED_PLAYLIST_NAMES in Luminous desktop source.
 */
export const RESERVED_PLAYLIST_NAMES = [
  "queue",
  "file d'attente",
];

/**
 * Checks if a playlist name is reserved (e.g. built-in player Queue).
 */
export function isReservedPlaylistName(name: string): boolean {
  const trimmed = name.trim().toLowerCase();
  return RESERVED_PLAYLIST_NAMES.includes(trimmed);
}

export interface PlaylistSummary {
  id: number;
  name: string;
  is_dynamic: boolean;
  dynamic_spec: string | null;
  track_count: number;
  created_timestamp: number | null;
  created_at: string | null;
  updated_timestamp: number | null;
  updated_at: string | null;
}

export interface ListPlaylistsParams {
  query?: string;
  include_dynamic?: boolean;
}

export interface GetPlaylistTracksParams {
  playlist_id?: number;
  playlist_name?: string;
  limit?: number;
  offset?: number;
}

export interface PlaylistItemTrack {
  item_id: number;
  position: number;
  uuid: string;
  track_id: number | null;
  type: number;
  title: string | null;
  artist: string | null;
  album: string | null;
  album_artist: string | null;
  year: number | null;
  genre: string | null;
  duration_seconds: number | null;
  path: string | null;
  play_count: number;
  skip_count: number;
  unavailable: boolean;
}

export interface PlaylistWithTracks {
  playlist: PlaylistSummary;
  total_tracks: number;
  limit: number;
  offset: number;
  tracks: PlaylistItemTrack[];
}

export interface CreatePlaylistParams {
  name: string;
  track_ids?: number[];
}

export interface CreatePlaylistResult {
  playlist_id: number;
  name: string;
  tracks_added: number;
  track_ids: number[];
  created_at: string;
}

export interface AddTracksParams {
  playlist_id?: number;
  playlist_name?: string;
  track_ids: number[];
}

export interface AddTracksResult {
  playlist_id: number;
  playlist_name: string;
  tracks_added: number;
  total_tracks: number;
  track_ids: number[];
}

function hasTable(db: Database, tableName: string): boolean {
  try {
    const row = db
      .query<{ count: number }, [string]>(
        "SELECT COUNT(*) as count FROM sqlite_master WHERE type='table' AND name=?1"
      )
      .get(tableName);
    return (row?.count ?? 0) > 0;
  } catch {
    return false;
  }
}

function toIsoString(timestampSeconds: number | null | undefined): string | null {
  if (timestampSeconds === null || timestampSeconds === undefined || timestampSeconds <= 0) {
    return null;
  }
  try {
    return new Date(timestampSeconds * 1000).toISOString();
  } catch {
    return null;
  }
}

/**
 * Retrieves all user playlists and dynamic/smart playlists from the database.
 */
export function listPlaylists(
  db: Database,
  params: ListPlaylistsParams = {}
): PlaylistSummary[] {
  if (!hasTable(db, "playlists")) {
    return [];
  }

  const itemsAvailable = hasTable(db, "playlist_items");
  const countSelect = itemsAvailable
    ? "(SELECT COUNT(*) FROM playlist_items pi WHERE pi.playlist_id = p.id) AS track_count"
    : "0 AS track_count";

  const conditions: string[] = [];
  const bindings: Record<string, string | number> = {};

  if (params.include_dynamic === false) {
    conditions.push("p.dynamic_enabled = 0");
  }

  if (params.query && params.query.trim() !== "") {
    conditions.push("LOWER(p.name) LIKE $query");
    bindings.$query = `%${params.query.trim().toLowerCase()}%`;
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const query = `
    SELECT
      p.id,
      p.name,
      p.dynamic_enabled,
      p.dynamic_spec,
      p.created,
      p.updated,
      ${countSelect}
    FROM playlists p
    ${whereClause}
    ORDER BY p.created ASC, p.id ASC
  `;

  interface Row {
    id: number;
    name: string;
    dynamic_enabled: number;
    dynamic_spec: string | null;
    created: number | null;
    updated: number | null;
    track_count: number;
  }

  const rows = db.query<Row, Record<string, string | number>>(query).all(bindings);

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    is_dynamic: Boolean(r.dynamic_enabled),
    dynamic_spec: r.dynamic_spec ?? null,
    track_count: r.track_count ?? 0,
    created_timestamp: r.created ?? null,
    created_at: toIsoString(r.created),
    updated_timestamp: r.updated ?? null,
    updated_at: toIsoString(r.updated),
  }));
}

/**
 * Retrieves ordered tracks belonging to a playlist by ID or name.
 */
export function getPlaylistTracks(
  db: Database,
  params: GetPlaylistTracksParams
): PlaylistWithTracks {
  if (!hasTable(db, "playlists")) {
    throw new Error("Playlists table not found in database.");
  }

  if (params.playlist_id === undefined && (!params.playlist_name || params.playlist_name.trim() === "")) {
    throw new Error("Either playlist_id or playlist_name must be provided.");
  }

  interface PlaylistRow {
    id: number;
    name: string;
    dynamic_enabled: number;
    dynamic_spec: string | null;
    created: number | null;
    updated: number | null;
  }

  let playlistRow: PlaylistRow | null = null;

  if (params.playlist_id !== undefined) {
    playlistRow = db
      .query<PlaylistRow, [number]>("SELECT id, name, dynamic_enabled, dynamic_spec, created, updated FROM playlists WHERE id = ?1")
      .get(params.playlist_id);
    if (!playlistRow) {
      throw new Error(`Playlist with ID ${params.playlist_id} not found.`);
    }
  } else {
    const trimmedName = params.playlist_name!.trim();
    playlistRow = db
      .query<PlaylistRow, [string]>(
        "SELECT id, name, dynamic_enabled, dynamic_spec, created, updated FROM playlists WHERE LOWER(TRIM(name)) = LOWER(TRIM(?1)) ORDER BY id ASC LIMIT 1"
      )
      .get(trimmedName);
    if (!playlistRow) {
      throw new Error(`Playlist with name "${trimmedName}" not found.`);
    }
  }

  const itemsAvailable = hasTable(db, "playlist_items");
  if (!itemsAvailable) {
    const summary: PlaylistSummary = {
      id: playlistRow.id,
      name: playlistRow.name,
      is_dynamic: Boolean(playlistRow.dynamic_enabled),
      dynamic_spec: playlistRow.dynamic_spec ?? null,
      track_count: 0,
      created_timestamp: playlistRow.created ?? null,
      created_at: toIsoString(playlistRow.created),
      updated_timestamp: playlistRow.updated ?? null,
      updated_at: toIsoString(playlistRow.updated),
    };
    return {
      playlist: summary,
      total_tracks: 0,
      limit: params.limit ?? 100,
      offset: params.offset ?? 0,
      tracks: [],
    };
  }

  const countRow = db
    .query<{ count: number }, [number]>("SELECT COUNT(*) as count FROM playlist_items WHERE playlist_id = ?1")
    .get(playlistRow.id);
  const totalTracks = countRow?.count ?? 0;

  const limit = Math.min(Math.max(params.limit ?? 100, 1), 1000);
  const offset = Math.max(params.offset ?? 0, 0);

  const songsAvailable = hasTable(db, "songs");

  let trackRows: any[] = [];
  if (songsAvailable) {
    const sql = `
      SELECT
        pi.id AS item_id,
        pi.position,
        pi.uuid,
        pi.song_id,
        pi.type,
        s.title,
        s.artist,
        s.album,
        s.album_artist,
        s.year,
        s.genre,
        s.length_nanosec,
        s.path,
        s.playcount,
        s.skipcount,
        s.unavailable
      FROM playlist_items pi
      LEFT JOIN songs s ON s.id = pi.song_id
      WHERE pi.playlist_id = $playlistId
      ORDER BY pi.position ASC
      LIMIT $limit OFFSET $offset
    `;
    trackRows = db.query<any, { $playlistId: number; $limit: number; $offset: number }>(sql).all({
      $playlistId: playlistRow.id,
      $limit: limit,
      $offset: offset,
    });
  } else {
    const sql = `
      SELECT
        pi.id AS item_id,
        pi.position,
        pi.uuid,
        pi.song_id,
        pi.type,
        NULL AS title,
        NULL AS artist,
        NULL AS album,
        NULL AS album_artist,
        NULL AS year,
        NULL AS genre,
        NULL AS length_nanosec,
        NULL AS path,
        0 AS playcount,
        0 AS skipcount,
        0 AS unavailable
      FROM playlist_items pi
      WHERE pi.playlist_id = $playlistId
      ORDER BY pi.position ASC
      LIMIT $limit OFFSET $offset
    `;
    trackRows = db.query<any, { $playlistId: number; $limit: number; $offset: number }>(sql).all({
      $playlistId: playlistRow.id,
      $limit: limit,
      $offset: offset,
    });
  }

  const tracks: PlaylistItemTrack[] = trackRows.map((r) => ({
    item_id: r.item_id,
    position: r.position,
    uuid: r.uuid,
    track_id: r.song_id ?? null,
    type: r.type ?? 0,
    title: r.title ?? null,
    artist: r.artist ?? null,
    album: r.album ?? null,
    album_artist: r.album_artist ?? null,
    year: r.year ?? null,
    genre: r.genre ?? null,
    duration_seconds:
      typeof r.length_nanosec === "number" && r.length_nanosec > 0
        ? Math.round(r.length_nanosec / 1_000_000_000)
        : null,
    path: r.path ?? null,
    play_count: r.playcount ?? 0,
    skip_count: r.skipcount ?? 0,
    unavailable: Boolean(r.unavailable),
  }));

  const summary: PlaylistSummary = {
    id: playlistRow.id,
    name: playlistRow.name,
    is_dynamic: Boolean(playlistRow.dynamic_enabled),
    dynamic_spec: playlistRow.dynamic_spec ?? null,
    track_count: totalTracks,
    created_timestamp: playlistRow.created ?? null,
    created_at: toIsoString(playlistRow.created),
    updated_timestamp: playlistRow.updated ?? null,
    updated_at: toIsoString(playlistRow.updated),
  };

  return {
    playlist: summary,
    total_tracks: totalTracks,
    limit,
    offset,
    tracks,
  };
}

/**
 * Creates a new playlist row in playlists and optional initial tracks in playlist_items.
 */
export function createPlaylist(
  db: Database,
  params: CreatePlaylistParams
): CreatePlaylistResult {
  if (!hasTable(db, "playlists")) {
    throw new Error("Playlists table not found in database.");
  }

  const name = params.name?.trim();
  if (!name) {
    throw new Error("Playlist name cannot be empty.");
  }

  if (isReservedPlaylistName(name)) {
    throw new Error(`"${name}" is reserved for the app's built-in Queue playlist.`);
  }

  const trackIds = params.track_ids ?? [];

  // Validate track IDs if songs table exists and track IDs are provided
  if (trackIds.length > 0 && hasTable(db, "songs")) {
    const placeholders = trackIds.map(() => "?").join(",");
    const existing = db
      .query<{ id: number }, number[]>(`SELECT id FROM songs WHERE id IN (${placeholders})`)
      .all(...trackIds);
    const existingSet = new Set(existing.map((e) => e.id));
    const missing = trackIds.filter((id) => !existingSet.has(id));
    if (missing.length > 0) {
      throw new Error(`The following track IDs were not found in the music library: ${missing.join(", ")}.`);
    }
  }

  const now = Math.floor(Date.now() / 1000);

  const tx = db.transaction(() => {
    const insertPlaylist = db.prepare(
      "INSERT INTO playlists (name, dynamic_enabled, created, updated) VALUES ($name, 0, $created, $updated)"
    );
    insertPlaylist.run({
      $name: name,
      $created: now,
      $updated: now,
    });

    const row = db.query<{ id: number }, []>("SELECT last_insert_rowid() AS id").get();
    const playlistId = row!.id;

    if (trackIds.length > 0 && hasTable(db, "playlist_items")) {
      const insertItem = db.prepare(
        "INSERT INTO playlist_items (playlist_id, song_id, position, uuid, type) VALUES ($playlistId, $songId, $pos, $uuid, 0)"
      );

      for (let i = 0; i < trackIds.length; i++) {
        insertItem.run({
          $playlistId: playlistId,
          $songId: trackIds[i],
          $pos: i,
          $uuid: crypto.randomUUID(),
        });
      }
    }

    return playlistId;
  });

  const playlistId = tx();

  return {
    playlist_id: playlistId,
    name,
    tracks_added: trackIds.length,
    track_ids: trackIds,
    created_at: new Date(now * 1000).toISOString(),
  };
}

/**
 * Appends track IDs to an existing playlist, maintaining position indexes and UUID generation.
 */
export function addTracksToPlaylist(
  db: Database,
  params: AddTracksParams
): AddTracksResult {
  if (!hasTable(db, "playlists")) {
    throw new Error("Playlists table not found in database.");
  }

  if (params.playlist_id === undefined && (!params.playlist_name || params.playlist_name.trim() === "")) {
    throw new Error("Either playlist_id or playlist_name must be provided.");
  }

  const trackIds = params.track_ids;
  if (!Array.isArray(trackIds) || trackIds.length === 0) {
    throw new Error("track_ids must be a non-empty array of song IDs.");
  }

  interface PlaylistRow {
    id: number;
    name: string;
    dynamic_enabled: number;
  }

  let playlistRow: PlaylistRow | null = null;

  if (params.playlist_id !== undefined) {
    playlistRow = db
      .query<PlaylistRow, [number]>("SELECT id, name, dynamic_enabled FROM playlists WHERE id = ?1")
      .get(params.playlist_id);
    if (!playlistRow) {
      throw new Error(`Playlist with ID ${params.playlist_id} not found.`);
    }
  } else {
    const trimmedName = params.playlist_name!.trim();
    playlistRow = db
      .query<PlaylistRow, [string]>(
        "SELECT id, name, dynamic_enabled FROM playlists WHERE LOWER(TRIM(name)) = LOWER(TRIM(?1)) ORDER BY id ASC LIMIT 1"
      )
      .get(trimmedName);
    if (!playlistRow) {
      throw new Error(`Playlist with name "${trimmedName}" not found.`);
    }
  }

  if (Boolean(playlistRow.dynamic_enabled)) {
    throw new Error(
      `Cannot manually add tracks to dynamic/smart playlist "${playlistRow.name}". Dynamic playlists are automatically populated by rules.`
    );
  }

  if (hasTable(db, "songs")) {
    const placeholders = trackIds.map(() => "?").join(",");
    const existing = db
      .query<{ id: number }, number[]>(`SELECT id FROM songs WHERE id IN (${placeholders})`)
      .all(...trackIds);
    const existingSet = new Set(existing.map((e) => e.id));
    const missing = trackIds.filter((id) => !existingSet.has(id));
    if (missing.length > 0) {
      throw new Error(`The following track IDs were not found in the music library: ${missing.join(", ")}.`);
    }
  }

  const now = Math.floor(Date.now() / 1000);

  const tx = db.transaction(() => {
    let startPos = 0;
    if (hasTable(db, "playlist_items")) {
      const maxRow = db
        .query<{ max_pos: number | null }, [number]>(
          "SELECT MAX(position) as max_pos FROM playlist_items WHERE playlist_id = ?1"
        )
        .get(playlistRow!.id);
      if (maxRow?.max_pos !== null && maxRow?.max_pos !== undefined) {
        startPos = maxRow.max_pos + 1;
      }

      const insertItem = db.prepare(
        "INSERT INTO playlist_items (playlist_id, song_id, position, uuid, type) VALUES ($playlistId, $songId, $pos, $uuid, 0)"
      );

      for (let i = 0; i < trackIds.length; i++) {
        insertItem.run({
          $playlistId: playlistRow!.id,
          $songId: trackIds[i],
          $pos: startPos + i,
          $uuid: crypto.randomUUID(),
        });
      }
    }

    db.prepare("UPDATE playlists SET updated = $updated WHERE id = $id").run({
      $updated: now,
      $id: playlistRow!.id,
    });
  });

  tx();

  let totalTracks = 0;
  if (hasTable(db, "playlist_items")) {
    const countRow = db
      .query<{ count: number }, [number]>("SELECT COUNT(*) as count FROM playlist_items WHERE playlist_id = ?1")
      .get(playlistRow.id);
    totalTracks = countRow?.count ?? 0;
  }

  return {
    playlist_id: playlistRow.id,
    playlist_name: playlistRow.name,
    tracks_added: trackIds.length,
    total_tracks: totalTracks,
    track_ids: trackIds,
  };
}
