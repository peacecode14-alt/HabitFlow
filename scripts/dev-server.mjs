// Minimal static file server for local development: `npm start` then open http://localhost:8080
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const port = Number(process.env.PORT) || 8080;
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
};

createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(
      new URL(req.url, "http://localhost").pathname,
    );
    let file = normalize(join(root, pathname));
    if (!file.startsWith(root)) {
      res.writeHead(403).end("Forbidden");
      return;
    }
    if ((await stat(file).catch(() => null))?.isDirectory())
      file = join(file, "index.html");
    const body = await readFile(file);
    res.writeHead(200, {
      "Content-Type": types[extname(file)] || "application/octet-stream",
      "Cache-Control": "no-cache",
    });
    res.end(body);
  } catch {
    res
      .writeHead(404, { "Content-Type": "text/plain; charset=utf-8" })
      .end("Not found");
  }
}).listen(port, () =>
  console.log(`HabitFlow dev server: http://localhost:${port}`),
);
