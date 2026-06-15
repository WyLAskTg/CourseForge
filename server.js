import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generateCourseOutput, resolveGenerationProvider } from "./functions/api/generate.js";

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
        sendJson(response, 405, { error: "Method not allowed" });
        return;
      }

      const provider = resolveGenerationProvider(process.env);
      if (!provider) {
        sendJson(response, 200, {
          configured: false,
          error: "DEEPSEEK_API_KEY is not configured. Set it before starting the local server."
        });
        return;
      }

      try {
        const payload = await readJsonRequest(request);
        const output = await generateCourseOutput(payload, provider);
        sendJson(response, 200, { output, provider: provider.name, model: provider.model });
      } catch (error) {
        sendJson(response, error instanceof SyntaxError ? 400 : 500, {
          error: error.message || "Generation failed."
        });
      }
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

function sendJson(response, status, payload) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload));
}

async function readJsonRequest(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(chunk);
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
