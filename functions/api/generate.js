const DEEPSEEK_CHAT_URL = "https://api.deepseek.com/chat/completions";
const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const DEFAULT_DEEPSEEK_MODEL = "deepseek-chat";
const DEFAULT_OPENAI_MODEL = "gpt-5.4-mini";

export async function onRequest(context) {
  if (context.request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  return handleGenerateRequest(context);
}

async function handleGenerateRequest({ request, env }) {
  const provider = resolveGenerationProvider(env);
  if (!provider) {
    return Response.json({
      configured: false,
      error: "DEEPSEEK_API_KEY is not configured. Add it in Cloudflare Pages environment variables."
    });
  }

  try {
    const payload = await request.json();
    const output = await generateCourseOutput(payload, provider);

    return Response.json({ output, provider: provider.name, model: provider.model });
  } catch (error) {
    return Response.json({ error: error.message || "Generation failed." }, { status: 500 });
  }
}

export function resolveGenerationProvider(env = {}) {
  const requestedProvider = String(env.AI_PROVIDER || "deepseek").toLowerCase();

  if (requestedProvider === "openai") {
    if (!env.OPENAI_API_KEY) return null;
    return {
      name: "OpenAI",
      provider: "openai",
      apiKey: env.OPENAI_API_KEY,
      model: env.OPENAI_MODEL || DEFAULT_OPENAI_MODEL
    };
  }

  if (env.DEEPSEEK_API_KEY) {
    return {
      name: "DeepSeek",
      provider: "deepseek",
      apiKey: env.DEEPSEEK_API_KEY,
      model: env.DEEPSEEK_MODEL || DEFAULT_DEEPSEEK_MODEL
    };
  }

  return null;
}

export async function generateCourseOutput(payload, options) {
  if (options?.provider === "deepseek") {
    return generateWithDeepSeek(payload, options);
  }

  return generateWithOpenAI(payload, options);
}

async function generateWithDeepSeek(payload, { apiKey, model = DEFAULT_DEEPSEEK_MODEL }) {
  const response = await fetch(DEEPSEEK_CHAT_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: "system",
          content: buildSystemPrompt()
        },
        {
          role: "user",
          content: JSON.stringify(buildUserPayload(payload))
        }
      ],
      response_format: { type: "json_object" },
      temperature: 0.2,
      stream: false
    })
  });

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(data?.error?.message || `DeepSeek API returned HTTP ${response.status}`);
  }

  const text = data?.choices?.[0]?.message?.content || "";
  if (!text) throw new Error("DeepSeek returned no output text.");

  return normalizeGeneratedOutput(parseJsonOutput(text), payload);
}

async function generateWithOpenAI(payload, { apiKey, model = DEFAULT_OPENAI_MODEL }) {
  const response = await fetch(OPENAI_RESPONSES_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      reasoning: { effort: "low" },
      input: [
        {
          role: "system",
          content: buildSystemPrompt()
        },
        {
          role: "user",
          content: JSON.stringify(buildUserPayload(payload))
        }
      ],
      store: false,
      text: {
        format: {
          type: "json_schema",
          name: "courseforge_output",
          strict: true,
          schema: outputSchema()
        }
      }
    })
  });

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(data?.error?.message || `OpenAI API returned HTTP ${response.status}`);
  }

  const text = extractOpenAIOutputText(data);
  if (!text) throw new Error("OpenAI returned no output text.");

  return normalizeGeneratedOutput(parseJsonOutput(text), payload);
}

function buildSystemPrompt() {
  return [
    "You are CourseForge, an education-focused generation engine.",
    "Return only one valid JSON object. Do not wrap it in markdown fences.",
    "Return final user-facing content only, never prompts, hidden instructions, planning text, or chain-of-thought.",
    "Use the uploaded course materials as source context. If the materials are insufficient, say so in the output instead of inventing details.",
    "For quizzes and mock exams, generate answerable questions with complete conditions and answers or marking guides.",
    "For quizzes and mock exams, always populate each item's answer field. The interface will hide or reveal answers per question.",
    "Do not copy uploaded exam questions. You may preserve topic and question type, but change decisive data, scenario, wording, and context.",
    "Use clear paragraph breaks. Put each multi-part question, answer step, proof step, or rubric item on its own line.",
    "Use standard LaTeX delimiters for mathematical notation: inline \\(...\\), display \\[...\\]. Do not leave raw LaTeX commands without delimiters.",
    "Inside JSON strings, do not double-escape LaTeX. The parsed text should contain \\(x\\), not \\\\(x\\\\).",
    "Never nest math delimiters. Write \\frac{a}{b} inside a single \\(...\\), not \\(\\frac{a}{b}\\) inside another math expression.",
    "Do not wrap single math commands separately inside a longer formula. Write \\(\\nabla f(1,0) / \\|\\nabla f(1,0)\\| = (1/\\sqrt{2}, 1/\\sqrt{2})\\), not \\(\\nabla\\) f(1,0) = \\( ... \\).",
    "Write in the requested output language unless the user's current request explicitly asks otherwise.",
    "For humanities or public-affairs content, separate facts, viewpoints, and sources.",
    "If the request or materials require political persuasion, ideological advocacy, discriminatory claims, or one-sided propaganda, return a refusal output with a clear reason."
  ].join("\n");
}

function buildUserPayload(payload) {
  return {
    task: payload.task,
    course: payload.course,
    settings: payload.settings,
    outputLanguage: payload.settings?.language === "en" ? "English" : "Simplified Chinese",
    safety: payload.safety,
    materials: (payload.materials || []).map((material) => ({
      name: material.name,
      type: material.type,
      text: String(material.text || "").slice(0, 30000)
    })),
    currentRequest: payload.settings?.extraRequirement || "",
    outputContract: {
      instruction:
        "Return JSON with title, type, checks, items, and safety. The root may be the output object itself or { output: ... }. items must contain final content in body and answer, not instructions.",
      schema: outputSchema()
    }
  };
}

function extractOpenAIOutputText(data) {
  if (typeof data?.output_text === "string") return data.output_text;

  for (const item of data?.output || []) {
    if (item.type !== "message") continue;
    for (const content of item.content || []) {
      if (content.type === "output_text" && typeof content.text === "string") {
        return content.text;
      }
    }
  }

  return "";
}

function parseJsonOutput(text) {
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("AI provider returned text instead of JSON.");
    return JSON.parse(match[0]);
  }
}

function normalizeGeneratedOutput(value, payload) {
  const output = value?.output || value;
  if (!output || !Array.isArray(output.items)) {
    throw new Error("AI provider returned JSON, but not the expected CourseForge output shape.");
  }

  return {
    title: String(output.title || "生成结果 / Generated Output"),
    type: normalizeOutputType(output.type, payload.task),
    checks: normalizeChecks(output.checks),
    items: output.items.map((item, index) => ({
      title: String(item?.title || `Item ${index + 1}`),
      body: String(item?.body || ""),
      answer: String(item?.answer || ""),
      meta: Array.isArray(item?.meta) ? item.meta.map(String) : [],
      checks: normalizeChecks(item?.checks)
    })),
    safety: normalizeSafety(output.safety, payload.safety)
  };
}

function normalizeOutputType(value, fallback) {
  const allowed = new Set(["knowledge", "pitfalls", "quiz", "mock", "refusal", "system"]);
  return allowed.has(value) ? value : fallback || "knowledge";
}

function normalizeChecks(value) {
  if (!Array.isArray(value)) return [];
  return value.map((check) => ({
    label: String(check?.label || "Review"),
    status: ["pass", "review", "blocked"].includes(check?.status) ? check.status : "review",
    detail: String(check?.detail || "")
  }));
}

function normalizeSafety(value, fallback) {
  return {
    level: String(value?.level || fallback?.level || "clear"),
    label: String(value?.label || fallback?.label || "通过 / Clear"),
    reason: String(value?.reason || fallback?.reason || "")
  };
}

function outputSchema() {
  const checkSchema = {
    type: "object",
    additionalProperties: false,
    properties: {
      label: { type: "string" },
      status: { type: "string", enum: ["pass", "review", "blocked"] },
      detail: { type: "string" }
    },
    required: ["label", "status", "detail"]
  };

  return {
    type: "object",
    additionalProperties: false,
    properties: {
      title: { type: "string" },
      type: { type: "string", enum: ["knowledge", "pitfalls", "quiz", "mock", "refusal", "system"] },
      checks: { type: "array", items: checkSchema },
      items: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            title: { type: "string" },
            body: { type: "string" },
            answer: { type: "string" },
            meta: { type: "array", items: { type: "string" } },
            checks: { type: "array", items: checkSchema }
          },
          required: ["title", "body", "answer", "meta", "checks"]
        }
      },
      safety: {
        type: "object",
        additionalProperties: false,
        properties: {
          level: { type: "string" },
          label: { type: "string" },
          reason: { type: "string" }
        },
        required: ["level", "label", "reason"]
      }
    },
    required: ["title", "type", "checks", "items", "safety"]
  };
}
