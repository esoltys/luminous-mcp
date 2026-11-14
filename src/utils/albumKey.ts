/**
 * Album identity (esoltys/luminous#1752, esoltys/luminous#1932):
 * Two tracks or album references represent the same album release when their
 * composite keys are equal. Mirrors Luminous core's `album_key`
 * (`src-tauri/src/album_key.rs` and `src/lib/utils/albumKey.ts`).
 *
 * Rules:
 * - Trims leading and trailing whitespace and converts to Unicode lowercase.
 * - Blank or whitespace-only album title folds to `""`.
 * - For compilation releases (`isCompilation` or Various Artists), artist key is `"[va]"`.
 * - For single-artist releases, artist key is `{folded_artist}` (preferring `album_artist` over `artist`).
 * - Composite key format: `"{artist_key}\u{1f}{folded_album}"`.
 * - When no artist and not a compilation, falls back to bare `"{folded_album}"`.
 */

export const ALBUM_KEY_SEPARATOR = "\u{1f}";
export const COMPILATION_ARTIST_KEY = "[va]";

function foldKey(s: string | null | undefined): string {
  return (s ?? "").trim().toLowerCase();
}

/**
 * Returns true if the artist string represents "Various Artists" or standard variants.
 */
export function isVariousArtists(artist: string | null | undefined): boolean {
  const folded = foldKey(artist);
  return (
    folded === "various artists" ||
    folded === "various" ||
    folded === "v/a" ||
    folded === "va" ||
    folded === "v.a." ||
    folded === "v. a." ||
    folded === "[va]"
  );
}

/**
 * Computes the folded (and optionally composite) identity key for an album.
 * If `album` already contains the composite separator `\u{1f}`, returns it folded as-is.
 */
export function albumKey(
  album: string | null | undefined,
  artist?: string | null | undefined,
  isCompilation = false
): string {
  const foldedAlbum = foldKey(album);
  if (!foldedAlbum) return "";

  if (foldedAlbum.includes(ALBUM_KEY_SEPARATOR)) {
    return foldedAlbum;
  }

  const trimmedArtist = (artist ?? "").trim();
  if (!trimmedArtist && !isCompilation) {
    return foldedAlbum;
  }

  const artistKey =
    isCompilation || isVariousArtists(trimmedArtist)
      ? COMPILATION_ARTIST_KEY
      : foldKey(trimmedArtist);

  return `${artistKey}${ALBUM_KEY_SEPARATOR}${foldedAlbum}`;
}

/**
 * Computes the composite album key for a track row, preferring `album_artist`
 * over track `artist` (matching Rust `album_key::album_key_for`).
 */
export function albumKeyForTrack(
  album: string | null | undefined,
  albumArtist: string | null | undefined,
  artist: string | null | undefined,
  isCompilation = false
): string {
  const effectiveArtist =
    (albumArtist ?? "").trim() !== ""
      ? albumArtist
      : (artist ?? "").trim() !== ""
        ? artist
        : null;
  return albumKey(album, effectiveArtist, isCompilation);
}

/**
 * Returns true if `key` is already a composite `{artist}\u{1f}{album}` key.
 */
export function isCompositeAlbumKey(key: string): boolean {
  return key.includes(ALBUM_KEY_SEPARATOR);
}

/**
 * Extracts the folded album title portion from a composite key or bare title.
 */
export function extractAlbumTitle(keyOrTitle: string | null | undefined): string {
  const s = foldKey(keyOrTitle);
  const sepIdx = s.indexOf(ALBUM_KEY_SEPARATOR);
  return sepIdx >= 0 ? s.slice(sepIdx + 1) : s;
}

/**
 * Extracts the folded artist key portion from a composite key, or `null` if bare.
 */
export function extractAlbumArtist(keyOrTitle: string | null | undefined): string | null {
  const s = foldKey(keyOrTitle);
  const sepIdx = s.indexOf(ALBUM_KEY_SEPARATOR);
  return sepIdx >= 0 ? s.slice(0, sepIdx) : null;
}

/**
 * Whether two album titles or composite keys name the same album.
 * If both carry an artist portion, both artist and title must match;
 * otherwise compares the folded album title portions.
 */
export function sameAlbum(
  a: string | null | undefined,
  b: string | null | undefined
): boolean {
  if (!a || !b) return false;
  const keyA = albumKey(a);
  const keyB = albumKey(b);
  if (keyA === keyB) return true;

  const artA = extractAlbumArtist(keyA);
  const artB = extractAlbumArtist(keyB);
  if (artA !== null && artB !== null) {
    return artA === artB && extractAlbumTitle(keyA) === extractAlbumTitle(keyB);
  }
  return extractAlbumTitle(keyA) === extractAlbumTitle(keyB);
}
