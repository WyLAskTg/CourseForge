import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 5173);

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml"
};

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://localhost:${port}`);

    if (url.pathname === "/api/generate") {
      if (request.method !== "POST") {
        response.writeHead(405, { "Content-Type": "application/json; charset=utf-8" });
        response.end(JSON.stringify({ error: "Method not allowed" }));
        return;
      }

      let body = "";
      request.on("data", (chunk) => {
        body += chunk;
      });
      request.on("end", () => {
        response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        response.end(
          JSON.stringify({
            configured: false,
            error: "AI backend is not connected. Implement this endpoint to call a real model and return final user-facing JSON.",
            received: body ? "request body received" : "empty body"
          })
        );
      });
      return;
    }

    const requestedPath = decodeURIComponent(url.pathname);
    const safePath = requestedPath === "/" ? "/index.html" : requestedPath;
    const filePath = path.normalize(path.join(root, safePath));

    if (!filePath.startsWith(root)) {
      response.writeHead(403);
      response.end("Forbidden");
      return;
    }

    const ext = path.extname(filePath);
    const body = await readFile(filePath);
    response.writeHead(200, {
      "Content-Type": mimeTypes[ext] || "application/octet-stream",
      "Cache-Control": "no-store"
    });
    response.end(body);
  } catch {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`CourseForge running at http://127.0.0.1:${port}`);
});
