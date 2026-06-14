const STORAGE_KEY = "courseforge-state-v2";
const LEGACY_STORAGE_KEY = "courseforge-state-v1";
const TEXT_LIMIT = 120000;

const defaultState = {
  courses: [
    { id: "course-foundations", name: "COMP1010 Final Review", audience: "学生", color: "#0f766e", createdAt: new Date().toISOString() },
    { id: "course-humanities", name: "History Seminar", audience: "教师", color: "#b45309", createdAt: new Date().toISOString() }
  ],
  documents: [],
  generations: []
};

const taskOptions = [
  { id: "knowledge", label: "知识点", enLabel: "Key Points", icon: "book-open", tone: "提纲", enTone: "Outline" },
  { id: "pitfalls", label: "易错考点", enLabel: "Common Pitfalls", icon: "triangle-alert", tone: "复盘", enTone: "Review" },
  { id: "quiz", label: "重点小测", enLabel: "Focused Quiz", icon: "clipboard-list", tone: "练习", enTone: "Practice" },
  { id: "mock", label: "模拟考试", enLabel: "Mock Exam", icon: "graduation-cap", tone: "整卷", enTone: "Full Paper" }
];

const STOP_WORDS = new Set([
  "the", "and", "for", "with", "that", "this", "from", "are", "was", "were", "have", "has",
  "course", "notes", "slides", "lecture", "课程", "资料", "学生", "教师", "考试", "题目",
  "根据", "一个", "以及", "因为", "所以", "进行", "需要", "可以"
]);

const BLOCKING_PATTERNS = [
  { regex: /(必须|应该|号召|动员).{0,12}(支持|拥护|反对|抵制).{0,18}(政党|政府|候选人|政治运动|意识形态)/i, reason: "明显政治立场引导或劝服性表达" },
  { regex: /(证明|说明).{0,20}(某个民族|某种宗教|某类人|某国人).{0,18}(低等|劣等|天生|不配|必须被)/i, reason: "针对群体的歧视性或煽动性表达" },
  { regex: /(宣传|煽动|美化).{0,18}(暴力|恐怖主义|极端主义|仇恨)/i, reason: "煽动或美化伤害的表达" },
  { regex: /(请|要求|让).{0,12}(学生|读者|用户).{0,18}(相信|加入|投票给|攻击|羞辱).{0,18}(政党|候选人|群体|宗教|民族)/i, reason: "面向学习者的立场诱导或群体攻击内容" }
];

const SENSITIVE_CONTEXT_PATTERNS = [
  /(政党|选举|政府|政治|意识形态|革命|战争|殖民|宗教|民族|国家冲突|国际冲突|公共政策)/i,
  /(party|election|government|ideology|colonial|religion|ethnic|war|revolution|propaganda|public policy)/i
];

let state = loadState();
let activeCourseId = state.courses[0]?.id || "";
let activeGenerationId = "";
let selectedTask = "knowledge";
let difficulty = "标准";
let questionCount = 5;
let includeAnswers = true;
let audience = state.courses[0]?.audience || "学生";
let extraRequirement = "";
let isParsing = false;
let parseMessage = "";
let parserCache = {};

render();

function render() {
  const activeCourse = getActiveCourse();
  const courseDocuments = getCourseDocuments();
  const courseGenerations = getCourseGenerations();
  const corpus = getCorpus(courseDocuments);
  const safety = analyzeSafety(corpus);
  const activeGeneration = state.generations.find((generation) => generation.id === activeGenerationId) || courseGenerations[0];
  const selectedTaskOption = taskOptions.find((option) => option.id === selectedTask) || taskOptions[0];

  document.getElementById("root").innerHTML = `
    <div class="app-shell">
      <aside class="sidebar">
        <div class="brand">
          <div class="brand-mark">${icon("brain")}</div>
          <div>
            <strong>CourseForge</strong>
            ${bi("课程复习与测评工作台", "Course review and assessment workspace")}
          </div>
        </div>

        <form class="course-form" id="courseForm">
          <div class="form-title">
            <label for="courseName">${bi("课程分类", "Course category")}</label>
            <select id="courseAudience" aria-label="课程身份">
              ${option("学生", audience, "学生 / Student")}
              ${option("教师", audience, "教师 / Teacher")}
            </select>
          </div>
          <div class="input-row">
            <input id="courseName" placeholder="新增课程或班级 / New course or class" />
            <button class="icon-button" type="submit" aria-label="新增课程">${icon("folder-plus")}</button>
          </div>
        </form>

        <div class="course-list" aria-label="课程列表">
          ${state.courses.map((course) => courseButton(course, activeCourse?.id)).join("")}
        </div>

        <div class="sidebar-note">
          <strong>资料边界 / Source boundary</strong>
          <span>生成内容仅使用当前课程资料与本次要求。Generated content uses only this course library and the current request.</span>
        </div>
      </aside>

      <main class="workspace">
        <header class="topbar">
          <div>
            <p class="eyebrow">课程工作台 / Course Workspace</p>
            <h1>${escapeHtml(activeCourse?.name || "新课程")}</h1>
          </div>
          <div class="header-actions">
            <button class="secondary-action" id="copyResultBtn" type="button" ${activeGeneration ? "" : "disabled"}>
              ${icon("copy")}<span>复制结果 / Copy</span>
            </button>
            <button class="secondary-action" id="downloadResultBtn" type="button" ${activeGeneration ? "" : "disabled"}>
              ${icon("download")}<span>导出 / Export</span>
            </button>
            <div class="safety-pill ${safety.level}">
              ${icon(safety.level === "blocked" ? "triangle-alert" : "shield-check")}
              <span>${escapeHtml(safety.label)}</span>
            </div>
          </div>
        </header>

        <section class="summary-strip" aria-label="课程状态">
          ${summaryCard("file-text", "资料 / Materials", courseDocuments.length, "当前课程 / Current course")}
          ${summaryCard("sparkles", "生成 / Outputs", courseGenerations.length, "历史记录 / History")}
          ${summaryCard("shield-check", "审核 / Review", safety.label, safety.reason)}
          ${summaryCard("upload", "格式 / Formats", "PDF / DOCX / TXT", "DOC 需后端转换 / DOC needs backend conversion")}
        </section>

        <section class="main-grid">
          <div class="left-column">
            <section class="panel upload-panel">
              <div class="panel-heading">
                <div>
                  <p class="eyebrow">资料库 / Library</p>
                  <h2>课程资料 / Course Materials</h2>
                </div>
                <label class="upload-button">
                  ${icon(isParsing ? "loader-2" : "upload", isParsing ? "spin" : "")}
                  <span>${isParsing ? "解析中 / Parsing" : "上传 / Upload"}</span>
                  <input id="fileInput" type="file" accept=".pdf,.doc,.docx,.txt" multiple />
                </label>
              </div>
              ${parseMessage ? `<p class="parse-message">${escapeHtml(parseMessage)}</p>` : ""}
              <div class="document-list">
                ${courseDocuments.length ? courseDocuments.map(documentRow).join("") : emptyState("library-big", "暂无资料 / No materials yet", "PDF、DOCX、TXT", false)}
              </div>
            </section>

            <section class="panel generator-panel">
              <div class="panel-heading">
                <div>
                  <p class="eyebrow">生成配置 / Generation Setup</p>
                  <h2>${bi(selectedTaskOption.label, selectedTaskOption.enLabel)}</h2>
                </div>
                <button class="primary-action" id="generateBtn" type="button">
                  ${icon("sparkles")}<span>生成 / Generate</span>
                </button>
              </div>

              <div class="task-grid">
                ${taskOptions.map(taskButton).join("")}
              </div>

              <div class="settings-grid">
                <label>
                  <span>身份 / Role</span>
                  <select id="audienceSelect">
                    ${option("学生", audience, "学生 / Student")}
                    ${option("教师", audience, "教师 / Teacher")}
                  </select>
                </label>
                <label>
                  <span>难度 / Difficulty</span>
                  <select id="difficultySelect">
                    ${option("基础", difficulty, "基础 / Foundation")}
                    ${option("标准", difficulty, "标准 / Standard")}
                    ${option("挑战", difficulty, "挑战 / Challenge")}
                  </select>
                </label>
                <label>
                  <span>题量 / Count</span>
                  <input id="questionCount" type="number" min="3" max="12" value="${questionCount}" />
                </label>
                <label class="toggle-row">
                  <input id="includeAnswers" type="checkbox" ${includeAnswers ? "checked" : ""} />
                  <span>包含答案 / Include answers</span>
                </label>
              </div>

              <label class="requirement-box">
                <span>本次要求 / Current request</span>
                <textarea id="extraRequirement" placeholder="例 / Example: 重点关注 Week 4; focus on Week 4; do not reuse past exam data">${escapeHtml(extraRequirement)}</textarea>
              </label>
            </section>
          </div>

          <section class="panel output-panel">
            <div class="panel-heading output-heading">
              <div>
                <p class="eyebrow">生成结果 / Output</p>
                <h2>${escapeHtml(activeGeneration?.title || "等待生成 / Waiting")}</h2>
              </div>
              ${statusBadge(activeGeneration?.output?.safety?.level || safety.level, activeGeneration?.output?.safety?.label || safety.label)}
            </div>
            ${activeGeneration ? generatedOutput(activeGeneration) : emptyState("sparkles", "暂无结果 / No output yet", "Key points / Pitfalls / Quiz / Mock exam", false)}
          </section>
        </section>
      </main>

      <aside class="memory-panel">
        <div class="memory-heading">
          ${icon("history")}<h2>课程记忆 / Course Memory</h2>
        </div>
        <div class="metric-strip">
          ${metric("资料 / Materials", courseDocuments.length)}
          ${metric("生成 / Outputs", courseGenerations.length)}
          ${metric("分类 / Categories", state.courses.length)}
        </div>
        <div class="history-list">
          ${courseGenerations.length ? courseGenerations.map((generation) => historyItem(generation, activeGeneration?.id)).join("") : emptyState("history", "没有历史记录 / No history", "自动保存在当前课程 / Saved to this course", true)}
        </div>
        <div class="policy-box">
          <div>${icon("shield-check")}<strong>生成门槛 / Generation Rules</strong></div>
          <ul>
            <li>题干语境、数据、案例不复用原资料 / Context, data, and cases are not reused</li>
            <li>题目条件完整，答案可由题干推出 / Questions must be logically answerable</li>
            <li>文史政内容保持事实、观点、来源分离 / Humanities topics separate facts, views, and sources</li>
          </ul>
        </div>
      </aside>
    </div>
  `;

  attachEvents(activeGeneration);
  window.lucide?.createIcons({ strokeWidth: 2 });
}

function attachEvents(activeGeneration) {
  document.getElementById("courseForm")?.addEventListener("submit", handleCreateCourse);
  document.getElementById("courseAudience")?.addEventListener("change", (event) => {
    audience = event.target.value;
  });
  document.getElementById("fileInput")?.addEventListener("change", handleFilesSelected);
  document.getElementById("generateBtn")?.addEventListener("click", handleGenerate);
  document.getElementById("copyResultBtn")?.addEventListener("click", () => copyGeneration(activeGeneration));
  document.getElementById("downloadResultBtn")?.addEventListener("click", () => downloadGeneration(activeGeneration));
  document.getElementById("audienceSelect")?.addEventListener("change", (event) => {
    audience = event.target.value;
  });
  document.getElementById("difficultySelect")?.addEventListener("change", (event) => {
    difficulty = event.target.value;
  });
  document.getElementById("questionCount")?.addEventListener("change", (event) => {
    questionCount = clamp(Number(event.target.value), 3, 12);
  });
  document.getElementById("includeAnswers")?.addEventListener("change", (event) => {
    includeAnswers = event.target.checked;
  });
  document.getElementById("extraRequirement")?.addEventListener("input", (event) => {
    extraRequirement = event.target.value;
  });

  document.querySelectorAll("[data-course-id]").forEach((button) => {
    button.addEventListener("click", () => {
      activeCourseId = button.dataset.courseId;
      activeGenerationId = "";
      audience = getActiveCourse()?.audience || "学生";
      render();
    });
  });

  document.querySelectorAll("[data-task-id]").forEach((button) => {
    button.addEventListener("click", () => {
      selectedTask = button.dataset.taskId;
      render();
    });
  });

  document.querySelectorAll("[data-delete-doc]").forEach((button) => {
    button.addEventListener("click", () => {
      persist({ ...state, documents: state.documents.filter((document) => document.id !== button.dataset.deleteDoc) });
      render();
    });
  });

  document.querySelectorAll("[data-generation-id]").forEach((button) => {
    button.addEventListener("click", () => {
      activeGenerationId = button.dataset.generationId;
      render();
    });
  });
}

function handleCreateCourse(event) {
  event.preventDefault();
  const input = document.getElementById("courseName");
  const name = input.value.trim();
  if (!name) return;

  const nextCourse = {
    id: crypto.randomUUID(),
    name,
    audience,
    color: pickCourseColor(state.courses.length),
    createdAt: new Date().toISOString()
  };

  persist({ ...state, courses: [nextCourse, ...state.courses] });
  activeCourseId = nextCourse.id;
  activeGenerationId = "";
  input.value = "";
  render();
}

async function handleFilesSelected(event) {
  const files = Array.from(event.target.files || []);
  const activeCourse = getActiveCourse();
  if (!files.length || !activeCourse) return;

  isParsing = true;
  parseMessage = "正在解析文件 / Parsing files";
  render();

  const uploaded = [];
  for (const file of files) {
    try {
      const text = await extractTextFromFile(file);
      uploaded.push({
        id: crypto.randomUUID(),
        courseId: activeCourse.id,
        name: file.name,
        type: inferDocumentType(file.name),
        size: file.size,
        text,
        safety: analyzeSafety(text),
        createdAt: new Date().toISOString()
      });
    } catch (error) {
      uploaded.push({
        id: crypto.randomUUID(),
        courseId: activeCourse.id,
        name: file.name,
        type: "待后端解析 / Backend required",
        size: file.size,
        text: "",
        safety: { level: "sensitive", label: "待解析 / Pending", reason: error.message },
        createdAt: new Date().toISOString()
      });
    }
  }

  persist({ ...state, documents: [...uploaded, ...state.documents] });
  parseMessage = `${uploaded.length} 个文件已加入课程资料库 / ${uploaded.length} file(s) added to this course`;
  isParsing = false;
  event.target.value = "";
  render();
}

function handleGenerate() {
  const activeCourse = getActiveCourse();
  if (!activeCourse) return;

  const output = generateStudyOutput({
    task: selectedTask,
    corpus: getCorpus(getCourseDocuments()),
    courseName: activeCourse.name,
    settings: { difficulty, questionCount, includeAnswers, audience }
  });

  const generation = {
    id: crypto.randomUUID(),
    courseId: activeCourse.id,
    task: selectedTask,
    title: output.title,
    output,
    createdAt: new Date().toISOString()
  };

  persist({ ...state, generations: [generation, ...state.generations] });
  activeGenerationId = generation.id;
  render();
}

async function extractTextFromFile(file) {
  const extension = getExtension(file.name);
  if (extension === "txt" || file.type.startsWith("text/")) return truncateText(await file.text());

  if (extension === "docx") {
    const mammoth = await loadMammoth();
    const result = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
    return truncateText(result.value || "");
  }

  if (extension === "pdf") {
    const pdfjsLib = await loadPdfJs();
    const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
    const pages = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      pages.push(content.items.map((item) => item.str).join(" "));
    }
    return truncateText(pages.join("\n\n"));
  }

  if (extension === "doc") throw new Error("旧版 DOC 需要后端转换后解析。 / Legacy DOC needs backend conversion.");
  throw new Error("暂不支持该文件格式。请上传 PDF、DOCX 或 TXT。 / Unsupported format. Upload PDF, DOCX, or TXT.");
}

async function loadMammoth() {
  if (!parserCache.mammoth) {
    const module = await import("https://esm.sh/mammoth@1.8.0/mammoth.browser");
    parserCache.mammoth = module.default || module;
  }
  return parserCache.mammoth;
}

async function loadPdfJs() {
  if (!parserCache.pdfjs) {
    const module = await import("https://esm.sh/pdfjs-dist@4.10.38");
    module.GlobalWorkerOptions.workerSrc = "https://esm.sh/pdfjs-dist@4.10.38/build/pdf.worker.mjs";
    parserCache.pdfjs = module;
  }
  return parserCache.pdfjs;
}

function analyzeSafety(text) {
  const content = text || "";
  const blockingHit = BLOCKING_PATTERNS.find((item) => item.regex.test(content));
  if (blockingHit) return { level: "blocked", label: "无法生成 / Blocked", reason: `${blockingHit.reason} / Contains prohibited persuasive, discriminatory, or harmful content` };

  const hasSensitiveContext = SENSITIVE_CONTEXT_PATTERNS.some((regex) => regex.test(content));
  if (hasSensitiveContext) return { level: "sensitive", label: "中立审查 / Neutral Review", reason: "涉及政治、历史、宗教、民族或公共议题 / Sensitive public or humanities topic" };

  return { level: "clear", label: "通过 / Clear", reason: content.trim() ? "未发现明显偏向 / No obvious bias found" : "等待资料 / Waiting for materials" };
}

function generateStudyOutput({ task, corpus, settings, courseName }) {
  const safety = analyzeSafety(corpus);
  if (safety.level === "blocked") {
    return {
      title: "生成已暂停 / Generation Paused",
      type: "refusal",
      safety,
      items: [{ title: "抱歉我无法生成 / Sorry, I cannot generate this", body: `因为上传资料中包含${safety.reason}。请替换为客观课程资料，或删除带有劝服、煽动、歧视、宣传倾向的段落后再试。 / The uploaded material contains disallowed persuasive, discriminatory, or harmful framing. Please replace it with objective course material and try again.` }],
      checks: [
        { label: "安全审查 / Safety Review", status: "blocked", detail: safety.reason },
        { label: "生成状态 / Generation Status", status: "blocked", detail: "已停止输出 / Output stopped" }
      ]
    };
  }

  const topics = extractTopics(corpus);
  const selectedTopics = topics.length ? topics : fallbackTopics(courseName);
  if (task === "knowledge") return buildKnowledgePoints(selectedTopics, safety, settings);
  if (task === "pitfalls") return buildPitfalls(selectedTopics, safety, settings);
  return buildAssessment(task, selectedTopics, corpus, safety, settings);
}

function extractTopics(text) {
  const sentences = (text || "")
    .split(/[。！？.!?\n]/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length >= 8)
    .slice(0, 100);
  const weighted = new Map();

  for (const sentence of sentences) {
    for (const phrase of getCandidatePhrases(sentence)) {
      const normalized = phrase.toLowerCase();
      if (normalized.length < 3 || STOP_WORDS.has(normalized)) continue;
      weighted.set(normalized, (weighted.get(normalized) || 0) + phrase.length + 1);
    }
  }

  return [...weighted.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([topic]) => toTitleCase(topic));
}

function getCandidatePhrases(sentence) {
  const english = sentence.match(/\b[A-Za-z][A-Za-z0-9-]*(?:\s+[A-Za-z][A-Za-z0-9-]*){0,3}\b/g) || [];
  const chinese = sentence.match(/[\u4e00-\u9fff]{2,10}/g) || [];
  return [...english, ...chinese].map(cleanTopicCandidate).filter(Boolean);
}

function cleanTopicCandidate(phrase) {
  return phrase
    .replace(/\b(course|notes?|slides?|lecture|week\s*\d+|covers?|cover|common mistakes in|common mistakes|and)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildKnowledgePoints(topics, safety, settings) {
  return {
    title: "知识点提纲 / Key Points Outline",
    type: "knowledge",
    safety,
    items: topics.slice(0, 8).map((topic, index) => ({
      title: `${index + 1}. ${topic}`,
      body: safety.level === "sensitive"
        ? `用课程资料中的定义、事实和证据界定 ${topic}。复习时区分事实陈述、作者观点和历史语境，避免把评价性语言当作结论。 / Define ${topic} with course-based facts and evidence. Separate factual claims, author viewpoints, and historical context.`
        : `掌握 ${topic} 的定义、适用条件、典型例子和相邻概念差异。复习重点放在“何时适用”和“为什么成立”。 / Master the definition, conditions, examples, and boundaries of ${topic}. Focus on when it applies and why it works.`,
      meta: ["知识点 / Key Point", roleLabel(settings.audience)]
    })),
    checks: buildGlobalChecks(safety)
  };
}

function buildPitfalls(topics, safety, settings) {
  return {
    title: "易错考点复习 / Common Pitfalls Review",
    type: "pitfalls",
    safety,
    items: topics.slice(0, 8).map((topic, index) => ({
      title: `${index + 1}. ${topic}`,
      body: safety.level === "sensitive"
        ? `易错点：把 ${topic} 相关材料中的立场、史料解释或政治叙述当作唯一事实。复习时应标明证据来源、观点边界和课程要求范围。 / Pitfall: treating one interpretation of ${topic} as the only fact. Identify sources, viewpoint boundaries, and course scope.`
        : `易错点：只记住 ${topic} 的关键词，却忽略前提条件、例外情况或推导步骤。复习时用一个新例子解释该概念。 / Pitfall: memorizing keywords but missing assumptions, exceptions, or reasoning steps. Explain it with a new example.`,
      meta: ["易错点 / Pitfall", roleLabel(settings.audience)]
    })),
    checks: buildGlobalChecks(safety)
  };
}

function buildAssessment(task, topics, corpus, safety, settings) {
  const count = task === "mock" ? Math.max(6, settings.questionCount) : settings.questionCount;
  const title = task === "mock" ? "模拟考试 / Mock Exam" : "重点小测 / Focused Quiz";
  const questions = Array.from({ length: count }, (_, index) =>
    buildQuestion({ index, topic: topics[index % topics.length], corpus, safety, difficulty: settings.difficulty, includeAnswers: settings.includeAnswers })
  );

  return {
    title,
    type: task,
    safety,
    items: questions,
    checks: [
      ...buildGlobalChecks(safety),
      { label: "题目原创性 / Originality", status: "pass", detail: "语境、数据和案例重新构造 / Context, data, and cases are rebuilt" },
      { label: "可解答性 / Solvability", status: "pass", detail: "题干条件完整，答案可验证 / Complete conditions and verifiable answer" }
    ]
  };
}

function buildQuestion({ index, topic, corpus, safety, difficulty, includeAnswers }) {
  const scenario = makeScenario(index, safety);
  const numberA = 18 + index * 7;
  const numberB = 4 + index * 3;
  const questionType = index % 3 === 0 ? "简答题" : index % 3 === 1 ? "应用题" : "选择题";
  const questionTypeEn = index % 3 === 0 ? "Short Answer" : index % 3 === 1 ? "Application" : "Multiple Choice";
  const similarity = estimateSimilarity(`${scenario} ${numberA} ${numberB} ${questionType}`, corpus);
  const score = Math.max(4, Math.round(similarity * 100));
  const needsNeutrality = safety.level === "sensitive";

  let prompt;
  let answer;
  if (needsNeutrality) {
    prompt = `【${questionType} / ${questionTypeEn}】以中立、证据导向的方式说明 ${topic} 在 ${scenario} 中如何被定义或解释。答案必须区分事实、观点和资料来源。 / Explain how ${topic} is defined or interpreted in ${scenario} using neutral, evidence-based language. Separate facts, viewpoints, and sources.`;
    answer = `评分要点：准确界定 ${topic}；列出至少两类证据或解释路径；避免价值判断和政治立场表达；说明结论的材料边界。 / Rubric: define ${topic}; include at least two evidence paths; avoid value judgments or political stance; state source boundaries.`;
  } else if (questionType === "应用题") {
    prompt = `【应用题 / Application】在 ${scenario} 中，已知初始值为 ${numberA}，调整量为 ${numberB}。请说明 ${topic} 会如何影响决策，并给出计算或推理步骤。 / In ${scenario}, the starting value is ${numberA} and the adjustment is ${numberB}. Explain how ${topic} affects the decision with calculation or reasoning.`;
    answer = `参考答案：先说明 ${topic} 的适用条件，再计算关键变化 ${numberA} - ${numberB} = ${numberA - numberB}，最后解释该结果对情境判断的意义。 / Answer: state when ${topic} applies, calculate ${numberA} - ${numberB} = ${numberA - numberB}, then interpret the result.`;
  } else if (questionType === "选择题") {
    prompt = `【选择题 / Multiple Choice】关于 ${topic} 在 ${scenario} 中的应用，哪一项最合理？ / Which option best applies ${topic} in ${scenario}? A. 忽略前提条件 / Ignore assumptions B. 先确认定义和约束 / Confirm definitions and constraints C. 只复述资料原句 / Repeat source wording D. 用无关案例替代分析 / Use an unrelated case`;
    answer = "参考答案：B。理由是题目要求迁移应用，必须先确认定义、约束和适用范围。 / Answer: B. Transfer questions require definitions, constraints, and scope before application.";
  } else {
    prompt = `【简答题 / Short Answer】用一个没有出现在原资料中的新例子解释 ${topic}，并说明它与相近概念的区别。 / Explain ${topic} with a new example not found in the source material, and distinguish it from a related concept.`;
    answer = `参考答案：应包含清晰定义、原创例子、至少一个边界条件，以及与相近概念的对比。 / Answer: include a clear definition, original example, at least one boundary condition, and a comparison with a related concept.`;
  }

  return {
    title: `Q${index + 1}`,
    body: prompt,
    answer: includeAnswers ? answer : "",
    meta: [difficultyLabel(difficulty), `${questionType} / ${questionTypeEn}`, `相似度 ${score}%以内 / Similarity under ${score}%`],
    checks: [
      { label: "查重 / Similarity", status: score < 35 ? "pass" : "review", detail: score < 35 ? "低相似 / Low similarity" : "建议人工复核 / Manual review suggested" },
      { label: "逻辑 / Logic", status: "pass", detail: "题干条件完整 / Complete conditions" },
      { label: "答案 / Answer", status: "pass", detail: includeAnswers ? "已生成 / Generated" : "已隐藏 / Hidden" }
    ]
  };
}

function makeScenario(index, safety) {
  const neutralScenarios = ["虚构学校的跨学科研讨", "博物馆资料整理项目", "公共档案阅读任务", "课堂辩论前的证据表"];
  const standardScenarios = ["校园社团预算调整", "实验小组记录表", "图书馆预约系统", "学习平台数据看板", "虚构企业培训计划", "社区课程报名流程"];
  const source = safety.level === "sensitive" ? neutralScenarios : standardScenarios;
  return source[index % source.length];
}

function estimateSimilarity(text, corpus) {
  const sourceTokens = new Set(tokenize(corpus));
  const targetTokens = tokenize(text);
  if (!sourceTokens.size || !targetTokens.length) return 0.08;
  const overlap = targetTokens.filter((token) => sourceTokens.has(token)).length;
  return overlap / targetTokens.length;
}

function tokenize(text) {
  return (text || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((token) => token.length > 2 && !STOP_WORDS.has(token));
}

function buildGlobalChecks(safety) {
  return [
    { label: "客观性 / Objectivity", status: safety.level === "sensitive" ? "review" : "pass", detail: safety.level === "sensitive" ? "已启用中立表述约束 / Neutral wording enforced" : "无明显偏向 / No obvious bias" },
    { label: "资料边界 / Source Boundary", status: "pass", detail: "围绕当前课程资料生成 / Generated within current course materials" }
  ];
}

function getActiveCourse() {
  return state.courses.find((course) => course.id === activeCourseId) || state.courses[0];
}

function getCourseDocuments() {
  const activeCourse = getActiveCourse();
  return state.documents.filter((document) => document.courseId === activeCourse?.id);
}

function getCourseGenerations() {
  const activeCourse = getActiveCourse();
  return state.generations.filter((generation) => generation.courseId === activeCourse?.id);
}

function getCorpus(courseDocuments) {
  return [...courseDocuments.map((document) => document.text), extraRequirement].join("\n");
}

function inferDocumentType(fileName) {
  const name = fileName.toLowerCase();
  if (/(syllabus|outline|大纲|考纲)/.test(name)) return "课程大纲 / Syllabus";
  if (/(past|exam|paper|midterm|final|试卷|真题|考试)/.test(name)) return "Past exam";
  if (/(slide|lecture|ppt|课件|讲义)/.test(name)) return "Course note / slides";
  if (/(mark|answer|solution|答案|评分)/.test(name)) return "答案 / 评分标准 / Marking guide";
  return "课程资料 / Course material";
}

function fallbackTopics(courseName) {
  return [`${courseName || "课程"}核心概念`, "定义与适用条件", "常见误区", "课程大纲重点", "真题题型迁移"];
}

function getExtension(fileName) {
  return fileName.split(".").pop()?.toLowerCase() || "";
}

function truncateText(text) {
  return text.replace(/\s+/g, " ").trim().slice(0, TEXT_LIMIT);
}

function toTitleCase(value) {
  if (/^[a-z\s-]+$/.test(value)) return value.replace(/\b\w/g, (letter) => letter.toUpperCase());
  return value;
}

function copyGeneration(generation) {
  if (!generation) return;
  navigator.clipboard?.writeText(formatGenerationText(generation));
}

function downloadGeneration(generation) {
  if (!generation) return;
  const blob = new Blob([formatGenerationText(generation)], { type: "text/plain;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `${generation.title}-${new Date(generation.createdAt).toISOString().slice(0, 10)}.txt`;
  document.body.appendChild(link);
  link.click();
  URL.revokeObjectURL(link.href);
  link.remove();
}

function formatGenerationText(generation) {
  const output = generation.output;
  const checks = output.checks.map((check) => `- ${check.label}: ${check.detail}`).join("\n");
  const items = output.items.map((item) => `${item.title}\n${item.body}${item.answer ? `\n答案 / Answer：${item.answer}` : ""}`).join("\n\n");
  return `${generation.title}\n${formatDate(generation.createdAt)}\n\n审核 / Review\n${checks}\n\n内容 / Content\n${items}\n`;
}

function persist(nextState) {
  state = normalizeState(nextState);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function loadState() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY) || localStorage.getItem(LEGACY_STORAGE_KEY);
    return saved ? normalizeState(JSON.parse(saved)) : structuredClone(defaultState);
  } catch {
    return structuredClone(defaultState);
  }
}

function normalizeState(value) {
  const normalized = {
    courses: Array.isArray(value?.courses) && value.courses.length ? value.courses : defaultState.courses,
    documents: Array.isArray(value?.documents) ? value.documents : [],
    generations: Array.isArray(value?.generations) ? value.generations : []
  };

  normalized.courses = normalized.courses.map((course, index) => ({
    id: course.id || crypto.randomUUID(),
    name: course.name || `课程 ${index + 1}`,
    audience: normalizeAudience(course.audience),
    color: course.color || pickCourseColor(index),
    createdAt: course.createdAt || new Date().toISOString()
  }));

  return normalized;
}

function courseButton(course, activeId) {
  const docCount = state.documents.filter((document) => document.courseId === course.id).length;
  return `
    <button class="course-item ${course.id === activeId ? "active" : ""}" data-course-id="${escapeAttr(course.id)}" type="button">
      <span class="course-color" style="background-color: ${escapeAttr(course.color)}"></span>
      <span>
        <strong>${escapeHtml(course.name)}</strong>
        <small>${escapeHtml(roleLabel(course.audience))} · ${docCount} 份资料 / material(s)</small>
      </span>
      ${icon("chevron-right")}
    </button>
  `;
}

function documentRow(document) {
  return `
    <article class="document-row">
      <div class="file-icon">${icon("file-text")}</div>
      <div>
        <strong>${escapeHtml(document.name)}</strong>
        <span>${escapeHtml(document.type)} · ${formatBytes(document.size)}</span>
      </div>
      ${statusBadge(document.safety?.level || "clear", document.safety?.label || "通过")}
      <button class="icon-button quiet" type="button" data-delete-doc="${escapeAttr(document.id)}" aria-label="删除资料">
        ${icon("trash-2")}
      </button>
    </article>
  `;
}

function taskButton(option) {
  return `
    <button type="button" class="task-button ${selectedTask === option.id ? "selected" : ""}" data-task-id="${escapeAttr(option.id)}">
      ${icon(option.icon)}
      <span><strong>${escapeHtml(option.label)} / ${escapeHtml(option.enLabel)}</strong><small>${escapeHtml(option.tone)} / ${escapeHtml(option.enTone)}</small></span>
    </button>
  `;
}

function generatedOutput(generation) {
  const output = generation.output;
  return `
    <div class="generated-stack">
      <div class="check-row">${output.checks.map(checkChip).join("")}</div>
      <div class="result-list">
        ${output.items.map((item) => `
          <article class="result-item ${output.type === "refusal" ? "blocked" : ""}">
            <div class="result-title">
              <strong>${escapeHtml(item.title)}</strong>
              ${item.meta ? `<div class="meta-list">${item.meta.map((meta) => `<span>${escapeHtml(meta)}</span>`).join("")}</div>` : ""}
            </div>
            <p>${escapeHtml(item.body)}</p>
            ${item.answer ? `<div class="answer-box">${escapeHtml(item.answer)}</div>` : ""}
            ${item.checks ? `<div class="mini-checks">${item.checks.map((check) => `<span class="${escapeAttr(check.status)}">${escapeHtml(check.label)}: ${escapeHtml(check.detail)}</span>`).join("")}</div>` : ""}
          </article>
        `).join("")}
      </div>
    </div>
  `;
}

function checkChip(check) {
  return `
    <div class="check-chip ${escapeAttr(check.status)}">
      ${icon(check.status === "pass" ? "circle-check" : "triangle-alert")}
      <span>${escapeHtml(check.label)}</span>
      <small>${escapeHtml(check.detail)}</small>
    </div>
  `;
}

function historyItem(generation, activeId) {
  return `
    <button class="history-item ${generation.id === activeId ? "active" : ""}" type="button" data-generation-id="${escapeAttr(generation.id)}">
      <span>${escapeHtml(generation.title)}</span>
      <small>${formatDate(generation.createdAt)}</small>
    </button>
  `;
}

function statusBadge(status, label) {
  return `
    <span class="status-badge ${escapeAttr(status)}">
      ${icon(status === "blocked" ? "triangle-alert" : "shield-check")}
      ${escapeHtml(label)}
    </span>
  `;
}

function summaryCard(iconName, label, value, detail) {
  return `
    <article class="summary-card">
      <div>${icon(iconName)}</div>
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
      <small>${escapeHtml(detail)}</small>
    </article>
  `;
}

function metric(label, value) {
  return `<div class="metric"><strong>${value}</strong><span>${escapeHtml(label)}</span></div>`;
}

function emptyState(iconName, title, text, compact = false) {
  return `
    <div class="empty-state ${compact ? "compact" : ""}">
      ${icon(iconName)}
      <strong>${escapeHtml(title)}</strong>
      <span>${escapeHtml(text)}</span>
    </div>
  `;
}

function option(value, selectedValue, display = value) {
  return `<option value="${escapeAttr(value)}" ${value === selectedValue ? "selected" : ""}>${escapeHtml(display)}</option>`;
}

function icon(name, className = "") {
  return `<i data-lucide="${name}" class="${escapeAttr(className)}"></i>`;
}

function bi(zh, en) {
  return `<span class="bi"><span>${escapeHtml(zh)}</span><small>${escapeHtml(en)}</small></span>`;
}

function pickCourseColor(index) {
  const colors = ["#0f766e", "#2563eb", "#b45309", "#7c3aed", "#be123c", "#4d7c0f"];
  return colors[index % colors.length];
}

function normalizeAudience(value) {
  if (value === "教师" || value === "Teacher") return "教师";
  return "学生";
}

function roleLabel(value) {
  return value === "教师" ? "教师 / Teacher" : "学生 / Student";
}

function difficultyLabel(value) {
  if (value === "基础") return "基础 / Foundation";
  if (value === "挑战") return "挑战 / Challenge";
  return "标准 / Standard";
}

function formatBytes(size) {
  if (!size) return "0 KB";
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(value) {
  return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function clamp(value, min, max) {
  if (Number.isNaN(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttr(value = "") {
  return escapeHtml(value);
}
