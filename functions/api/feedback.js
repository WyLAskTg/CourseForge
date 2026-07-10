import { json, requireDb, requireUser } from "../_lib/cloud-state.js";

const TITLE_LIMIT = 90;
const BODY_LIMIT = 1800;

export async function onRequest(context) {
  const { request, env } = context;
  const { db, error } = await requireDb(env);
  if (error) return error;

  if (request.method === "GET") {
    return handleGet(request, env, db);
  }

  if (request.method === "POST") {
    return handlePost(request, env, db);
  }

  return json({ error: "Method not allowed" }, { status: 405 });
}

async function handleGet(request, env, db) {
  const viewer = await resolveViewer(request, env);
  const threadId = new URL(request.url).searchParams.get("id");

  if (threadId) {
    const thread = await readFeedbackThread(db, threadId);
    if (!thread) {
      return json({ error: "Feedback thread not found." }, { status: 404 });
    }
    return json({ viewer, thread });
  }

  return json({
    viewer,
    items: await listFeedbackThreads(db)
  });
}

async function handlePost(request, env, db) {
  const body = await request.json().catch(() => ({}));
  const threadId = String(body?.threadId || "").trim();

  if (threadId) {
    const viewer = await resolveViewer(request, env);

    if (String(body?.action || "").trim().toLowerCase() === "like") {
      const thread = await likeFeedbackThread(db, threadId);
      if (!thread) {
        return json({ error: "Feedback thread not found." }, { status: 404 });
      }

      return json({
        viewer,
        items: await listFeedbackThreads(db),
        thread
      });
    }

    const replyBody = normalizeFeedbackText(body?.body, BODY_LIMIT);
    if (!replyBody) {
      return json({ error: "Reply content cannot be empty." }, { status: 400 });
    }

    const thread = await createFeedbackReply(db, threadId, viewer, replyBody);
    if (!thread) {
      return json({ error: "Feedback thread not found." }, { status: 404 });
    }

    return json({
      viewer,
      items: await listFeedbackThreads(db),
      thread
    });
  }

  const title = normalizeFeedbackText(body?.title, TITLE_LIMIT);
  const threadBody = normalizeFeedbackText(body?.body, BODY_LIMIT);
  if (!title || !threadBody) {
    return json({ error: "Please enter both a title and a feedback message." }, { status: 400 });
  }

  const thread = await createFeedbackThread(db, { title, body: threadBody });
  const viewer = await resolveViewer(request, env);
  return json({
    viewer,
    items: await listFeedbackThreads(db),
    thread
  });
}

async function resolveViewer(request, env) {
  const auth = await requireUser(request, env);
  if (auth.user) return buildViewerState(auth.user, env);
  return buildViewerState(null, env);
}

function buildViewerState(user, env) {
  return {
    authenticated: Boolean(user),
    canReply: Boolean(user && isDeveloperUser(user, env)),
    isDeveloper: Boolean(user && isDeveloperUser(user, env)),
    userId: String(user?.id || ""),
    email: String(user?.email || "")
  };
}

function isDeveloperUser(user, env) {
  if (!user?.email) return false;
  const email = String(user.email).trim().toLowerCase();
  const allowed = developerEmailSet(env);
  return allowed.size ? allowed.has(email) : true;
}

function developerEmailSet(env = {}) {
  return new Set(
    [
      env.COURSEFORGE_DEVELOPER_EMAILS,
      env.COURSEFORGE_DEVELOPER_EMAIL,
      env.DEVELOPER_EMAILS,
      env.DEVELOPER_EMAIL
    ]
      .filter(Boolean)
      .flatMap((value) => String(value).split(/[,\s]+/))
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean)
  );
}

function normalizeFeedbackText(value, limit) {
  const text = String(value || "")
    .replace(/\r\n?/g, "\n")
    .replace(/\u0000/g, "")
    .trim();
  if (!text) return "";
  return text.slice(0, limit);
}

async function createFeedbackThread(db, { title, body }) {
  const now = new Date().toISOString();
  const id = newFeedbackId("feedback");

  await db.prepare(
    `INSERT INTO feedback_threads (id, title, body, like_count, created_at, updated_at)
     VALUES (?, ?, ?, 0, ?, ?)`
  ).bind(id, title, body, now, now).run();

  return readFeedbackThread(db, id);
}

async function createFeedbackReply(db, threadId, viewer, body) {
  const existing = await db.prepare("SELECT id FROM feedback_threads WHERE id = ?").bind(threadId).first();
  if (!existing) return null;

  const now = new Date().toISOString();
  const replyId = newFeedbackId("reply");
  const isDeveloper = Boolean(viewer?.isDeveloper);
  const authorLabel = isDeveloper ? "Developer" : "Anonymous";

  await db.batch([
    db.prepare(
      `INSERT INTO feedback_replies (id, thread_id, author_user_id, author_email, author_label, body, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(replyId, threadId, viewer?.userId || null, isDeveloper ? viewer?.email || "" : null, authorLabel, body, now, now),
    db.prepare("UPDATE feedback_threads SET updated_at = ? WHERE id = ?").bind(now, threadId)
  ]);

  return readFeedbackThread(db, threadId);
}

async function likeFeedbackThread(db, threadId) {
  const existing = await db.prepare("SELECT id FROM feedback_threads WHERE id = ?").bind(threadId).first();
  if (!existing) return null;
  await db.prepare("UPDATE feedback_threads SET like_count = COALESCE(like_count, 0) + 1 WHERE id = ?").bind(threadId).run();
  return readFeedbackThread(db, threadId);
}

async function listFeedbackThreads(db) {
  const result = await db.prepare(
    `SELECT
       feedback_threads.id,
       feedback_threads.title,
       feedback_threads.body,
       COALESCE(feedback_threads.like_count, 0) AS like_count,
       feedback_threads.created_at,
       feedback_threads.updated_at,
       COUNT(feedback_replies.id) AS reply_count
     FROM feedback_threads
     LEFT JOIN feedback_replies ON feedback_replies.thread_id = feedback_threads.id
     GROUP BY feedback_threads.id, feedback_threads.like_count
     ORDER BY feedback_threads.updated_at DESC, feedback_threads.created_at DESC`
  ).all();

  return (result.results || []).map(feedbackThreadRowToItem);
}

async function readFeedbackThread(db, threadId) {
  const threadRow = await db.prepare(
    `SELECT
       feedback_threads.id,
       feedback_threads.title,
       feedback_threads.body,
       COALESCE(feedback_threads.like_count, 0) AS like_count,
       feedback_threads.created_at,
       feedback_threads.updated_at,
       COUNT(feedback_replies.id) AS reply_count
     FROM feedback_threads
     LEFT JOIN feedback_replies ON feedback_replies.thread_id = feedback_threads.id
     WHERE feedback_threads.id = ?
     GROUP BY feedback_threads.id, feedback_threads.like_count`
  ).bind(threadId).first();

  if (!threadRow) return null;

  const repliesResult = await db.prepare(
    `SELECT id, author_label, body, created_at, updated_at
     FROM feedback_replies
     WHERE thread_id = ?
     ORDER BY created_at ASC`
  ).bind(threadId).all();

  return {
    ...feedbackThreadRowToItem(threadRow),
    replies: (repliesResult.results || []).map((row) => ({
      id: row.id,
      authorLabel: row.author_label || "Developer",
      body: row.body || "",
      createdAt: row.created_at,
      updatedAt: row.updated_at || row.created_at
    }))
  };
}

function feedbackThreadRowToItem(row) {
  return {
    id: row.id,
    title: row.title || "",
    body: row.body || "",
    likeCount: Number(row.like_count || 0),
    replyCount: Number(row.reply_count || 0),
    createdAt: row.created_at,
    updatedAt: row.updated_at || row.created_at
  };
}

function newFeedbackId(prefix) {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
