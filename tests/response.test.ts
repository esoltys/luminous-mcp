import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  formatMcpResponse,
  isPrettyJsonEnabled,
  serializeJson,
  stripNullAndEmpty,
} from "../src/utils/response.ts";

describe("Response Serialization Utility", () => {
  const originalEnv = process.env.LUMINOUS_PRETTY_JSON;

  beforeEach(() => {
    delete process.env.LUMINOUS_PRETTY_JSON;
  });

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.LUMINOUS_PRETTY_JSON = originalEnv;
    } else {
      delete process.env.LUMINOUS_PRETTY_JSON;
    }
  });

  it("serializes objects to compact JSON by default without indentation whitespace", () => {
    const sample = {
      id: 1,
      title: "Test Track",
      artist: "Test Artist",
      tags: ["rock", "indie"],
      metadata: { year: 2024, duration: 180 },
    };

    const serialized = serializeJson(sample);
    expect(serialized).toBe(JSON.stringify(sample));
    expect(serialized).not.toContain("\n");
    expect(serialized).not.toContain("  ");
    expect(JSON.parse(serialized)).toEqual(sample);
  });

  it("respects explicit pretty option override", () => {
    const sample = { a: 1, b: "hello" };
    const prettySerialized = serializeJson(sample, { pretty: true });
    expect(prettySerialized).toBe(JSON.stringify(sample, null, 2));
    expect(prettySerialized).toContain("\n");
    expect(prettySerialized).toContain("  \"a\": 1");

    const compactSerialized = serializeJson(sample, { pretty: false });
    expect(compactSerialized).toBe(JSON.stringify(sample));
    expect(compactSerialized).not.toContain("\n");
  });

  it("detects LUMINOUS_PRETTY_JSON environment variable", () => {
    expect(isPrettyJsonEnabled()).toBe(false);

    process.env.LUMINOUS_PRETTY_JSON = "1";
    expect(isPrettyJsonEnabled()).toBe(true);
    expect(serializeJson({ key: "val" })).toContain("\n");

    process.env.LUMINOUS_PRETTY_JSON = "true";
    expect(isPrettyJsonEnabled()).toBe(true);

    process.env.LUMINOUS_PRETTY_JSON = "0";
    expect(isPrettyJsonEnabled()).toBe(false);

    process.env.LUMINOUS_PRETTY_JSON = "false";
    expect(isPrettyJsonEnabled()).toBe(false);
  });

  it("formatMcpResponse returns MCP compatible text content block", () => {
    const data = { status: "ok", count: 42 };
    const response = formatMcpResponse(data);

    expect(response).toEqual({
      content: [
        {
          type: "text",
          text: JSON.stringify(data),
        },
      ],
    });
  });

  describe("stripNullAndEmpty", () => {
    it("removes null, undefined, and empty string fields while preserving 0 and false", () => {
      const input = {
        id: 1,
        title: "Track",
        composer: null,
        performer: undefined,
        comment: "",
        play_count: 0,
        has_lyrics: false,
      };

      const cleaned = stripNullAndEmpty(input);

      expect(cleaned).toEqual({
        id: 1,
        title: "Track",
        play_count: 0,
        has_lyrics: false,
      });
      expect("composer" in (cleaned as any)).toBe(false);
      expect("performer" in (cleaned as any)).toBe(false);
      expect("comment" in (cleaned as any)).toBe(false);
    });

    it("cleans recursively inside nested objects and arrays", () => {
      const input = {
        id: 10,
        tracks: [
          { id: 1, title: "T1", album_artist: null, bpm: "" },
          { id: 2, title: "T2", album_artist: "Artist", bpm: 120 },
        ],
        details: {
          release_year: 2020,
          notes: null,
          empty_group: {
            sub1: null,
            sub2: "",
          },
        },
      };

      const cleaned = stripNullAndEmpty(input);

      expect(cleaned).toEqual({
        id: 10,
        tracks: [
          { id: 1, title: "T1" },
          { id: 2, title: "T2", album_artist: "Artist", bpm: 120 },
        ],
        details: {
          release_year: 2020,
        },
      });
    });

    it("preserves empty arrays by default", () => {
      const input = {
        results: [],
        count: 0,
      };

      const cleaned = stripNullAndEmpty(input);
      expect(cleaned).toEqual({
        results: [],
        count: 0,
      });
    });

    it("supports disabling null stripping via options", () => {
      const input = {
        id: 1,
        composer: null,
      };

      const cleaned = stripNullAndEmpty(input, { stripNull: false });
      expect(cleaned).toEqual({
        id: 1,
        composer: null,
      });
    });
  });

  it("formatMcpResponse automatically applies stripNullAndEmpty", () => {
    const input = {
      id: 42,
      artist: "Test",
      composer: null,
      bpm: null,
    };

    const response = formatMcpResponse(input);
    const parsed = JSON.parse(response.content[0].text);

    expect(parsed).toEqual({
      id: 42,
      artist: "Test",
    });
    expect(parsed.composer).toBeUndefined();
    expect(parsed.bpm).toBeUndefined();
  });
});
