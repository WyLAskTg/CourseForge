import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generateCourseOutput, resolveGenerationProvider } from "./functions/api/generate.js";
import { onRequest as handleRelevanceRequest } from "./functions/api/relevance.js";

const root = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 5173);

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml"
};

const localFeedbackThreads = [];

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://localhost:${port}`);

    if (url.pathname === "/api/feedback") {
      await handleLocalFeedback(request, response, url);
      return;
    }

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

    if (url.pathname === "/api/relevance") {
      const body = request.method === "POST" ? await readJsonRequest(request).catch(() => ({})) : undefined;
      const apiResponse = await handleRelevanceRequest({
        request: new Request(`http://localhost:${port}/api/relevance`, {
          method: request.method,
          headers: { "Content-Type": "application/json" },
          body: body === undefined ? undefined : JSON.stringify(body)
        }),
        env: process.env
      });
      sendJson(response, apiResponse.status, await apiResponse.json());
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

async function handleLocalFeedback(request, response, url) {
  if (request.method === "GET") {
    const threadId = url.searchParams.get("id");
    if (threadId) {
      const thread = localFeedbackThreads.find((item) => item.id === threadId);
      if (!thread) {
        sendJson(response, 404, { error: "Feedback thread not found." });
        return;
      }

      sendJson(response, 200, {
        viewer: { authenticated: false, canReply: false, email: "" },
        thread
      });
      return;
    }

    sendJson(response, 200, {
      viewer: { authenticated: false, canReply: false, email: "" },
      items: localFeedbackThreads.map(toLocalFeedbackListItem)
    });
    return;
  }

  if (request.method !== "POST") {
    sendJson(response, 405, { error: "Method not allowed" });
    return;
  }

  const body = await readJsonRequest(request).catch(() => ({}));
  if (body?.threadId) {
    sendJson(response, 403, {
      error: "Developer replies are only available in the deployed Cloudflare version."
    });
    return;
  }

  const title = normalizeLocalFeedbackText(body?.title, 90);
  const message = normalizeLocalFeedbackText(body?.body, 1800);
  if (!title || !message) {
    sendJson(response, 400, { error: "Please enter both a title and a feedback message." });
    return;
  }

  const now = new Date().toISOString();
  const thread = {
    id: `local-feedback-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    title,
    body: message,
    replyCount: 0,
    createdAt: now,
    updatedAt: now,
    replies: []
  };

  localFeedbackThreads.unshift(thread);

  sendJson(response, 200, {
    viewer: { authenticated: false, canReply: false, email: "" },
    items: localFeedbackThreads.map(toLocalFeedbackListItem),
    thread
  });
}

function normalizeLocalFeedbackText(value, limit) {
  return String(value || "").replace(/\r\n?/g, "\n").trim().slice(0, limit);
}

function toLocalFeedbackListItem(thread) {
  return {
    id: thread.id,
    title: thread.title,
    body: thread.body,
    replyCount: thread.replyCount || 0,
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt
  };
}
