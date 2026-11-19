#!/usr/bin/env node
/**
 * HabitFlow reference sync server (development / testing only).
 *
 *   node server/sync-server.js            # listens on http://localhost:8787/sync
 *   PORT=9000 DATA_DIR=./data node server/sync-server.js
 *
 * Contract (the same one any real backend must follow):
 *   GET /sync  with  Authorization: Bearer <token>
 *       200 + JSON document   |   404 if nothing is stored yet
 *   PUT /sync  with  Authorization: Bearer <token>  and a JSON body
 *       (a habit document, or an encrypted envelope { enc: 1, ... })
 *       204 on success
 * Each token gets its own document, so the token acts as the account key.
 * Use a long random string. For real use, put it behind HTTPS and use proper
 * authentication (Supabase, Firebase, your own API, ...).
 */
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = Number(process.env.PORT) || 8787;
const DATA_DIR = path.resolve(
  process.env.DATA_DIR || path.join(__dirname, "data"),
);
const MAX_BYTES = 2 * 1024 * 1024;
fs.mkdirSync(DATA_DIR, { recursive: true });

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, PUT, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
};
const send = (res, status, body, type = "application/json") => {
  res.writeHead(status, {
    ...cors,
    "Content-Type": type,
    "Cache-Control": "no-store",
  });
  res.end(body);
};

http
  .createServer((req, res) => {
    if (req.method === "OPTIONS") return send(res, 204, "");
    if (new URL(req.url, "http://x").pathname !== "/sync")
      return send(res, 404, '{"error":"not found"}');

    const token = (req.headers.authorization || "")
      .replace(/^Bearer\s+/i, "")
      .trim();
    if (token.length < 8)
      return send(res, 401, '{"error":"token required (min 8 characters)"}');
    const file = path.join(
      DATA_DIR,
      crypto.createHash("sha256").update(token).digest("hex") + ".json",
    );

    if (req.method === "GET") {
      return fs.readFile(file, (err, buf) =>
        err ? send(res, 404, '{"error":"empty"}') : send(res, 200, buf),
      );
    }
    if (req.method === "PUT") {
      const chunks = [];
      let size = 0;
      req.on("data", (c) => {
        size += c.length;
        if (size > MAX_BYTES) {
          send(res, 413, '{"error":"too large"}');
          req.destroy();
        } else chunks.push(c);
      });
      req.on("end", () => {
        if (res.writableEnded) return;
        try {
          const doc = JSON.parse(Buffer.concat(chunks).toString("utf8"));
          if (
            !doc ||
            typeof doc !== "object" ||
            Array.isArray(doc) ||
            !(Array.isArray(doc.habits) || doc.enc === 1)
          )
            throw new Error("invalid");
          const tmp = file + ".tmp";
          fs.writeFileSync(tmp, JSON.stringify(doc));
          fs.renameSync(tmp, file);
          send(res, 204, "");
        } catch {
          send(res, 400, '{"error":"invalid JSON document"}');
        }
      });
      return;
    }
    send(res, 405, '{"error":"method not allowed"}');
  })
  .listen(PORT, () =>
    console.log(
      `HabitFlow sync server: http://localhost:${PORT}/sync  (data in ${DATA_DIR})`,
    ),
  );
