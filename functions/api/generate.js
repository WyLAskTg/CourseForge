export async function onRequestPost({ request }) {
  await request.text();

  return Response.json(
    {
      configured: false,
      error:
        "AI backend is not connected. Implement this function to call a real model and return final user-facing JSON."
    }
  );
}

export async function onRequest() {
  return Response.json({ error: "Method not allowed" }, { status: 405 });
}
