/**
 * Album identity (esoltys/luminous#1752, esoltys/luminous#1761):
 * Two album titles represent the same album when their keys are equal.
 * Mirrors Luminous core's `album_key` (`src-tauri/src/album_key.rs`),
 * which groups the album grid and keys ratings, profiles, and charts.
 *
 * Rules:
 * - Trims leading and trailing whitespace.
 * - Converts to Unicode lowercase.
 * - Empty string or whitespace-only folds to `""`.
 */
export function albumKey(album: string | null | undefined): string {
  return (album ?? "").trim().toLowerCase();
}

/**
 * Whether two album titles name the same album under the folded identity rule.
 */
export function sameAlbum(
  a: string | null | undefined,
  b: string | null | undefined
): boolean {
  return albumKey(a) === albumKey(b);
}
