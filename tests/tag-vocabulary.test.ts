import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { listArtistTags, parseTagList } from "../src/db/artistTags.ts";
import { updateAlbumProfile, updateArtistProfile, updateArtistProfiles } from "../src/db/curation.ts";
import {
  classifyTag,
  defaultTagVocabulary,
  describeTagPolicy,
  loadTagVocabulary,
  setTagVocabulary,
  suggestTags,
  type TagStatus,
  validateArtistTags,
  type TagVocabulary,
} from "../src/db/tagVocabulary.ts";
import { createMcpServer } from "../src/server.ts";

let tmpDir: string;
let db: Database;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "luminous-tagvocab-"));
  setTagVocabulary(null);
});

afterEach(() => {
  setTagVocabulary(null);
  db?.close();
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // best-effort on Windows
  }
});

function openDb(): Database {
  const handle = new Database(path.join(tmpDir, "luminous.db"));
  handle.run(
    `CREATE TABLE songs (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, artist TEXT, album_artist TEXT,
       album TEXT, path TEXT, musicbrainz_artist_id TEXT)`
  );
  handle.run(
    `CREATE TABLE artist_profiles (artist_key TEXT PRIMARY KEY COLLATE NOCASE, website TEXT,
       tags TEXT NOT NULL DEFAULT '[]', social_links TEXT NOT NULL DEFAULT '[]', bio TEXT)`
  );
  handle.run(
    `INSERT INTO songs (title, artist, album_artist, album, path) VALUES
       ('a', 'Drake', 'Drake', 'Views', '/1'), ('b', 'Abba', 'Abba', 'Gold', '/2'),
       ('c', 'Rush', 'Rush', 'Moving Pictures', '/3'), ('d', 'Bjork', 'Bjork', 'Debut', '/4')`
  );
  return handle;
}

function seedTags(handle: Database, rows: Record<string, unknown>): void {
  for (const [artist, tags] of Object.entries(rows)) {
    handle.run("INSERT INTO artist_profiles (artist_key, tags) VALUES (?1, ?2)", [
      artist,
      typeof tags === "string" ? tags : JSON.stringify(tags),
    ]);
  }
}

function writeVocabFile(content: unknown): string {
  const file = path.join(tmpDir, "vocab.json");
  fs.writeFileSync(file, typeof content === "string" ? content : JSON.stringify(content));
  return file;
}

const CUSTOM: unknown = {
  unknown_tags: "reject",
  categories: [
    { id: "label", label: "record label", kind: "allowed", description: "Label", values: ["Sub Pop"], examples: ["Sub Pop"] },
    { id: "mood", label: "mood", kind: "denied", description: "Moods are subjective", values: ["Sad"], examples: ["Sad"] },
  ],
};

describe("classifyTag with the built-in vocabulary", () => {
  const vocab = defaultTagVocabulary();

  it.each([
    ["Canadian", "allowed", "nationality"],
    ["  british ", "allowed", "nationality"],
    ["Grammy Award", "allowed", "named_award"],
    ["Polaris Music Prize", "allowed", "named_award"],
    ["Rock and Roll Hall of Fame", "allowed", "named_award"],
    ["Rock", "denied", "genre"],
    ["Singer-Songwriter", "denied", "genre"],
    ["80s", "denied", "decade_era"],
    ["'80s", "denied", "decade_era"],
    ["1980s", "denied", "decade_era"],
    ["Eighties", "denied", "decade_era"],
    ["Award-Winning", "unknown", undefined],
  ])("%p is %s", (tag, status, category) => {
    expect(classifyTag(vocab, tag)).toEqual(category ? { status: status as TagStatus, category } : { status: status as TagStatus });
  });

  it("suggests the nearest allowed tags", () => {
    expect(suggestTags(vocab, "Canadien")).toContain("Canadian");
    expect(suggestTags(vocab, "Grammy")).toContain("Grammy Award");
    expect(suggestTags(vocab, "zzzzzzzz")).toEqual([]);
  });
});

describe("validateArtistTags", () => {
  const vocab = defaultTagVocabulary();

  it("rejects every denied example and accepts every allowed example in the vocabulary", () => {
    for (const cat of vocab.categories) {
      for (const example of cat.examples) {
        if (cat.kind === "denied") {
          expect(() => validateArtistTags(vocab, [example])).toThrow(/not allowed/);
        } else {
          expect(validateArtistTags(vocab, [example])).toEqual([]);
        }
      }
    }
  });

  it("lists every denied tag with its category in one error", () => {
    expect(() => validateArtistTags(vocab, ["Canadian", "Rock", "80s"])).toThrow(
      /"Rock" is a genre\/style tag.*"80s" is a decade\/era tag/
    );
  });

  it("warns about unknown tags with a suggestion and does not throw", () => {
    const warnings = validateArtistTags(vocab, ["Canadien", "canadien"]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('Did you mean: "Canadian"');
  });

  it("rejects unknown tags when the vocabulary says so", () => {
    const strict: TagVocabulary = { ...vocab, unknown_tags: "reject" };
    expect(() => validateArtistTags(strict, ["Award-Winning"])).toThrow(/not in the tag vocabulary/);
  });
});

describe("describeTagPolicy", () => {
  it("names every category and denied example of the vocabulary", () => {
    const vocab = defaultTagVocabulary();
    const text = describeTagPolicy(vocab);
    for (const cat of vocab.categories) {
      expect(text).toContain(cat.label);
      for (const example of cat.examples) expect(text).toContain(`'${example}'`);
    }
    expect(text).toContain("accepted with a warning");
  });

  it("says unknown tags are rejected in reject mode", () => {
    expect(describeTagPolicy({ ...defaultTagVocabulary(), unknown_tags: "reject" })).toContain("are rejected");
  });
});

describe("loadTagVocabulary", () => {
  it("returns the defaults without the env var", () => {
    expect(loadTagVocabulary({}).source).toBe("built-in defaults");
    expect(loadTagVocabulary({ LUMINOUS_ARTIST_TAG_VOCAB: "  " }).source).toBe("built-in defaults");
  });

  it("loads a file that replaces the defaults entirely", () => {
    const file = writeVocabFile(CUSTOM);
    const vocab = loadTagVocabulary({ LUMINOUS_ARTIST_TAG_VOCAB: file });
    expect(vocab.source).toBe(file);
    expect(vocab.unknown_tags).toBe("reject");
    expect(classifyTag(vocab, "Sub Pop")).toEqual({ status: "allowed", category: "label" });
    expect(classifyTag(vocab, "Canadian")).toEqual({ status: "unknown" });
  });

  it.each([
    ["a missing file", () => path.join(tmpDir, "nope.json"), /Cannot read/],
    ["invalid JSON", () => writeVocabFile("{not json"), /not valid JSON/],
    ["a schema violation", () => writeVocabFile({ categories: [] }), /categories/],
    [
      "a bad pattern",
      () => writeVocabFile({ categories: [{ id: "x", label: "x", kind: "allowed", description: "d", patterns: ["("] }] }),
      /Invalid pattern/,
    ],
    [
      "duplicate ids",
      () =>
        writeVocabFile({
          categories: [
            { id: "x", label: "x", kind: "allowed", description: "d" },
            { id: "x", label: "y", kind: "denied", description: "d" },
          ],
        }),
      /Duplicate tag category id "x"/,
    ],
  ])("fails loudly for %s", (_name, makeFile, message) => {
    expect(() => loadTagVocabulary({ LUMINOUS_ARTIST_TAG_VOCAB: makeFile() })).toThrow(message);
  });
});

describe("artist writes", () => {
  it("rejects a denied tag without writing, with a suggestion for near misses", () => {
    db = openDb();
    expect(() => updateArtistProfile(db, { artist: "Rush", tags: ["Canadian", "Rock"] })).toThrow(
      /"Rock" is a genre\/style tag/
    );
    expect(() => updateArtistProfile(db, { artist: "Rush", add_tags: ["80s"] })).toThrow(/decade\/era/);
    expect(db.query("SELECT COUNT(*) AS n FROM artist_profiles").get()).toEqual({ n: 0 });
  });

  it("warns for unknown tags but still writes them", () => {
    db = openDb();
    const res = updateArtistProfile(db, { artist: "Rush", add_tags: ["Canadien"] });
    expect(res.profile.tags).toEqual(["Canadien"]);
    expect(res.warnings?.[0]).toContain('Did you mean: "Canadian"');
  });

  it("never validates remove_tags, so a banned tag can always be removed", () => {
    db = openDb();
    seedTags(db, { Rush: ["Rock", "Canadian"] });
    const res = updateArtistProfile(db, { artist: "Rush", remove_tags: ["rock"] });
    expect(res.profile.tags).toEqual(["Canadian"]);
  });

  it("reports a denied tag per item in a batch and keeps the others", () => {
    db = openDb();
    const batch = updateArtistProfiles(db, [
      { artist: "Rush", add_tags: ["Canadian"] },
      { artist: "Abba", add_tags: ["Pop"] },
    ]);
    expect(batch.results.map((r) => r.status)).toEqual(["created", "error"]);
    expect(batch.results[1].error).toMatch(/genre\/style/);
  });

  it("enforces a vocabulary loaded from the env file", () => {
    db = openDb();
    setTagVocabulary(loadTagVocabulary({ LUMINOUS_ARTIST_TAG_VOCAB: writeVocabFile(CUSTOM) }));
    expect(() => updateArtistProfile(db, { artist: "Rush", add_tags: ["Sad"] })).toThrow(/mood tag/);
    expect(() => updateArtistProfile(db, { artist: "Rush", add_tags: ["Canadian"] })).toThrow(/not in the tag vocabulary/);
    expect(updateArtistProfile(db, { artist: "Rush", add_tags: ["Sub Pop"] }).profile.tags).toEqual(["Sub Pop"]);
  });

  it("keeps album tags free of genre rules but still rejects decades", () => {
    db = openDb();
    expect(updateAlbumProfile(db, { album: "Views", artist: "Drake", add_tags: ["Rap", "Live"] }).success).toBe(true);
    expect(() => updateAlbumProfile(db, { album: "Views", artist: "Drake", add_tags: ["80s"] })).toThrow(
      /Decade\/era tags are not allowed/
    );
  });
});

describe("parseTagList", () => {
  it("tolerates null, corrupt and non-array values and drops non-strings", () => {
    expect(parseTagList(null)).toEqual([]);
    expect(parseTagList("{oops")).toEqual([]);
    expect(parseTagList('{"a":1}')).toEqual([]);
    expect(parseTagList('["a",1,null,"b"]')).toEqual(["a", "b"]);
  });
});

describe("listArtistTags", () => {
  it("groups spelling variants case-insensitively and counts artists once", () => {
    db = openDb();
    seedTags(db, {
      Drake: ["Canadian", "award-winning"],
      Rush: ["canadian", "Canadian", "Award-Winning"],
      Abba: ["Swedish", "Award-Winning"],
    });
    const { tags, summary } = listArtistTags(db);

    const canadian = tags.find((t) => t.tag.toLowerCase() === "canadian")!;
    expect(canadian.artist_count).toBe(2);
    expect(canadian.tag).toBe("Canadian");
    expect(canadian.spellings).toEqual([
      { spelling: "Canadian", artist_count: 2 },
      { spelling: "canadian", artist_count: 1 },
    ]);

    const award = tags.find((t) => t.tag.toLowerCase() === "award-winning")!;
    expect(award).toMatchObject({ tag: "Award-Winning", artist_count: 3, status: "unknown" });
    expect(tags.find((t) => t.tag === "Swedish")).toEqual({
      tag: "Swedish",
      artist_count: 1,
      status: "allowed",
      category: "nationality",
    });
    expect(summary).toEqual({
      artists_with_tags: 3,
      distinct_tags: 3,
      denied_tags: 0,
      unknown_tags: 1,
      tags_with_spelling_variants: 2,
    });
  });

  it("reports denied tags with category and filters by status, query and variants", () => {
    db = openDb();
    seedTags(db, { Drake: ["Canadian", "Rock", "80s"], Abba: ["Swedish", "rock"] });

    const denied = listArtistTags(db, { status: "denied" });
    expect(denied.tags.map((t) => [t.tag, t.category])).toEqual([
      ["rock", "genre"],
      ["80s", "decade_era"],
    ]);
    expect(denied.summary.denied_tags).toBe(2);
    expect(listArtistTags(db, { query: "SWED" }).tags.map((t) => t.tag)).toEqual(["Swedish"]);
    expect(listArtistTags(db, { variants_only: true }).tags.map((t) => t.tag)).toEqual(["rock"]);
  });

  it("suggests nearest allowed tags for tags that are not allowed", () => {
    db = openDb();
    seedTags(db, { Drake: ["Canadien"] });
    expect(listArtistTags(db).tags[0].suggestions).toContain("Canadian");
  });

  it("paginates", () => {
    db = openDb();
    seedTags(db, { Drake: ["Canadian"], Abba: ["Swedish"], Rush: ["Canadian", "Grammy Award"] });
    const page = listArtistTags(db, { limit: 1, offset: 1 });
    expect(page.tags).toHaveLength(1);
    expect(page.pagination).toEqual({ total_matching: 3, offset: 1, limit: 1, has_more: true });
  });

  it("never rewrites stored tags", () => {
    db = openDb();
    seedTags(db, { Drake: ["Rock", "rock", "80s"] });
    listArtistTags(db);
    expect(db.query("SELECT tags FROM artist_profiles").get()).toEqual({ tags: '["Rock","rock","80s"]' });
  });

  it("returns an empty report when there is no artist_profiles table or tags are corrupt", () => {
    db = new Database(path.join(tmpDir, "empty.db"));
    expect(listArtistTags(db).tags).toEqual([]);
    db.run("CREATE TABLE artist_profiles (artist_key TEXT, tags TEXT)");
    db.run("INSERT INTO artist_profiles VALUES ('A', 'not json')");
    expect(listArtistTags(db).summary.distinct_tags).toBe(0);
  });
});

describe("MCP tools", () => {
  async function connect(vocab?: TagVocabulary) {
    const { server, db: luminousDb } = createMcpServer({
      dbPath: path.join(tmpDir, "luminous.db"),
      tagVocabulary: vocab,
    });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test-client", version: "1.0.0" }, { capabilities: {} });
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    return { client, luminousDb };
  }

  it("generates the tag descriptions from the vocabulary in force", async () => {
    const vocab = loadTagVocabulary({ LUMINOUS_ARTIST_TAG_VOCAB: writeVocabFile(CUSTOM) });
    const { client, luminousDb } = await connect(vocab);
    try {
      const tools = (await client.listTools()).tools;
      const policy = describeTagPolicy(vocab);
      const update = tools.find((t) => t.name === "update_artist_profile")!;
      const tagsDescription = (update.inputSchema.properties!.tags as { description: string }).description;
      expect(tagsDescription).toContain(policy);
      expect(tagsDescription).toContain("record label");
      expect(tagsDescription).not.toContain("nationality");
      expect(tools.map((t) => t.name)).toEqual(expect.arrayContaining(["list_artist_tags", "get_tag_policy"]));
    } finally {
      luminousDb.close();
    }
  });

  it("get_tag_policy returns the vocabulary, its source and the unknown-tag mode", async () => {
    const { client, luminousDb } = await connect();
    try {
      const res = await client.callTool({ name: "get_tag_policy", arguments: {} });
      const body = JSON.parse((res.content as Array<{ text: string }>)[0].text);
      expect(body.source).toBe("built-in defaults");
      expect(body.unknown_tags).toBe("warn");
      expect(body.categories.map((c: { id: string }) => c.id)).toEqual([
        "nationality",
        "named_award",
        "decade_era",
        "genre",
      ]);
      expect(body.summary).toBe(describeTagPolicy(defaultTagVocabulary()));
    } finally {
      luminousDb.close();
    }
  });

  it("list_artist_tags reports through the tool", async () => {
    db = openDb();
    seedTags(db, { Drake: ["Canadian", "Rock"] });
    db.close();
    const { client, luminousDb } = await connect();
    try {
      const res = await client.callTool({ name: "list_artist_tags", arguments: { status: "denied" } });
      const body = JSON.parse((res.content as Array<{ text: string }>)[0].text);
      expect(body.tags).toEqual([{ tag: "Rock", artist_count: 1, status: "denied", category: "genre" }]);
      expect(body.summary.denied_tags).toBe(1);
    } finally {
      luminousDb.close();
    }
  });

  it("createMcpServer fails startup on an invalid vocabulary file", () => {
    const original = process.env.LUMINOUS_ARTIST_TAG_VOCAB;
    process.env.LUMINOUS_ARTIST_TAG_VOCAB = path.join(tmpDir, "missing.json");
    try {
      expect(() => createMcpServer({ dbPath: path.join(tmpDir, "luminous.db") })).toThrow(/LUMINOUS_ARTIST_TAG_VOCAB/);
    } finally {
      if (original === undefined) delete process.env.LUMINOUS_ARTIST_TAG_VOCAB;
      else process.env.LUMINOUS_ARTIST_TAG_VOCAB = original;
    }
  });
});
