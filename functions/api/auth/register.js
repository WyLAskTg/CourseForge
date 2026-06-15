import { json, registerUser } from "../../_lib/cloud-state.js";

export async function onRequest({ request, env }) {
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, { status: 405 });
  }

  const body = await request.json().catch(() => ({}));
  const result = await registerUser(env, body);
  if (result.error) return result.error;

  return json(
    { authenticated: true, user: result.user },
    { headers: { "Set-Cookie": result.cookie } }
  );
}
