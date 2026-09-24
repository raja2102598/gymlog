// Serves a folder of static files: the built site in out/ by default (`npm run preview`), and for the
// end-to-end tests. GET /__delay?ms=2000 makes every later response that much slower, like weak signal.
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
};

export function serve(root, port, host = "127.0.0.1") {
  root = path.resolve(root);
  let delay = 0;
  const server = createServer(async (req, res) => {
    const u = new URL(req.url ?? "/", "http://localhost");
    if (u.pathname === "/__delay") {
      delay = Number(u.searchParams.get("ms")) || 0;
      res.end(`delay ${delay}`);
      return;
    }
    let file;
    try {
      file = path.join(root, decodeURIComponent(u.pathname));
    } catch {
      res.writeHead(400).end();
      return;
    }
    if (file !== root && !file.startsWith(root + path.sep)) {
      res.writeHead(403).end();
      return;
    }
    if (await stat(file).then((s) => s.isDirectory(), () => false)) file = path.join(file, "index.html");
    if (delay) await new Promise((r) => setTimeout(r, delay));
    try {
      const body = await readFile(file);
      res.writeHead(200, { "content-type": TYPES[path.extname(file)] ?? "application/octet-stream", "cache-control": "no-cache" });
      res.end(body);
    } catch {
      const page = await readFile(path.join(root, "404.html")).catch(() => "Not found");
      res.writeHead(404, { "content-type": TYPES[".html"] }).end(page);
    }
  });
  return new Promise((resolve) => server.listen(port, host, () => resolve(server)));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [root = "out", port = "3000"] = process.argv.slice(2);
  await serve(root, Number(port));
  console.log(`Serving ${root} at http://127.0.0.1:${port}/`);
}
