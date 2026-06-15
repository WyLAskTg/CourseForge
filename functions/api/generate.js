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
  const output = await requestDeepSeekOutput(payload, { apiKey, model });
  const qualityIssues = findFinalAnswerQualityIssues(output);

  if (!qualityIssues.length) return output;

  try {
    return await requestDeepSeekOutput(payload, {
      apiKey,
      model,
      revision: buildRevisionPayload(output, qualityIssues)
    });
  } catch {
    return output;
  }
}

async function requestDeepSeekOutput(payload, { apiKey, model, revision }) {
  const userPayload = buildUserPayload(payload);
  if (revision) {
    userPayload.qualityRevision = revision;
  }

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
          content: JSON.stringify(userPayload)
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
    "For every item.answer, write the final polished solution/proof only. Do not include exploration, self-correction, hedging, alternative discarded paths, or phrases like maybe, perhaps, however the problem may mean, on second thought, 可能, 也许, 然而题目可能, 更准确地说, 故不一定.",
    "Before returning JSON, privately verify that each answer has exactly one final conclusion and no contradiction. If a proof question has a false premise or no such object exists, state that final conclusion directly and prove it.",
    "For math proofs, use a concise final-answer structure such as 结论: ... / 证明: ... or 解: ... . Each step must logically support the final conclusion. Do not narrate trial-and-error reasoning.",
    "Use the uploaded course materials as source context. If the materials are insufficient, say so in the output instead of inventing details.",
    "For quizzes and mock exams, generate answerable questions with complete conditions and answers or marking guides.",
    "For quizzes and mock exams, always populate each item's answer field. The interface will hide or reveal answers per question.",
    "Do not copy uploaded exam questions. You may preserve topic and question type, but change decisive data, scenario, wording, and context.",
    "Use clear paragraph breaks. Put each multi-part question, answer step, proof step, or rubric item on its own line.",
    "Never use external image URLs, placeholder image services, Markdown image links, or links such as via.placeholder.com.",
    "When a non-circuit problem needs a diagram, describe the diagram completely in text unless the answer can be made self-contained without an image.",
    "For every circuit problem, you must draw the circuit with the CourseForge circuit DSL inside a fenced ```circuit block. Do not use ASCII art, box-drawing characters, Markdown image syntax, external links, or placeholder images for circuits.",
    "CourseForge circuit DSL commands are: size W H; node ID X Y; wire A B; dot A; resistor R1 2ohm A B; capacitor C1 1nF A B; lamp L A B; switch S1 A B open; switch S1 A B closed; ammeter A A B; battery U_S 12V A B; voltage US 12V A B; current IS 3A A B; arrow I A B; ground G; label text X Y. Use coordinates to define a readable textbook-style SVG layout with generous spacing between components and labels.",
    "If a diagram cannot be represented accurately, rewrite the question with a complete textual topology instead of linking to an image.",
    "Use standard LaTeX delimiters for mathematical notation: inline \\(...\\), display \\[...\\]. Do not leave raw LaTeX commands without delimiters.",
    "Because the response is JSON, escape every LaTeX backslash inside string values as \\\\. For example, the JSON source string must contain \\\\(x\\\\), so JSON.parse produces \\(x\\). Never emit raw \\(, \\[, \\frac, or \\nabla inside JSON strings.",
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
    answerQualityContract: [
      "Final answers must read like a clean model solution, not internal reasoning.",
      "Do not show uncertainty, self-debate, or discarded approaches.",
      "Do not state two incompatible conclusions in the same answer.",
      "For existence/extreme-value questions, explicitly verify domain, continuity, compactness or the relevant failure before the conclusion.",
      "If the final answer is negative, present only the negative conclusion and proof; do not first claim the positive conclusion."
    ],
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

export function parseJsonOutput(text) {
  const candidate = extractJsonCandidate(text);
  const attempts = [repairLooseJsonBackslashes(candidate), candidate];
  let lastError = null;

  for (const attempt of attempts) {
    try {
      return JSON.parse(attempt);
    } catch (error) {
      lastError = error;
    }
  }

  throw new Error(`AI provider returned invalid JSON: ${lastError?.message || "parse failed"}`);
}

function extractJsonCandidate(text) {
  const trimmed = String(text || "")
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "");
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");

  if (start === -1 || end === -1 || end <= start) {
    throw new Error("AI provider returned text instead of JSON.");
  }

  return trimmed.slice(start, end + 1);
}

function repairLooseJsonBackslashes(value) {
  let output = "";
  let inString = false;

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];

    if (!inString) {
      output += character;
      if (character === "\"") inString = true;
      continue;
    }

    if (character === "\"") {
      output += character;
      inString = false;
      continue;
    }

    if (character === "\\") {
      const next = value[index + 1] || "";
      const rest = value.slice(index + 1);

      if (isLikelyLatexEscape(rest)) {
        output += "\\\\";
        continue;
      }

      if (next === "u" && /^[0-9a-fA-F]{4}/.test(value.slice(index + 2, index + 6))) {
        output += value.slice(index, index + 6);
        index += 5;
        continue;
      }

      if (/["\\/bfnrt]/.test(next)) {
        output += character + next;
        index += 1;
        continue;
      }

      output += "\\\\";
      continue;
    }

    if (character === "\n") {
      output += "\\n";
    } else if (character === "\r") {
      output += "\\r";
    } else if (character === "\t") {
      output += "\\t";
    } else {
      output += character;
    }
  }

  return output;
}

function isLikelyLatexEscape(rest) {
  if (/^[()[\]{}|,;:! ]/.test(rest)) return true;

  const latexCommands = [
    "alpha", "beta", "gamma", "delta", "epsilon", "theta", "lambda", "mu", "nu", "pi", "rho", "sigma", "omega",
    "frac", "sqrt", "nabla", "partial", "cdot", "times", "div", "le", "ge", "neq", "infty",
    "left", "right", "begin", "end", "text", "mathbb", "mathbf", "mathcal", "vec", "overline", "underline",
    "sin", "cos", "tan", "log", "ln", "lim", "sum", "prod", "int", "det", "to", "rightarrow",
    "forall", "exists", "in", "notin", "subset", "subseteq", "cup", "cap", "setminus", "pm", "mp",
    "approx", "equiv", "cong", "circ", "prime", "cdots", "ldots", "dots", "quad", "qquad",
    "displaystyle", "bar", "hat", "tilde", "dot", "ddot", "therefore", "because"
  ];

  return latexCommands.some((command) => rest.startsWith(command) && !/[A-Za-z]/.test(rest[command.length] || ""));
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

function buildRevisionPayload(previousOutput, qualityIssues) {
  return {
    reason: "The previous output looked like exploratory reasoning or contained contradictory conclusions.",
    detectedIssues: qualityIssues,
    previousOutput,
    instruction:
      "Rewrite the whole output as final user-facing content only. Preserve the same JSON schema and task type. For each item.answer, give one clear final conclusion followed by a rigorous proof or solution. Remove all self-correction, uncertainty, alternative discarded paths, and contradictory statements. Do not mention that this is a rewrite."
  };
}

export function findFinalAnswerQualityIssues(output) {
  const issues = [];

  for (const [index, item] of (output?.items || []).entries()) {
    const answerText = String(item?.answer || "");
    const text = answerText || String(item?.body || "");
    if (!text.trim()) continue;

    const itemIssues = [];
    if (hasExploratoryReasoning(text)) {
      itemIssues.push("contains exploratory, hedging, or self-correction language");
    }
    if (answerText && hasContradictoryConclusion(answerText)) {
      itemIssues.push("contains incompatible positive and negative conclusions");
    }

    if (itemIssues.length) {
      issues.push({
        item: index + 1,
        title: String(item?.title || `Item ${index + 1}`),
        issues: itemIssues
      });
    }
  }

  return issues;
}

function hasExploratoryReasoning(text) {
  const patterns = [
    /然而题目可能/,
    /题目可能/,
    /更准确地说/,
    /换句话说.*不一定/s,
    /先.*但.*因此/s,
    /但是.*故不一定/s,
    /不过.*不一定/s,
    /可能(?:没有|存在|设定|是|为)/,
    /似乎|也许|猜测|自相矛盾|推翻|修正/,
    /on second thought|however,?\s+the problem may|maybe|perhaps|not necessarily|contradict|revise/i
  ];

  return patterns.some((pattern) => pattern.test(text));
}

function hasContradictoryConclusion(text) {
  const compact = text.replace(/\s+/g, "");
  const negativeMinimum = /(没有最小值|无最小值|不存在最小值|没有全局最小值|不一定有最小值|nominimum|doesnotexist)/i.test(compact);
  const negativeMaximum = /(没有最大值|无最大值|不存在最大值|没有全局最大值|不一定有最大值|nomaximum)/i.test(compact);
  const positiveMinimumText = compact.replace(/没有最小值|无最小值|不存在最小值|没有全局最小值|不一定有最小值|nominimum|doesnotexist/gi, "");
  const positiveMaximumText = compact.replace(/没有最大值|无最大值|不存在最大值|没有全局最大值|不一定有最大值|nomaximum/gi, "");
  const positiveMinimum = /(有最小值|存在最小值|取得最小值|hasaminimum|minimumexists)/i.test(positiveMinimumText);
  const positiveMaximum = /(有最大值|存在最大值|取得最大值|hasamaximum|maximumexists)/i.test(positiveMaximumText);

  return (positiveMinimum && negativeMinimum) || (positiveMaximum && negativeMaximum);
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
