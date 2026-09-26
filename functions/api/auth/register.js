import { json, registerUser } from "../../_lib/cloud-state.js";

const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const requestLog = new Map();

function isRateLimited(key) {
  const now = Date.now();
  const timestamps = (requestLog.get(key) || []).filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
  timestamps.push(now);
  requestLog.set(key, timestamps);
  return timestamps.length > RATE_LIMIT_MAX;
}

export async function onRequest({ request, env }) {
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, { status: 405 });
  }

  const clientIp = request.headers.get("CF-Connecting-IP") || "unknown";
  if (isRateLimited(clientIp)) {
    return json({ error: "Too many requests. Please try again later." }, { status: 429 });
  }

  try {
    const body = await request.json().catch(() => ({}));
    const result = await registerUser(env, body);
    if (result.error) return result.error;

    return json(
      { authenticated: true, user: result.user },
      { headers: { "Set-Cookie": result.cookie } }
    );
  } catch (error) {
    return json({ error: error.message || "Registration failed." }, { status: 500 });
  }
}
