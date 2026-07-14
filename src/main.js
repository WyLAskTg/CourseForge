import { PRODUCT_ANNOUNCEMENTS } from "./announcements.js";

const STORAGE_KEY = "courseforge-state-v3";
const LEGACY_STORAGE_KEY = "courseforge-state-v1";
const UI_LANGUAGE_KEY = "courseforge-ui-language";
const FEEDBACK_LIKES_KEY = "courseforge-feedback-likes";
const FEEDBACK_OWNERS_KEY = "courseforge-feedback-owners";
const TEXT_LIMIT = 120000;
const SYNC_DEBOUNCE_MS = 900;
const SEARCH_RESULT_LIMIT = 12;
const OCR_TEXT_THRESHOLD = 180;
const OCR_DIRECT_TEXT_ACCEPT_LENGTH = 1200;
const OCR_SPARSE_PAGE_THRESHOLD = 0.6;
const OCR_RENDER_SCALE = 1;
const SEEDED_COURSE_IDS = new Set(["course-foundations", "course-humanities"]);
const CIRCUIT_COMPONENT_TYPES = new Set(["resistor", "capacitor", "lamp", "switch", "ammeter", "battery", "voltage", "current"]);
const CIRCUIT_COMPONENT_PRIORITIES = new Map([
  ["resistor", 1],
  ["capacitor", 1],
  ["lamp", 1],
  ["switch", 1],
  ["battery", 2],
  ["ammeter", 2],
  ["voltage", 2],
  ["current", 2]
]);

const defaultState = {
  courses: [],
  documents: [],
  generations: [],
  studyCollections: []
};

const STUDY_STATUS_OPTIONS = [
  { id: "stuck", zh: "不会", en: "Need Help" },
  { id: "review", zh: "模糊", en: "Review" },
  { id: "mastered", zh: "会了", en: "Got It" }
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
let difficulty = "中";
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
let workspaceMode = "study";
let feedbackItems = [];
let activeFeedbackId = "";
let activeFeedbackThread = null;
let feedbackLoaded = false;
let feedbackLoading = false;
let feedbackThreadLoading = false;
let feedbackSubmitting = false;
let feedbackReplySubmitting = false;
let feedbackError = "";
let feedbackNotice = "";
let feedbackDraftTitle = "";
let feedbackDraftBody = "";
let feedbackDraftNickname = "";
let feedbackReplyDraft = "";
let feedbackReplyNickname = "";
let feedbackViewer = { authenticated: false, canReply: false, email: "" };
let feedbackLikedIds = loadFeedbackLikedIds();
let feedbackOwnerTokens = loadFeedbackOwnerTokens();
let searchQuery = "";
let activeQuestionKey = "";
let activeStudyCollectionId = "";
let pendingScrollTarget = "";
let isCourseDialogOpen = false;
let studyCollectionDialogType = "";
let renameGenerationId = "";
let isAuthDialogOpen = false;
let isSettingsDialogOpen = false;
let settingsTab = "account";
let isFeedbackThreadModalOpen = false;
let isFeedbackReplyDialogOpen = false;
let topToast = null;
let topToastTimer = null;

render();
initializeCloudSession();
initializeFeedbackCenter();

function render() {
  document.documentElement.lang = uiLanguage === "zh" ? "zh-CN" : "en";
  document.title = t("CourseForge | 课程复习助手", "CourseForge | Course Review Assistant");

  const activeCourse = getActiveCourse();
  const courseDocuments = getCourseDocuments();
  const courseGenerations = getCourseGenerations();
  const corpus = getCorpus(courseDocuments);
  const safety = analyzeSafety(corpus);
  const activeGeneration = state.generations.find((generation) => generation.id === activeGenerationId) || courseGenerations[0];
  const rootElement = document.getElementById("root");
  const hasCourse = Boolean(activeCourse);
  const usesAssessmentSettings = isAssessmentTask(selectedTask);
  const taskMode = usesAssessmentSettings ? "assessment" : "outline";
  const taskTitle = t("生成设置", "Generation Settings");
  const questionReferences = collectQuestionReferences(courseGenerations);
  const courseStudyCollections = getCourseStudyCollections(activeCourse?.id);
  const favoriteCollections = courseStudyCollections.filter((collection) => collection.type === "favorite");
  const wrongCollections = courseStudyCollections.filter((collection) => collection.type === "wrong");
  const activeStudyCollection = courseStudyCollections.find((collection) => collection.id === activeStudyCollectionId) || null;
  const activeStudyCollectionRefs = activeStudyCollection ? resolveStudyCollectionItems(activeStudyCollection, questionReferences) : [];
  const searchResults = buildWorkspaceSearchResults(searchQuery, courseDocuments, courseGenerations);

  window.MathJax?.typesetClear?.([rootElement]);
  rootElement.innerHTML = `
    <div class="app-shell">
      ${courseDialog()}
      ${studyCollectionDialog()}
      ${renameGenerationDialog()}
      ${authDialog()}
      ${settingsDialog()}
      ${feedbackThreadModal()}
      ${feedbackReplyDialog()}
      ${topToastMarkup()}

      <main class="workspace">
        <header class="topbar">
          <div class="brand topbar-brand">
            <div class="brand-mark">${icon("brain")}</div>
            <div>
              <strong>CourseForge</strong>
              ${bi("课程综合复习平台", "课程综合复习平台")}
            </div>
          </div>
          <div class="header-actions">
            ${currentUser ? "" : `
              <button class="secondary-action" id="openAuthDialogBtn" type="button">
                ${icon("log-in")}<span>${t("登录", "Log in")}</span>
              </button>
            `}
            <label class="language-control">
              <span class="language-symbol" aria-hidden="true">文A</span>
              <select id="languageSelect" aria-label="${t("界面语言", "Interface language")}">
                ${option("zh", uiLanguage, "中文")}
                ${option("en", uiLanguage, "English")}
              </select>
            </label>
            ${blockedBadge(safety)}
          </div>
        </header>

        <section class="main-grid">
          <div class="left-column">
            <div class="course-heading">
              <p class="eyebrow">${t("当前课程", "Current Course")}</p>
              <div class="course-switcher">
                <select id="courseSelect" aria-label="${t("选择课程", "Select course")}" ${state.courses.length ? "" : "disabled"}>
                  ${state.courses.length
                    ? state.courses.map((course) => option(course.id, activeCourse?.id, course.name)).join("")
                    : `<option value="">${t("请先创建课程", "Create a course first")}</option>`}
                </select>
                <button class="create-course-button" id="openCourseDialogBtn" type="button">
                  ${icon("folder-plus")}<span>${t("创建", "Create")}</span>
                </button>
                ${activeCourse ? `
                  <button class="icon-button quiet" type="button" data-delete-course="${escapeAttr(activeCourse.id)}" aria-label="${t("删除当前课程", "Delete current course")}">
                    ${icon("trash-2")}
                  </button>
                ` : ""}
              </div>
            </div>

            <section class="panel upload-panel">
              <div class="panel-heading">
                <div>
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
                ${hasCourse ? (courseDocuments.length ? courseDocuments.map(documentRow).join("") : emptyState("library-big", t("待上传", "Waiting for upload"), "", false)) : emptyState("folder-plus", t("请先创建课程", "Create a course first"), t("课程会用来保存资料和生成记录", "Courses keep materials and generation history organized"), false)}
              </div>
            </section>

            <section class="panel generator-panel">
              <div class="panel-heading">
                <div>
                  <h2>${taskTitle}</h2>
                </div>
                <button class="primary-action" id="generateBtn" type="button" ${isGenerating || !hasCourse ? "disabled" : ""}>
                  ${icon(isGenerating ? "loader-2" : "sparkles", isGenerating ? "spin" : "")}<span>${isGenerating ? t("生成中", "Generating") : t("生成", "Generate")}</span>
                </button>
              </div>

              <div class="task-grid">
                <button type="button" class="task-button ${taskMode === "outline" ? "selected" : ""}" data-task-mode="outline">
                  ${icon("book-open")}
                  <span><strong>${t("知识提纲", "Knowledge Outline")}</strong></span>
                </button>
                <button type="button" class="task-button ${taskMode === "assessment" ? "selected" : ""}" data-task-mode="assessment">
                  ${icon("clipboard-list")}
                  <span><strong>${t("题目", "Questions")}</strong></span>
                </button>
              </div>

              ${usesAssessmentSettings ? `
                <div class="settings-grid">
                  <label>
                    <span>${t("题量", "Count")}</span>
                    <input id="questionCount" type="number" min="3" max="12" value="${questionCount}" />
                  </label>
                  <label>
                    <span>${t("难度", "Difficulty")}</span>
                    <select id="difficultySelect">
                      ${option("易", difficulty, t("易", "Easy"))}
                      ${option("中", difficulty, t("中", "Medium"))}
                      ${option("难", difficulty, t("难", "Hard"))}
                    </select>
                  </label>
                </div>
              ` : ""}

              <label class="requirement-box">
                <span>${t("附加要求", "Additional Requirements")}</span>
                <textarea id="extraRequirement">${escapeHtml(extraRequirement)}</textarea>
              </label>
            </section>
          </div>

          <section class="panel output-panel">
            <div class="panel-heading output-heading">
              <div>
                <h2>${escapeHtml(displayBilingual(activeGeneration?.title || t("生成结果", "Output")))}</h2>
              </div>
              ${blockedBadge(activeGeneration?.output?.safety || safety)}
            </div>
            ${activeGeneration ? generatedOutput(activeGeneration) : emptyState("", t("暂无结果", "No output yet"), "", false)}
          </section>
        </section>
      </main>

      <aside class="memory-panel">
        <section class="announcement-panel">
          <div class="memory-section-head">
            <div>
              <h3>${t("更新公告", "Updates")}</h3>
            </div>
          </div>
          <div class="announcement-list">
            ${PRODUCT_ANNOUNCEMENTS.map(renderAnnouncementItem).join("")}
          </div>
        </section>
        <section class="search-panel">
          <div class="memory-section-head">
            <div>
              <h3>${t("资料检索", "Material Search")}</h3>
            </div>
            ${searchQuery ? `<button class="spotlight-link" id="clearSearchBtn" type="button">${t("清空", "Clear")}</button>` : ""}
          </div>
          <label class="search-input-wrap">
            ${icon("search")}
            <input id="workspaceSearch" type="search" value="${escapeAttr(searchQuery)}" />
          </label>
          <div class="search-result-list">
            ${renderSearchResults(searchQuery, searchResults)}
          </div>
        </section>
        <section class="study-board">
          <div class="memory-section-head">
            <div>
              <h3>${t("收藏夹", "Favorites")}</h3>
            </div>
            <button class="create-course-button study-create-button" type="button" data-create-study-collection="favorite">
              ${icon("plus")}<span>${t("新建", "New")}</span>
            </button>
          </div>
          <div class="study-collection-list">
            ${favoriteCollections.length
              ? favoriteCollections.map((collection) => renderStudyCollectionItem(collection, questionReferences, activeStudyCollectionId)).join("")
              : ""}
          </div>
          ${activeStudyCollection?.type === "favorite" ? `
            <div class="study-collection-detail">
              <div class="study-section-head">
                <strong>${escapeHtml(activeStudyCollection.name)}</strong>
                <button class="spotlight-link" type="button" data-close-study-collection="1">${t("收起", "Collapse")}</button>
              </div>
              <div class="study-link-list">
                ${activeStudyCollectionRefs.length
                  ? activeStudyCollectionRefs.map(renderStudyLinkItem).join("")
                  : `<p class="feedback-inline-status">${escapeHtml(t("这个集合里还没有题目。", "This collection has no questions yet."))}</p>`}
              </div>
            </div>
          ` : ""}
        </section>
        <section class="study-board">
          <div class="memory-section-head">
            <div>
              <h3>${t("错题集", "Wrong Questions")}</h3>
            </div>
            <button class="create-course-button study-create-button" type="button" data-create-study-collection="wrong">
              ${icon("plus")}<span>${t("新建", "New")}</span>
            </button>
          </div>
          <div class="study-collection-list">
            ${wrongCollections.length
              ? wrongCollections.map((collection) => renderStudyCollectionItem(collection, questionReferences, activeStudyCollectionId)).join("")
              : ""}
          </div>
          ${activeStudyCollection?.type === "wrong" ? `
            <div class="study-collection-detail">
              <div class="study-section-head">
                <strong>${escapeHtml(activeStudyCollection.name)}</strong>
                <button class="spotlight-link" type="button" data-close-study-collection="1">${t("收起", "Collapse")}</button>
              </div>
              <div class="study-link-list">
                ${activeStudyCollectionRefs.length
                  ? activeStudyCollectionRefs.map(renderStudyLinkItem).join("")
                  : `<p class="feedback-inline-status">${escapeHtml(t("这个集合里还没有题目。", "This collection has no questions yet."))}</p>`}
              </div>
            </div>
          ` : ""}
        </section>
        <section class="history-panel">
          <div class="memory-section-head">
            <div>
              <h3>${t("历史记录", "History")}</h3>
            </div>
          </div>
          <div class="history-list">
            ${courseGenerations.length ? courseGenerations.map((generation) => historyItem(generation, activeGeneration?.id)).join("") : emptyState("history", t("没有历史记录", "No history"), t("自动保存在当前课程", "Saved to this course"), true)}
          </div>
        </section>
      </aside>
      <button class="settings-launcher" id="openSettingsBtn" type="button" aria-label="${t("打开设置", "Open settings")}">
        ${icon("settings")}<span>${t("设置", "Settings")}</span>
      </button>
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
  document.getElementById("openAuthDialogBtn")?.addEventListener("click", openAuthDialog);
  document.getElementById("closeAuthDialogBtn")?.addEventListener("click", closeAuthDialog);
  document.getElementById("cancelAuthDialogBtn")?.addEventListener("click", closeAuthDialog);
  document.getElementById("authDialogBackdrop")?.addEventListener("click", (event) => {
    if (event.target.id === "authDialogBackdrop") closeAuthDialog();
  });
  document.getElementById("openCourseDialogBtn")?.addEventListener("click", openCourseDialog);
  document.getElementById("openSettingsBtn")?.addEventListener("click", openSettingsDialog);
  document.getElementById("closeSettingsDialogBtn")?.addEventListener("click", closeSettingsDialog);
  document.getElementById("settingsDialogBackdrop")?.addEventListener("click", (event) => {
    if (event.target.id === "settingsDialogBackdrop") closeSettingsDialog();
  });
  document.getElementById("settingsOpenAuthDialogBtn")?.addEventListener("click", () => {
    isSettingsDialogOpen = false;
    openAuthDialog();
  });
  document.getElementById("settingsSyncNowBtn")?.addEventListener("click", () => pushCloudState({ renderAfter: true }));
  document.getElementById("settingsLogoutBtn")?.addEventListener("click", handleLogout);
  document.querySelectorAll("[data-settings-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      settingsTab = button.dataset.settingsTab || "account";
      render();
      if (settingsTab === "feedback" && !feedbackLoaded) {
        refreshFeedbackBoard({ keepSelection: true, loadThread: false });
      }
    });
  });
  document.getElementById("courseDialogForm")?.addEventListener("submit", handleCreateCourse);
  document.getElementById("closeCourseDialogBtn")?.addEventListener("click", closeCourseDialog);
  document.getElementById("cancelCourseDialogBtn")?.addEventListener("click", closeCourseDialog);
  document.getElementById("courseDialogBackdrop")?.addEventListener("click", (event) => {
    if (event.target.id === "courseDialogBackdrop") closeCourseDialog();
  });
  document.getElementById("courseDialogName")?.addEventListener("input", (event) => {
    event.target.classList.remove("needs-value");
  });
  document.getElementById("courseSelect")?.addEventListener("change", (event) => {
    const courseId = event.target.value;
    if (!courseId || courseId === activeCourseId) return;
    activeCourseId = courseId;
    activeGenerationId = "";
    activeQuestionKey = "";
    activeStudyCollectionId = "";
    audience = getActiveCourse()?.audience || "学生";
    render();
  });
  document.getElementById("languageSelect")?.addEventListener("change", (event) => {
    uiLanguage = event.target.value === "en" ? "en" : "zh";
    localStorage.setItem(UI_LANGUAGE_KEY, uiLanguage);
    render();
  });
  document.getElementById("fileInput")?.addEventListener("change", handleFilesSelected);
  document.getElementById("generateBtn")?.addEventListener("click", handleGenerate);
  document.getElementById("difficultySelect")?.addEventListener("change", (event) => {
    difficulty = event.target.value;
  });
  document.getElementById("questionCount")?.addEventListener("change", (event) => {
    questionCount = clamp(Number(event.target.value), 3, 12);
  });
  const extraRequirementInput = document.getElementById("extraRequirement");
  autoResizeTextarea(extraRequirementInput);
  extraRequirementInput?.addEventListener("input", (event) => {
    extraRequirement = event.target.value;
    autoResizeTextarea(event.target);
  });
  document.getElementById("workspaceSearch")?.addEventListener("input", (event) => {
    searchQuery = event.target.value;
    render();
  });
  document.getElementById("clearSearchBtn")?.addEventListener("click", () => {
    searchQuery = "";
    render();
  });

  document.querySelectorAll("[data-answer-toggle]").forEach((checkbox) => {
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) {
        visibleAnswerKeys.add(checkbox.dataset.answerToggle);
      } else {
        visibleAnswerKeys.delete(checkbox.dataset.answerToggle);
      }
      renderPreservingOutputScroll();
    });
  });

  document.querySelectorAll("[data-course-id]").forEach((button) => {
    button.addEventListener("click", () => {
      activeCourseId = button.dataset.courseId;
      activeGenerationId = "";
      activeQuestionKey = "";
      activeStudyCollectionId = "";
      audience = getActiveCourse()?.audience || "学生";
      render();
    });
  });

  document.querySelectorAll("[data-task-mode]").forEach((button) => {
    button.addEventListener("click", () => {
      selectedTask = button.dataset.taskMode === "assessment" ? "quiz" : "knowledge";
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
      activeQuestionKey = "";
      render();
    });
  });

  document.querySelectorAll("[data-delete-generation]").forEach((button) => {
    button.addEventListener("click", () => {
      deleteGeneration(button.dataset.deleteGeneration);
    });
  });

  document.querySelectorAll("[data-rename-generation]").forEach((button) => {
    button.addEventListener("click", () => {
      openRenameGenerationDialog(button.dataset.renameGeneration);
    });
  });

  document.querySelectorAll("[data-toggle-favorite]").forEach((button) => {
    button.addEventListener("click", () => {
      toggleQuestionFavorite(button.dataset.generationId, Number(button.dataset.itemIndex));
    });
  });

  document.querySelectorAll("[data-mark-study]").forEach((button) => {
    button.addEventListener("click", () => {
      setQuestionStudyStatus(button.dataset.generationId, Number(button.dataset.itemIndex), button.dataset.markStudy);
    });
  });

  document.querySelectorAll("[data-create-study-collection]").forEach((button) => {
    button.addEventListener("click", () => {
      openStudyCollectionDialog(button.dataset.createStudyCollection);
    });
  });

  document.getElementById("studyCollectionDialogForm")?.addEventListener("submit", handleCreateStudyCollection);
  document.getElementById("closeStudyCollectionDialogBtn")?.addEventListener("click", closeStudyCollectionDialog);
  document.getElementById("cancelStudyCollectionDialogBtn")?.addEventListener("click", closeStudyCollectionDialog);
  document.getElementById("studyCollectionDialogBackdrop")?.addEventListener("click", (event) => {
    if (event.target.id === "studyCollectionDialogBackdrop") closeStudyCollectionDialog();
  });
  document.getElementById("studyCollectionDialogName")?.addEventListener("input", (event) => {
    event.target.classList.remove("needs-value");
  });

  document.getElementById("renameGenerationDialogForm")?.addEventListener("submit", handleRenameGeneration);
  document.getElementById("closeRenameGenerationDialogBtn")?.addEventListener("click", closeRenameGenerationDialog);
  document.getElementById("cancelRenameGenerationDialogBtn")?.addEventListener("click", closeRenameGenerationDialog);
  document.getElementById("renameGenerationDialogBackdrop")?.addEventListener("click", (event) => {
    if (event.target.id === "renameGenerationDialogBackdrop") closeRenameGenerationDialog();
  });
  document.getElementById("renameGenerationDialogName")?.addEventListener("input", (event) => {
    event.target.classList.remove("needs-value");
  });

  document.querySelectorAll("[data-open-study-collection]").forEach((button) => {
    button.addEventListener("click", () => {
      activeStudyCollectionId = button.dataset.openStudyCollection;
      render();
    });
  });

  document.querySelectorAll("[data-delete-study-collection]").forEach((button) => {
    button.addEventListener("click", () => {
      deleteStudyCollection(button.dataset.deleteStudyCollection);
    });
  });

  document.querySelectorAll("[data-add-study-collection]").forEach((select) => {
    select.addEventListener("change", () => {
      addQuestionToStudyCollection(select.value, select.dataset.generationId, Number(select.dataset.itemIndex));
    });
  });

  document.querySelector("[data-close-study-collection]")?.addEventListener("click", () => {
    activeStudyCollectionId = "";
    render();
  });

  document.querySelectorAll("[data-open-question]").forEach((button) => {
    button.addEventListener("click", () => {
      openQuestionReference({
        generationId: button.dataset.generationId,
        questionKey: button.dataset.questionKey
      });
    });
  });

  document.querySelectorAll("[data-open-document]").forEach((button) => {
    button.addEventListener("click", () => {
      queueScrollTarget(`document:${button.dataset.openDocument}`);
      render();
    });
  });

  document.querySelectorAll("[data-open-generation]").forEach((button) => {
    button.addEventListener("click", () => {
      activeGenerationId = button.dataset.openGeneration;
      activeQuestionKey = "";
      queueScrollTarget(`generation:${button.dataset.openGeneration}`);
      render();
    });
  });

  document.getElementById("feedbackForm")?.addEventListener("submit", handleFeedbackSubmit);
  document.getElementById("feedbackTitle")?.addEventListener("input", (event) => {
    feedbackDraftTitle = event.target.value;
  });
  document.getElementById("feedbackNickname")?.addEventListener("input", (event) => {
    feedbackDraftNickname = event.target.value;
  });
  const feedbackBodyInput = document.getElementById("feedbackBody");
  autoResizeTextarea(feedbackBodyInput);
  feedbackBodyInput?.addEventListener("input", (event) => {
    feedbackDraftBody = event.target.value;
    autoResizeTextarea(event.target);
  });
  document.getElementById("feedbackReplyForm")?.addEventListener("submit", handleFeedbackReplySubmit);
  document.getElementById("feedbackReplyBody")?.addEventListener("input", (event) => {
    feedbackReplyDraft = event.target.value;
  });
  document.getElementById("feedbackReplyNickname")?.addEventListener("input", (event) => {
    feedbackReplyNickname = event.target.value;
  });
  document.getElementById("feedbackLikeBtn")?.addEventListener("click", handleFeedbackLike);
  document.getElementById("openFeedbackReplyDialogBtn")?.addEventListener("click", openFeedbackReplyDialog);
  document.getElementById("closeFeedbackReplyDialogBtn")?.addEventListener("click", closeFeedbackReplyDialog);
  document.getElementById("cancelFeedbackReplyDialogBtn")?.addEventListener("click", closeFeedbackReplyDialog);
  document.getElementById("feedbackReplyDialogBackdrop")?.addEventListener("click", (event) => {
    if (event.target.id === "feedbackReplyDialogBackdrop") closeFeedbackReplyDialog();
  });
  document.getElementById("feedbackDeleteBtn")?.addEventListener("click", handleFeedbackDelete);
  document.getElementById("closeFeedbackThreadDialogBtn")?.addEventListener("click", closeFeedbackThreadDialog);
  document.getElementById("feedbackThreadDialogBackdrop")?.addEventListener("click", (event) => {
    if (event.target.id === "feedbackThreadDialogBackdrop") closeFeedbackThreadDialog();
  });
  document.querySelectorAll("[data-feedback-id]").forEach((button) => {
    button.addEventListener("click", () => {
      openFeedbackThread(button.dataset.feedbackId);
    });
  });

  queueScrollToPendingTarget();
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
    isAuthDialogOpen = false;
    cloudSyncStatus = { level: "syncing", code: "syncing" };
    render();
    await pullCloudState({ mergeLocal: true });
    await pushCloudState({ renderAfter: true });
    showTopToast(action === "register" ? "registerSuccess" : "loginSuccess");
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
  showTopToast("logoutSuccess");
}

function showTopToast(code) {
  if (topToastTimer) window.clearTimeout(topToastTimer);
  const id = Date.now();
  topToast = { id, code };
  render();
  topToastTimer = window.setTimeout(() => {
    if (topToast?.id !== id) return;
    topToast = null;
    topToastTimer = null;
    render();
  }, 2200);
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

async function initializeFeedbackCenter() {
  if (feedbackLoaded || feedbackLoading) return;
  await refreshFeedbackBoard({ keepSelection: true, loadThread: false, quiet: true });
}

function toggleFeedbackCenter() {
  if (workspaceMode === "feedback") {
    workspaceMode = "study";
    render();
    return;
  }

  openFeedbackCenter();
}

function openFeedbackCenter() {
  workspaceMode = "feedback";
  render();

  if (!feedbackLoaded) {
    refreshFeedbackBoard({ keepSelection: true, loadThread: false });
    return;
  }

  if (isFeedbackThreadModalOpen && !activeFeedbackThread && activeFeedbackId) {
    loadFeedbackThread(activeFeedbackId);
  }
}

async function refreshFeedbackBoard({ keepSelection = true, loadThread = true, quiet = false } = {}) {
  feedbackLoading = true;
  if (!quiet) render();

  try {
    const data = await apiJson("/api/feedback");
    feedbackItems = Array.isArray(data.items) ? data.items : [];
    feedbackViewer = normalizeFeedbackViewer(data.viewer);
    feedbackLoaded = true;
    feedbackError = "";

    if (!keepSelection || (activeFeedbackId && !feedbackItems.some((item) => item.id === activeFeedbackId))) {
      activeFeedbackId = "";
      activeFeedbackThread = null;
    }

    if (loadThread && activeFeedbackId) {
      await loadFeedbackThread(activeFeedbackId, { quiet: true });
    } else if (!activeFeedbackId) {
      activeFeedbackThread = null;
    }
  } catch (error) {
    feedbackError = error.message;
  }

  feedbackLoading = false;
  render();
}

async function loadFeedbackThread(feedbackId, { quiet = false } = {}) {
  if (!feedbackId) {
    activeFeedbackId = "";
    activeFeedbackThread = null;
    feedbackReplyDraft = "";
    render();
    return;
  }

  if (feedbackId !== activeFeedbackId) {
    feedbackReplyDraft = "";
  }
  activeFeedbackId = feedbackId;
  feedbackThreadLoading = true;
  if (!quiet) render();

  try {
    const data = await apiJson(`/api/feedback?id=${encodeURIComponent(feedbackId)}`);
    activeFeedbackThread = data.thread || null;
    feedbackViewer = normalizeFeedbackViewer(data.viewer);
    feedbackError = "";
  } catch (error) {
    feedbackError = error.message;
  }

  feedbackThreadLoading = false;
  render();
}

function openFeedbackThread(feedbackId) {
  isSettingsDialogOpen = true;
  isFeedbackThreadModalOpen = true;
  loadFeedbackThread(feedbackId);
}

function closeFeedbackThreadDialog() {
  isFeedbackThreadModalOpen = false;
  isFeedbackReplyDialogOpen = false;
  feedbackReplyDraft = "";
  render();
}

function openFeedbackReplyDialog() {
  if (!activeFeedbackThread) return;
  isFeedbackReplyDialogOpen = true;
  render();
}

function closeFeedbackReplyDialog() {
  isFeedbackReplyDialogOpen = false;
  feedbackReplyDraft = "";
  render();
}

async function handleFeedbackSubmit(event) {
  event.preventDefault();
  const title = feedbackDraftTitle.trim();
  const body = feedbackDraftBody.trim();
  const nickname = feedbackDraftNickname.trim();

  if (!title || !body) {
    feedbackError = t("请先写标题和内容。", "Please enter both a title and feedback message.");
    render();
    return;
  }

  if (!nickname) {
    feedbackError = t("请输入昵称。", "Please enter a nickname.");
    render();
    return;
  }

  feedbackSubmitting = true;
  feedbackError = "";
  feedbackNotice = "";
  render();

  try {
    const ownerToken = createFeedbackOwnerToken();
    const data = await apiJson("/api/feedback", {
      method: "POST",
      body: { title, body, ownerToken, nickname }
    });

    feedbackItems = Array.isArray(data.items) ? data.items : feedbackItems;
    feedbackViewer = normalizeFeedbackViewer(data.viewer);
    activeFeedbackId = data.thread?.id || activeFeedbackId;
    activeFeedbackThread = data.thread || activeFeedbackThread;
    if (data.thread?.id) {
      feedbackOwnerTokens[data.thread.id] = ownerToken;
      saveFeedbackOwnerTokens();
    }
    isFeedbackThreadModalOpen = Boolean(data.thread);
    feedbackLoaded = true;
    feedbackDraftTitle = "";
    feedbackDraftBody = "";
    feedbackNotice = t("反馈已发布，感谢你帮我们把它打磨得更好。", "Feedback posted. Thank you for helping improve it.");
    isSettingsDialogOpen = true;
  } catch (error) {
    feedbackError = error.message;
  }

  feedbackSubmitting = false;
  render();
}

async function handleFeedbackReplySubmit(event) {
  event.preventDefault();
  if (!activeFeedbackId) return;

  const body = feedbackReplyDraft.trim();
  const nickname = feedbackReplyNickname.trim();
  if (!nickname || !body) {
    feedbackError = t("请输入昵称和回复内容。", "Please enter a nickname and reply.");
    render();
    return;
  }

  feedbackReplySubmitting = true;
  feedbackError = "";
  feedbackNotice = "";
  render();

  try {
    const data = await apiJson("/api/feedback", {
      method: "POST",
      body: { threadId: activeFeedbackId, body, nickname }
    });

    feedbackItems = Array.isArray(data.items) ? data.items : feedbackItems;
    feedbackViewer = normalizeFeedbackViewer(data.viewer);
    activeFeedbackThread = data.thread || activeFeedbackThread;
    feedbackReplyDraft = "";
    isFeedbackReplyDialogOpen = false;
    feedbackNotice = t("回复已发布。", "Reply posted.");
  } catch (error) {
    feedbackError = error.message;
  }

  feedbackReplySubmitting = false;
  render();
}

async function handleFeedbackDelete() {
  if (!activeFeedbackId) return;
  const ownerToken = feedbackOwnerTokens[activeFeedbackId];
  if (!ownerToken) return;
  if (!window.confirm(t("确定删除这条反馈帖吗？删除后无法恢复。", "Delete this feedback thread? This cannot be undone."))) return;

  const deletingId = activeFeedbackId;
  feedbackError = "";
  feedbackNotice = "";

  try {
    const data = await apiJson("/api/feedback", {
      method: "DELETE",
      body: { threadId: deletingId, ownerToken }
    });
    delete feedbackOwnerTokens[deletingId];
    saveFeedbackOwnerTokens();
    feedbackLikedIds.delete(deletingId);
    saveFeedbackLikedIds();
    feedbackItems = Array.isArray(data.items) ? data.items : feedbackItems.filter((item) => item.id !== deletingId);
    feedbackViewer = normalizeFeedbackViewer(data.viewer);
    activeFeedbackId = "";
    activeFeedbackThread = null;
    isFeedbackThreadModalOpen = false;
    isFeedbackReplyDialogOpen = false;
    feedbackNotice = t("反馈帖已删除。", "Feedback thread deleted.");
  } catch (error) {
    feedbackError = error.message;
  }

  render();
}

async function handleFeedbackLike() {
  if (!activeFeedbackId || feedbackLikedIds.has(activeFeedbackId)) return;

  const likedId = activeFeedbackId;
  feedbackLikedIds.add(likedId);
  saveFeedbackLikedIds();
  incrementFeedbackLikeCount(likedId);
  render();

  try {
    const data = await apiJson("/api/feedback", {
      method: "POST",
      body: { threadId: likedId, action: "like" }
    });

    feedbackItems = Array.isArray(data.items) ? data.items : feedbackItems;
    feedbackViewer = normalizeFeedbackViewer(data.viewer);
    activeFeedbackThread = data.thread || activeFeedbackThread;
    feedbackError = "";
  } catch (error) {
    feedbackLikedIds.delete(likedId);
    saveFeedbackLikedIds();
    decrementFeedbackLikeCount(likedId);
    feedbackError = error.message;
  }

  render();
}

function incrementFeedbackLikeCount(threadId) {
  updateFeedbackLikeCount(threadId, 1);
}

function decrementFeedbackLikeCount(threadId) {
  updateFeedbackLikeCount(threadId, -1);
}

function updateFeedbackLikeCount(threadId, delta) {
  feedbackItems = feedbackItems.map((item) => (
    item.id === threadId ? { ...item, likeCount: Math.max(0, Number(item.likeCount || 0) + delta) } : item
  ));
  if (activeFeedbackThread?.id === threadId) {
    activeFeedbackThread = {
      ...activeFeedbackThread,
      likeCount: Math.max(0, Number(activeFeedbackThread.likeCount || 0) + delta)
    };
  }
}

function normalizeFeedbackViewer(viewer) {
  return {
    authenticated: Boolean(viewer?.authenticated),
    canReply: Boolean(viewer?.canReply),
    isDeveloper: Boolean(viewer?.isDeveloper),
    email: String(viewer?.email || "")
  };
}

function toggleQuestionFavorite(generationId, itemIndex) {
  updateGenerationItemState(generationId, itemIndex, (item) => ({
    ...item,
    isFavorite: !item.isFavorite
  }));
}

function setQuestionStudyStatus(generationId, itemIndex, status) {
  const nextStatus = normalizeStudyStatus(status);
  updateGenerationItemState(generationId, itemIndex, (item) => ({
    ...item,
    studyStatus: item.studyStatus === nextStatus ? "" : nextStatus
  }));
}

function openStudyCollectionDialog(type) {
  const collectionType = normalizeStudyCollectionType(type);
  if (!getActiveCourse() || !collectionType) return;
  studyCollectionDialogType = collectionType;
  render();
}

function closeStudyCollectionDialog() {
  studyCollectionDialogType = "";
  render();
}

function handleCreateStudyCollection(event) {
  event.preventDefault();
  const activeCourse = getActiveCourse();
  const collectionType = normalizeStudyCollectionType(studyCollectionDialogType);
  if (!activeCourse || !collectionType) return;

  const input = document.getElementById("studyCollectionDialogName");
  const name = input.value.trim();
  if (!name) {
    input.classList.add("needs-value");
    input.placeholder = collectionType === "favorite" ? t("请输入收藏夹名称", "Enter a folder name") : t("请输入错题集名称", "Enter a wrong-question set name");
    input.focus();
    return;
  }

  const nextCollection = {
    id: crypto.randomUUID(),
    courseId: activeCourse.id,
    type: collectionType,
    name,
    itemRefs: [],
    createdAt: new Date().toISOString()
  };

  persist({ ...state, studyCollections: [nextCollection, ...state.studyCollections] });
  activeStudyCollectionId = nextCollection.id;
  studyCollectionDialogType = "";
  render();
}

function deleteStudyCollection(collectionId) {
  const collection = state.studyCollections.find((item) => item.id === collectionId);
  if (!collection) return;

  const confirmed = window.confirm(t(`删除「${collection.name}」？集合里的题目引用会被移除，原生成记录不会删除。`, `Delete "${collection.name}"? Question links will be removed, but generated outputs stay.`));
  if (!confirmed) return;

  persist({ ...state, studyCollections: state.studyCollections.filter((item) => item.id !== collectionId) });
  if (activeStudyCollectionId === collectionId) activeStudyCollectionId = "";
  render();
}

function addQuestionToStudyCollection(collectionId, generationId, itemIndex) {
  if (!collectionId || !generationId || !Number.isInteger(itemIndex)) return;
  const collection = state.studyCollections.find((item) => item.id === collectionId);
  const generation = state.generations.find((item) => item.id === generationId);
  if (!collection || !generation) return;

  const ref = { generationId, itemIndex, questionKey: getQuestionKey(generationId, itemIndex) };
  const nextCollections = state.studyCollections.map((item) => {
    if (item.id !== collectionId) return item;
    const refs = Array.isArray(item.itemRefs) ? item.itemRefs : [];
    const exists = refs.some((candidate) => candidate.generationId === generationId && Number(candidate.itemIndex) === itemIndex);
    return exists ? item : { ...item, itemRefs: [ref, ...refs] };
  });

  const nextGenerations = state.generations.map((item) => {
    if (item.id !== generationId) return item;
    const items = Array.isArray(item.output?.items) ? item.output.items : [];
    if (!items[itemIndex]) return item;
    const nextItems = items.map((question, index) => {
      const normalizedQuestion = normalizeGeneratedItem(question);
      if (index !== itemIndex) return normalizedQuestion;
      return normalizeGeneratedItem({
        ...normalizedQuestion,
        isFavorite: collection.type === "favorite" ? true : normalizedQuestion.isFavorite,
        studyStatus: collection.type === "wrong" && !normalizedQuestion.studyStatus ? "review" : normalizedQuestion.studyStatus
      });
    });
    return { ...item, output: { ...item.output, items: nextItems } };
  });

  persist({ ...state, generations: nextGenerations, studyCollections: nextCollections });
  activeStudyCollectionId = collectionId;
  activeGenerationId = generationId;
  activeQuestionKey = ref.questionKey;
  queueScrollTarget(`question:${ref.questionKey}`);
  render();
}

function updateGenerationItemState(generationId, itemIndex, updater) {
  if (!generationId || !Number.isInteger(itemIndex) || itemIndex < 0) return;

  const nextGenerations = state.generations.map((generation) => {
    if (generation.id !== generationId) return generation;
    const items = Array.isArray(generation.output?.items) ? generation.output.items : [];
    if (!items[itemIndex]) return generation;

    const nextItems = items.map((item, index) => (
      index === itemIndex ? normalizeGeneratedItem(updater(normalizeGeneratedItem(item))) : normalizeGeneratedItem(item)
    ));

    return {
      ...generation,
      output: {
        ...generation.output,
        items: nextItems
      }
    };
  });

  persist({ ...state, generations: nextGenerations });
  activeGenerationId = generationId;
  activeQuestionKey = getQuestionKey(generationId, itemIndex);
  queueScrollTarget(`question:${activeQuestionKey}`);
  render();
}

function collectQuestionReferences(generations) {
  return generations.flatMap((generation) => {
    const items = Array.isArray(generation.output?.items) ? generation.output.items : [];
    return items.map((item, index) => {
      const normalizedItem = normalizeGeneratedItem(item);
      return {
        generationId: generation.id,
        courseId: generation.courseId,
        generationTitle: displayBilingual(generation.title || ""),
        questionKey: getQuestionKey(generation.id, index),
        itemIndex: index,
        title: displayBilingual(normalizedItem.title || `Q${index + 1}`),
        preview: plainTextPreview(normalizedItem.body),
        isFavorite: Boolean(normalizedItem.isFavorite),
        studyStatus: normalizedItem.studyStatus || "",
        outputType: generation.output?.type || generation.task || ""
      };
    });
  });
}

function openQuestionReference(reference) {
  if (!reference?.generationId) return;
  activeGenerationId = reference.generationId;
  activeQuestionKey = reference.questionKey || "";
  queueScrollTarget(reference.questionKey ? `question:${reference.questionKey}` : `generation:${reference.generationId}`);
  render();
}

function queueScrollTarget(targetKey) {
  pendingScrollTarget = String(targetKey || "");
}

function queueScrollToPendingTarget() {
  if (!pendingScrollTarget) return;
  const targetKey = pendingScrollTarget;
  pendingScrollTarget = "";

  window.requestAnimationFrame(() => {
    const safeKey = escapeSelectorValue(targetKey);
    const element = document.querySelector(`[data-scroll-target="${safeKey}"]`);
    if (!element) return;
    element.scrollIntoView({ behavior: "smooth", block: "center" });
    element.classList.add("focus-flash");
    window.setTimeout(() => element.classList.remove("focus-flash"), 1400);
  });
}

function renderPreservingOutputScroll() {
  const scroller = document.querySelector(".output-panel > .generated-stack");
  const scrollTop = scroller?.scrollTop || 0;
  const scrollLeft = scroller?.scrollLeft || 0;

  render();

  const restore = () => {
    const nextScroller = document.querySelector(".output-panel > .generated-stack");
    if (!nextScroller) return;
    nextScroller.scrollTop = scrollTop;
    nextScroller.scrollLeft = scrollLeft;
  };

  window.requestAnimationFrame(restore);
  window.setTimeout(restore, 80);
}

function autoResizeTextarea(textarea) {
  if (!textarea) return;
  textarea.style.height = "auto";
  textarea.style.height = `${textarea.scrollHeight}px`;
}

function buildWorkspaceSearchResults(query, courseDocuments, courseGenerations) {
  const normalizedQuery = String(query || "").trim().toLowerCase();
  if (!normalizedQuery) return [];

  const results = [];

  for (const document of courseDocuments) {
    const haystack = `${document.name} ${displayBilingual(document.type)} ${document.text || ""}`.toLowerCase();
    if (!haystack.includes(normalizedQuery)) continue;
    results.push({
      id: `document:${document.id}`,
      kind: "document",
      title: document.name,
      preview: plainTextPreview(document.text || ""),
      meta: formatBytes(document.size),
      documentId: document.id
    });
    if (results.length >= SEARCH_RESULT_LIMIT) return results;
  }

  for (const generation of courseGenerations) {
    const generationText = formatGenerationText(generation).toLowerCase();
    if (!generationText.includes(normalizedQuery)) continue;
    results.push({
      id: `generation:${generation.id}`,
      kind: "generation",
      title: displayBilingual(generation.title || ""),
      preview: plainTextPreview(generation.output?.items?.[0]?.body || ""),
      meta: formatDate(generation.createdAt),
      generationId: generation.id
    });
    if (results.length >= SEARCH_RESULT_LIMIT) return results;
  }

  return results;
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

function openAuthDialog() {
  if (currentUser) return;
  isAuthDialogOpen = true;
  render();
}

function closeAuthDialog() {
  isAuthDialogOpen = false;
  render();
}

function openSettingsDialog() {
  isSettingsDialogOpen = true;
  render();
  if (!feedbackLoaded) {
    refreshFeedbackBoard({ keepSelection: true, loadThread: false });
  }
}

function closeSettingsDialog() {
  isSettingsDialogOpen = false;
  render();
}

function openCourseDialog() {
  isCourseDialogOpen = true;
  render();
}

function closeCourseDialog() {
  isCourseDialogOpen = false;
  render();
}

function handleCreateCourse(event) {
  event.preventDefault();
  const input = document.getElementById("courseDialogName");
  const name = input.value.trim();
  if (!name) {
    input.classList.add("needs-value");
    input.placeholder = t("请输入课程标题或代码", "Enter a course title or code");
    input.focus();
    return;
  }

  const nextCourse = {
    id: crypto.randomUUID(),
    name,
    audience: "学生",
    color: pickCourseColor(state.courses.length),
    createdAt: new Date().toISOString()
  };

  persist({ ...state, courses: [nextCourse, ...state.courses] });
  activeCourseId = nextCourse.id;
  activeGenerationId = "";
  isCourseDialogOpen = false;
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
  const nextStudyCollections = state.studyCollections.filter((collection) => collection.courseId !== courseId);
  const retainedActiveCourse = activeCourseId === courseId ? null : nextCourses.find((item) => item.id === activeCourseId);
  const nextActiveCourse = retainedActiveCourse || nextCourses[0];

  persist({
    ...state,
    courses: nextCourses,
    documents: nextDocuments,
    generations: nextGenerations,
    studyCollections: nextStudyCollections
  });

  activeCourseId = nextActiveCourse?.id || "";
  activeGenerationId = "";
  activeQuestionKey = "";
  activeStudyCollectionId = nextStudyCollections.some((collection) => collection.id === activeStudyCollectionId) ? activeStudyCollectionId : "";
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
  const nextStudyCollections = state.studyCollections.map((collection) => ({
    ...collection,
    itemRefs: collection.itemRefs.filter((ref) => ref.generationId !== generationId)
  }));
  persist({ ...state, generations: nextGenerations, studyCollections: nextStudyCollections });

  if (activeGenerationId === generationId) {
    activeGenerationId = "";
  }
  if (activeQuestionKey.startsWith(`${generationId}:question:`)) {
    activeQuestionKey = "";
  }
  if (activeStudyCollectionId && !nextStudyCollections.some((collection) => collection.id === activeStudyCollectionId)) {
    activeStudyCollectionId = "";
  }
  visibleAnswerKeys = new Set(Array.from(visibleAnswerKeys).filter((key) => !key.startsWith(`${generationId}:`)));
  render();
}

function openRenameGenerationDialog(generationId) {
  if (!state.generations.some((generation) => generation.id === generationId)) return;
  renameGenerationId = generationId;
  render();
}

function closeRenameGenerationDialog() {
  renameGenerationId = "";
  render();
}

function handleRenameGeneration(event) {
  event.preventDefault();
  const generation = state.generations.find((item) => item.id === renameGenerationId);
  if (!generation) return;

  const input = document.getElementById("renameGenerationDialogName");
  const title = input.value.trim();
  if (!title) {
    input.classList.add("needs-value");
    input.placeholder = t("请输入新的生成记录名称", "Enter a new output name");
    input.focus();
    return;
  }

  persist({
    ...state,
    generations: state.generations.map((item) => (
      item.id === renameGenerationId ? { ...item, title } : item
    ))
  });
  activeGenerationId = renameGenerationId;
  renameGenerationId = "";
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
  let ocrUsedCount = 0;
  for (const file of files) {
    const documentId = crypto.randomUUID();
    let documentRecord;

    try {
      parseMessage = t(`正在解析 ${file.name}`, `Parsing ${file.name}`);
      render();
      const extracted = await extractTextFromFile(file, {
        onStatus: (message) => {
          parseMessage = message;
          render();
        }
      });
      if (extracted.parseMode === "ocr") ocrUsedCount += 1;
      documentRecord = {
        id: documentId,
        courseId: activeCourse.id,
        name: file.name,
        type: applyDocumentParseMode(inferDocumentType(file.name), extracted.parseMode),
        size: file.size,
        text: extracted.text,
        safety: analyzeSafety(extracted.text),
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
  parseMessage = ocrUsedCount
    ? t(`${uploaded.length} 个文件已加入课程资料库，其中 ${ocrUsedCount} 个扫描件使用了 OCR`, `${uploaded.length} file(s) added, with OCR used for ${ocrUsedCount} scanned PDF(s)`)
    : t(`${uploaded.length} 个文件已加入课程资料库`, `${uploaded.length} file(s) added to this course`);
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
      "Do not use external image URLs or Markdown image links.",
      "For circuit questions, use only the CourseForge circuit DSL in a fenced circuit block. Do not use ASCII art or placeholder images.",
      "Circuit DSL examples: size W H; node ID X Y; wire A B; dot A; resistor R1 2ohm A B; capacitor C1 1nF A B; lamp L A B; switch S1 A B open; ammeter A A B; battery U_S 12V A B; arrow I A B; ground G. Leave generous spacing between labels and components.",
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
    items: output.items.map((item, index) => normalizeGeneratedItem({
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

async function extractTextFromFile(file, { onStatus } = {}) {
  const extension = getExtension(file.name);
  if (extension === "txt" || file.type.startsWith("text/")) {
    return { text: truncateText(await file.text()), parseMode: "text" };
  }

  if (extension === "docx") {
    const mammoth = await loadMammoth();
    const result = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
    return { text: truncateText(result.value || ""), parseMode: "text" };
  }

  if (extension === "pdf") {
    onStatus?.(t(`正在解析 PDF 文本：${file.name}`, `Reading PDF text: ${file.name}`));
    const pdfjsLib = await loadPdfJs();
    const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
    const pages = [];
    let sparsePageCount = 0;
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      if (pdf.numPages > 12 && (pageNumber === 1 || pageNumber % 10 === 0)) {
        onStatus?.(t(`正在读取 PDF 文本：第 ${pageNumber}/${pdf.numPages} 页`, `Reading PDF text: page ${pageNumber}/${pdf.numPages}`));
      }
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      const pageText = content.items.map((item) => item.str).join(" ").trim();
      if (pageText.length < 12) sparsePageCount += 1;
      pages.push(pageText);
    }
    const directText = truncateText(pages.join("\n\n"));
    const processedPageCount = pages.length || 1;
    const sparseRatio = sparsePageCount / processedPageCount;
    const hasUsableDirectText = directText.length >= OCR_DIRECT_TEXT_ACCEPT_LENGTH;
    const needsOcr = directText.length < OCR_TEXT_THRESHOLD
      || (!hasUsableDirectText && sparseRatio >= OCR_SPARSE_PAGE_THRESHOLD);

    if (!needsOcr) {
      return { text: directText, parseMode: "text" };
    }

    const ocrLanguages = chooseOcrLanguages(file.name, directText);
    onStatus?.(t(`检测到扫描版 PDF，正在进行 OCR：${file.name}`, `Scanned PDF detected, running OCR: ${file.name}`));
    try {
      const ocrText = await extractPdfTextWithOcr(pdf, onStatus, ocrLanguages);
      if (ocrText.trim()) {
        return { text: truncateText(ocrText), parseMode: "ocr" };
      }
    } catch (error) {
      console.warn("OCR fallback failed", error);
    }

    return { text: directText, parseMode: "text" };
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

async function loadTesseractWorker(languages) {
  const languageKey = languages || "eng";
  parserCache.tesseractWorkerPromises ||= {};
  if (!parserCache.tesseractWorkerPromises[languageKey]) {
    parserCache.tesseractWorkerPromises[languageKey] = (async () => {
      const module = await import("https://esm.sh/tesseract.js@5/dist/tesseract.esm.min.js");
      const createWorker = module.createWorker || module.default?.createWorker;
      if (typeof createWorker !== "function") {
        throw new Error("Tesseract worker is unavailable.");
      }
      const worker = await createWorker(languageKey);
      try {
        await worker.setParameters?.({
          preserve_interword_spaces: "1",
          tessedit_pageseg_mode: "6"
        });
      } catch (error) {
        console.warn("Tesseract fast parameters unavailable", error);
      }
      return worker;
    })();
  }

  return parserCache.tesseractWorkerPromises[languageKey];
}

async function extractPdfTextWithOcr(pdf, onStatus, languages) {
  const pageLimit = pdf.numPages;
  const worker = await loadTesseractWorker(languages);
  const parts = [];

  for (let pageNumber = 1; pageNumber <= pageLimit; pageNumber += 1) {
    onStatus?.(t(`OCR 识别中：第 ${pageNumber}/${pageLimit} 页`, `Running OCR: page ${pageNumber}/${pageLimit}`));
    const page = await pdf.getPage(pageNumber);
    const canvas = await renderPdfPageToCanvas(page);
    try {
      const result = await worker.recognize(canvas);
      const text = result?.data?.text || "";
      if (text.trim()) parts.push(text.trim());
    } finally {
      canvas.width = 0;
      canvas.height = 0;
    }
  }

  return parts.join("\n\n");
}

async function renderPdfPageToCanvas(page) {
  const viewport = page.getViewport({ scale: OCR_RENDER_SCALE });
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const context = canvas.getContext("2d", { alpha: false });
  await page.render({ canvasContext: context, viewport }).promise;
  return canvas;
}

function applyDocumentParseMode(typeLabel, parseMode) {
  if (parseMode !== "ocr") return typeLabel;
  const parts = String(typeLabel || "").split(" / ");
  if (parts.length < 2) return `${typeLabel} (OCR)`;
  return `${parts[0]}（OCR） / ${parts.slice(1).join(" / ")} · OCR`;
}

function analyzeSafety(text) {
  const content = text || "";
  const blockingHit = BLOCKING_PATTERNS.find((item) => item.regex.test(content));
  if (blockingHit) return { level: "blocked", label: "不通过 / Not Passed", reason: `${blockingHit.reason} / Contains prohibited persuasive, discriminatory, or harmful content` };

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

function getCourseStudyCollections(courseId = getActiveCourse()?.id) {
  return state.studyCollections.filter((collection) => collection.courseId === courseId);
}

function resolveStudyCollectionItems(collection, questionReferences) {
  const referenceByKey = new Map(questionReferences.map((item) => [`${item.generationId}:${item.itemIndex}`, item]));
  return collection.itemRefs
    .map((ref) => referenceByKey.get(`${ref.generationId}:${ref.itemIndex}`))
    .filter(Boolean);
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

function chooseOcrLanguages(fileName, textSample = "") {
  return /[\u3400-\u9fff]/.test(`${fileName} ${textSample}`) ? "eng+chi_sim" : "eng";
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
    generations: mergeRecords(remote.generations, local.generations),
    studyCollections: mergeRecords(remote.studyCollections, local.studyCollections)
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
    generations: Array.isArray(value?.generations) ? value.generations : [],
    studyCollections: Array.isArray(value?.studyCollections) ? value.studyCollections : []
  };

  normalized.courses = normalized.courses.map((course, index) => ({
    id: course.id || crypto.randomUUID(),
    name: course.name || `课程 ${index + 1}`,
    audience: normalizeAudience(course.audience),
    color: course.color || pickCourseColor(index),
    createdAt: course.createdAt || new Date().toISOString()
  }));

  normalized.documents = normalized.documents.map((document) => ({
    id: document.id || crypto.randomUUID(),
    courseId: document.courseId || normalized.courses[0]?.id || "",
    name: document.name || "Untitled",
    type: document.type || inferDocumentType(document.name || ""),
    size: Number(document.size || 0),
    text: String(document.text || ""),
    safety: document.safety || analyzeSafety(document.text || ""),
    storageKey: document.storageKey || "",
    createdAt: document.createdAt || new Date().toISOString()
  }));

  normalized.generations = normalized.generations.map((generation) => ({
    id: generation.id || crypto.randomUUID(),
    courseId: generation.courseId || normalized.courses[0]?.id || "",
    task: generation.task || generation.output?.type || "knowledge",
    title: generation.title || "Generated Output",
    output: normalizeGenerationOutput(generation.output),
    createdAt: generation.createdAt || new Date().toISOString()
  }));

  normalized.studyCollections = normalized.studyCollections.map((collection) => normalizeStudyCollection(collection, normalized.courses[0]?.id || ""));

  normalized = removeUnusedSeedCourses(normalized);

  return normalized;
}

function normalizeGenerationOutput(output) {
  return {
    title: output?.title || "",
    type: output?.type || "knowledge",
    safety: output?.safety || null,
    checks: Array.isArray(output?.checks) ? output.checks : [],
    items: Array.isArray(output?.items) ? output.items.map(normalizeGeneratedItem) : []
  };
}

function normalizeGeneratedItem(item = {}) {
  return {
    ...item,
    title: String(item.title || ""),
    body: String(item.body || ""),
    answer: String(item.answer || ""),
    meta: Array.isArray(item.meta) ? item.meta : [],
    checks: Array.isArray(item.checks) ? item.checks : [],
    isFavorite: Boolean(item.isFavorite),
    studyStatus: normalizeStudyStatus(item.studyStatus)
  };
}

function normalizeStudyCollection(collection = {}, fallbackCourseId = "") {
  return {
    id: collection.id || crypto.randomUUID(),
    courseId: collection.courseId || fallbackCourseId,
    type: normalizeStudyCollectionType(collection.type) || "favorite",
    name: String(collection.name || "Untitled"),
    itemRefs: Array.isArray(collection.itemRefs) ? collection.itemRefs.map(normalizeStudyCollectionRef).filter(Boolean) : [],
    createdAt: collection.createdAt || new Date().toISOString()
  };
}

function normalizeStudyCollectionRef(ref = {}) {
  const itemIndex = Number(ref.itemIndex);
  if (!ref.generationId || !Number.isInteger(itemIndex) || itemIndex < 0) return null;
  return {
    generationId: String(ref.generationId),
    itemIndex,
    questionKey: ref.questionKey || getQuestionKey(ref.generationId, itemIndex)
  };
}

function normalizeStudyCollectionType(value) {
  return ["favorite", "wrong"].includes(value) ? value : "";
}

function normalizeStudyStatus(value) {
  return ["stuck", "review", "mastered"].includes(value) ? value : "";
}

function removeUnusedSeedCourses(value) {
  const usedCourseIds = new Set([
    ...value.documents.map((document) => document.courseId),
    ...value.generations.map((generation) => generation.courseId),
    ...value.studyCollections.map((collection) => collection.courseId)
  ]);

  return {
    ...value,
    courses: value.courses.filter((course) => !SEEDED_COURSE_IDS.has(course.id) || usedCourseIds.has(course.id))
  };
}

function courseDialog() {
  if (!isCourseDialogOpen) return "";

  return `
    <div class="modal-backdrop" id="courseDialogBackdrop" role="presentation">
      <section class="modal-card course-dialog" role="dialog" aria-modal="true" aria-labelledby="courseDialogTitle">
        <div class="modal-heading">
          <div>
            <h2 id="courseDialogTitle">${t("新课程", "New Course")}</h2>
          </div>
          <button class="icon-button quiet" id="closeCourseDialogBtn" type="button" aria-label="${t("关闭", "Close")}">
            ${icon("x")}
          </button>
        </div>
        <form class="modal-form" id="courseDialogForm">
          <label>
            <span>${t("课程标题或代码", "Course title or code")}</span>
            <input id="courseDialogName" autocomplete="off" autofocus />
          </label>
          <div class="modal-actions">
            <button class="secondary-action" id="cancelCourseDialogBtn" type="button">${t("取消", "Cancel")}</button>
            <button class="create-course-button" type="submit">
              ${icon("folder-plus")}<span>${t("创建", "Create")}</span>
            </button>
          </div>
        </form>
      </section>
    </div>
  `;
}

function studyCollectionDialog() {
  const collectionType = normalizeStudyCollectionType(studyCollectionDialogType);
  if (!collectionType) return "";

  const isFavorite = collectionType === "favorite";
  return `
    <div class="modal-backdrop" id="studyCollectionDialogBackdrop" role="presentation">
      <section class="modal-card course-dialog" role="dialog" aria-modal="true" aria-labelledby="studyCollectionDialogTitle">
        <div class="modal-heading">
          <div>
            <p class="eyebrow">${isFavorite ? t("新收藏夹", "New folder") : t("新错题集", "New wrong-question set")}</p>
            <h2 id="studyCollectionDialogTitle">${isFavorite ? t("创建收藏夹", "Create Folder") : t("创建错题集", "Create Set")}</h2>
          </div>
          <button class="icon-button quiet" id="closeStudyCollectionDialogBtn" type="button" aria-label="${t("关闭", "Close")}">
            ${icon("x")}
          </button>
        </div>
        <form class="modal-form" id="studyCollectionDialogForm">
          <label>
            <span>${isFavorite ? t("收藏夹名称", "Folder name") : t("错题集名称", "Set name")}</span>
            <input id="studyCollectionDialogName" autocomplete="off" autofocus placeholder="${isFavorite ? t("例如 期中复习", "Example: Midterm review") : t("例如 导数易错题", "Example: Derivatives review")}" />
          </label>
          <div class="modal-actions">
            <button class="secondary-action" id="cancelStudyCollectionDialogBtn" type="button">${t("取消", "Cancel")}</button>
            <button class="create-course-button" type="submit">
              ${icon("folder-plus")}<span>${t("创建", "Create")}</span>
            </button>
          </div>
        </form>
      </section>
    </div>
  `;
}

function renameGenerationDialog() {
  if (!renameGenerationId) return "";

  const generation = state.generations.find((item) => item.id === renameGenerationId);
  if (!generation) return "";

  return `
    <div class="modal-backdrop" id="renameGenerationDialogBackdrop" role="presentation">
      <section class="modal-card course-dialog" role="dialog" aria-modal="true" aria-labelledby="renameGenerationDialogTitle">
        <div class="modal-heading">
          <div>
            <p class="eyebrow">${t("生成记录", "Generated output")}</p>
            <h2 id="renameGenerationDialogTitle">${t("重命名", "Rename")}</h2>
          </div>
          <button class="icon-button quiet" id="closeRenameGenerationDialogBtn" type="button" aria-label="${t("关闭", "Close")}">
            ${icon("x")}
          </button>
        </div>
        <form class="modal-form" id="renameGenerationDialogForm">
          <label>
            <span>${t("生成记录名称", "Output name")}</span>
            <input id="renameGenerationDialogName" autocomplete="off" autofocus value="${escapeAttr(displayBilingual(generation.title))}" />
          </label>
          <div class="modal-actions">
            <button class="secondary-action" id="cancelRenameGenerationDialogBtn" type="button">${t("取消", "Cancel")}</button>
            <button class="create-course-button" type="submit">
              ${icon("check")}<span>${t("保存", "Save")}</span>
            </button>
          </div>
        </form>
      </section>
    </div>
  `;
}

function authDialog() {
  if (!isAuthDialogOpen || currentUser) return "";

  const statusText = cloudStatusText();
  const detail = cloudStatusDetail();
  const isBusy = ["registering", "loggingIn", "syncing"].includes(cloudSyncStatus.code);
  const isError = cloudSyncStatus.code === "authError" || cloudSyncStatus.code === "syncError" || cloudSyncStatus.code === "unavailable";

  return `
    <div class="modal-backdrop" id="authDialogBackdrop" role="presentation">
      <section class="modal-card course-dialog" role="dialog" aria-modal="true" aria-labelledby="authDialogTitle">
        <div class="modal-heading">
          <div>
            <p class="eyebrow">${t("账号", "Account")}</p>
            <h2 id="authDialogTitle">${t("登录", "Log in")}</h2>
          </div>
          <button class="icon-button quiet" id="closeAuthDialogBtn" type="button" aria-label="${t("关闭", "Close")}">
            ${icon("x")}
          </button>
        </div>
        <form class="modal-form auth-dialog-form" id="authForm">
          <label>
            <span>${t("邮箱", "Email")}</span>
            <input id="authEmail" type="email" autocomplete="email" autofocus />
          </label>
          <label>
            <span>${t("密码", "Password")}</span>
            <input id="authPassword" type="password" autocomplete="current-password" />
          </label>
          ${detail ? `<p class="auth-dialog-status ${isError ? "error" : ""}">${escapeHtml(statusText ? `${statusText}：${detail}` : detail)}</p>` : ""}
          <div class="modal-actions">
            <button class="secondary-action" id="cancelAuthDialogBtn" type="button">${t("取消", "Cancel")}</button>
            <button class="secondary-action" type="submit" data-auth-action="register" ${isBusy ? "disabled" : ""}>${t("注册", "Sign up")}</button>
            <button class="create-course-button" type="submit" data-auth-action="login" ${isBusy ? "disabled" : ""}>
              ${icon(isBusy ? "loader-2" : "log-in", isBusy ? "spin" : "")}<span>${isBusy ? t("处理中", "Working") : t("登录", "Log in")}</span>
            </button>
          </div>
        </form>
      </section>
    </div>
  `;
}

function settingsDialog() {
  if (!isSettingsDialogOpen) return "";

  const allQuestionReferences = collectQuestionReferences(state.generations);
  const documents = [...state.documents].sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
  const generations = [...state.generations].sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
  const favorites = state.studyCollections.filter((collection) => collection.type === "favorite");
  const wrongSets = state.studyCollections.filter((collection) => collection.type === "wrong");
  const tabs = [
    { id: "account", label: t("账号与数据", "Account & Data"), iconName: "database" },
    { id: "collections", label: t("收藏夹与错题集", "Collections"), iconName: "star" },
    { id: "feedback", label: t("意见反馈", "Feedback"), iconName: "messages-square" },
  ];
  const activeTab = tabs.some((tab) => tab.id === settingsTab) ? settingsTab : "account";

  return `
    <div class="modal-backdrop settings-backdrop" id="settingsDialogBackdrop" role="presentation">
      <section class="modal-card settings-dialog" role="dialog" aria-modal="true" aria-labelledby="settingsDialogTitle">
        <div class="modal-heading settings-dialog-heading">
          <div>
            <h2 id="settingsDialogTitle">${t("设置", "Settings")}</h2>
          </div>
          <button class="icon-button quiet" id="closeSettingsDialogBtn" type="button" aria-label="${t("关闭", "Close")}">
            ${icon("x")}
          </button>
        </div>
        <div class="settings-dialog-body">
          <nav class="settings-nav" aria-label="${t("设置分类", "Settings sections")}">
            ${tabs.map((tab) => `
              <button class="settings-nav-item ${activeTab === tab.id ? "active" : ""}" type="button" data-settings-tab="${tab.id}">
                ${icon(tab.iconName)}
                <span>${tab.label}</span>
              </button>
            `).join("")}
          </nav>
          <div class="settings-content">
            ${activeTab === "collections"
              ? settingsCollectionsSection(favorites, wrongSets, allQuestionReferences)
              : activeTab === "feedback"
                ? settingsFeedbackSection()
                : settingsAccountDataSection(documents, generations)}
          </div>
        </div>
      </section>
    </div>
  `;
}

function settingsAccountDataSection(documents, generations) {
  return `
    <div class="settings-section-heading">
      <h3>${t("账号与数据", "Account & Data")}</h3>
    </div>
    <div class="settings-content-grid settings-account-grid">
      <section class="settings-admin-card settings-account-card">
        <div class="settings-card-head"><h3>${t("账号信息", "Account")}</h3></div>
        ${settingsAccountPanel()}
      </section>
      <section class="settings-admin-card">
        <div class="settings-card-head">
          <h3>${t("课程资料", "Course Materials")}</h3>
          <span>${escapeHtml(t(`${documents.length} 份`, `${documents.length} file(s)`))}</span>
        </div>
        <div class="settings-summary-list">
          ${documents.length ? documents.map(settingsMaterialRow).join("") : settingsEmptyLine(t("还没有上传资料", "No uploaded materials yet"))}
        </div>
      </section>
      <section class="settings-admin-card">
        <div class="settings-card-head">
          <h3>${t("生成历史", "Generation History")}</h3>
          <span>${escapeHtml(t(`${generations.length} 条`, `${generations.length} item(s)`))}</span>
        </div>
        <div class="settings-summary-list">
          ${generations.length ? generations.map(settingsGenerationRow).join("") : settingsEmptyLine(t("还没有生成历史", "No generation history yet"))}
        </div>
      </section>
    </div>
  `;
}

function settingsCollectionsSection(favorites, wrongSets, allQuestionReferences) {
  return `
    <div class="settings-section-heading">
      <h3>${t("收藏夹与错题集", "Collections")}</h3>
    </div>
    <div class="settings-content-grid">
      <section class="settings-admin-card">
        <div class="settings-card-head">
          <h3>${t("收藏夹", "Favorites")}</h3>
          <span>${escapeHtml(t(`${favorites.length} 个`, `${favorites.length} folder(s)`))}</span>
        </div>
        <div class="settings-summary-list">
          ${favorites.length ? favorites.map((collection) => settingsCollectionRow(collection, allQuestionReferences)).join("") : settingsEmptyLine(t("还没有收藏夹", "No favorite folders yet"))}
        </div>
      </section>
      <section class="settings-admin-card">
        <div class="settings-card-head">
          <h3>${t("错题集", "Wrong Question Sets")}</h3>
          <span>${escapeHtml(t(`${wrongSets.length} 个`, `${wrongSets.length} set(s)`))}</span>
        </div>
        <div class="settings-summary-list">
          ${wrongSets.length ? wrongSets.map((collection) => settingsCollectionRow(collection, allQuestionReferences)).join("") : settingsEmptyLine(t("还没有错题集", "No wrong-question sets yet"))}
        </div>
      </section>
    </div>
  `;
}

function settingsFeedbackSection() {
  return `
    <div class="settings-section-heading">
      <h3>${t("意见反馈", "Feedback")}</h3>
    </div>
    <section class="settings-admin-card settings-feedback-card">
      ${feedbackCenterPanel(false)}
    </section>
  `;
}

function settingsAccountPanel() {
  const statusText = cloudStatusText();
  const detail = cloudStatusDetail();

  if (!currentUser) {
    return `
      <div class="settings-account-stack">
        <p class="settings-muted">${escapeHtml(t("当前未登录", "Not signed in"))}</p>
        <p>${escapeHtml(detail)}</p>
        <button class="create-course-button" id="settingsOpenAuthDialogBtn" type="button">
          ${icon("log-in")}<span>${t("登录", "Log in")}</span>
        </button>
      </div>
    `;
  }

  return `
    <div class="settings-account-stack">
      <div class="settings-account-identity">
        <p class="settings-account-email">${escapeHtml(currentUser.email)}</p>
        ${statusText ? `<span class="auth-status ${escapeAttr(cloudSyncStatus.level)}">${escapeHtml(statusText)}</span>` : ""}
      </div>
      <div class="settings-inline-actions">
        <button class="secondary-action" id="settingsSyncNowBtn" type="button">${t("立即同步", "Sync now")}</button>
        <button class="secondary-action" id="settingsLogoutBtn" type="button">${t("登出", "Log out")}</button>
      </div>
    </div>
  `;
}

function settingsMaterialRow(document) {
  return `
    <article class="settings-summary-row">
      <div class="file-icon">${icon("file-text")}</div>
      <div>
        <strong>${escapeHtml(document.name)}</strong>
        <span>${escapeHtml(courseName(document.courseId))} · ${formatBytes(document.size)}</span>
      </div>
      <time>${escapeHtml(formatDate(document.createdAt))}</time>
    </article>
  `;
}

function settingsGenerationRow(generation) {
  return `
    <article class="settings-summary-row">
      <div class="file-icon">${icon("sparkles")}</div>
      <div>
        <strong>${escapeHtml(displayBilingual(generation.title))}</strong>
        <span>${escapeHtml(courseName(generation.courseId))}</span>
      </div>
      <time>${escapeHtml(formatDate(generation.createdAt))}</time>
    </article>
  `;
}

function settingsCollectionRow(collection, questionReferences) {
  const itemCount = resolveStudyCollectionItems(collection, questionReferences).length;
  return `
    <article class="settings-summary-row">
      <div class="file-icon">${icon(collection.type === "favorite" ? "star" : "book-marked")}</div>
      <div>
        <strong>${escapeHtml(collection.name)}</strong>
        <span>${escapeHtml(courseName(collection.courseId))} · ${escapeHtml(t(`${itemCount} 题`, `${itemCount} question(s)`))}</span>
      </div>
      <time>${escapeHtml(formatDate(collection.createdAt))}</time>
    </article>
  `;
}

function settingsEmptyLine(text) {
  return `<p class="settings-empty-line">${escapeHtml(text)}</p>`;
}

function courseName(courseId) {
  return state.courses.find((course) => course.id === courseId)?.name || t("未分类课程", "Uncategorized course");
}

function topToastMarkup() {
  if (!topToast) return "";
  const labels = {
    loginSuccess: t("登录成功", "Logged in successfully"),
    logoutSuccess: t("登出成功", "Logged out successfully"),
    registerSuccess: t("注册成功", "Account created successfully")
  };
  return `
    <div class="top-toast" role="status" aria-live="polite">
      ${icon("circle-check")}<span>${labels[topToast.code] || ""}</span>
    </div>
  `;
}

function authPanel() {
  const statusText = cloudStatusText();
  const detail = cloudStatusDetail();

  if (currentUser) {
    return `
      <section class="auth-card">
        <div class="auth-heading">
          <strong>${t("账号登录", "Account Login")}</strong>
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
        <strong>${t("账号登录", "Account Login")}</strong>
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
    signedOut: "",
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
    signedOut: t("登录后可同步历史记录", "Sign in to sync history"),
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
          <small>${t(`${docCount} 份资料`, `${docCount} material(s)`)}</small>
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
  const isBlocked = document.safety?.level === "blocked";
  const usesOcr = /OCR/i.test(String(document.type || ""));
  return `
    <article class="document-row ${isBlocked ? "" : "no-status"}" data-scroll-target="document:${escapeAttr(document.id)}">
      <div class="file-icon">${icon("file-text")}</div>
      <div>
        <strong>${escapeHtml(document.name)}</strong>
        <span>${formatBytes(document.size)}</span>
        ${usesOcr ? `<small class="document-note">${escapeHtml(t("扫描件已走 OCR", "Scanned PDF parsed with OCR"))}</small>` : ""}
      </div>
      ${blockedBadge(document.safety)}
      <button class="icon-button quiet" type="button" data-delete-doc="${escapeAttr(document.id)}" aria-label="${t("删除资料", "Delete material")}">
        ${icon("trash-2")}
      </button>
    </article>
  `;
}

function generatedOutput(generation) {
  const output = generation.output;
  return `
    <div class="generated-stack">
      <div class="result-list">
        ${output.items.map((item, index) => resultItem(generation, output, item, index)).join("")}
      </div>
    </div>
  `;
}

function resultItem(generation, output, item, index) {
  const normalizedItem = normalizeGeneratedItem(item);
  const answerKey = getAnswerKey(generation.id, index);
  const questionKey = getQuestionKey(generation.id, index);
  const hasAnswer = Boolean(normalizedItem.answer);
  const answerVisible = hasAnswer && visibleAnswerKeys.has(answerKey);
  const canTrackItem = output.type !== "refusal";
  const showStudyTools = canTrackItem && isAssessmentTask(output.type);
  const courseStudyCollections = getCourseStudyCollections(generation.courseId);

  return `
    <article class="result-item ${output.type === "refusal" ? "blocked" : ""} ${questionKey === activeQuestionKey ? "focused" : ""}" data-scroll-target="question:${escapeAttr(questionKey)}">
      <div class="result-title">
        <strong>${escapeHtml(displayBilingual(normalizedItem.title))}</strong>
      </div>
      <div class="rich-text result-body">${renderRichText(normalizedItem.body)}</div>
      ${canTrackItem ? `
        <div class="result-tools">
          <button class="bookmark-toggle ${normalizedItem.isFavorite ? "active" : ""}" type="button" data-toggle-favorite="1" data-generation-id="${escapeAttr(generation.id)}" data-item-index="${index}">
            ${icon("star")}
            <span>${normalizedItem.isFavorite ? t("已收藏", "Saved") : t("收藏", "Save")}</span>
          </button>
          ${showStudyTools ? `
            <div class="study-status-group" role="group" aria-label="${escapeAttr(t("掌握度", "Mastery"))}">
              ${STUDY_STATUS_OPTIONS.map((option) => `
                <button class="study-status-button ${normalizedItem.studyStatus === option.id ? "active" : ""}" type="button" data-mark-study="${escapeAttr(option.id)}" data-generation-id="${escapeAttr(generation.id)}" data-item-index="${index}">
                  ${escapeHtml(biText(option.zh, option.en))}
                </button>
              `).join("")}
            </div>
          ` : ""}
          ${showStudyTools && courseStudyCollections.length ? renderStudyCollectionSelect(courseStudyCollections, generation.id, index) : ""}
        </div>
      ` : ""}
      ${hasAnswer ? `
        <label class="answer-toggle">
          <input type="checkbox" data-answer-toggle="${escapeAttr(answerKey)}" ${answerVisible ? "checked" : ""} />
          <span>${t("显示答案", "Show answer")}</span>
        </label>
      ` : ""}
      ${answerVisible ? `<div class="answer-box rich-text">${renderRichText(normalizedItem.answer)}</div>` : ""}
    </article>
  `;
}

function getAnswerKey(generationId, index) {
  return `${generationId}:${index}`;
}

function getQuestionKey(generationId, index) {
  return `${generationId}:question:${index}`;
}

function historyItem(generation, activeId) {
  return `
    <article class="history-entry ${generation.id === activeId ? "active" : ""}" data-scroll-target="generation:${escapeAttr(generation.id)}">
      <button class="history-item" type="button" data-generation-id="${escapeAttr(generation.id)}">
        <span>${escapeHtml(displayBilingual(generation.title))}</span>
        <small>${formatDate(generation.createdAt)}</small>
      </button>
      <button class="icon-button quiet neutral" type="button" data-rename-generation="${escapeAttr(generation.id)}" aria-label="${t("重命名生成记录", "Rename generated output")}">
        ${icon("pencil")}
      </button>
      <button class="icon-button quiet" type="button" data-delete-generation="${escapeAttr(generation.id)}" aria-label="${t("删除生成记录", "Delete generated output")}">
        ${icon("trash-2")}
      </button>
    </article>
  `;
}

function feedbackCenterPanel(showHeading = true) {
  return `
    ${showHeading ? `<div class="panel-heading output-heading feedback-heading">
      <div>
        <h2>${t("意见反馈", "Feedback")}</h2>
      </div>
    </div>` : ""}
    ${feedbackError ? `<p class="feedback-banner error">${escapeHtml(feedbackError)}</p>` : ""}
    ${feedbackNotice ? `<p class="feedback-banner success">${escapeHtml(feedbackNotice)}</p>` : ""}
    <div class="feedback-hub">
      <form class="feedback-compose" id="feedbackForm">
        <div class="feedback-compose-head">
          <div>
            <strong>${t("发布反馈", "Post feedback")}</strong>
          </div>
        </div>
        <div class="feedback-author-controls">
          <label class="feedback-nickname-field">
            <span>${t("昵称", "Nickname")}</span>
            <input id="feedbackNickname" maxlength="40" value="${escapeAttr(feedbackDraftNickname)}" />
          </label>
        </div>
        <input id="feedbackTitle" maxlength="90" placeholder="${t("标题", "Title")}" value="${escapeAttr(feedbackDraftTitle)}" />
        <textarea id="feedbackBody" maxlength="1800" placeholder="${t("写下你的建议、体验问题，或你希望我们下一步做什么。", "Write your suggestion, pain point, or what you want us to build next.")}">${escapeHtml(feedbackDraftBody)}</textarea>
        <div class="feedback-compose-actions">
          <button class="primary-action" type="submit" ${feedbackSubmitting ? "disabled" : ""}>
            ${icon(feedbackSubmitting ? "loader-2" : "send", feedbackSubmitting ? "spin" : "")}
            <span>${feedbackSubmitting ? t("发布中", "Posting") : t("发布反馈", "Post feedback")}</span>
          </button>
        </div>
      </form>

      <div class="feedback-list-panel">
        <div class="feedback-list-head">
          <strong>${t("反馈帖", "Feedback threads")}</strong>
          <span>${escapeHtml(t(`${feedbackItems.length} 条`, `${feedbackItems.length} thread(s)`))}</span>
        </div>
        <div class="feedback-list">
          ${feedbackLoading && !feedbackItems.length
            ? `<p class="feedback-inline-status">${escapeHtml(t("正在加载反馈…", "Loading feedback…"))}</p>`
            : (feedbackItems.length
              ? feedbackItems.map(feedbackListItem).join("")
              : emptyState("", t("还没有反馈帖", "No feedback yet"), "", true))}
        </div>
      </div>
    </div>
  `;
}

function feedbackListItem(item) {
  return `
    <button class="feedback-item ${item.id === activeFeedbackId ? "active" : ""}" type="button" data-feedback-id="${escapeAttr(item.id)}">
      <div class="feedback-item-top">
        <strong>${escapeHtml(item.title)}</strong>
        <time>${escapeHtml(formatDate(item.updatedAt || item.createdAt))}</time>
      </div>
      <p>${escapeHtml(feedbackPreviewText(item.body))}</p>
      <div class="feedback-item-meta">
        <span>${escapeHtml(feedbackAuthorLabel(item.authorLabel))}</span>
        <span>${escapeHtml(t(`${item.likeCount || 0} 赞`, `${item.likeCount || 0} likes`))}</span>
        <span>${escapeHtml(t(`${item.replyCount || 0} 条回复`, `${item.replyCount || 0} replies`))}</span>
      </div>
    </button>
  `;
}

function feedbackThreadModal() {
  if (!isFeedbackThreadModalOpen) return "";

  return `
    <div class="modal-backdrop feedback-thread-backdrop" id="feedbackThreadDialogBackdrop" role="presentation">
      <section class="modal-card feedback-thread-dialog" role="dialog" aria-modal="true" aria-labelledby="feedbackThreadDialogTitle">
        <div class="modal-heading">
          <div>
            <h2 id="feedbackThreadDialogTitle">${t("反馈详情", "Feedback Detail")}</h2>
          </div>
          <button class="icon-button quiet" id="closeFeedbackThreadDialogBtn" type="button" aria-label="${t("关闭", "Close")}">
            ${icon("x")}
          </button>
        </div>
        <div class="feedback-thread-dialog-body">
          ${feedbackThreadLoading
            ? `<p class="feedback-inline-status">${escapeHtml(t("正在打开帖子…", "Opening thread…"))}</p>`
            : (activeFeedbackThread
              ? feedbackThreadView(activeFeedbackThread)
              : emptyState("", t("帖子不存在", "Thread not found"), "", true))}
        </div>
      </section>
    </div>
  `;
}

function feedbackThreadView(thread) {
  const replies = Array.isArray(thread.replies) ? thread.replies : [];
  const liked = feedbackLikedIds.has(thread.id);
  return `
    <div class="feedback-thread-card">
      <div class="feedback-thread-header">
        <div>
          <h3>${escapeHtml(thread.title)}</h3>
        </div>
        <time>${escapeHtml(formatDate(thread.createdAt))}</time>
      </div>

      <article class="feedback-message original">
        <div class="feedback-message-head">
          <strong>${escapeHtml(feedbackAuthorLabel(thread.authorLabel))}</strong>
          <span>${escapeHtml(formatDate(thread.createdAt))}</span>
        </div>
        <div class="feedback-message-body">${renderFeedbackText(thread.body)}</div>
        ${feedbackOwnerTokens[thread.id] ? `
          <div class="feedback-original-footer">
            <button class="feedback-delete-button" id="feedbackDeleteBtn" type="button" aria-label="${t("删除帖子", "Delete thread")}" title="${t("删除帖子", "Delete thread")}">
              ${icon("trash-2")}
            </button>
          </div>
        ` : ""}
      </article>

      <div class="feedback-thread-actions">
        <button class="secondary-action feedback-like-button ${liked ? "active" : ""}" id="feedbackLikeBtn" type="button" ${liked ? "disabled" : ""}>
          ${icon("thumbs-up")}<span>${Number(thread.likeCount || 0)}</span>
        </button>
        <button class="secondary-action" id="openFeedbackReplyDialogBtn" type="button">
          ${icon("message-square")}<span>${t("回复", "Reply")}</span>
        </button>
      </div>

      <div class="feedback-thread-replies">
        <div class="feedback-thread-subhead">
          <strong>${t("回复", "Replies")}</strong>
          <span>${escapeHtml(t(`${replies.length} 条`, `${replies.length} reply${replies.length === 1 ? "" : "ies"}`))}</span>
        </div>
        ${replies.length
          ? replies.map(feedbackReplyItem).join("")
          : `<p class="feedback-inline-status">${escapeHtml(t("还没有回复。", "No replies yet."))}</p>`}
      </div>

    </div>
  `;
}

function feedbackReplyDialog() {
  if (!isFeedbackReplyDialogOpen || !activeFeedbackThread) return "";

  return `
    <div class="modal-backdrop feedback-reply-backdrop" id="feedbackReplyDialogBackdrop" role="presentation">
      <section class="modal-card feedback-reply-dialog" role="dialog" aria-modal="true" aria-labelledby="feedbackReplyDialogTitle">
        <div class="modal-heading">
          <div><h2 id="feedbackReplyDialogTitle">${t("回复帖子", "Reply to thread")}</h2></div>
          <button class="icon-button quiet" id="closeFeedbackReplyDialogBtn" type="button" aria-label="${t("关闭", "Close")}">${icon("x")}</button>
        </div>
        <form class="feedback-reply-form" id="feedbackReplyForm">
          <label>
            <span>${t("昵称", "Nickname")}</span>
            <input id="feedbackReplyNickname" maxlength="40" value="${escapeAttr(feedbackReplyNickname)}" />
          </label>
          <label>
            <span>${t("回复", "Reply")}</span>
            <textarea id="feedbackReplyBody" maxlength="1800" placeholder="${t("写下你的回复。", "Write your reply.")}">${escapeHtml(feedbackReplyDraft)}</textarea>
          </label>
          <div class="modal-actions">
            <button class="secondary-action" id="cancelFeedbackReplyDialogBtn" type="button">${t("取消", "Cancel")}</button>
            <button class="primary-action" type="submit" ${feedbackReplySubmitting ? "disabled" : ""}>
              ${icon(feedbackReplySubmitting ? "loader-2" : "corner-down-left", feedbackReplySubmitting ? "spin" : "")}
              <span>${feedbackReplySubmitting ? t("回复中", "Replying") : t("发布回复", "Post reply")}</span>
            </button>
          </div>
        </form>
      </section>
    </div>
  `;
}

function feedbackReplyItem(reply) {
  return `
    <article class="feedback-message reply">
      <div class="feedback-message-head">
        <div class="feedback-reply-author">
          <strong>${escapeHtml(feedbackAuthorLabel(reply.authorLabel))}</strong>
          ${reply.isDeveloper ? `<span class="developer-reply-badge">${t("开发者", "Developer")}</span>` : ""}
        </div>
        <span>${escapeHtml(formatDate(reply.createdAt))}</span>
      </div>
      <div class="feedback-message-body">${renderFeedbackText(reply.body)}</div>
    </article>
  `;
}

function feedbackAuthorLabel(label) {
  const value = String(label || "").trim();
  if (value.toLowerCase() === "developer") return t("开发者", "Developer");
  if (!value || value.toLowerCase() === "anonymous") return t("匿名用户", "Anonymous");
  return value;
}

function feedbackPreviewText(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, 90) || t("没有内容", "No content");
}

function renderFeedbackText(value = "") {
  return escapeHtml(String(value || "").trim()).replace(/\n{2,}/g, "<br><br>").replace(/\n/g, "<br>");
}

function renderAnnouncementItem(item) {
  return `
    <article class="announcement-item">
      <div class="announcement-item-head">
        <strong>${escapeHtml(displayBilingual(item.title))}</strong>
        <time>${escapeHtml(item.date)}</time>
      </div>
      <p>${escapeHtml(displayBilingual(item.body))}</p>
    </article>
  `;
}

function renderSearchResults(query, results) {
  if (!query.trim()) {
    return `<p class="feedback-inline-status">${escapeHtml(t("输入关键词来检索资料和历史生成记录。", "Enter keywords to search materials and generation history."))}</p>`;
  }

  if (!results.length) {
    return `<p class="feedback-inline-status">${escapeHtml(t("没有匹配结果。", "No matching results."))}</p>`;
  }

  return results.map(renderSearchResultItem).join("");
}

function renderSearchResultItem(item) {
  if (item.kind === "document") {
    return `
      <button class="search-result-item" type="button" data-open-document="${escapeAttr(item.documentId)}">
        <strong>${escapeHtml(item.title)}</strong>
        <span>${escapeHtml(item.meta)}</span>
        <small>${escapeHtml(item.preview)}</small>
      </button>
    `;
  }

  if (item.kind === "generation") {
    return `
      <button class="search-result-item" type="button" data-open-generation="${escapeAttr(item.generationId)}">
        <strong>${escapeHtml(item.title)}</strong>
        <span>${escapeHtml(item.meta)}</span>
        <small>${escapeHtml(item.preview)}</small>
      </button>
    `;
  }

  return "";
}

function renderStudyLinkItem(item) {
  return `
    <button class="study-link-item" type="button" data-open-question="1" data-generation-id="${escapeAttr(item.generationId)}" data-question-key="${escapeAttr(item.questionKey)}">
      <strong>${escapeHtml(item.title)}</strong>
      <span>${escapeHtml(buildStudyItemMeta(item))}</span>
      <small>${escapeHtml(item.preview)}</small>
    </button>
  `;
}

function renderStudyCollectionItem(collection, questionReferences, activeId) {
  const items = resolveStudyCollectionItems(collection, questionReferences);
  return `
    <article class="study-collection-item ${collection.id === activeId ? "active" : ""}">
      <button type="button" data-open-study-collection="${escapeAttr(collection.id)}">
        <strong>${escapeHtml(collection.name)}</strong>
        <span>${items.length} ${escapeHtml(t("题", "item(s)"))}</span>
      </button>
      <button class="icon-button quiet" type="button" data-delete-study-collection="${escapeAttr(collection.id)}" aria-label="${t("删除集合", "Delete collection")}">
        ${icon("trash-2")}
      </button>
    </article>
  `;
}

function renderStudyCollectionSelect(collections, generationId, itemIndex) {
  const favoriteCollections = collections.filter((collection) => collection.type === "favorite");
  const wrongCollections = collections.filter((collection) => collection.type === "wrong");
  return `
    <select class="collection-select" data-add-study-collection="1" data-generation-id="${escapeAttr(generationId)}" data-item-index="${itemIndex}" aria-label="${t("加入集合", "Add to collection")}">
      <option value="">${t("加入集合", "Add to")}</option>
      ${favoriteCollections.length ? `<optgroup label="${escapeAttr(t("收藏夹", "Favorites"))}">
        ${favoriteCollections.map((collection) => `<option value="${escapeAttr(collection.id)}">${escapeHtml(collection.name)}</option>`).join("")}
      </optgroup>` : ""}
      ${wrongCollections.length ? `<optgroup label="${escapeAttr(t("错题集", "Wrong questions"))}">
        ${wrongCollections.map((collection) => `<option value="${escapeAttr(collection.id)}">${escapeHtml(collection.name)}</option>`).join("")}
      </optgroup>` : ""}
    </select>
  `;
}

function buildStudyItemMeta(item) {
  const parts = [item.generationTitle || ""];
  if (item.studyStatus) parts.push(studyStatusLabel(item.studyStatus));
  if (item.isFavorite) parts.push(t("已收藏", "Saved"));
  return parts.filter(Boolean).join(" · ");
}

function studyStatusLabel(status) {
  const match = STUDY_STATUS_OPTIONS.find((option) => option.id === status);
  return match ? biText(match.zh, match.en) : "";
}

function plainTextPreview(value = "", limit = 110) {
  const normalized = String(value || "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*]\([^)]+\)/g, " ")
    .replace(/\\\(|\\\)|\\\[|\\\]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return normalized.slice(0, limit) || t("没有内容", "No content");
}

function escapeSelectorValue(value = "") {
  return String(value).replace(/\\/g, "\\\\").replace(/"/g, "\\\"");
}

function blockedBadge(safety) {
  if (safety?.level !== "blocked") return "";

  return `
    <span class="status-badge blocked">
      ${icon("triangle-alert")}
      ${escapeHtml(displayBilingual(safety.label || t("不通过", "Not Passed")))}
    </span>
  `;
}

function emptyState(iconName, title, text, compact = false) {
  return `
    <div class="empty-state ${compact ? "compact" : ""}">
      ${iconName ? icon(iconName) : ""}
      <strong>${escapeHtml(title)}</strong>
      ${text ? `<span>${escapeHtml(text)}</span>` : ""}
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
    html += renderCodeBlock(code, codeLanguage);
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

function renderCodeBlock(code, language = "") {
  if (isCircuitDiagramLanguage(language)) {
    const diagram = renderCircuitDiagram(code);
    if (diagram) return diagram;
  }

  return `<pre class="code-block"${language ? ` data-language="${escapeAttr(language)}"` : ""}><code>${escapeHtml(code)}</code></pre>`;
}

function isCircuitDiagramLanguage(language) {
  return ["circuit", "circuit-svg"].includes(String(language || "").trim().toLowerCase());
}

function renderCircuitDiagram(source) {
  const diagram = parseCircuitDiagram(source);
  if (!diagram) return "";
  diagram.labelBoxes = [];
  diagram.componentEdges = circuitComponentEdges(diagram);
  diagram.primaryComponents = circuitPrimaryComponents(diagram);

  const parts = [
    `<svg viewBox="0 0 ${diagram.width} ${diagram.height}" role="img" aria-label="${escapeAttr(t("电路图", "Circuit diagram"))}">`,
    `<defs><marker id="circuit-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M 0 0 L 8 4 L 0 8 z" /></marker></defs>`
  ];

  for (const item of diagram.items) {
    if (item.type === "wire") {
      if (!isCircuitComponentEdge(diagram, item)) parts.push(renderCircuitWire(diagram, item));
      continue;
    }

    if (isSecondaryCircuitComponent(diagram, item)) {
      parts.push(renderCircuitSecondaryComponentLabel(diagram, item));
      continue;
    }

    if (item.type === "resistor") parts.push(renderCircuitResistor(diagram, item));
    if (item.type === "capacitor") parts.push(renderCircuitCapacitor(diagram, item));
    if (item.type === "lamp") parts.push(renderCircuitLamp(diagram, item));
    if (item.type === "switch") parts.push(renderCircuitSwitch(diagram, item));
    if (item.type === "ammeter") parts.push(renderCircuitAmmeter(diagram, item));
    if (item.type === "battery") parts.push(renderCircuitBattery(diagram, item));
    if (item.type === "voltage") parts.push(renderCircuitSource(diagram, item, "voltage"));
    if (item.type === "current") parts.push(renderCircuitSource(diagram, item, "current"));
    if (item.type === "arrow") parts.push(renderCircuitArrow(diagram, item));
    if (item.type === "ground") parts.push(renderCircuitGround(diagram, item));
    if (item.type === "label") parts.push(renderCircuitPlacedText(diagram, item.x, item.y, item.text, "circuit-title"));
  }

  const degrees = circuitNodeDegrees(diagram);
  for (const node of diagram.nodes.values()) {
    if ((degrees.get(node.id) || 0) >= 3 || diagram.dots.has(node.id)) {
      parts.push(`<circle class="circuit-node" cx="${node.x}" cy="${node.y}" r="4" />`);
    }
  }

  parts.push("</svg>");
  return `<figure class="circuit-render">${parts.join("")}</figure>`;
}

function parseCircuitDiagram(source) {
  const diagram = { width: 680, height: 360, nodes: new Map(), items: [], dots: new Set() };
  const lines = String(source || "").split("\n");

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const tokens = line.split(/\s+/);
    const command = tokens[0]?.toLowerCase();

    if (command === "size" && tokens.length >= 3) {
      diagram.width = clamp(Number(tokens[1]), 360, 1200);
      diagram.height = clamp(Number(tokens[2]), 220, 900);
    } else if (command === "node" && tokens.length >= 4) {
      const [id, x, y] = [tokens[1], Number(tokens[2]), Number(tokens[3])];
      if (id && Number.isFinite(x) && Number.isFinite(y)) diagram.nodes.set(id, { id, x, y });
    } else if (command === "wire" && tokens.length >= 3) {
      diagram.items.push({ type: "wire", from: tokens[1], to: tokens[2] });
    } else if (["resistor", "capacitor", "voltage", "current"].includes(command) && tokens.length >= 5) {
      diagram.items.push({ type: command, id: tokens[1], value: tokens[2], from: tokens[3], to: tokens[4] });
    } else if (command === "cap" && tokens.length >= 5) {
      diagram.items.push({ type: "capacitor", id: tokens[1], value: tokens[2], from: tokens[3], to: tokens[4] });
    } else if (["lamp", "ammeter", "meter"].includes(command) && tokens.length >= 4) {
      diagram.items.push({ type: command === "meter" ? "ammeter" : command, id: tokens[1], from: tokens[2], to: tokens[3] });
    } else if (command === "battery" && tokens.length >= 4) {
      const hasValue = tokens.length >= 5;
      diagram.items.push({
        type: "battery",
        id: tokens[1],
        value: hasValue ? tokens[2] : "",
        from: hasValue ? tokens[3] : tokens[2],
        to: hasValue ? tokens[4] : tokens[3]
      });
    } else if (command === "switch" && tokens.length >= 4) {
      diagram.items.push({ type: "switch", id: tokens[1], from: tokens[2], to: tokens[3], state: tokens[4] || "open" });
    } else if (command === "arrow" && tokens.length >= 4) {
      diagram.items.push({ type: "arrow", id: tokens[1], from: tokens[2], to: tokens[3] });
    } else if (command === "ground" && tokens.length >= 2) {
      diagram.items.push({ type: "ground", at: tokens[1] });
    } else if (command === "dot" && tokens.length >= 2) {
      diagram.dots.add(tokens[1]);
    } else if (command === "label" && tokens.length >= 4) {
      diagram.items.push(parseCircuitLabel(tokens));
    }
  }

  const drawableCount = diagram.items.filter((item) => item.type !== "label").length;
  return diagram.nodes.size >= 2 && drawableCount ? diagram : null;
}

function parseCircuitLabel(tokens) {
  if (Number.isFinite(Number(tokens[1])) && Number.isFinite(Number(tokens[2]))) {
    return { type: "label", x: Number(tokens[1]), y: Number(tokens[2]), text: tokens.slice(3).join(" ") };
  }

  const x = Number(tokens[tokens.length - 2]);
  const y = Number(tokens[tokens.length - 1]);
  return {
    type: "label",
    x: Number.isFinite(x) ? x : 24,
    y: Number.isFinite(y) ? y : 24,
    text: tokens.slice(1, -2).join(" ")
  };
}

function renderCircuitWire(diagram, item) {
  const points = circuitPoints(diagram, item);
  if (!points) return "";
  return circuitLine(points.from, points.to, "circuit-wire");
}

function circuitComponentEdges(diagram) {
  return new Set(
    diagram.items
      .filter(isCircuitPhysicalComponent)
      .map((item) => circuitEdgeKey(item.from, item.to))
  );
}

function circuitPrimaryComponents(diagram) {
  const grouped = new Map();
  diagram.items.forEach((item, index) => {
    if (!isCircuitPhysicalComponent(item)) return;
    const key = circuitEdgeKey(item.from, item.to);
    const entries = grouped.get(key) || [];
    entries.push({ item, index });
    grouped.set(key, entries);
  });

  const primary = new Map();
  grouped.forEach((entries, key) => {
    const [winner] = entries.sort((a, b) => (
      circuitComponentPriority(a.item) - circuitComponentPriority(b.item) || a.index - b.index
    ));
    primary.set(key, winner.item);
  });
  return primary;
}

function isCircuitPhysicalComponent(item) {
  return CIRCUIT_COMPONENT_TYPES.has(item.type) && item.from && item.to;
}

function circuitComponentPriority(item) {
  return CIRCUIT_COMPONENT_PRIORITIES.get(item.type) || 9;
}

function isCircuitComponentEdge(diagram, item) {
  return diagram.componentEdges?.has(circuitEdgeKey(item.from, item.to));
}

function isSecondaryCircuitComponent(diagram, item) {
  if (!isCircuitPhysicalComponent(item)) return false;
  const primary = diagram.primaryComponents?.get(circuitEdgeKey(item.from, item.to));
  return Boolean(primary && primary !== item);
}

function renderCircuitSecondaryComponentLabel(diagram, item) {
  const geometry = circuitGeometry(diagram, item, 0);
  const label = circuitComponentLabel(item) || formatCircuitId(item.id);
  return geometry && label ? renderCircuitComponentLabel(diagram, geometry, label, { distance: 24, preferredSide: 1 }) : "";
}

function circuitEdgeKey(from, to) {
  return [String(from || ""), String(to || "")].sort().join("::");
}

function renderCircuitResistor(diagram, item) {
  const geometry = circuitFixedBodyGeometry(diagram, item, 68);
  if (!geometry) return "";

  const { from, to, start, end, unit, normal, bodyLength, mid } = geometry;
  const segments = 8;
  const amplitude = 8;
  const points = [pointString(start)];
  for (let index = 1; index < segments; index += 1) {
    const along = bodyLength * index / segments;
    const offset = index % 2 ? amplitude : -amplitude;
    points.push(pointString({
      x: start.x + unit.x * along + normal.x * offset,
      y: start.y + unit.y * along + normal.y * offset
    }));
  }
  points.push(pointString(end));
  const mostlyVertical = Math.abs(unit.y) > Math.abs(unit.x);
  const label = circuitComponentLabel(item);
  const labelX = mostlyVertical
    ? mid.x + (mid.x > diagram.width - 90 ? -34 : 34)
    : mid.x;
  const labelY = mostlyVertical ? mid.y : mid.y + 30;

  return [
    circuitLine(from, start, "circuit-wire"),
    `<polyline class="circuit-component" points="${points.join(" ")}" />`,
    circuitLine(end, to, "circuit-wire"),
    renderCircuitPlacedText(diagram, labelX, labelY, label)
  ].join("");
}

function renderCircuitCapacitor(diagram, item) {
  const geometry = circuitGeometry(diagram, item, 24);
  if (!geometry) return "";

  const { from, to, unit, normal, mid } = geometry;
  const plateOffset = 6;
  const plateHalf = 16;
  const plateA = { x: mid.x - unit.x * plateOffset, y: mid.y - unit.y * plateOffset };
  const plateB = { x: mid.x + unit.x * plateOffset, y: mid.y + unit.y * plateOffset };
  const leadA = { x: plateA.x - unit.x * 2, y: plateA.y - unit.y * 2 };
  const leadB = { x: plateB.x + unit.x * 2, y: plateB.y + unit.y * 2 };

  return [
    circuitLine(from, leadA, "circuit-wire"),
    circuitLine(leadB, to, "circuit-wire"),
    circuitLine(
      { x: plateA.x - normal.x * plateHalf, y: plateA.y - normal.y * plateHalf },
      { x: plateA.x + normal.x * plateHalf, y: plateA.y + normal.y * plateHalf },
      "circuit-component"
    ),
    circuitLine(
      { x: plateB.x - normal.x * plateHalf, y: plateB.y - normal.y * plateHalf },
      { x: plateB.x + normal.x * plateHalf, y: plateB.y + normal.y * plateHalf },
      "circuit-component"
    ),
    renderCircuitComponentLabel(diagram, geometry, circuitComponentLabel(item), { distance: 28 })
  ].join("");
}

function renderCircuitLamp(diagram, item) {
  const geometry = circuitGeometry(diagram, item, 28);
  if (!geometry) return "";

  const { from, to, unit, normal, mid } = geometry;
  const radius = 15;
  const leadA = { x: mid.x - unit.x * radius, y: mid.y - unit.y * radius };
  const leadB = { x: mid.x + unit.x * radius, y: mid.y + unit.y * radius };
  const label = formatCircuitId(item.id || "L");
  return [
    circuitLine(from, leadA, "circuit-wire"),
    circuitLine(leadB, to, "circuit-wire"),
    `<circle class="circuit-symbol" cx="${mid.x}" cy="${mid.y}" r="${radius}" />`,
    circuitLine({ x: mid.x - 10, y: mid.y - 10 }, { x: mid.x + 10, y: mid.y + 10 }, "circuit-component"),
    circuitLine({ x: mid.x + 10, y: mid.y - 10 }, { x: mid.x - 10, y: mid.y + 10 }, "circuit-component"),
    renderCircuitComponentLabel(diagram, geometry, label, { distance: 30 })
  ].join("");
}

function renderCircuitSwitch(diagram, item) {
  const geometry = circuitGeometry(diagram, item, 18);
  if (!geometry) return "";

  const { from, to, unit, normal, mid } = geometry;
  const totalLength = Math.hypot(to.x - from.x, to.y - from.y);
  const contactGap = Math.min(58, Math.max(34, totalLength - 24));
  const contactA = { x: mid.x - unit.x * contactGap / 2, y: mid.y - unit.y * contactGap / 2 };
  const contactB = { x: mid.x + unit.x * contactGap / 2, y: mid.y + unit.y * contactGap / 2 };
  const closed = String(item.state || "open").toLowerCase() === "closed";
  const bladeEnd = closed
    ? contactB
    : {
      x: contactA.x + unit.x * contactGap * 0.82 - normal.x * 22,
      y: contactA.y + unit.y * contactGap * 0.82 - normal.y * 22
    };

  return [
    circuitLine(from, contactA, "circuit-wire"),
    circuitLine(contactB, to, "circuit-wire"),
    `<circle class="circuit-contact" cx="${contactA.x}" cy="${contactA.y}" r="3.4" />`,
    `<circle class="circuit-contact" cx="${contactB.x}" cy="${contactB.y}" r="3.4" />`,
    circuitLine(contactA, bladeEnd, "circuit-component"),
    renderCircuitComponentLabel(diagram, geometry, formatCircuitId(item.id || "S"), { distance: 22, preferredSide: 1 })
  ].join("");
}

function renderCircuitAmmeter(diagram, item) {
  const geometry = circuitGeometry(diagram, item, 24);
  if (!geometry) return "";

  const { from, to, unit, mid } = geometry;
  const radius = 15;
  const leadA = { x: mid.x - unit.x * radius, y: mid.y - unit.y * radius };
  const leadB = { x: mid.x + unit.x * radius, y: mid.y + unit.y * radius };
  return [
    circuitLine(from, leadA, "circuit-wire"),
    circuitLine(leadB, to, "circuit-wire"),
    `<circle class="circuit-symbol" cx="${mid.x}" cy="${mid.y}" r="${radius}" />`,
    renderCircuitText(mid.x, mid.y + 6, formatCircuitId(item.id || "A"), "circuit-meter-label")
  ].join("");
}

function renderCircuitBattery(diagram, item) {
  const geometry = circuitGeometry(diagram, item, 18);
  if (!geometry) return "";

  const { from, to, unit, normal, mid } = geometry;
  const longCenter = { x: mid.x - unit.x * 6, y: mid.y - unit.y * 6 };
  const shortCenter = { x: mid.x + unit.x * 10, y: mid.y + unit.y * 10 };
  const longHalf = 18;
  const shortHalf = 11;
  const label = circuitComponentLabel(item);
  return [
    circuitLine(from, { x: longCenter.x - unit.x * 2, y: longCenter.y - unit.y * 2 }, "circuit-wire"),
    circuitLine({ x: shortCenter.x + unit.x * 2, y: shortCenter.y + unit.y * 2 }, to, "circuit-wire"),
    circuitLine(
      { x: longCenter.x - normal.x * longHalf, y: longCenter.y - normal.y * longHalf },
      { x: longCenter.x + normal.x * longHalf, y: longCenter.y + normal.y * longHalf },
      "circuit-component"
    ),
    circuitLine(
      { x: shortCenter.x - normal.x * shortHalf, y: shortCenter.y - normal.y * shortHalf },
      { x: shortCenter.x + normal.x * shortHalf, y: shortCenter.y + normal.y * shortHalf },
      "circuit-component"
    ),
    label ? renderCircuitComponentLabel(diagram, geometry, label, { distance: 28, preferredSide: 1 }) : ""
  ].join("");
}

function renderCircuitSource(diagram, item, kind) {
  const geometry = circuitGeometry(diagram, item, 26);
  if (!geometry) return "";

  const { from, to, unit, normal, mid } = geometry;
  const radius = 19;
  const leadA = { x: mid.x - unit.x * radius, y: mid.y - unit.y * radius };
  const leadB = { x: mid.x + unit.x * radius, y: mid.y + unit.y * radius };
  const label = circuitComponentLabel(item);

  const body = [
    circuitLine(from, leadA, "circuit-wire"),
    circuitLine(leadB, to, "circuit-wire"),
    `<circle class="circuit-source" cx="${mid.x}" cy="${mid.y}" r="${radius}" />`,
    renderCircuitComponentLabel(diagram, geometry, label, { distance: 28 })
  ];

  if (kind === "voltage") {
    body.push(renderCircuitText(mid.x + unit.x * 10, mid.y + unit.y * 10 - 8, "+", "circuit-polarity"));
    body.push(renderCircuitText(mid.x - unit.x * 10, mid.y - unit.y * 10 + 14, "-", "circuit-polarity"));
  } else {
    body.push(circuitLine(
      { x: mid.x - unit.x * 12, y: mid.y - unit.y * 12 },
      { x: mid.x + unit.x * 12, y: mid.y + unit.y * 12 },
      "circuit-arrow-line"
    ));
  }

  return body.join("");
}

function renderCircuitArrow(diagram, item) {
  const geometry = circuitGeometry(diagram, item, 0);
  if (!geometry) return "";
  const { from, to, normal, mid } = geometry;
  const offset = -22;
  const start = { x: from.x + normal.x * offset, y: from.y + normal.y * offset };
  const end = { x: to.x + normal.x * offset, y: to.y + normal.y * offset };
  return [
    circuitLine(start, end, "circuit-arrow-line"),
    renderCircuitComponentLabel(diagram, geometry, formatCircuitId(item.id), { distance: Math.abs(offset) + 18 })
  ].join("");
}

function renderCircuitGround(diagram, item) {
  const point = diagram.nodes.get(item.at);
  if (!point) return "";
  return [
    circuitLine(point, { x: point.x, y: point.y + 14 }, "circuit-wire"),
    circuitLine({ x: point.x - 18, y: point.y + 14 }, { x: point.x + 18, y: point.y + 14 }, "circuit-ground-line"),
    circuitLine({ x: point.x - 12, y: point.y + 21 }, { x: point.x + 12, y: point.y + 21 }, "circuit-ground-line"),
    circuitLine({ x: point.x - 6, y: point.y + 28 }, { x: point.x + 6, y: point.y + 28 }, "circuit-ground-line")
  ].join("");
}

function circuitGeometry(diagram, item, leadLength = 34) {
  const points = circuitPoints(diagram, item);
  if (!points) return null;
  const dx = points.to.x - points.from.x;
  const dy = points.to.y - points.from.y;
  const length = Math.hypot(dx, dy);
  if (length < 20) return null;
  const unit = { x: dx / length, y: dy / length };
  const normal = { x: -unit.y, y: unit.x };
  const lead = Math.min(leadLength, length * 0.28);
  const start = { x: points.from.x + unit.x * lead, y: points.from.y + unit.y * lead };
  const end = { x: points.to.x - unit.x * lead, y: points.to.y - unit.y * lead };
  return {
    ...points,
    unit,
    normal,
    start,
    end,
    bodyLength: Math.hypot(end.x - start.x, end.y - start.y),
    mid: { x: (points.from.x + points.to.x) / 2, y: (points.from.y + points.to.y) / 2 }
  };
}

function circuitFixedBodyGeometry(diagram, item, fixedBodyLength) {
  const points = circuitPoints(diagram, item);
  if (!points) return null;
  const dx = points.to.x - points.from.x;
  const dy = points.to.y - points.from.y;
  const length = Math.hypot(dx, dy);
  if (length < 20) return null;
  const unit = { x: dx / length, y: dy / length };
  const normal = { x: -unit.y, y: unit.x };
  const mid = { x: (points.from.x + points.to.x) / 2, y: (points.from.y + points.to.y) / 2 };
  const bodyLength = Math.min(fixedBodyLength, Math.max(24, length - 18));
  const halfBody = bodyLength / 2;
  const start = { x: mid.x - unit.x * halfBody, y: mid.y - unit.y * halfBody };
  const end = { x: mid.x + unit.x * halfBody, y: mid.y + unit.y * halfBody };

  return {
    ...points,
    unit,
    normal,
    start,
    end,
    bodyLength,
    mid
  };
}

function circuitNodeDegrees(diagram) {
  const degrees = new Map();
  const add = (id) => degrees.set(id, (degrees.get(id) || 0) + 1);

  for (const item of diagram.items) {
    if (item.from && item.to) {
      add(item.from);
      add(item.to);
    }
    if (item.at) add(item.at);
  }

  return degrees;
}

function circuitPoints(diagram, item) {
  const from = diagram.nodes.get(item.from);
  const to = diagram.nodes.get(item.to);
  return from && to ? { from, to } : null;
}

function circuitLine(from, to, className) {
  return `<line class="${className}" x1="${from.x}" y1="${from.y}" x2="${to.x}" y2="${to.y}" />`;
}

function renderCircuitComponentLabel(diagram, geometry, text, options = {}) {
  const label = String(text || "").trim();
  if (!label) return "";

  const position = chooseCircuitLabelPosition(diagram, geometry, label, options);
  return renderCircuitPlacedText(diagram, position.x, position.y, label, options.className || "circuit-label");
}

function chooseCircuitLabelPosition(diagram, geometry, text, options = {}) {
  const candidates = circuitLabelCandidates(geometry, text, options);
  const ranked = candidates
    .map((candidate) => {
      const box = circuitTextBox(candidate.x, candidate.y, text);
      return { ...candidate, box, penalty: circuitLabelPenalty(diagram, box) };
    })
    .sort((a, b) => a.penalty - b.penalty || a.rank - b.rank);

  return ranked[0] || { x: geometry.mid.x, y: geometry.mid.y - 28 };
}

function circuitLabelCandidates(geometry, text, options = {}) {
  const { mid, unit, normal } = geometry;
  const mostlyVertical = Math.abs(unit.y) > Math.abs(unit.x);
  const textAwareDistance = mostlyVertical
    ? Math.min(92, estimateCircuitTextWidth(text) / 2 + 18)
    : 28;
  const baseDistance = Math.max(options.distance || 0, textAwareDistance);
  const preferredSide = options.preferredSide || -1;
  const sideOrder = [preferredSide, -preferredSide];
  const distances = [baseDistance, baseDistance + 12, baseDistance + 22, baseDistance + 34];
  const alongOffsets = [0, -18, 18, -34, 34, -52, 52];
  const candidates = [];

  distances.forEach((distance, distanceIndex) => {
    sideOrder.forEach((side, sideIndex) => {
      alongOffsets.forEach((along, alongIndex) => {
        candidates.push({
          x: mid.x + normal.x * distance * side + unit.x * along,
          y: mid.y + normal.y * distance * side + unit.y * along,
          rank: distanceIndex * 100 + sideIndex * 20 + alongIndex
        });
      });
    });
  });

  return candidates;
}

function renderCircuitPlacedText(diagram, x, y, text, className = "circuit-label") {
  const box = circuitTextBox(x, y, text);
  diagram.labelBoxes?.push(box);
  return renderCircuitText(x, y, text, className);
}

function renderCircuitText(x, y, text, className = "circuit-label") {
  return `<text class="${className}" x="${x}" y="${y}" text-anchor="middle">${renderCircuitTextContent(text, className)}</text>`;
}

function circuitTextBox(x, y, text) {
  const width = Math.max(24, Math.min(190, estimateCircuitTextWidth(text)));
  return {
    left: x - width / 2 - 5,
    right: x + width / 2 + 5,
    top: y - 16,
    bottom: y + 6
  };
}

function estimateCircuitTextWidth(text) {
  const plain = String(text || "")
    .replace(/[\u2080-\u2089]/g, "0")
    .replace(/_/g, "");
  let width = 0;

  for (const char of plain) {
    if (/[A-Za-z0-9]/.test(char)) width += 8.5;
    else if (char === " ") width += 5;
    else if ("=+-*/".includes(char)) width += 7;
    else width += 10;
  }

  return width + 8;
}

function circuitLabelPenalty(diagram, box) {
  let penalty = 0;
  const margin = 5;

  for (const existing of diagram.labelBoxes || []) {
    if (circuitBoxesOverlap(box, existing, margin)) {
      penalty += circuitOverlapArea(box, existing, margin) + 1000;
    }
  }

  if (box.left < 8) penalty += (8 - box.left) * 8;
  if (box.right > diagram.width - 8) penalty += (box.right - diagram.width + 8) * 8;
  if (box.top < 8) penalty += (8 - box.top) * 8;
  if (box.bottom > diagram.height - 8) penalty += (box.bottom - diagram.height + 8) * 8;

  return penalty;
}

function circuitBoxesOverlap(a, b, margin = 0) {
  return !(
    a.right + margin < b.left ||
    b.right + margin < a.left ||
    a.bottom + margin < b.top ||
    b.bottom + margin < a.top
  );
}

function circuitOverlapArea(a, b, margin = 0) {
  const xOverlap = Math.max(0, Math.min(a.right + margin, b.right + margin) - Math.max(a.left - margin, b.left - margin));
  const yOverlap = Math.max(0, Math.min(a.bottom + margin, b.bottom + margin) - Math.max(a.top - margin, b.top - margin));
  return xOverlap * yOverlap;
}

function circuitComponentLabel(item) {
  return [formatCircuitId(item.id), formatCircuitValue(item.value)].filter(Boolean).join(" = ");
}

function renderCircuitTextContent(text, className = "") {
  const value = String(text || "");
  if (className === "circuit-meter-label") return escapeHtml(value);

  const subscriptDigits = {
    "\u2080": "0",
    "\u2081": "1",
    "\u2082": "2",
    "\u2083": "3",
    "\u2084": "4",
    "\u2085": "5",
    "\u2086": "6",
    "\u2087": "7",
    "\u2088": "8",
    "\u2089": "9"
  };
  let html = "";

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    const previous = value[index - 1] || "";

    if (/[A-Za-z]/.test(char) && !/\d/.test(previous)) {
      let name = char;
      while (/[A-Za-z]/.test(value[index + 1] || "")) {
        index += 1;
        name += value[index];
      }

      let subscript = "";
      if (value[index + 1] === "_") {
        index += 1;
        while (/[A-Za-z0-9]/.test(value[index + 1] || "")) {
          index += 1;
          subscript += value[index];
        }
      } else {
        while (subscriptDigits[value[index + 1]]) {
          index += 1;
          subscript += subscriptDigits[value[index]];
        }
      }

      html += `<tspan class="circuit-symbol-name">${escapeHtml(name)}</tspan>`;
      if (subscript) html += `<tspan class="circuit-subscript">${escapeHtml(subscript)}</tspan>`;
      continue;
    }

    html += escapeHtml(char);
  }

  return html;
}

function formatCircuitId(value = "") {
  const subscripts = {
    0: "\u2080",
    1: "\u2081",
    2: "\u2082",
    3: "\u2083",
    4: "\u2084",
    5: "\u2085",
    6: "\u2086",
    7: "\u2087",
    8: "\u2088",
    9: "\u2089"
  };
  return String(value || "").replace(/([A-Za-z]+)_?(\d+)/g, (_match, name, digits) => (
    `${name}${digits.replace(/\d/g, (digit) => subscripts[digit] || digit)}`
  ));
}

function formatCircuitValue(value = "") {
  return String(value || "").replace(/ohm/gi, "\u03a9");
}

function pointString(point) {
  return `${point.x.toFixed(1)},${point.y.toFixed(1)}`;
}

function renderRichBlock(block) {
  const lines = block.split("\n").map((line) => line.trim()).filter(Boolean);
  if (!lines.length) return "";

  if (looksLikeBareCircuitDslText(block)) {
    const diagram = renderCircuitDiagram(block);
    if (diagram) return diagram;
  }

  if (lines.some(isMarkdownImageLine)) {
    return lines
      .map((line) => (isMarkdownImageLine(line) ? renderMarkdownImage(line) : `<p>${renderInlineText(line)}</p>`))
      .join("");
  }

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

function isMarkdownImageLine(value) {
  return Boolean(parseMarkdownImage(value));
}

function parseMarkdownImage(value) {
  return String(value || "").trim().match(/^!\[([^\]]*)\]\(([^)]+)\)$/);
}

function renderMarkdownImage(value) {
  const match = parseMarkdownImage(value);
  if (!match) return "";

  const alt = match[1] || t("图示", "Diagram");
  const source = match[2] || "";
  if (isEmbeddedImageSource(source)) {
    return `
      <figure class="inline-image">
        <img src="${escapeAttr(source)}" alt="${escapeAttr(alt)}" loading="lazy" />
        <figcaption>${escapeHtml(alt)}</figcaption>
      </figure>
    `;
  }

  return `
    <figure class="inline-diagram-note">
      <div>${icon("image-off")}</div>
      <figcaption>
        <strong>${escapeHtml(alt)}</strong>
        <span>${escapeHtml(diagramFallbackText(source))}</span>
      </figcaption>
    </figure>
  `;
}

function looksLikeBareCircuitDslText(text) {
  const lines = String(text || "").split("\n").map((line) => line.trim()).filter(Boolean);
  if (lines.length < 3) return false;

  const commandLines = lines.filter((line) => /^(size|node|wire|dot|resistor|capacitor|cap|lamp|switch|ammeter|meter|battery|voltage|current|arrow|ground|label)\b/i.test(line));
  return commandLines.length >= 3 && commandLines.length >= Math.ceil(lines.length * 0.6);
}

function isEmbeddedImageSource(source) {
  try {
    const url = new URL(source, window.location.origin);
    return url.protocol === "data:" || url.origin === window.location.origin;
  } catch {
    return false;
  }
}

function diagramFallbackText(source) {
  const label = extractImageTextLabel(source);
  return label
    ? t(`外部图片链接已隐藏：${label}。请重新生成以获得题干内嵌图示。`, `External image link hidden: ${label}. Regenerate to embed the diagram in the question.`)
    : t("外部图片链接已隐藏。请重新生成以获得题干内嵌图示。", "External image link hidden. Regenerate to embed the diagram in the question.");
}

function extractImageTextLabel(source) {
  try {
    const url = new URL(source, window.location.origin);
    return decodeURIComponent(url.searchParams.get("text") || "").replace(/\+/g, " ").trim();
  } catch {
    return "";
  }
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

function loadFeedbackLikedIds() {
  try {
    const raw = JSON.parse(localStorage.getItem(FEEDBACK_LIKES_KEY) || "[]");
    return new Set(Array.isArray(raw) ? raw.map(String).filter(Boolean) : []);
  } catch {
    return new Set();
  }
}

function saveFeedbackLikedIds() {
  try {
    localStorage.setItem(FEEDBACK_LIKES_KEY, JSON.stringify(Array.from(feedbackLikedIds)));
  } catch {
    // Likes are a small local convenience; failing to persist them should not block feedback.
  }
}

function loadFeedbackOwnerTokens() {
  try {
    const value = JSON.parse(localStorage.getItem(FEEDBACK_OWNERS_KEY) || "{}");
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

function saveFeedbackOwnerTokens() {
  try {
    localStorage.setItem(FEEDBACK_OWNERS_KEY, JSON.stringify(feedbackOwnerTokens));
  } catch {
    // A missing local deletion token must not interrupt feedback browsing.
  }
}

function createFeedbackOwnerToken() {
  if (crypto?.randomUUID) return `${crypto.randomUUID()}-${crypto.randomUUID()}`;
  const values = new Uint32Array(8);
  crypto.getRandomValues(values);
  return Array.from(values, (value) => value.toString(36)).join("-");
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
  if (value === "易" || value === "基础") return t("易", "Easy");
  if (value === "难" || value === "挑战") return t("难", "Hard");
  return t("中", "Medium");
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
