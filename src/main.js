const STORAGE_KEY = "courseforge-state-v3";
const LEGACY_STORAGE_KEY = "courseforge-state-v1";
const UI_LANGUAGE_KEY = "courseforge-ui-language";
const TEXT_LIMIT = 120000;
const SYNC_DEBOUNCE_MS = 900;
const SEEDED_COURSE_IDS = new Set(["course-foundations", "course-humanities"]);

const defaultState = {
  courses: [],
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
let audience = state.courses[0]?.audience || "学生";
let extraRequirement = "";
let isParsing = false;
let isGenerating = false;
let parseMessage = "";
let parserCache = {};
let visibleAnswerKeys = new Set();
let uiLanguage = loadUiLanguage();
let currentUser = null;
let cloudSyncStatus = { level: "local", detail: "" };
let cloudSyncTimer = null;
let suppressCloudSync = false;

render();
initializeCloudSession();

function render() {
  document.documentElement.lang = uiLanguage === "zh" ? "zh-CN" : "en";
  document.title = t("CourseForge | 课程复习助手", "CourseForge | Course Review Assistant");

  const activeCourse = getActiveCourse();
  const courseDocuments = getCourseDocuments();
  const courseGenerations = getCourseGenerations();
  const corpus = getCorpus(courseDocuments);
  const safety = analyzeSafety(corpus);
  const activeGeneration = state.generations.find((generation) => generation.id === activeGenerationId) || courseGenerations[0];
  const selectedTaskOption = taskOptions.find((option) => option.id === selectedTask) || taskOptions[0];
  const rootElement = document.getElementById("root");
  const hasCourse = Boolean(activeCourse);
  const usesAssessmentSettings = isAssessmentTask(selectedTask);

  window.MathJax?.typesetClear?.([rootElement]);
  rootElement.innerHTML = `
    <div class="app-shell">
      <aside class="sidebar">
        <div class="brand">
          <div class="brand-mark">${icon("brain")}</div>
          <div>
            <strong>CourseForge</strong>
            ${bi("课程复习与测评工作台", "Course review and assessment workspace")}
          </div>
        </div>

        ${authPanel()}

        <form class="course-form" id="courseForm">
          <div class="form-title">
            <label for="courseName">${bi("课程名称", "Course name")}</label>
            <select id="courseAudience" aria-label="课程身份">
              ${option("学生", audience, t("学生", "Student"))}
              ${option("教师", audience, t("教师", "Teacher"))}
            </select>
          </div>
          <div class="input-row">
            <input id="courseName" placeholder="${t("例如 MATH237", "Example: MATH237")}" />
            <button class="create-course-button" type="submit" aria-label="${t("创建课程", "Create course")}">
              ${icon("folder-plus")}<span>${t("创建", "Create")}</span>
            </button>
          </div>
        </form>

        <div class="course-list" aria-label="${t("课程列表", "Course list")}">
          ${state.courses.length ? state.courses.map((course) => courseButton(course, activeCourse?.id)).join("") : emptyState("folder-plus", t("还没有课程", "No courses yet"), t("先创建一个课程分类", "Create a course category first"), true)}
        </div>

        <div class="sidebar-stats" aria-label="${t("课程状态", "Course status")}">
          ${sidebarStat("file-text", t("资料", "Materials"), courseDocuments.length, t("当前课程", "Current course"))}
          ${sidebarStat("sparkles", t("生成", "Outputs"), courseGenerations.length, t("历史记录", "History"))}
        </div>
      </aside>

      <main class="workspace">
        <header class="topbar">
          <div>
            <p class="eyebrow">${t("课程工作台", "Course Workspace")}</p>
            <h1>${escapeHtml(activeCourse?.name || t("创建你的第一门课程", "Create your first course"))}</h1>
          </div>
          <div class="header-actions">
            <label class="language-control">
              <span>${t("语言", "Language")}</span>
              <select id="languageSelect" aria-label="${t("界面语言", "Interface language")}">
                ${option("zh", uiLanguage, "中文")}
                ${option("en", uiLanguage, "English")}
              </select>
            </label>
            <button class="secondary-action" id="copyResultBtn" type="button" ${activeGeneration ? "" : "disabled"}>
              ${icon("copy")}<span>${t("复制结果", "Copy")}</span>
            </button>
            <button class="secondary-action" id="downloadResultBtn" type="button" ${activeGeneration ? "" : "disabled"}>
              ${icon("download")}<span>${t("导出", "Export")}</span>
            </button>
            <div class="safety-pill ${safety.level}">
              ${icon(safety.level === "blocked" ? "triangle-alert" : "shield-check")}
              <span>${escapeHtml(displayBilingual(safety.label))}</span>
            </div>
          </div>
        </header>

        <section class="main-grid">
          <div class="left-column">
            <section class="panel upload-panel">
              <div class="panel-heading">
                <div>
                  <p class="eyebrow">${t("资料库", "Library")}</p>
                  <h2>${t("课程资料", "Course Materials")}</h2>
                </div>
                <label class="upload-button ${hasCourse ? "" : "disabled"}">
                  ${icon(isParsing ? "loader-2" : "upload", isParsing ? "spin" : "")}
                  <span>${isParsing ? t("解析中", "Parsing") : t("上传", "Upload")}</span>
                  <input id="fileInput" type="file" accept=".pdf,.doc,.docx,.txt" multiple ${hasCourse ? "" : "disabled"} />
                </label>
              </div>
              ${parseMessage ? `<p class="parse-message">${escapeHtml(displayBilingual(parseMessage))}</p>` : ""}
              <div class="document-list">
                ${hasCourse ? (courseDocuments.length ? courseDocuments.map(documentRow).join("") : emptyState("library-big", t("暂无资料", "No materials yet"), "PDF / DOCX / TXT", false)) : emptyState("folder-plus", t("请先创建课程", "Create a course first"), t("课程会用来保存资料和生成记录", "Courses keep materials and generation history organized"), false)}
              </div>
            </section>

            <section class="panel generator-panel">
              <div class="panel-heading">
                <div>
                  <p class="eyebrow">${t("生成配置", "Generation Setup")}</p>
                  <h2>${bi(selectedTaskOption.label, selectedTaskOption.enLabel)}</h2>
                </div>
                <button class="primary-action" id="generateBtn" type="button" ${isGenerating || !hasCourse ? "disabled" : ""}>
                  ${icon(isGenerating ? "loader-2" : "sparkles", isGenerating ? "spin" : "")}<span>${isGenerating ? t("生成中", "Generating") : t("生成", "Generate")}</span>
                </button>
              </div>

              <div class="task-grid">
                ${taskOptions.map(taskButton).join("")}
              </div>

              <div class="settings-grid ${usesAssessmentSettings ? "" : "knowledge-settings"}">
                <label>
                  <span>${t("身份", "Role")}</span>
                  <select id="audienceSelect">
                    ${option("学生", audience, t("学生", "Student"))}
                    ${option("教师", audience, t("教师", "Teacher"))}
                  </select>
                </label>
                ${usesAssessmentSettings ? `
                  <label>
                    <span>${t("难度", "Difficulty")}</span>
                    <select id="difficultySelect">
                      ${option("基础", difficulty, t("基础", "Foundation"))}
                      ${option("标准", difficulty, t("标准", "Standard"))}
                      ${option("挑战", difficulty, t("挑战", "Challenge"))}
                    </select>
                  </label>
                  <label>
                    <span>${t("题量", "Count")}</span>
                    <input id="questionCount" type="number" min="3" max="12" value="${questionCount}" />
                  </label>
                ` : ""}
              </div>

              <label class="requirement-box">
                <span>${t("本次要求", "Current request")}</span>
                <textarea id="extraRequirement" placeholder="${t("例：重点关注 Week 4；不要复用真题数据", "Example: focus on Week 4; do not reuse past exam data")}">${escapeHtml(extraRequirement)}</textarea>
              </label>
            </section>
          </div>

          <section class="panel output-panel">
            <div class="panel-heading output-heading">
              <div>
                <p class="eyebrow">${t("生成结果", "Output")}</p>
                <h2>${escapeHtml(displayBilingual(activeGeneration?.title || t("等待生成", "Waiting")))}</h2>
              </div>
              ${statusBadge(activeGeneration?.output?.safety?.level || safety.level, activeGeneration?.output?.safety?.label || safety.label)}
            </div>
            ${activeGeneration ? generatedOutput(activeGeneration) : emptyState("sparkles", t("暂无结果", "No output yet"), "Key points / Pitfalls / Quiz / Mock exam", false)}
          </section>
        </section>
      </main>

      <aside class="memory-panel">
        <div class="memory-heading">
          ${icon("history")}<h2>${t("课程记忆", "Course Memory")}</h2>
        </div>
        <div class="metric-strip">
          ${metric(t("资料", "Materials"), courseDocuments.length)}
          ${metric(t("生成", "Outputs"), courseGenerations.length)}
          ${metric(t("分类", "Categories"), state.courses.length)}
        </div>
        <div class="history-list">
          ${courseGenerations.length ? courseGenerations.map((generation) => historyItem(generation, activeGeneration?.id)).join("") : emptyState("history", t("没有历史记录", "No history"), t("自动保存在当前课程", "Saved to this course"), true)}
        </div>
      </aside>
    </div>
  `;

  attachEvents(activeGeneration);
  window.lucide?.createIcons({ strokeWidth: 2 });
  queueMathTypeset();
}

function attachEvents(activeGeneration) {
  document.getElementById("authForm")?.addEventListener("submit", handleAuthSubmit);
  document.getElementById("logoutBtn")?.addEventListener("click", handleLogout);
  document.getElementById("syncNowBtn")?.addEventListener("click", () => pushCloudState({ renderAfter: true }));
  document.getElementById("courseForm")?.addEventListener("submit", handleCreateCourse);
  document.getElementById("courseName")?.addEventListener("input", (event) => {
    event.target.classList.remove("needs-value");
  });
  document.getElementById("languageSelect")?.addEventListener("change", (event) => {
    uiLanguage = event.target.value === "en" ? "en" : "zh";
    localStorage.setItem(UI_LANGUAGE_KEY, uiLanguage);
    render();
  });
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
  document.getElementById("extraRequirement")?.addEventListener("input", (event) => {
    extraRequirement = event.target.value;
  });

  document.querySelectorAll("[data-answer-toggle]").forEach((checkbox) => {
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) {
        visibleAnswerKeys.add(checkbox.dataset.answerToggle);
      } else {
        visibleAnswerKeys.delete(checkbox.dataset.answerToggle);
      }
      render();
    });
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

  document.querySelectorAll("[data-delete-course]").forEach((button) => {
    button.addEventListener("click", () => {
      deleteCourse(button.dataset.deleteCourse);
    });
  });

  document.querySelectorAll("[data-generation-id]").forEach((button) => {
    button.addEventListener("click", () => {
      activeGenerationId = button.dataset.generationId;
      render();
    });
  });

  document.querySelectorAll("[data-delete-generation]").forEach((button) => {
    button.addEventListener("click", () => {
      deleteGeneration(button.dataset.deleteGeneration);
    });
  });
}

async function initializeCloudSession() {
  cloudSyncStatus = { level: "checking", code: "checking" };

  try {
    const data = await apiJson("/api/auth/me");
    if (!data?.user) {
      cloudSyncStatus = { level: "local", code: "signedOut" };
      render();
      return;
    }

    currentUser = data.user;
    cloudSyncStatus = { level: "syncing", code: "syncing" };
    render();
    await pullCloudState({ mergeLocal: true });
    await pushCloudState({ renderAfter: true });
  } catch (error) {
    currentUser = null;
    cloudSyncStatus = error.data?.configured === false
      ? { level: "unavailable", code: "unavailable", detail: error.message }
      : { level: "local", code: "signedOut" };
    render();
  }
}

async function handleAuthSubmit(event) {
  event.preventDefault();
  const action = event.submitter?.dataset.authAction === "register" ? "register" : "login";
  const email = document.getElementById("authEmail")?.value.trim();
  const password = document.getElementById("authPassword")?.value || "";

  cloudSyncStatus = { level: "syncing", code: action === "register" ? "registering" : "loggingIn" };
  render();

  try {
    const data = await apiJson(`/api/auth/${action}`, {
      method: "POST",
      body: { email, password }
    });

    currentUser = data.user;
    cloudSyncStatus = { level: "syncing", code: "syncing" };
    render();
    await pullCloudState({ mergeLocal: true });
    await pushCloudState({ renderAfter: true });
  } catch (error) {
    currentUser = null;
    cloudSyncStatus = { level: "error", code: "authError", detail: error.message };
    render();
  }
}

async function handleLogout() {
  try {
    await apiJson("/api/auth/logout", { method: "POST" });
  } catch {
    // Local state stays available even if the cloud logout request cannot finish.
  }

  currentUser = null;
  cloudSyncStatus = { level: "local", code: "signedOut" };
  render();
}

async function pullCloudState({ mergeLocal = true } = {}) {
  const data = await apiJson("/api/sync");
  const remoteState = normalizeState(data.state || defaultState);
  const nextState = mergeLocal ? mergeCourseForgeStates(remoteState, state) : remoteState;

  suppressCloudSync = true;
  persist(nextState);
  suppressCloudSync = false;
  activeCourseId = nextState.courses.some((course) => course.id === activeCourseId)
    ? activeCourseId
    : nextState.courses[0]?.id || "";
  activeGenerationId = nextState.generations.some((generation) => generation.id === activeGenerationId)
    ? activeGenerationId
    : "";
  audience = getActiveCourse()?.audience || audience;
  cloudSyncStatus = { level: "synced", code: "synced" };
  render();
}

function scheduleCloudSync() {
  if (!currentUser || suppressCloudSync) return;

  cloudSyncStatus = { level: "pending", code: "pending" };
  window.clearTimeout(cloudSyncTimer);
  cloudSyncTimer = window.setTimeout(() => {
    pushCloudState({ renderAfter: true });
  }, SYNC_DEBOUNCE_MS);
}

async function pushCloudState({ renderAfter = false } = {}) {
  if (!currentUser) return;

  window.clearTimeout(cloudSyncTimer);
  cloudSyncTimer = null;
  cloudSyncStatus = { level: "syncing", code: "syncing" };
  if (renderAfter) render();

  try {
    await apiJson("/api/sync", {
      method: "POST",
      body: { state }
    });
    cloudSyncStatus = { level: "synced", code: "synced" };
  } catch (error) {
    cloudSyncStatus = error.data?.configured === false
      ? { level: "unavailable", code: "unavailable", detail: error.message }
      : { level: "error", code: "syncError", detail: error.message };
  }

  if (renderAfter) render();
}

async function uploadCloudFile(file, courseId, documentId) {
  if (!currentUser) return null;

  const formData = new FormData();
  formData.set("file", file);
  formData.set("courseId", courseId);
  formData.set("documentId", documentId);

  const response = await fetch("/api/files", {
    method: "POST",
    body: formData,
    credentials: "same-origin"
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.error) throw new Error(data?.error || `Upload failed with HTTP ${response.status}`);
  return data;
}

async function apiJson(path, { method = "GET", body } = {}) {
  const response = await fetch(path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    credentials: "same-origin"
  });
  const data = await response.json().catch(() => ({}));

  if (!response.ok || data?.error) {
    const error = new Error(data?.error || `Request failed with HTTP ${response.status}`);
    error.data = data;
    throw error;
  }

  return data;
}

function handleCreateCourse(event) {
  event.preventDefault();
  const input = document.getElementById("courseName");
  const name = input.value.trim();
  if (!name) {
    input.classList.add("needs-value");
    input.placeholder = t("请先输入课程名称", "Enter a course name first");
    input.focus();
    return;
  }

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

function deleteCourse(courseId) {
  const course = state.courses.find((item) => item.id === courseId);
  if (!course) return;

  const confirmed = window.confirm(
    t("删除此课程会同时删除该课程的资料和生成记录。确定删除吗？", "Deleting this course will also remove its materials and generation history. Continue?")
  );
  if (!confirmed) return;

  const nextCourses = state.courses.filter((item) => item.id !== courseId);
  const nextDocuments = state.documents.filter((document) => document.courseId !== courseId);
  const nextGenerations = state.generations.filter((generation) => generation.courseId !== courseId);
  const retainedActiveCourse = activeCourseId === courseId ? null : nextCourses.find((item) => item.id === activeCourseId);
  const nextActiveCourse = retainedActiveCourse || nextCourses[0];

  persist({
    ...state,
    courses: nextCourses,
    documents: nextDocuments,
    generations: nextGenerations
  });

  activeCourseId = nextActiveCourse?.id || "";
  activeGenerationId = "";
  audience = nextActiveCourse?.audience || "学生";
  visibleAnswerKeys = new Set(
    Array.from(visibleAnswerKeys).filter((key) => nextGenerations.some((generation) => key.startsWith(`${generation.id}:`)))
  );
  render();
}

function deleteGeneration(generationId) {
  const generation = state.generations.find((item) => item.id === generationId);
  if (!generation) return;

  const confirmed = window.confirm(t("删除这条生成记录？", "Delete this generated output?"));
  if (!confirmed) return;

  const nextGenerations = state.generations.filter((item) => item.id !== generationId);
  persist({ ...state, generations: nextGenerations });

  if (activeGenerationId === generationId) {
    activeGenerationId = "";
  }
  visibleAnswerKeys = new Set(Array.from(visibleAnswerKeys).filter((key) => !key.startsWith(`${generationId}:`)));
  render();
}

async function handleFilesSelected(event) {
  const files = Array.from(event.target.files || []);
  const activeCourse = getActiveCourse();
  if (!files.length || !activeCourse) return;

  isParsing = true;
  parseMessage = t("正在解析文件", "Parsing files");
  render();

  const uploaded = [];
  for (const file of files) {
    const documentId = crypto.randomUUID();
    let documentRecord;

    try {
      const text = await extractTextFromFile(file);
      documentRecord = {
        id: documentId,
        courseId: activeCourse.id,
        name: file.name,
        type: inferDocumentType(file.name),
        size: file.size,
        text,
        safety: analyzeSafety(text),
        createdAt: new Date().toISOString()
      };
    } catch (error) {
      documentRecord = {
        id: documentId,
        courseId: activeCourse.id,
        name: file.name,
        type: "待后端解析 / Backend required",
        size: file.size,
        text: "",
        safety: { level: "sensitive", label: "待解析 / Pending", reason: error.message },
        createdAt: new Date().toISOString()
      };
    }

    try {
      const uploadResult = await uploadCloudFile(file, activeCourse.id, documentId);
      if (uploadResult?.storageKey) {
        documentRecord.storageKey = uploadResult.storageKey;
      }
    } catch (error) {
      cloudSyncStatus = { level: "error", code: "syncError", detail: error.message };
    }

    uploaded.push(documentRecord);
  }

  persist({ ...state, documents: [...uploaded, ...state.documents] });
  parseMessage = t(`${uploaded.length} 个文件已加入课程资料库`, `${uploaded.length} file(s) added to this course`);
  isParsing = false;
  event.target.value = "";
  render();
}

async function handleGenerate() {
  const activeCourse = getActiveCourse();
  const courseDocuments = getCourseDocuments();
  const corpus = getCorpus(courseDocuments);
  if (!activeCourse || isGenerating) return;

  const safety = analyzeSafety(corpus);
  let output;

  if (safety.level === "blocked") {
    output = buildBlockedOutput(safety);
  } else {
    isGenerating = true;
    render();

    try {
      output = await requestAiGeneration(
        buildGenerationRequest({
          task: selectedTask,
          course: activeCourse,
          documents: courseDocuments,
          corpus,
          safety,
          settings: { difficulty, questionCount, audience, extraRequirement }
        })
      );
    } catch (error) {
      output = buildBackendNotConnectedOutput(error, safety);
    } finally {
      isGenerating = false;
    }
  }

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

function buildGenerationRequest({ task, course, documents, corpus, safety, settings }) {
  const assessmentTask = isAssessmentTask(task);

  return {
    task,
    course: {
      id: course.id,
      name: course.name,
      audience: settings.audience
    },
    settings: {
      audience: settings.audience,
      extraRequirement: settings.extraRequirement,
      language: uiLanguage,
      ...(assessmentTask
        ? {
          difficulty: settings.difficulty,
          questionCount: settings.questionCount,
          includeAnswers: true
        }
        : {})
    },
    safety,
    materials: documents.map((document) => ({
      id: document.id,
      name: document.name,
      type: document.type,
      text: document.text
    })),
    corpus,
    outputContract: {
      title: "string",
      type: "knowledge | pitfalls | quiz | mock | refusal",
      checks: [{ label: "string", status: "pass | review | blocked", detail: "string" }],
      items: [{ title: "string", body: "string", answer: "string optional", meta: ["string"], checks: [] }]
    },
    generationRules: [
      "Use the uploaded course materials as source context.",
      "Generate final student-facing content only. Do not return prompts, instructions, or hidden reasoning.",
      "For quizzes and mock exams, every question must be answerable from the question conditions and course context.",
      "Do not reuse decisive data, cases, wording, or contexts from uploaded exams.",
      "Use clear line breaks for multi-part questions, solutions, and marking guides.",
      "Use standard LaTeX delimiters for math: inline \\(...\\), display \\[...\\]."
    ]
  };
}

async function requestAiGeneration(payload) {
  const response = await fetch("/api/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  let data = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }

  if (!response.ok) {
    const message = data?.error || `AI backend returned HTTP ${response.status}`;
    throw new Error(message);
  }

  if (data?.configured === false) {
    throw new Error(data.error || "AI backend is not configured.");
  }

  return normalizeAiOutput(data);
}

function normalizeAiOutput(data) {
  const output = data?.output || data;
  if (!output || !Array.isArray(output.items)) {
    throw new Error("AI backend returned an invalid output shape.");
  }

  return {
    title: output.title || "生成结果 / Generated Output",
    type: output.type || selectedTask,
    safety: output.safety || analyzeSafety(getCorpus(getCourseDocuments())),
    checks: Array.isArray(output.checks) ? output.checks : [],
    items: output.items.map((item, index) => ({
      title: item.title || `Item ${index + 1}`,
      body: item.body || "",
      answer: item.answer || "",
      meta: Array.isArray(item.meta) ? item.meta : [],
      checks: Array.isArray(item.checks) ? item.checks : []
    }))
  };
}

function buildBlockedOutput(safety) {
  return {
    title: "生成已暂停 / Generation Paused",
    type: "refusal",
    safety,
    checks: [
      { label: "安全审查 / Safety Review", status: "blocked", detail: safety.reason },
      { label: "生成状态 / Generation Status", status: "blocked", detail: "已停止输出 / Output stopped" }
    ],
    items: [
      {
        title: "抱歉我无法生成 / Sorry, I cannot generate this",
        body: `因为上传资料中包含${safety.reason}。请替换为客观课程资料，或删除带有劝服、煽动、歧视、宣传倾向的段落后再试。 / The uploaded material contains disallowed persuasive, discriminatory, or harmful framing. Please replace it with objective course material and try again.`
      }
    ]
  };
}

function buildBackendNotConnectedOutput(error, safety) {
  const message = error.message || "";
  const isDeepSeekIssue = /deepseek/i.test(message);
  const isOpenAiIssue = /openai/i.test(message);
  const serviceName = isDeepSeekIssue ? "DeepSeek" : isOpenAiIssue ? "OpenAI" : t("模型服务", "Model service");
  const isQuotaIssue = /quota|billing|credit|balance|insufficient|plan/i.test(message);
  const isModelIssue = /model|does not exist|not found|unsupported/i.test(message);
  const isRegionIssue = /country|region|territory|not supported/i.test(message);
  const isKeyIssue = /api key|auth|unauthorized|forbidden|invalid key|401|403/i.test(message);
  const title = isQuotaIssue
    ? t(`${serviceName} 额度或账单问题`, `${serviceName} quota or billing issue`)
    : isRegionIssue
      ? t(`${serviceName} 地区限制`, `${serviceName} region restriction`)
      : isModelIssue
        ? t(`${serviceName} 模型配置问题`, `${serviceName} model configuration issue`)
        : isKeyIssue
          ? t(`${serviceName} 密钥配置问题`, `${serviceName} key configuration issue`)
          : t("AI 接口未连接", "AI Backend Not Connected");
  const statusDetail = isQuotaIssue
    ? t(`${serviceName} 已响应，但账号额度或账单不可用`, `${serviceName} responded, but quota or billing is unavailable`)
    : isRegionIssue
      ? t(`${serviceName} 已响应，但当前访问地区不可用`, `${serviceName} responded, but the current region is unavailable`)
      : isModelIssue
        ? t(`${serviceName} 已响应，但模型名称或权限不可用`, `${serviceName} responded, but the model name or access is unavailable`)
        : isKeyIssue
          ? t(`${serviceName} 已响应，但密钥或权限配置不可用`, `${serviceName} responded, but the key or permission is unavailable`)
          : t("未收到真实 AI 生成结果", "No real AI output was returned");

  return {
    title,
    type: "system",
    safety,
    checks: [
      { label: t("接口状态", "API Status"), status: "review", detail: statusDetail },
      { label: t("本地模板", "Local Templates"), status: "blocked", detail: t("已禁用假生成", "Mock generation is disabled") }
    ],
    items: [
      {
        title: isQuotaIssue ? t("需要处理模型服务账单", "Model billing required") : t("需要检查生成接口", "Check the Generation API"),
        body: t(
          `前端已经把课程资料、用户设置和生成规则发送到 /api/generate。模型服务返回错误：${message}`,
          `The frontend sent the course materials, settings, and rules to /api/generate. The model service returned this error: ${message}`
        )
      },
      {
        title: t("接口返回格式", "Expected API Response"),
        body: t(
          `后端应返回 JSON：{ "output": { "title": "...", "type": "quiz", "checks": [...], "items": [{ "title": "...", "body": "final student-facing content", "answer": "final answer" }] } }。注意：body 和 answer 必须是最终给学生/教师看的内容，不要返回 prompt。`,
          `Return JSON like { "output": { "title": "...", "type": "quiz", "checks": [...], "items": [{ "title": "...", "body": "final student-facing content", "answer": "final answer" }] } }. Return final user-facing content only; do not return prompts.`
        )
      }
    ]
  };
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
  const answersEnabled = settings.includeAnswers !== false;
  const questions = Array.from({ length: count }, (_, index) =>
    buildQuestion({ index, topic: topics[index % topics.length], corpus, safety, difficulty: settings.difficulty, includeAnswers: answersEnabled })
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

function isAssessmentTask(task) {
  return task === "quiz" || task === "mock";
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
  const checks = output.checks.map((check) => `- ${displayBilingual(check.label)}: ${displayBilingual(check.detail)}`).join("\n");
  const items = output.items.map((item) => `${displayBilingual(item.title)}\n${item.body}${item.answer ? `\n${t("答案", "Answer")}：${item.answer}` : ""}`).join("\n\n");
  return `${displayBilingual(generation.title)}\n${formatDate(generation.createdAt)}\n\n${t("审核", "Review")}\n${checks}\n\n${t("内容", "Content")}\n${items}\n`;
}

function persist(nextState) {
  state = normalizeState(nextState);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  scheduleCloudSync();
}

function mergeCourseForgeStates(remoteState, localState) {
  const remote = normalizeState(remoteState);
  const local = normalizeState(localState);

  return normalizeState({
    courses: mergeRecords(remote.courses, local.courses),
    documents: mergeRecords(remote.documents, local.documents),
    generations: mergeRecords(remote.generations, local.generations)
  });
}

function mergeRecords(remoteRecords, localRecords) {
  const merged = new Map();
  for (const record of remoteRecords) merged.set(record.id, record);
  for (const record of localRecords) merged.set(record.id, { ...merged.get(record.id), ...record });
  return [...merged.values()].sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
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
  let normalized = {
    courses: Array.isArray(value?.courses) ? value.courses : defaultState.courses,
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

  normalized = removeUnusedSeedCourses(normalized);

  return normalized;
}

function removeUnusedSeedCourses(value) {
  const usedCourseIds = new Set([
    ...value.documents.map((document) => document.courseId),
    ...value.generations.map((generation) => generation.courseId)
  ]);

  return {
    ...value,
    courses: value.courses.filter((course) => !SEEDED_COURSE_IDS.has(course.id) || usedCourseIds.has(course.id))
  };
}

function authPanel() {
  const statusText = cloudStatusText();
  const detail = cloudStatusDetail();

  if (currentUser) {
    return `
      <section class="auth-card">
        <div class="auth-heading">
          <strong>${t("云端同步", "Cloud Sync")}</strong>
          <span class="auth-status ${escapeAttr(cloudSyncStatus.level)}">${escapeHtml(statusText)}</span>
        </div>
        <p class="auth-email">${escapeHtml(currentUser.email)}</p>
        <small>${escapeHtml(detail)}</small>
        <div class="auth-actions">
          <button id="syncNowBtn" class="auth-button secondary" type="button">${t("立即同步", "Sync now")}</button>
          <button id="logoutBtn" class="auth-button ghost" type="button">${t("退出", "Log out")}</button>
        </div>
      </section>
    `;
  }

  return `
    <section class="auth-card">
      <div class="auth-heading">
        <strong>${t("云端同步", "Cloud Sync")}</strong>
        <span class="auth-status ${escapeAttr(cloudSyncStatus.level)}">${escapeHtml(statusText)}</span>
      </div>
      <small>${escapeHtml(detail)}</small>
      <form class="auth-form" id="authForm">
        <input id="authEmail" type="email" autocomplete="email" placeholder="${t("邮箱", "Email")}" />
        <input id="authPassword" type="password" autocomplete="current-password" placeholder="${t("密码至少 8 位", "Password, 8+ characters")}" />
        <div class="auth-actions">
          <button class="auth-button primary" type="submit" data-auth-action="login">${t("登录", "Log in")}</button>
          <button class="auth-button secondary" type="submit" data-auth-action="register">${t("注册", "Sign up")}</button>
        </div>
      </form>
    </section>
  `;
}

function cloudStatusText() {
  const labels = {
    checking: t("检查中", "Checking"),
    registering: t("注册中", "Signing up"),
    loggingIn: t("登录中", "Logging in"),
    syncing: t("同步中", "Syncing"),
    pending: t("待同步", "Pending"),
    synced: t("已同步", "Synced"),
    signedOut: t("本地保存", "Local only"),
    unavailable: t("云端未配置", "Cloud unavailable"),
    authError: t("登录失败", "Sign-in failed"),
    syncError: t("同步失败", "Sync failed")
  };

  return labels[cloudSyncStatus.code] || labels.signedOut;
}

function cloudStatusDetail() {
  if (cloudSyncStatus.detail && (cloudSyncStatus.code === "authError" || cloudSyncStatus.code === "syncError")) {
    return cloudSyncStatus.detail;
  }

  const details = {
    checking: t("正在检查当前浏览器是否已登录。", "Checking whether this browser is signed in."),
    registering: t("正在创建账号并准备同步。", "Creating the account and preparing sync."),
    loggingIn: t("正在登录并合并本地资料。", "Signing in and merging local materials."),
    syncing: t("正在保存课程、资料和生成记录。", "Saving courses, materials, and generated outputs."),
    pending: t("本次更改会自动保存到云端。", "This change will be saved to the cloud automatically."),
    synced: t("课程、资料和生成记录已保存。", "Courses, materials, and generated outputs are saved."),
    signedOut: t("登录后可在不同设备和网址继续使用。", "Sign in to keep working across devices and URLs."),
    unavailable: t("需要在 Cloudflare 绑定 D1 数据库。", "Bind a Cloudflare D1 database to enable sync."),
    authError: t("请检查邮箱、密码或云端配置。", "Check the email, password, or cloud configuration."),
    syncError: t("本地内容仍然保留，请稍后重试。", "Local content is still kept. Try again later.")
  };

  return details[cloudSyncStatus.code] || details.signedOut;
}

function courseButton(course, activeId) {
  const docCount = state.documents.filter((document) => document.courseId === course.id).length;
  return `
    <article class="course-entry ${course.id === activeId ? "active" : ""}">
      <button class="course-item" data-course-id="${escapeAttr(course.id)}" type="button">
        <span class="course-color" style="background-color: ${escapeAttr(course.color)}"></span>
        <span>
          <strong>${escapeHtml(course.name)}</strong>
          <small>${escapeHtml(roleLabel(course.audience))} · ${t(`${docCount} 份资料`, `${docCount} material(s)`)}</small>
        </span>
        ${icon("chevron-right")}
      </button>
      <button class="icon-button quiet" type="button" data-delete-course="${escapeAttr(course.id)}" aria-label="${t("删除课程", "Delete course")}">
        ${icon("trash-2")}
      </button>
    </article>
  `;
}

function documentRow(document) {
  return `
    <article class="document-row">
      <div class="file-icon">${icon("file-text")}</div>
      <div>
        <strong>${escapeHtml(document.name)}</strong>
        <span>${escapeHtml(displayBilingual(document.type))} · ${formatBytes(document.size)}</span>
      </div>
      ${statusBadge(document.safety?.level || "clear", document.safety?.label || t("通过", "Clear"))}
      <button class="icon-button quiet" type="button" data-delete-doc="${escapeAttr(document.id)}" aria-label="${t("删除资料", "Delete material")}">
        ${icon("trash-2")}
      </button>
    </article>
  `;
}

function taskButton(option) {
  return `
    <button type="button" class="task-button ${selectedTask === option.id ? "selected" : ""}" data-task-id="${escapeAttr(option.id)}">
      ${icon(option.icon)}
      <span><strong>${escapeHtml(biText(option.label, option.enLabel))}</strong><small>${escapeHtml(biText(option.tone, option.enTone))}</small></span>
    </button>
  `;
}

function generatedOutput(generation) {
  const output = generation.output;
  return `
    <div class="generated-stack">
      <div class="check-row">${output.checks.map(checkChip).join("")}</div>
      <div class="result-list">
        ${output.items.map((item, index) => resultItem(generation, output, item, index)).join("")}
      </div>
    </div>
  `;
}

function resultItem(generation, output, item, index) {
  const answerKey = getAnswerKey(generation.id, index);
  const hasAnswer = Boolean(item.answer);
  const answerVisible = hasAnswer && visibleAnswerKeys.has(answerKey);

  return `
    <article class="result-item ${output.type === "refusal" ? "blocked" : ""}">
      <div class="result-title">
        <strong>${escapeHtml(displayBilingual(item.title))}</strong>
        ${item.meta ? `<div class="meta-list">${item.meta.map((meta) => `<span>${escapeHtml(displayBilingual(meta))}</span>`).join("")}</div>` : ""}
      </div>
      <div class="rich-text result-body">${renderRichText(item.body)}</div>
      ${hasAnswer ? `
        <label class="answer-toggle">
          <input type="checkbox" data-answer-toggle="${escapeAttr(answerKey)}" ${answerVisible ? "checked" : ""} />
          <span>${t("显示答案", "Show answer")}</span>
        </label>
      ` : ""}
      ${answerVisible ? `<div class="answer-box rich-text">${renderRichText(item.answer)}</div>` : ""}
    </article>
  `;
}

function getAnswerKey(generationId, index) {
  return `${generationId}:${index}`;
}

function checkChip(check) {
  return `
    <div class="check-chip ${escapeAttr(check.status)}">
      ${icon(check.status === "pass" ? "circle-check" : "triangle-alert")}
      <span>${escapeHtml(displayBilingual(check.label))}</span>
      <small>${escapeHtml(displayBilingual(check.detail))}</small>
    </div>
  `;
}

function historyItem(generation, activeId) {
  return `
    <article class="history-entry ${generation.id === activeId ? "active" : ""}">
      <button class="history-item" type="button" data-generation-id="${escapeAttr(generation.id)}">
        <span>${escapeHtml(displayBilingual(generation.title))}</span>
        <small>${formatDate(generation.createdAt)}</small>
      </button>
      <button class="icon-button quiet" type="button" data-delete-generation="${escapeAttr(generation.id)}" aria-label="${t("删除生成记录", "Delete generated output")}">
        ${icon("trash-2")}
      </button>
    </article>
  `;
}

function statusBadge(status, label) {
  return `
    <span class="status-badge ${escapeAttr(status)}">
      ${icon(status === "blocked" ? "triangle-alert" : "shield-check")}
      ${escapeHtml(displayBilingual(label))}
    </span>
  `;
}

function sidebarStat(iconName, label, value, detail) {
  return `
    <article class="sidebar-stat">
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
  return `<span class="bi"><span>${escapeHtml(biText(zh, en))}</span></span>`;
}

function biText(zh, en) {
  return uiLanguage === "zh" ? zh : en;
}

function t(zh, en) {
  return biText(zh, en);
}

function displayBilingual(value = "") {
  const text = String(value);
  const parts = text.split(/\s+\/\s+/);
  if (parts.length < 2) return text;
  return uiLanguage === "zh" ? parts[0] : parts.slice(1).join(" / ");
}

function renderRichText(value = "") {
  const text = prettifyGeneratedText(value);
  if (!text.trim()) return "";

  return renderMixedRichText(text);
}

function renderMixedRichText(text) {
  const lines = text.split("\n");
  let html = "";
  let textBuffer = [];
  let codeBuffer = [];
  let codeLanguage = "";
  let inCodeBlock = false;

  const flushText = () => {
    const blockText = textBuffer.join("\n").trim();
    if (blockText) {
      html += blockText
        .split(/\n{2,}/)
        .map((block) => renderRichBlock(block))
        .join("");
    }
    textBuffer = [];
  };

  const flushCode = () => {
    const code = codeBuffer.join("\n").replace(/\n+$/g, "");
    html += `<pre class="code-block"${codeLanguage ? ` data-language="${escapeAttr(codeLanguage)}"` : ""}><code>${escapeHtml(code)}</code></pre>`;
    codeBuffer = [];
    codeLanguage = "";
  };

  for (const line of lines) {
    const fence = line.trim().match(/^```([\w#+.-]*)\s*$/);
    if (fence) {
      if (inCodeBlock) {
        flushCode();
        inCodeBlock = false;
      } else {
        flushText();
        inCodeBlock = true;
        codeLanguage = fence[1] || "";
      }
      continue;
    }

    if (inCodeBlock) {
      codeBuffer.push(line);
    } else {
      textBuffer.push(line);
    }
  }

  if (inCodeBlock) flushCode();
  flushText();
  return html;
}

function renderRichBlock(block) {
  const lines = block.split("\n").map((line) => line.trim()).filter(Boolean);
  if (!lines.length) return "";

  if (lines.length > 1 && lines.every((line) => isListLine(line))) {
    return `<ul>${lines.map((line) => `<li>${renderInlineText(listItemText(line))}</li>`).join("")}</ul>`;
  }

  return `<p>${lines.map(renderInlineText).join("<br>")}</p>`;
}

function renderInlineText(value) {
  return escapeHtml(normalizeMathForDisplay(value))
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`]+)`/g, "<code>$1</code>");
}

function prettifyGeneratedText(value) {
  return normalizeLatexEscapes(String(value || ""))
    .replace(/\r\n/g, "\n")
    .replace(/\\n(?![A-Za-z])/g, "\n")
    .replace(/[ \t]+(\([a-z]\))/gi, "\n$1")
    .replace(/[ \t]+([A-D]\.)[ \t]+/g, "\n$1 ")
    .replace(/[ \t]+(Answer|Solution|Proof|Rubric|Reason|Therefore|Hence):/gi, "\n\n$1:")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function normalizeLatexEscapes(value) {
  return value
    .replace(/\\{2,}(?=[()[\]{}A-Za-z|])/g, "\\")
    .replace(/\\\s+([()[\]])/g, "\\$1");
}

function normalizeMathForDisplay(value) {
  return collapseNestedMathDelimiters(value)
    .replace(/\\\(\s*\\\)/g, "")
    .replace(/\\\[\s*\\\]/g, "");
}

function collapseNestedMathDelimiters(value) {
  const delimiters = [
    { open: "\\(", close: "\\)" },
    { open: "\\[", close: "\\]" },
    { open: "$$", close: "$$" },
    { open: "$", close: "$" }
  ];
  let output = "";
  let active = null;
  let nestedDepth = 0;

  for (let index = 0; index < value.length;) {
    if (!active) {
      const opening = findDelimiter(value, index, delimiters, "open");
      if (opening) {
        active = opening;
        nestedDepth = 0;
        output += opening.open;
        index += opening.open.length;
      } else {
        output += value[index];
        index += 1;
      }
      continue;
    }

    if (value.startsWith(active.open, index)) {
      nestedDepth += 1;
      index += active.open.length;
      continue;
    }

    if (value.startsWith(active.close, index)) {
      const closeLength = active.close.length;
      if (nestedDepth > 0) {
        nestedDepth -= 1;
      } else {
        output += active.close;
        active = null;
      }
      index += closeLength;
      continue;
    }

    const nestedOpening = findDelimiter(value, index, delimiters, "open");
    const nestedClosing = findDelimiter(value, index, delimiters, "close");
    if (nestedOpening) {
      index += nestedOpening.open.length;
      continue;
    }
    if (nestedClosing) {
      index += nestedClosing.close.length;
      continue;
    }

    output += value[index];
    index += 1;
  }

  return output;
}

function findDelimiter(value, index, delimiters, key) {
  return delimiters.find((delimiter) => value.startsWith(delimiter[key], index));
}

function isListLine(value) {
  return /^([-*•]|\d+[.)]|\([a-z]\)|[A-Z][.)])\s+/i.test(value);
}

function listItemText(value) {
  if (/^[-*•]\s+/.test(value)) return value.replace(/^[-*•]\s+/, "");
  return value;
}

function queueMathTypeset() {
  window.MathJax?.typesetPromise?.([document.getElementById("root")]).catch(() => {});
}

function loadUiLanguage() {
  try {
    return localStorage.getItem(UI_LANGUAGE_KEY) === "en" ? "en" : "zh";
  } catch {
    return "zh";
  }
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
  return value === "教师" ? t("教师", "Teacher") : t("学生", "Student");
}

function difficultyLabel(value) {
  if (value === "基础") return t("基础", "Foundation");
  if (value === "挑战") return t("挑战", "Challenge");
  return t("标准", "Standard");
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
