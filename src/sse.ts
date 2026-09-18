#!/usr/bin/env bun
import http from "node:http";
import { URL } from "node:url";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import {
  DEFAULT_SSE_HOST,
  DEFAULT_SSE_PORT,
  SERVER_NAME,
  SERVER_VERSION,
} from "./constants.ts";
import { createMcpServer, type ServerOptions } from "./server.ts";

export interface SseServerOptions extends ServerOptions {
  port?: number;
  host?: string;
}

export interface SseServerInstance {
  httpServer: http.Server;
  port: number;
  host: string;
  close: () => Promise<void>;
  listen: () => Promise<{ port: number; host: string }>;
}

/**
 * Creates an HTTP server exposing an SSE (Server-Sent Events) MCP transport.
 * Allows sandboxed, containerized (Docker, WSL), or remote agents to connect to Luminous.
 */
export function createSseServer(options: SseServerOptions = {}): SseServerInstance {
  const port = options.port ?? (Number(process.env.LUMINOUS_MCP_PORT) || DEFAULT_SSE_PORT);
  const host = options.host ?? (process.env.LUMINOUS_MCP_HOST || DEFAULT_SSE_HOST);

  const activeSessions = new Map<
    string,
    { transport: SSEServerTransport; close: () => Promise<void> }
  >();

  const httpServer = http.createServer(async (req, res) => {
    // CORS headers for broad local and cross-origin compatibility
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

    if (req.method === "OPTIONS") {
      res.writeHead(200);
      res.end();
      return;
    }

    const reqUrl = req.url ? new URL(req.url, `http://${req.headers.host || "localhost"}`) : null;
    const pathname = reqUrl?.pathname ?? "";

    // SSE connection initiation
    if (pathname === "/sse" && req.method === "GET") {
      const { server: mcpServer, db } = createMcpServer(options);
      const transport = new SSEServerTransport("/messages", res);
      const sessionId = transport.sessionId;

    let isClosing = false;
    const closeSession = async () => {
      if (isClosing) return;
      isClosing = true;
      activeSessions.delete(sessionId);
      try {
        db.close();
        await mcpServer.close().catch(() => {});
      } catch {
        // Ignore cleanup errors
      }
    };

    activeSessions.set(sessionId, {
      transport,
      close: closeSession,
    });

    transport.onclose = closeSession;

      await mcpServer.connect(transport);
      return;
    }

    // Client JSON-RPC POST messages
    if (pathname === "/messages" && req.method === "POST") {
      const sessionId = reqUrl?.searchParams.get("sessionId");
      const session = sessionId
        ? activeSessions.get(sessionId)
        : activeSessions.values().next().value;

      if (!session) {
        res.writeHead(400, { "Content-Type": "text/plain" });
        res.end(`Session not found: ${sessionId ?? "none"}`);
        return;
      }

      await session.transport.handlePostMessage(req, res);
      return;
    }

    // Diagnostic health endpoint
    if (pathname === "/health" && req.method === "GET") {
      const { db } = createMcpServer(options);
      const stats = db.getStats();
      db.close();

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          status: "ok",
          name: SERVER_NAME,
          version: SERVER_VERSION,
          database: {
            path: stats.dbPath,
            exists: stats.exists,
            trackCount: stats.trackCount,
            schemaVersion: stats.schemaVersion,
          },
        })
      );
      return;
    }

    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not Found");
  });

  const listen = (): Promise<{ port: number; host: string }> => {
    return new Promise((resolve) => {
      httpServer.listen(port, host, () => {
        const addr = httpServer.address();
        const boundPort = typeof addr === "object" && addr ? addr.port : port;
        resolve({ port: boundPort, host });
      });
    });
  };

  const close = async (): Promise<void> => {
    for (const [id, session] of activeSessions) {
      await session.close().catch(() => {});
      activeSessions.delete(id);
    }
    return new Promise((resolve) => {
      httpServer.close(() => resolve());
    });
  };

  return {
    httpServer,
    port,
    host,
    listen,
    close,
  };
}

if (import.meta.main) {
  const instance = createSseServer();

  const shutdown = async () => {
    console.error(`Shutting down ${SERVER_NAME} SSE server...`);
    await instance.close();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  instance.listen().then(({ port, host }) => {
    console.error(
      `${SERVER_NAME} v${SERVER_VERSION} SSE server listening on http://${host}:${port}/sse`
    );
  });
}
