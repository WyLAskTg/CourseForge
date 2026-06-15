import { getFilesBucket, json, readUserState, replaceUserState, requireUser } from "../_lib/cloud-state.js";

export async function onRequest({ request, env }) {
  const { db, user, error } = await requireUser(request, env);
  if (error) return error;

  if (request.method === "GET") {
    return json({ user, state: await readUserState(db, user.id) });
  }

  if (request.method === "POST" || request.method === "PUT") {
    const body = await request.json().catch(() => ({}));
    const incomingState = body.state || body;
    const result = await replaceUserState(db, user.id, incomingState);
    await removeDeletedFiles(env, result.removedStorageKeys);
    return json({ ok: true, user, state: await readUserState(db, user.id) });
  }

  return json({ error: "Method not allowed" }, { status: 405 });
}

async function removeDeletedFiles(env, storageKeys = []) {
  const bucket = getFilesBucket(env);
  if (!bucket || !storageKeys.length) return;

  await Promise.allSettled(storageKeys.map((storageKey) => bucket.delete(storageKey)));
}
