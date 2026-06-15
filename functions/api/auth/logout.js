import { json, logoutUser } from "../../_lib/cloud-state.js";

export async function onRequest({ request, env }) {
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, { status: 405 });
  }

  return logoutUser(request, env);
}
