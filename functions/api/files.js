import { json, putDocumentFile, requireUser } from "../_lib/cloud-state.js";

export async function onRequest({ request, env }) {
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, { status: 405 });
  }

  const { user, error } = await requireUser(request, env);
  if (error) return error;

  const formData = await request.formData().catch(() => null);
  const file = formData?.get("file");
  const courseId = String(formData?.get("courseId") || "");
  const documentId = String(formData?.get("documentId") || "");

  if (!(file instanceof File) || !courseId || !documentId) {
    return json({ error: "Upload requires file, courseId, and documentId." }, { status: 400 });
  }

  return json(await putDocumentFile(env, user.id, courseId, documentId, file));
}
