/**
 * Country knowledge for artist profiles.
 *
 * Luminous stores `artist_profiles.country` as an uppercase ISO 3166-1 alpha-2
 * code or NULL, never a name, city or state. Everything that validates or
 * displays that value goes through this module.
 */

const regionNames = new Intl.DisplayNames(["en"], { type: "region", fallback: "none" });

/** ZZ is the reserved "unknown region" code: Intl names it rather than rejecting it. */
const UNKNOWN_REGION_NAME = regionNames.of("ZZ");

/** Display name for an alpha-2 code ("CA" -> "Canada"), or undefined if the code is not a region. */
export function countryDisplayName(code: string | null | undefined): string | undefined {
  if (!code) return undefined;
  try {
    const name = regionNames.of(code.toUpperCase());
    return name === UNKNOWN_REGION_NAME ? undefined : (name ?? undefined);
  } catch {
    return undefined;
  }
}

/** The pair of fields every response shows for a stored country code. */
export interface CountryFields {
  /** ISO 3166-1 alpha-2 code; absent when no country is stored. */
  country?: string;
  /** English display name for `country`. */
  country_name?: string;
}

/** Response fields for a stored (possibly NULL or empty) country code. */
export function countryFields(storedCode: string | null | undefined): CountryFields {
  if (!storedCode) return {};
  return { country: storedCode, country_name: countryDisplayName(storedCode) };
}

/**
 * Validates `input` as an alpha-2 country code and returns it uppercased.
 * Throws for anything else (country names, three-letter codes, unassigned codes).
 */
export function normalizeCountryCode(input: string): string {
  const code = input.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(code) || countryDisplayName(code) === undefined) {
    throw new Error(
      `country must be an ISO 3166-1 alpha-2 code such as "CA" or "US" (got "${input}"). ` +
        `Names, cities and three-letter codes are not accepted.`
    );
  }
  return code;
}
