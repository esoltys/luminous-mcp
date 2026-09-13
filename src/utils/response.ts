/**
 * Centralized formatting and serialization utilities for Luminous MCP responses.
 */

export interface McpTextContent {
  type: "text";
  text: string;
}

export interface McpResponse {
  [key: string]: unknown;
  content: McpTextContent[];
  isError?: boolean;
}

export interface StripOptions {
  /**
   * Whether to strip keys with null or undefined values.
   * Default: true.
   */
  stripNull?: boolean;
  /**
   * Whether to strip keys with empty string ("") values.
   * Default: true.
   */
  stripEmptyStrings?: boolean;
  /**
   * Whether to strip empty plain objects ({}) created when all children were stripped.
   * Root objects are never stripped.
   * Default: true.
   */
  stripEmptyObjects?: boolean;
  /**
   * Whether to strip empty arrays ([]).
   * Default: false (preserves empty list properties such as tracks: []).
   */
  stripEmptyArrays?: boolean;
}

export interface ResponseFormatOptions {
  /**
   * Explicitly force 2-space indentation pretty-printing if true.
   * Defaults to reading LUMINOUS_PRETTY_JSON env var, or false.
   */
  pretty?: boolean;
  /**
   * Whether to strip null, undefined, and empty fields prior to serialization.
   * Default: true.
   */
  stripNulls?: boolean;
  /**
   * Detailed stripping configuration options.
   */
  stripOptions?: StripOptions;
}

/**
 * Returns true if pretty-printed JSON formatting is requested via options or environment variable.
 */
export function isPrettyJsonEnabled(options?: ResponseFormatOptions): boolean {
  if (options?.pretty !== undefined) {
    return options.pretty;
  }
  if (typeof process !== "undefined" && process.env) {
    const envVal = process.env.LUMINOUS_PRETTY_JSON;
    return envVal === "1" || envVal?.toLowerCase() === "true";
  }
  return false;
}

/**
 * Recursively removes null, undefined, and empty string/object fields from an object or array.
 * Primitive values of 0 and false are always preserved.
 */
export function stripNullAndEmpty(val: unknown, options?: StripOptions): unknown {
  const stripNull = options?.stripNull ?? true;
  const stripEmptyStrings = options?.stripEmptyStrings ?? true;
  const stripEmptyObjects = options?.stripEmptyObjects ?? true;
  const stripEmptyArrays = options?.stripEmptyArrays ?? false;

  if (val === null || val === undefined) {
    return val;
  }

  if (typeof val !== "object") {
    return val;
  }

  if (Array.isArray(val)) {
    const cleaned = val
      .map((item) => stripNullAndEmpty(item, options))
      .filter((item) => {
        if (stripNull && (item === null || item === undefined)) return false;
        if (stripEmptyStrings && item === "") return false;
        return true;
      });
    return cleaned;
  }

  // Handle plain objects
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
    if (stripNull && (v === null || v === undefined)) {
      continue;
    }
    if (stripEmptyStrings && v === "") {
      continue;
    }
    if (typeof v === "object" && v !== null) {
      if (Array.isArray(v)) {
        const cleanedArray = stripNullAndEmpty(v, options) as unknown[];
        if (stripEmptyArrays && cleanedArray.length === 0) {
          continue;
        }
        result[k] = cleanedArray;
      } else {
        const cleanedObj = stripNullAndEmpty(v, options);
        if (
          stripEmptyObjects &&
          typeof cleanedObj === "object" &&
          cleanedObj !== null &&
          Object.keys(cleanedObj).length === 0
        ) {
          continue;
        }
        result[k] = cleanedObj;
      }
    } else {
      result[k] = v;
    }
  }

  return result;
}

/**
 * Serializes data to a JSON string. By default, removes null/empty metadata fields
 * and formats compactly without indentation whitespace to minimize token consumption for LLMs.
 * Pretty-printing (2-space indent) can be enabled via options or by setting LUMINOUS_PRETTY_JSON=1.
 */
export function serializeJson(data: unknown, options?: ResponseFormatOptions): string {
  const shouldStrip = options?.stripNulls ?? true;
  const processed = shouldStrip ? stripNullAndEmpty(data, options?.stripOptions) : data;
  return isPrettyJsonEnabled(options)
    ? JSON.stringify(processed, null, 2)
    : JSON.stringify(processed);
}

/**
 * Creates a standard MCP response object containing a single text content block
 * with cleaned and compactly serialized JSON.
 */
export function formatMcpResponse(data: unknown, options?: ResponseFormatOptions): McpResponse {
  return {
    content: [
      {
        type: "text",
        text: serializeJson(data, options),
      },
    ],
  };
}
