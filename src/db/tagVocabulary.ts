/**
 * The artist tag vocabulary: the one place that says which tags may be written.
 *
 * Validation (`validateArtistTags`), the generated tool descriptions
 * (`describeTagPolicy`), the `get_tag_policy` tool and the `list_artist_tags`
 * report all read the same `TagVocabulary`, so prose and enforcement cannot
 * diverge. Defaults ship here; `LUMINOUS_ARTIST_TAG_VOCAB` names a JSON file
 * that replaces them.
 *
 * Tags are classified, never rewritten: existing data is only ever reported on.
 */

import fs from "node:fs";
import { z } from "zod";
import { levenshtein } from "../utils/levenshtein.ts";

export type TagCategoryKind = "allowed" | "denied";
export type TagStatus = "allowed" | "denied" | "unknown";
export type UnknownTagMode = "warn" | "reject";

/** Category id of the decade/era rule; album tags are checked against it too. */
export const DECADE_CATEGORY_ID = "decade_era";

const TagCategorySpecSchema = z.object({
  id: z.string().min(1),
  /** Human wording used in generated descriptions and error messages. */
  label: z.string().min(1),
  kind: z.enum(["allowed", "denied"]),
  /** Why the category is allowed or denied. */
  description: z.string().min(1),
  /** Exact tags (case-insensitive). */
  values: z.array(z.string().min(1)).default([]),
  /** Regular expressions (case-insensitive) matched against the whole trimmed tag. */
  patterns: z.array(z.string().min(1)).default([]),
  /** Illustrative tags for descriptions and suggestions; need not appear in `values`. */
  examples: z.array(z.string().min(1)).default([]),
});

const TagVocabularyFileSchema = z.object({
  categories: z.array(TagCategorySpecSchema).min(1),
  unknown_tags: z.enum(["warn", "reject"]).default("warn"),
});

export type TagCategorySpec = z.infer<typeof TagCategorySpecSchema>;

export interface TagVocabulary {
  categories: TagCategorySpec[];
  /** What to do with a tag no category matches. Denied tags are always rejected. */
  unknown_tags: UnknownTagMode;
  /** "built-in defaults" or the file path the vocabulary was loaded from. */
  source: string;
}

export interface TagClassification {
  status: TagStatus;
  /** Category id when status is allowed or denied. */
  category?: string;
}

const NATIONALITIES = [
  "American", "Argentine", "Argentinian", "Australian", "Austrian", "Belgian", "Brazilian",
  "British", "Canadian", "Chilean", "Chinese", "Colombian", "Cuban", "Czech", "Danish",
  "Dutch", "English", "Estonian", "Finnish", "French", "German", "Greek", "Hungarian",
  "Icelandic", "Indian", "Indonesian", "Irish", "Israeli", "Italian", "Jamaican", "Japanese",
  "Korean", "Mexican", "New Zealander", "Nigerian", "Norwegian", "Polish", "Portuguese",
  "Puerto Rican", "Romanian", "Russian", "Scottish", "South African", "South Korean",
  "Spanish", "Swedish", "Swiss", "Turkish", "Ukrainian", "Welsh",
];

const GENRES = [
  "Alternative", "Ambient", "Blues", "Classical", "Country", "Dance", "Electronic", "Folk",
  "Funk", "Gospel", "Hip Hop", "Hip-Hop", "House", "Indie", "Jazz", "Latin", "Metal", "Pop",
  "Punk", "R&B", "Rap", "Reggae", "Rock", "Singer-Songwriter", "Soul", "Techno",
];

/** Built-in vocabulary: nationality and named awards allowed; genre and decade/era denied. */
export function defaultTagVocabulary(): TagVocabulary {
  return {
    unknown_tags: "warn",
    source: "built-in defaults",
    categories: [
      {
        id: "nationality",
        label: "nationality",
        kind: "allowed",
        description: "Where the artist is from, as a demonym.",
        values: NATIONALITIES,
        patterns: [],
        examples: ["Canadian", "British", "Japanese"],
      },
      {
        id: "named_award",
        label: "named award",
        kind: "allowed",
        description: "A specific named award or honor the artist has received.",
        values: [],
        patterns: ["^.+\\s(awards?|prizes?)$", "^.*hall of fame$"],
        examples: ["Grammy Award", "Juno Award", "Polaris Music Prize"],
      },
      {
        id: DECADE_CATEGORY_ID,
        label: "decade/era",
        kind: "denied",
        description: "Era active is derivable from the library's own release data, not a curated fact.",
        values: ["twenties", "thirties", "forties", "fifties", "sixties", "seventies", "eighties", "nineties"],
        patterns: ["^['‘’]?\\d{1,3}0s$"],
        examples: ["80s", "1980s", "eighties"],
      },
      {
        id: "genre",
        label: "genre/style",
        kind: "denied",
        description: "Genres and styles are tracked through Luminous's tag groups and track metadata.",
        values: GENRES,
        patterns: [],
        examples: ["Rock", "Singer-Songwriter", "Hip Hop"],
      },
    ],
  };
}

interface CompiledCategory {
  spec: TagCategorySpec;
  values: Set<string>;
  regexes: RegExp[];
}

const compiledCache = new WeakMap<TagVocabulary, CompiledCategory[]>();

function compile(vocab: TagVocabulary): CompiledCategory[] {
  let compiled = compiledCache.get(vocab);
  if (!compiled) {
    compiled = vocab.categories.map((spec) => ({
      spec,
      values: new Set(spec.values.map((v) => v.toLowerCase())),
      regexes: spec.patterns.map((p) => new RegExp(p, "i")),
    }));
    compiledCache.set(vocab, compiled);
  }
  return compiled;
}

/** Adds the source and rejects bad regexes and duplicate ids at load time, naming the culprit. */
function buildVocabulary(
  parsed: z.infer<typeof TagVocabularyFileSchema>,
  source: string
): TagVocabulary {
  const vocab: TagVocabulary = { ...parsed, source };
  for (const cat of vocab.categories) {
    for (const pattern of cat.patterns) {
      try {
        new RegExp(pattern, "i");
      } catch (err: any) {
        throw new Error(
          `Invalid pattern "${pattern}" in tag category "${cat.id}" (${source}): ${err.message}`
        );
      }
    }
  }
  const ids = vocab.categories.map((c) => c.id);
  const duplicate = ids.find((id, i) => ids.indexOf(id) !== i);
  if (duplicate) {
    throw new Error(`Duplicate tag category id "${duplicate}" in ${source}.`);
  }
  return vocab;
}

/**
 * The vocabulary for this process: the JSON file named by
 * `LUMINOUS_ARTIST_TAG_VOCAB` (replacing the defaults entirely), else the
 * defaults. A missing or invalid file throws so a misconfigured server fails
 * at startup instead of silently enforcing something else.
 */
export function loadTagVocabulary(env: NodeJS.ProcessEnv = process.env): TagVocabulary {
  const file = env.LUMINOUS_ARTIST_TAG_VOCAB?.trim();
  if (!file) return defaultTagVocabulary();

  let raw: string;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch (err: any) {
    throw new Error(`Cannot read LUMINOUS_ARTIST_TAG_VOCAB file "${file}": ${err.message}`);
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (err: any) {
    throw new Error(`LUMINOUS_ARTIST_TAG_VOCAB file "${file}" is not valid JSON: ${err.message}`);
  }
  const parsed = TagVocabularyFileSchema.safeParse(json);
  if (!parsed.success) {
    throw new Error(
      `LUMINOUS_ARTIST_TAG_VOCAB file "${file}" is invalid: ${parsed.error.issues
        .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
        .join("; ")}`
    );
  }
  return buildVocabulary(parsed.data, file);
}

let activeVocabulary: TagVocabulary | null = null;

/** The vocabulary in force; defaults until the server installs one at startup. */
export function getTagVocabulary(): TagVocabulary {
  activeVocabulary ??= defaultTagVocabulary();
  return activeVocabulary;
}

/** Installs the vocabulary in force; null restores the defaults. */
export function setTagVocabulary(vocab: TagVocabulary | null): void {
  activeVocabulary = vocab;
}

/** Classifies one tag. Denied categories win over allowed ones; first match in order. */
export function classifyTag(vocab: TagVocabulary, tag: string): TagClassification {
  const normalized = tag.trim().toLowerCase();
  const matches = (kind: TagCategoryKind): TagClassification | undefined => {
    for (const cat of compile(vocab)) {
      if (cat.spec.kind !== kind) continue;
      if (cat.values.has(normalized) || cat.regexes.some((re) => re.test(tag.trim()))) {
        return { status: kind, category: cat.spec.id };
      }
    }
    return undefined;
  };
  return matches("denied") ?? matches("allowed") ?? { status: "unknown" };
}

/** Up to `limit` allowed tags closest to `tag`, best first (substring, then small edit distance). */
export function suggestTags(vocab: TagVocabulary, tag: string, limit = 3): string[] {
  const q = tag.trim().toLowerCase();
  if (!q) return [];
  const maxDistance = Math.max(2, Math.floor(q.length * 0.4));
  const candidates = new Set<string>();
  for (const cat of vocab.categories) {
    if (cat.kind !== "allowed") continue;
    for (const t of [...cat.values, ...cat.examples]) candidates.add(t);
  }
  const ranked: Array<{ tag: string; tier: number; distance: number }> = [];
  for (const candidate of candidates) {
    const c = candidate.toLowerCase();
    if (c === q) continue;
    const distance = levenshtein(q, c);
    const contains = q.length >= 3 && (c.includes(q) || q.includes(c));
    if (contains) ranked.push({ tag: candidate, tier: 0, distance });
    else if (distance <= maxDistance) ranked.push({ tag: candidate, tier: 1, distance });
  }
  ranked.sort((a, b) => a.tier - b.tier || a.distance - b.distance || a.tag.localeCompare(b.tag));
  return ranked.slice(0, limit).map((r) => r.tag);
}

function categoryLabel(vocab: TagVocabulary, id: string | undefined): string {
  return vocab.categories.find((c) => c.id === id)?.label ?? id ?? "unknown";
}

function allowedSummary(vocab: TagVocabulary): string {
  return vocab.categories
    .filter((c) => c.kind === "allowed")
    .map((c) => (c.examples.length > 0 ? `${c.label} (e.g. ${c.examples.map((e) => `'${e}'`).join(", ")})` : c.label))
    .join(" and ");
}

/**
 * The tag-writing rules as prose for tool descriptions, generated from the
 * vocabulary so the text always matches what `validateArtistTags` enforces.
 */
export function describeTagPolicy(vocab: TagVocabulary): string {
  const allowed = allowedSummary(vocab);
  const denied = vocab.categories
    .filter((c) => c.kind === "denied")
    .map((c) => (c.examples.length > 0 ? `${c.label} tags (e.g. ${c.examples.map((e) => `'${e}'`).join(", ")})` : `${c.label} tags`))
    .join(" or ");
  const unknown =
    vocab.unknown_tags === "reject"
      ? "Tags outside these categories are rejected."
      : "Tags outside these categories are accepted with a warning.";
  return (
    `Curated artist-attribute tags only: ${allowed}. ` +
    (denied ? `Never ${denied}; they are rejected. ` : "") +
    `${unknown} Call get_tag_policy for the full vocabulary.`
  );
}

/**
 * Checks tags about to be written to an artist profile. Throws one error
 * listing every denied tag (and unknown ones when the vocabulary rejects them),
 * each with its category and the nearest allowed tags. Returns warnings for
 * unknown tags otherwise.
 */
export function validateArtistTags(vocab: TagVocabulary, tags: string[] | undefined): string[] {
  if (!tags) return [];
  const problems: string[] = [];
  const warnings: string[] = [];
  const seen = new Set<string>();
  for (const raw of tags) {
    const key = raw.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);

    const { status, category } = classifyTag(vocab, raw);
    if (status === "allowed") continue;
    const suggestions = suggestTags(vocab, raw);
    const hint = suggestions.length > 0 ? ` Did you mean: ${suggestions.map((s) => `"${s}"`).join(", ")}?` : "";
    if (status === "denied") {
      problems.push(`"${raw}" is a ${categoryLabel(vocab, category)} tag, which is not allowed.${hint}`);
    } else if (vocab.unknown_tags === "reject") {
      problems.push(`"${raw}" is not in the tag vocabulary.${hint}`);
    } else {
      warnings.push(`Tag "${raw}" is not in the tag vocabulary (${allowedSummary(vocab)}).${hint}`);
    }
  }
  if (problems.length > 0) {
    throw new Error(
      `Artist tags rejected: ${problems.join(" ")} Allowed: ${allowedSummary(vocab)}. Call get_tag_policy for the full vocabulary.`
    );
  }
  return warnings;
}

/** Throws if any tag falls in the decade/era category (the rule album tags share with artists). */
export function assertNoDecadeTags(vocab: TagVocabulary, tags: string[] | undefined): void {
  const bad = (tags ?? []).filter((t) => classifyTag(vocab, t).category === DECADE_CATEGORY_ID);
  if (bad.length > 0) {
    throw new Error(
      `Decade/era tags are not allowed (found: ${bad.join(", ")}). Era active can be derived from library data.`
    );
  }
}
