import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  formatMcpResponse,
  isPrettyJsonEnabled,
  serializeJson,
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
});
