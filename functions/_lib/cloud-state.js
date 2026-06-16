const SESSION_COOKIE = "courseforge_session";
const SESSION_DAYS = 30;
const PASSWORD_ITERATIONS = 120000;

const schemaStatements = [
  `CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    password_salt TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS courses (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    audience TEXT NOT NULL,
    color TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS documents (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    course_id TEXT NOT NULL,
    name TEXT NOT NULL,
    type TEXT,
    size INTEGER,
    text TEXT,
    safety_json TEXT,
    storage_key TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS generations (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    course_id TEXT NOT NULL,
    task TEXT,
    title TEXT,
    output_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS feedback_threads (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS feedback_replies (
    id TEXT PRIMARY KEY,
    thread_id TEXT NOT NULL,
    author_user_id TEXT,
    author_email TEXT,
    author_label TEXT,
    body TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  "CREATE INDEX IF NOT EXISTS idx_sessions_token_hash ON sessions(token_hash)",
  "CREATE INDEX IF NOT EXISTS idx_courses_user_id ON courses(user_id)",
  "CREATE INDEX IF NOT EXISTS idx_documents_user_id ON documents(user_id)",
  "CREATE INDEX IF NOT EXISTS idx_generations_user_id ON generations(user_id)",
  "CREATE INDEX IF NOT EXISTS idx_feedback_threads_updated_at ON feedback_threads(updated_at)",
  "CREATE INDEX IF NOT EXISTS idx_feedback_replies_thread_id ON feedback_replies(thread_id)",
  "CREATE INDEX IF NOT EXISTS idx_feedback_replies_created_at ON feedback_replies(created_at)"
];

export function json(data, init = {}) {
  return Response.json(data, {
    ...init,
    headers: {
      "Cache-Control": "no-store",
      ...(init.headers || {})
    }
  });
}

export function getDb(env = {}) {
  return env.COURSEFORGE_DB || env.DB || null;
}

export function getFilesBucket(env = {}) {
  return env.COURSEFORGE_FILES || env.FILES || null;
}

export async function ensureSchema(env) {
  const db = getDb(env);
  if (!db) return null;
  for (const statement of schemaStatements) {
    await db.prepare(statement).run();
  }
  return db;
}

export async function requireDb(env) {
  const db = await ensureSchema(env);
  if (!db) {
    return {
      error: json({
        configured: false,
        error: "Cloud database is not configured. Bind a D1 database as COURSEFORGE_DB."
      })
    };
  }
  return { db };
}

export function publicUser(row) {
  return row ? { id: row.id, email: row.email } : null;
}

export async function registerUser(env, { email, password }) {
  const { db, error } = await requireDb(env);
  if (error) return { error };

  const normalizedEmail = normalizeEmail(email);
  const passwordError = validatePassword(password);
  if (!normalizedEmail || passwordError) {
    return { error: json({ error: passwordError || "Enter a valid email address." }, { status: 400 }) };
  }

  const existing = await db.prepare("SELECT id FROM users WHERE email = ?").bind(normalizedEmail).first();
  if (existing) return { error: json({ error: "This email is already registered." }, { status: 409 }) };

  const now = new Date().toISOString();
  const salt = randomToken(18);
  const passwordHash = await hashPassword(password, salt);
  const user = { id: newId("user"), email: normalizedEmail };

  await db.prepare(
    `INSERT INTO users (id, email, password_hash, password_salt, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(user.id, user.email, passwordHash, salt, now, now).run();

  return createSessionResponse(db, user);
}

export async function loginUser(env, { email, password }) {
  const { db, error } = await requireDb(env);
  if (error) return { error };

  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail || !password) {
    return { error: json({ error: "Enter your email and password." }, { status: 400 }) };
  }

  const row = await db.prepare("SELECT * FROM users WHERE email = ?").bind(normalizedEmail).first();
  if (!row) return { error: json({ error: "Invalid email or password." }, { status: 401 }) };

  const expectedHash = await hashPassword(password, row.password_salt);
  if (!timingSafeEqual(expectedHash, row.password_hash)) {
    return { error: json({ error: "Invalid email or password." }, { status: 401 }) };
  }

  return createSessionResponse(db, publicUser(row));
}

export async function logoutUser(request, env) {
  const { db } = await requireDb(env);
  if (db) {
    const token = getCookie(request, SESSION_COOKIE);
    if (token) {
      await db.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(await sha256(token)).run();
    }
  }

  return json({ ok: true }, {
    headers: {
      "Set-Cookie": `${SESSION_COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`
    }
  });
}

export async function requireUser(request, env) {
  const { db, error } = await requireDb(env);
  if (error) return { error };

  const token = getCookie(request, SESSION_COOKIE);
  if (!token) return { error: json({ authenticated: false, error: "Not signed in." }, { status: 401 }) };

  const tokenHash = await sha256(token);
  const row = await db.prepare(
    `SELECT users.id, users.email
     FROM sessions
     JOIN users ON users.id = sessions.user_id
     WHERE sessions.token_hash = ? AND sessions.expires_at > ?`
  ).bind(tokenHash, new Date().toISOString()).first();

  if (!row) return { error: json({ authenticated: false, error: "Session expired." }, { status: 401 }) };
  return { db, user: publicUser(row) };
}

export async function readUserState(db, userId) {
  const [coursesResult, documentsResult, generationsResult] = await Promise.all([
    db.prepare("SELECT * FROM courses WHERE user_id = ? ORDER BY created_at DESC").bind(userId).all(),
    db.prepare("SELECT * FROM documents WHERE user_id = ? ORDER BY created_at DESC").bind(userId).all(),
    db.prepare("SELECT * FROM generations WHERE user_id = ? ORDER BY created_at DESC").bind(userId).all()
  ]);

  return {
    courses: (coursesResult.results || []).map((row) => ({
      id: row.id,
      name: row.name,
      audience: row.audience,
      color: row.color,
      createdAt: row.created_at
    })),
    documents: (documentsResult.results || []).map((row) => ({
      id: row.id,
      courseId: row.course_id,
      name: row.name,
      type: row.type,
      size: row.size || 0,
      text: row.text || "",
      safety: parseJson(row.safety_json, null),
      storageKey: row.storage_key || "",
      createdAt: row.created_at
    })),
    generations: (generationsResult.results || []).map((row) => ({
      id: row.id,
      courseId: row.course_id,
      task: row.task,
      title: row.title,
      output: parseJson(row.output_json, {}),
      createdAt: row.created_at
    }))
  };
}

export async function replaceUserState(db, userId, state) {
  const now = new Date().toISOString();
  const courses = Array.isArray(state?.courses) ? state.courses : [];
  const documents = Array.isArray(state?.documents) ? state.documents : [];
  const generations = Array.isArray(state?.generations) ? state.generations : [];
  const courseIds = new Set(courses.map((course) => course.id).filter(Boolean));
  const documentIds = new Set(documents.map((document) => document.id).filter(Boolean));
  const generationIds = new Set(generations.map((generation) => generation.id).filter(Boolean));

  const previousDocuments = await db.prepare("SELECT id, storage_key FROM documents WHERE user_id = ?").bind(userId).all();
  const removedStorageKeys = (previousDocuments.results || [])
    .filter((document) => !documentIds.has(document.id) && document.storage_key)
    .map((document) => document.storage_key);

  const statements = [];

  statements.push(
    db.prepare(`DELETE FROM courses WHERE user_id = ? ${courseIds.size ? `AND id NOT IN (${placeholders(courseIds.size)})` : ""}`)
      .bind(userId, ...courseIds)
  );
  statements.push(
    db.prepare(`DELETE FROM documents WHERE user_id = ? ${documentIds.size ? `AND id NOT IN (${placeholders(documentIds.size)})` : ""}`)
      .bind(userId, ...documentIds)
  );
  statements.push(
    db.prepare(`DELETE FROM generations WHERE user_id = ? ${generationIds.size ? `AND id NOT IN (${placeholders(generationIds.size)})` : ""}`)
      .bind(userId, ...generationIds)
  );

  for (const course of courses) {
    statements.push(db.prepare(
      `INSERT INTO courses (id, user_id, name, audience, color, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         audience = excluded.audience,
         color = excluded.color,
         updated_at = excluded.updated_at`
    ).bind(
      String(course.id || newId("course")),
      userId,
      String(course.name || "Untitled course"),
      String(course.audience || "学生"),
      String(course.color || "#0f766e"),
      String(course.createdAt || now),
      now
    ));
  }

  for (const document of documents) {
    statements.push(db.prepare(
      `INSERT INTO documents (id, user_id, course_id, name, type, size, text, safety_json, storage_key, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         course_id = excluded.course_id,
         name = excluded.name,
         type = excluded.type,
         size = excluded.size,
         text = excluded.text,
         safety_json = excluded.safety_json,
         storage_key = COALESCE(NULLIF(excluded.storage_key, ''), documents.storage_key),
         updated_at = excluded.updated_at`
    ).bind(
      String(document.id || newId("document")),
      userId,
      String(document.courseId || ""),
      String(document.name || "Untitled material"),
      String(document.type || "Course material"),
      Number(document.size || 0),
      String(document.text || ""),
      JSON.stringify(document.safety || null),
      String(document.storageKey || ""),
      String(document.createdAt || now),
      now
    ));
  }

  for (const generation of generations) {
    statements.push(db.prepare(
      `INSERT INTO generations (id, user_id, course_id, task, title, output_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         course_id = excluded.course_id,
         task = excluded.task,
         title = excluded.title,
         output_json = excluded.output_json,
         updated_at = excluded.updated_at`
    ).bind(
      String(generation.id || newId("generation")),
      userId,
      String(generation.courseId || ""),
      String(generation.task || ""),
      String(generation.title || generation.output?.title || "Generated output"),
      JSON.stringify(generation.output || {}),
      String(generation.createdAt || now),
      now
    ));
  }

  if (statements.length) await db.batch(statements);
  return { removedStorageKeys };
}

export async function putDocumentFile(env, userId, courseId, documentId, file) {
  const bucket = getFilesBucket(env);
  if (!bucket) {
    return { configured: false, storageKey: "" };
  }

  const safeName = String(file.name || "material.bin").replace(/[^\w.\-]+/g, "_").slice(0, 120);
  const storageKey = `users/${userId}/courses/${courseId}/documents/${documentId}/${Date.now()}-${safeName}`;
  await bucket.put(storageKey, file.stream(), {
    httpMetadata: { contentType: file.type || "application/octet-stream" },
    customMetadata: {
      userId,
      courseId,
      documentId,
      originalName: String(file.name || "")
    }
  });

  return { configured: true, storageKey };
}

async function createSessionResponse(db, user) {
  const token = randomToken(36);
  const tokenHash = await sha256(token);
  const now = new Date();
  const expires = new Date(now.getTime() + SESSION_DAYS * 24 * 60 * 60 * 1000);

  await db.prepare(
    "INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)"
  ).bind(newId("session"), user.id, tokenHash, expires.toISOString(), now.toISOString()).run();

  return {
    user,
    cookie: `${SESSION_COOKIE}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${SESSION_DAYS * 24 * 60 * 60}`
  };
}

function normalizeEmail(value) {
  const email = String(value || "").trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : "";
}

function validatePassword(password) {
  if (String(password || "").length < 8) return "Password must be at least 8 characters.";
  return "";
}

async function hashPassword(password, salt) {
  if (!crypto.subtle?.importKey || !crypto.subtle?.deriveBits) {
    return hashPasswordFallback(password, salt);
  }

  const encoder = new TextEncoder();
  try {
    const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
    const bits = await crypto.subtle.deriveBits(
      { name: "PBKDF2", hash: "SHA-256", salt: encoder.encode(salt), iterations: PASSWORD_ITERATIONS },
      key,
      256
    );
    return `pbkdf2:${bytesToBase64(new Uint8Array(bits))}`;
  } catch {
    return hashPasswordFallback(password, salt);
  }
}

async function hashPasswordFallback(password, salt) {
  let value = `${salt}:${password}`;
  for (let index = 0; index < 250; index += 1) {
    value = await sha256(value);
  }
  return `sha256:${value}`;
}

async function sha256(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return bytesToHex(new Uint8Array(digest));
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let index = 0; index < a.length; index += 1) {
    mismatch |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return mismatch === 0;
}

function getCookie(request, name) {
  const cookie = request.headers.get("Cookie") || "";
  return cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`))
    ?.slice(name.length + 1) || "";
}

function randomToken(byteLength) {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return bytesToBase64Url(bytes);
}

function newId(prefix) {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `${prefix}_${randomToken(18)}`;
}

function bytesToHex(bytes) {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function bytesToBase64(bytes) {
  return btoa(String.fromCharCode(...bytes));
}

function bytesToBase64Url(bytes) {
  return bytesToBase64(bytes).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function parseJson(value, fallback) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function placeholders(count) {
  return Array.from({ length: count }, () => "?").join(", ");
}
