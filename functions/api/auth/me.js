import { json, requireUser } from "../../_lib/cloud-state.js";

export async function onRequest({ request, env }) {
  if (request.method !== "GET") {
    return json({ error: "Method not allowed" }, { status: 405 });
  }

  const { user, error } = await requireUser(request, env);
  if (error) return error;

  return json({ authenticated: true, user });
}
