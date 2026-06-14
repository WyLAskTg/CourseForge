const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const DEFAULT_MODEL = "gpt-5.4-mini";

export async function onRequest(context) {
  if (context.request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  return handleGenerateRequest(context);
}

async function handleGenerateRequest({ request, env }) {
  const apiKey = env?.OPENAI_API_KEY;
  if (!apiKey) {
    return Response.json({
      configured: false,
      error: "OPENAI_API_KEY is not configured in Cloudflare Pages environment variables."
    });
  }

  try {
    const payload = await request.json();
    const output = await generateCourseOutput(payload, {
      apiKey,
      model: env.OPENAI_MODEL || DEFAULT_MODEL
    });

    return Response.json({ output });
  } catch (error) {
    return Response.json({ error: error.message || "Generation failed." }, { status: 500 });
  }
}

export async function generateCourseOutput(payload, { apiKey, model = DEFAULT_MODEL }) {
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

  const text = extractOutputText(data);
  if (!text) throw new Error("OpenAI returned no output text.");

  return JSON.parse(text);
}

function buildSystemPrompt() {
  return [
    "You are CourseForge, an education-focused generation engine.",
    "Return final user-facing content only, never prompts, hidden instructions, planning text, or chain-of-thought.",
    "Use the uploaded course materials as source context. If the materials are insufficient, say so in the output instead of inventing details.",
    "For quizzes and mock exams, generate answerable questions with complete conditions and answers or marking guides.",
    "Do not copy uploaded exam questions. You may preserve topic and question type, but change decisive data, scenario, wording, and context.",
    "Use clear paragraph breaks. Put each multi-part question, answer step, proof step, or rubric item on its own line.",
    "Use standard LaTeX delimiters for mathematical notation: inline \\(...\\), display \\[...\\]. Do not leave raw LaTeX commands without delimiters.",
    "Inside JSON strings, do not double-escape LaTeX. The parsed text should contain \\(x\\), not \\\\(x\\\\).",
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
    outputContract:
      "Return an object with title, type, checks, items, and safety. items must contain final content in body and answer, not instructions. Use line breaks and LaTeX delimiters where helpful."
  };
}

function extractOutputText(data) {
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
