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

export interface ResponseFormatOptions {
  /**
   * Explicitly force 2-space indentation pretty-printing if true.
   * Defaults to reading LUMINOUS_PRETTY_JSON env var, or false.
   */
  pretty?: boolean;
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
 * Serializes data to a JSON string. By default, formats compactly without indentation
 * whitespace to minimize token consumption for LLMs. Pretty-printing (2-space indent)
 * can be enabled via options or by setting LUMINOUS_PRETTY_JSON=1.
 */
export function serializeJson(data: unknown, options?: ResponseFormatOptions): string {
  return isPrettyJsonEnabled(options)
    ? JSON.stringify(data, null, 2)
    : JSON.stringify(data);
}

/**
 * Creates a standard MCP response object containing a single text content block
 * with compactly serialized JSON.
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
