#!/usr/bin/env node
/**
 * Minimal WebSocket relay for shared splat rooms (adapted from google/xrblocks netblocks).
 * @see https://github.com/google/xrblocks/tree/main/src/addons/netblocks/server
 *
 * Deploy separately from the Vercel frontend (Render, Railway, Fly.io, etc.).
 * Cloud hosts terminate TLS — listen on HTTP + WebSocket; clients use wss://your-relay-host.
 */
import http from "node:http";
import https from "node:https";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { WebSocketServer } from "ws";

const PORT = Number(process.env.PORT ?? 8765);
const HOST = process.env.HOST ?? "0.0.0.0";

/** @type {Map<string, Map<string, import('ws').WebSocket>>} */
const rooms = new Map();

const mkcertDir = process.env.MKCERT_DIR ?? path.join(os.homedir(), ".vite-plugin-mkcert");
const keyFile = process.env.RELAY_KEY ?? path.join(mkcertDir, "dev.pem");
const certFile = process.env.RELAY_CERT ?? path.join(mkcertDir, "cert.pem");

const canUseTls = fs.existsSync(keyFile) && fs.existsSync(certFile);

const maxPayload = Number(process.env.MAX_PAYLOAD ?? 16 * 1024 * 1024);

const httpServer = canUseTls
  ? https.createServer({
      key: fs.readFileSync(keyFile),
      cert: fs.readFileSync(certFile),
    })
  : http.createServer((req, res) => {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("sensai splat relay ok\n");
    });

httpServer.listen(PORT, HOST, () => {
  console.log(
    `[relay] listening on port ${PORT} (${canUseTls ? "local TLS" : "HTTP + WebSocket"})`,
  );
});

const wss = new WebSocketServer({ server: httpServer, maxPayload });

wss.on("connection", (ws) => {
  /** @type {string | null} */
  let peerId = null;
  /** @type {string | null} */
  let roomId = null;
  ws.isAlive = true;

  ws.on("error", (err) => {
    console.warn("[relay] WebSocket error:", err.message ?? err);
  });

  ws.on("pong", () => {
    ws.isAlive = true;
  });

  ws.on("message", (data) => {
    let msg;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      return;
    }
    if (!msg || typeof msg.type !== "string") return;

    if (msg.type === "join") {
      if (peerId) return;
      roomId = String(msg.roomId);
      peerId = String(msg.peerId || randomId());
      let room = rooms.get(roomId);
      if (!room) {
        room = new Map();
        rooms.set(roomId, room);
      }
      if (room.has(peerId)) {
        send(ws, { type: "error", reason: "peer-id-taken", peerId });
        try {
          ws.close();
        } catch {
          // ignore
        }
        peerId = null;
        roomId = null;
        return;
      }
      const peers = [...room.keys()];
      send(ws, { type: "welcome", peerId, peers });
      for (const [, peerWs] of room) send(peerWs, { type: "peer-join", peerId });
      room.set(peerId, ws);
      return;
    }

    if (msg.type === "send" && peerId && roomId) {
      const room = rooms.get(roomId);
      if (!room) return;
      const out = { type: "message", from: peerId, data: msg.data };
      if (msg.to) {
        const target = room.get(String(msg.to));
        if (target) send(target, out);
      } else {
        for (const [otherId, otherWs] of room) {
          if (otherId !== peerId) send(otherWs, out);
        }
      }
    }
  });

  ws.on("close", () => {
    if (!roomId || !peerId) return;
    const room = rooms.get(roomId);
    if (!room) return;
    room.delete(peerId);
    for (const [, otherWs] of room) send(otherWs, { type: "peer-leave", peerId });
    if (room.size === 0) rooms.delete(roomId);
  });
});

setInterval(() => {
  for (const client of wss.clients) {
    if (client.isAlive === false) {
      try {
        client.terminate();
      } catch {
        // ignore
      }
      continue;
    }
    client.isAlive = false;
    try {
      client.ping();
    } catch {
      // ignore
    }
  }
}, 15000);

/** @param {import('ws').WebSocket} ws @param {Record<string, unknown>} obj */
function send(ws, obj) {
  if (ws.readyState !== ws.OPEN) return;
  try {
    ws.send(JSON.stringify(obj));
  } catch {
    // ignore
  }
}

function randomId() {
  return Math.random().toString(36).slice(2, 12);
}
