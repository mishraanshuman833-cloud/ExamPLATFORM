const API_BASE_URL = `${window.location.origin}/api`;
const LEGACY_REGISTERED_USER_STORAGE_KEY = "examPlatform.registeredUser";
const ATTEMPT_HISTORY_STORAGE_KEY = "examPlatform.attemptHistory";
const MOCK_TEST_RESULT_STORAGE_KEY = "examPlatform.latestMockTestResult";
const OPTION_KEYS_FOR_QUESTION_BANK = ["A", "B", "C", "D"];
let activeMockTestSession = null;
let mockTestTimerInterval = null;
let authenticatedUser = null;
let appRoutes = [];
let currentRouteIndex = -1;
let handlingPopState = false;

window.addEventListener("beforeunload", (event) => {
  if (activeMockTestSession) {
    event.preventDefault();
    event.returnValue = "";
  }
});

// ================================
// Dashboard navigation
// ================================

const appShell = document.querySelector(".app");
const mainContent = document.querySelector(".main-content");
const backButton = document.getElementById("app-back");
const homeLink = document.getElementById("app-home");
const screenTitle = document.getElementById("app-screen-title");
const accountButton = document.getElementById("app-account");

function setAuthenticationView(isActive) {
  appShell.classList.toggle("auth-view", isActive);
}

function renderCurrentRoute() {
  const route = appRoutes[currentRouteIndex];
  if (!route) {
    return;
  }
  if (route.requiresAuth && !authenticatedUser) {
    showLoginPage({ replace: true });
    return;
  }

  setAuthenticationView(!authenticatedUser);
  backButton.classList.toggle("hidden", currentRouteIndex <= 0);
  screenTitle.textContent = route.title;
  accountButton.classList.toggle("hidden", !authenticatedUser);
  mainContent.replaceChildren();
  route.render();
}

function navigateTo(route, { replace = false } = {}) {
  if (route.requiresAuth && !authenticatedUser) {
    showLoginPage({ replace });
    return;
  }

  if (replace && currentRouteIndex >= 0) {
    appRoutes[currentRouteIndex] = route;
  } else {
    appRoutes = appRoutes.slice(0, currentRouteIndex + 1);
    appRoutes.push(route);
    currentRouteIndex = appRoutes.length - 1;
  }

  const state = { examPlatformRouteIndex: currentRouteIndex };
  if (replace) {
    window.history.replaceState(state, "", window.location.pathname);
  } else if (!handlingPopState) {
    window.history.pushState(state, "", window.location.pathname);
  }
  renderCurrentRoute();
}

function resetNavigation(route) {
  appRoutes = [route];
  currentRouteIndex = 0;
  window.history.replaceState(
    { examPlatformRouteIndex: currentRouteIndex },
    "",
    window.location.pathname
  );
  renderCurrentRoute();
}

function goBack() {
  if (currentRouteIndex <= 0) {
    return;
  }
  window.history.back();
}

window.addEventListener("popstate", (event) => {
  const nextIndex = event.state?.examPlatformRouteIndex;
  if (!Number.isInteger(nextIndex) || nextIndex < 0 || nextIndex >= appRoutes.length) {
    return;
  }
  if (activeMockTestSession && nextIndex < currentRouteIndex) {
    const shouldLeave = window.confirm(
      "Leave this test? Your answers from this session will be lost."
    );
    if (!shouldLeave) {
      window.history.pushState(
        { examPlatformRouteIndex: currentRouteIndex },
        "",
        window.location.pathname
      );
      return;
    }
    clearMockTestSession();
  }

  handlingPopState = true;
  currentRouteIndex = nextIndex;
  renderCurrentRoute();
  handlingPopState = false;
});

backButton.addEventListener("click", () => {
  if (!confirmLeavingActiveMockTest()) {
    return;
  }
  goBack();
});

homeLink.addEventListener("click", (event) => {
  event.preventDefault();
  if (!confirmLeavingActiveMockTest()) {
    return;
  }
  if (authenticatedUser) {
    showDashboardPage();
  } else {
    showWelcomePage();
  }
});

accountButton.addEventListener("click", () => {
  if (!confirmLeavingActiveMockTest()) {
    return;
  }
  showProfilePage();
});

function confirmLeavingActiveMockTest() {
  if (!activeMockTestSession) {
    return true;
  }

  const shouldLeave = window.confirm(
    "Leave this test? Your answers from this session will be lost."
  );
  if (shouldLeave) {
    clearMockTestSession();
  }
  return shouldLeave;
}

function loadAttemptHistory() {
  try {
    const rawHistory = window.localStorage.getItem(ATTEMPT_HISTORY_STORAGE_KEY);
    if (!rawHistory) {
      return [];
    }

    const parsedHistory = JSON.parse(rawHistory);
    return Array.isArray(parsedHistory) ? parsedHistory : [];
  } catch (error) {
    console.error("Unable to load device-local attempt history:", error);
    return [];
  }
}

function saveAttemptHistory(historyEntries) {
  try {
    window.localStorage.setItem(
      ATTEMPT_HISTORY_STORAGE_KEY,
      JSON.stringify(historyEntries)
    );
    return true;
  } catch (error) {
    console.error("Unable to persist device-local attempt history:", error);
    return false;
  }
}

function clearLegacyRegisteredUserCache() {
  try {
    window.localStorage.removeItem(LEGACY_REGISTERED_USER_STORAGE_KEY);
  } catch (error) {
    console.error("Unable to clear legacy local account state:", error);
  }
}

function updateAuthenticatedUserUI() {
  accountButton.replaceChildren();
  if (!authenticatedUser) {
    accountButton.classList.add("hidden");
    return;
  }

  const avatar = document.createElement("span");
  avatar.className = "avatar";
  avatar.textContent = authenticatedUser.name.trim().charAt(0).toUpperCase();
  const label = document.createElement("span");
  label.className = "profile-box-copy";
  const name = document.createElement("strong");
  name.textContent = authenticatedUser.name;
  const caption = document.createElement("span");
  caption.textContent = "Profile";
  label.append(name, caption);
  accountButton.append(avatar, label);
  accountButton.setAttribute("aria-label", `My Profile: ${authenticatedUser.name}`);
  accountButton.classList.remove("hidden");
}

async function restoreAuthenticatedUser() {
  try {
    const response = await fetch(`${API_BASE_URL}/auth/me`, {
      credentials: "same-origin"
    });
    if (response.status === 401) {
      authenticatedUser = null;
      updateAuthenticatedUserUI();
      return false;
    }
    const result = await response.json();
    if (!response.ok || !result.success || !result.authenticated || !result.data) {
      throw new Error(result.message || "Unable to restore the account session.");
    }
    authenticatedUser = result.data;
    updateAuthenticatedUserUI();
    return true;
  } catch (error) {
    console.error("Unable to restore authenticated account:", error);
    authenticatedUser = null;
    updateAuthenticatedUserUI();
    return false;
  }
}

clearLegacyRegisteredUserCache();
updateAuthenticatedUserUI();

function showWelcomePage(options = {}) {
  navigateTo({
    id: "welcome",
    title: "Welcome",
    isAuth: true,
    render: renderWelcomePage
  }, options);
}

function renderWelcomePage() {
  if (authenticatedUser) {
    showDashboardPage({ replace: true });
    return;
  }
  mainContent.innerHTML = `
    <section class="welcome-panel">
      <p class="eyebrow">Competitive Exam Preparation</p>
      <h1>Welcome to ExamPlatform</h1>
      <p class="subtitle">Prepare for PET, SSC, Police and other competitive exams.</p>
      <div class="welcome-actions">
        <button type="button" class="registration-submit" id="welcome-create-account">Get Started · Create Account</button>
        <button type="button" class="mock-quiz-secondary-button" id="welcome-login">Login</button>
      </div>
    </section>
  `;
  document.getElementById("welcome-create-account").addEventListener("click", () => {
    showRegistrationPage();
  });
  document.getElementById("welcome-login").addEventListener("click", () => {
    showLoginPage();
  });
}

function showDashboardPage(options = {}) {
  if (!authenticatedUser) {
    showWelcomePage(options);
    return;
  }
  navigateTo({
    id: "dashboard",
    title: "Dashboard",
    requiresAuth: true,
    render: renderDashboardPage
  }, options);
}

function renderDashboardPage() {
  const adminModule = authenticatedUser.role === "admin"
    ? `
      <button type="button" class="module-card" id="open-admin-question-bank">
        <span class="card-icon">Q</span>
        <span><strong>Question Bank</strong><small>Review and manage pending AI-generated questions.</small></span>
      </button>
    `
    : "";
  mainContent.innerHTML = `
    <section class="dashboard-welcome">
      <p class="eyebrow">Your preparation workspace</p>
      <h1>Welcome, ${escapeHtml(authenticatedUser.name)}</h1>
      <p class="subtitle">Choose where you want to continue.</p>
    </section>
    <section class="module-grid" aria-label="Available modules">
      <button type="button" class="module-card" id="open-mock-tests">
        <span class="card-icon">M</span>
        <span><strong>Mock Tests</strong><small>Choose an exam and attempt a published test.</small></span>
      </button>
      <button type="button" class="module-card" id="open-practice">
        <span class="card-icon">P</span>
        <span><strong>Practice</strong><small>Practice approved questions by exam, subject and topic.</small></span>
      </button>
      <button type="button" class="module-card" id="open-attempt-history">
        <span class="card-icon">H</span>
        <span><strong>Attempt History</strong><small>Review your account-owned test attempts.</small></span>
      </button>
      <button type="button" class="module-card" id="open-profile">
        <span class="card-icon">P</span>
        <span><strong>Profile</strong><small>View your account and session options.</small></span>
      </button>
      ${adminModule}
    </section>
  `;
  document.getElementById("open-mock-tests").addEventListener("click", showMockTestPage);
  document.getElementById("open-practice").addEventListener("click", showPracticePage);
  document.getElementById("open-attempt-history").addEventListener("click", showAttemptHistoryPage);
  document.getElementById("open-profile").addEventListener("click", showProfilePage);
  if (authenticatedUser.role === "admin") {
    document.getElementById("open-admin-question-bank").addEventListener(
      "click",
      showAdminQuestionBankPage
    );
  }
}

function showAdminQuestionBankPage() {
  if (!authenticatedUser || authenticatedUser.role !== "admin") {
    showDashboardPage({ replace: true });
    return;
  }

  navigateTo({
    id: "admin-question-bank",
    title: "Question Bank",
    requiresAuth: true,
    render: renderAdminQuestionBankPage
  });
}

function renderAdminQuestionBankPage() {
  if (!authenticatedUser || authenticatedUser.role !== "admin") {
    showDashboardPage({ replace: true });
    return;
  }

  mainContent.innerHTML = `
    <section class="admin-question-bank">
      <header class="admin-question-bank-heading">
        <div>
          <p class="eyebrow">Administration</p>
          <h1>Question Bank</h1>
          <p class="subtitle">Search and review questions across all origins and publishing states.</p>
        </div>
        <button class="mock-quiz-secondary-button" type="button" id="question-bank-refresh">Refresh</button>
      </header>
      <p class="question-bank-status" id="question-bank-status" role="status" aria-live="polite">Loading Question Bank…</p>
      <form class="question-bank-filters" id="question-bank-filters">
        <label class="question-bank-field">
          <span>Question text</span>
          <input name="search" type="search" maxlength="200" placeholder="Search question text">
        </label>
        <label class="question-bank-field">
          <span>Exam</span>
          <select name="examId"><option value="">All exams</option></select>
        </label>
        <label class="question-bank-field">
          <span>Section</span>
          <select name="sectionId"><option value="">All sections</option></select>
        </label>
        <label class="question-bank-field">
          <span>Topic</span>
          <select name="topicId"><option value="">All topics</option></select>
        </label>
        <label class="question-bank-field">
          <span>Language</span>
          <select name="language">
            <option value="">All languages</option>
            <option value="en">English</option>
            <option value="hi">Hindi</option>
          </select>
        </label>
        <label class="question-bank-field">
          <span>Difficulty</span>
          <select name="difficulty">
            <option value="">All difficulties</option>
            <option value="easy">Easy</option>
            <option value="medium">Medium</option>
            <option value="hard">Hard</option>
          </select>
        </label>
        <label class="question-bank-field">
          <span>Review status</span>
          <select name="reviewStatus">
            <option value="">All review statuses</option>
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
          </select>
        </label>
        <label class="question-bank-field">
          <span>Publishing</span>
          <select name="published">
            <option value="">Published and unpublished</option>
            <option value="true">Published</option>
            <option value="false">Unpublished</option>
          </select>
        </label>
        <label class="question-bank-field">
          <span>Origin</span>
          <select name="origin">
            <option value="">All origins</option>
            <option value="ai_generated">AI-generated</option>
            <option value="manual">Manual</option>
            <option value="pyq">PYQ</option>
          </select>
        </label>
        <label class="question-bank-field">
          <span>Source</span>
          <input name="source" type="search" maxlength="150" placeholder="Filter source">
        </label>
        <div class="question-bank-filter-actions">
          <button class="registration-submit" type="submit">Apply filters</button>
          <button class="mock-quiz-secondary-button" type="reset">Clear filters</button>
        </div>
      </form>
      <div class="question-bank-layout">
        <section class="question-bank-list-panel" aria-labelledby="question-bank-list-heading">
          <h2 id="question-bank-list-heading">Question inventory</h2>
          <div class="question-bank-list" id="question-bank-list"></div>
          <nav class="question-bank-pagination" aria-label="Question Bank pages">
            <button class="mock-quiz-secondary-button" type="button" id="question-bank-previous">Previous</button>
            <span id="question-bank-page" aria-live="polite"></span>
            <button class="mock-quiz-secondary-button" type="button" id="question-bank-next">Next</button>
          </nav>
        </section>
        <section class="question-bank-editor-panel" id="question-bank-editor" aria-live="polite">
          <div class="question-bank-empty">
            <h2>Select a question</h2>
            <p>Choose a question to inspect its content and available actions.</p>
          </div>
        </section>
      </div>
    </section>
  `;

  const status = document.getElementById("question-bank-status");
  const list = document.getElementById("question-bank-list");
  const editor = document.getElementById("question-bank-editor");
  const filtersForm = document.getElementById("question-bank-filters");
  const pageIndicator = document.getElementById("question-bank-page");
  const previousPage = document.getElementById("question-bank-previous");
  const nextPage = document.getElementById("question-bank-next");
  let selectedQuestionId = null;
  let inventoryQuestions = [];
  let currentPage = 1;
  let totalPages = 0;
  const pageSize = 20;
  let sections = [];
  let topics = [];

  function showStatus(message, kind = "") {
    status.textContent = message;
    status.className = `question-bank-status${kind ? ` is-${kind}` : ""}`;
  }

  async function requestJson(url, options = {}) {
    const response = await fetch(url, {
      credentials: "same-origin",
      ...options,
      headers: {
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...(options.headers || {})
      }
    });
    let result;
    try {
      result = await response.json();
    } catch {
      throw new Error("The server returned an unreadable response.");
    }
    if (!response.ok || !result.success) {
      throw new Error(result.message || "The request could not be completed.");
    }
    return result;
  }

  function renderQuestionList() {
    list.replaceChildren();
    if (inventoryQuestions.length === 0) {
      const empty = document.createElement("p");
      empty.className = "question-bank-empty-copy";
      empty.textContent = "No questions match these filters.";
      list.appendChild(empty);
      return;
    }

    inventoryQuestions.forEach((question) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "question-bank-list-item";
      button.classList.toggle("is-selected", String(question.id) === selectedQuestionId);
      button.setAttribute("aria-current", String(question.id) === selectedQuestionId ? "true" : "false");

      const title = document.createElement("strong");
      title.textContent = question.question;
      const meta = document.createElement("span");
      meta.textContent = `${question.examName} · ${question.sectionName} · ${question.topicName}`;
      const tags = document.createElement("span");
      tags.className = "question-bank-tags";
      tags.textContent = [
        question.questionOrigin.replace("_", " "),
        question.questionType.replace("_", " "),
        question.language.toUpperCase(),
        question.difficulty
      ].join(" · ");
      const state = document.createElement("span");
      state.className = "question-bank-list-state";
      state.textContent = `${question.reviewStatus} · ${question.isPublished ? "Published" : "Unpublished"}`;
      const source = document.createElement("span");
      source.className = "question-bank-list-source";
      source.textContent = [question.source, question.sourceYear, question.sourceExam]
        .filter((value) => value !== null && value !== undefined && value !== "")
        .join(" · ");
      button.append(title, meta, tags, state);
      if (source.textContent) button.appendChild(source);
      button.addEventListener("click", () => openQuestion(question.id));
      list.appendChild(button);
    });
  }

  function fillSelect(select, rows, valueKey, labelForRow) {
    const selected = select.value;
    const firstOption = select.options[0];
    select.replaceChildren(firstOption);
    rows.forEach((row) => {
      const option = document.createElement("option");
      option.value = row[valueKey];
      option.textContent = labelForRow(row);
      select.appendChild(option);
    });
    if (Array.from(select.options).some((option) => option.value === selected)) {
      select.value = selected;
    }
  }

  function updateSectionOptions() {
    const examId = filtersForm.elements.examId.value;
    const availableSections = sections.filter(
      (section) => !examId || String(section.exam_id) === examId
    );
    fillSelect(
      filtersForm.elements.sectionId,
      availableSections,
      "id",
      (section) => section.name
    );
    updateTopicOptions();
  }

  function updateTopicOptions() {
    const examId = filtersForm.elements.examId.value;
    const sectionId = filtersForm.elements.sectionId.value;
    const availableTopics = topics.filter(
      (topic) =>
        (!examId || String(topic.exam_id) === examId) &&
        (!sectionId || String(topic.subject_id) === sectionId)
    );
    fillSelect(
      filtersForm.elements.topicId,
      availableTopics,
      "id",
      (topic) => topic.name
    );
  }

  async function loadFilterOptions() {
    const [examResult, sectionResult, topicResult] = await Promise.all([
      requestJson(`${API_BASE_URL}/exams`),
      requestJson(`${API_BASE_URL}/subjects`),
      requestJson(`${API_BASE_URL}/topics`)
    ]);
    sections = sectionResult.data;
    topics = topicResult.data;
    fillSelect(
      filtersForm.elements.examId,
      examResult.data,
      "id",
      (exam) => exam.name
    );
    updateSectionOptions();
  }

  function field(labelText, control) {
    const wrapper = document.createElement("label");
    wrapper.className = "question-bank-field";
    const label = document.createElement("span");
    label.textContent = labelText;
    wrapper.append(label, control);
    return wrapper;
  }

  function questionContext(question) {
    const details = document.createElement("p");
    details.className = "question-bank-preview-explanation";
    details.textContent = [
      `Origin: ${question.questionOrigin}`,
      `Type: ${question.questionType}`,
      `Language: ${question.language.toUpperCase()}`,
      `Difficulty: ${question.difficulty}`,
      question.source ? `Source: ${question.source}` : "",
      question.sourceYear ? `Source year: ${question.sourceYear}` : "",
      question.sourceExam ? `Source exam: ${question.sourceExam}` : "",
      question.creatorName ? `Created by: ${question.creatorName}` : "",
      question.reviewerName ? `Reviewed by: ${question.reviewerName}` : "",
      question.reviewedAt
        ? `Reviewed on: ${new Date(question.reviewedAt).toLocaleDateString()}`
        : ""
    ].filter(Boolean).join(" · ");
    return details;
  }

  function renderEditor(question) {
    editor.replaceChildren();
    if (
      question.aiGenerated &&
      question.reviewStatus === "approved" &&
      !question.isPublished
    ) {
      renderApprovedUnpublishedQuestion(question);
      return;
    }
    if (
      !question.aiGenerated ||
      question.reviewStatus !== "pending" ||
      question.isPublished
    ) {
      renderReadOnlyQuestion(question);
      return;
    }

    const heading = document.createElement("div");
    heading.className = "question-bank-editor-heading";
    const headingCopy = document.createElement("div");
    const title = document.createElement("h2");
    title.textContent = `Review question #${question.id}`;
    const metadata = document.createElement("p");
    metadata.textContent = `${question.examName} · ${question.sectionName} · ${question.topicName}`;
    headingCopy.append(title, metadata);
    const state = document.createElement("span");
    state.className = "question-bank-unpublished-badge";
    state.textContent = "Unpublished";
    heading.append(headingCopy, state);

    const form = document.createElement("form");
    form.className = "question-bank-form";
    const questionInput = document.createElement("textarea");
    questionInput.name = "question";
    questionInput.required = true;
    questionInput.rows = 3;
    questionInput.value = question.question;
    form.appendChild(field("Question", questionInput));

    const optionInputs = {};
    OPTION_KEYS_FOR_QUESTION_BANK.forEach((key) => {
      const input = document.createElement("input");
      input.name = `option-${key}`;
      input.required = true;
      input.type = "text";
      input.value = question.options[key]?.text || "";
      optionInputs[key] = input;
      form.appendChild(field(`Option ${key}`, input));
    });

    const correctAnswer = document.createElement("select");
    correctAnswer.name = "correctAnswer";
    OPTION_KEYS_FOR_QUESTION_BANK.forEach((key) => {
      const option = document.createElement("option");
      option.value = key;
      option.textContent = `${key} — ${optionInputs[key].value}`;
      correctAnswer.appendChild(option);
    });
    correctAnswer.value = OPTION_KEYS_FOR_QUESTION_BANK.find(
      (key) => question.options[key]?.isCorrect
    ) || "A";
    Object.values(optionInputs).forEach((input) => {
      input.addEventListener("input", () => {
        Array.from(correctAnswer.options).forEach((option) => {
          const key = option.value;
          option.textContent = `${key} — ${optionInputs[key].value}`;
        });
      });
    });
    form.appendChild(field("Correct answer", correctAnswer));

    const explanation = document.createElement("textarea");
    explanation.name = "explanation";
    explanation.required = true;
    explanation.rows = 4;
    explanation.value = question.explanation || "";
    form.appendChild(field("Explanation", explanation));

    const language = document.createElement("select");
    language.name = "language";
    [["en", "English"], ["hi", "Hindi"]].forEach(([value, label]) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      language.appendChild(option);
    });
    language.value = question.language;
    form.appendChild(field("Language", language));

    const difficulty = document.createElement("select");
    difficulty.name = "difficulty";
    ["easy", "medium", "hard"].forEach((value) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = value.charAt(0).toUpperCase() + value.slice(1);
      difficulty.appendChild(option);
    });
    difficulty.value = question.difficulty;
    form.appendChild(field("Difficulty", difficulty));

    const actions = document.createElement("div");
    actions.className = "question-bank-actions";
    const save = document.createElement("button");
    save.type = "submit";
    save.className = "registration-submit";
    save.textContent = "Save changes";
    const approve = document.createElement("button");
    approve.type = "button";
    approve.className = "question-bank-approve";
    approve.textContent = "Approve";
    const reject = document.createElement("button");
    reject.type = "button";
    reject.className = "question-bank-reject";
    reject.textContent = "Reject";
    actions.append(save, approve, reject);
    form.appendChild(actions);
    editor.append(heading, questionContext(question), form);

    function setBusy(isBusy, message) {
      Array.from(form.elements).forEach((control) => {
        control.disabled = isBusy;
      });
      if (message) {
        showStatus(message, isBusy ? "" : "success");
      }
    }

    function renderReadOnlyQuestion(question) {
      const heading = document.createElement("div");
      heading.className = "question-bank-editor-heading";
      const headingCopy = document.createElement("div");
      const title = document.createElement("h2");
      title.textContent = `Question #${question.id}`;
      const metadata = document.createElement("p");
      metadata.textContent = `${question.examName} · ${question.sectionName} · ${question.topicName}`;
      headingCopy.append(title, metadata);
      const state = document.createElement("span");
      state.className = "question-bank-unpublished-badge";
      state.textContent = `${question.reviewStatus} · ${question.isPublished ? "Published" : "Unpublished"}`;
      heading.append(headingCopy, state);

      const questionText = document.createElement("p");
      questionText.className = "question-bank-preview-question";
      questionText.textContent = question.question;
      const options = document.createElement("ul");
      options.className = "question-bank-preview-options";
      OPTION_KEYS_FOR_QUESTION_BANK.forEach((key) => {
        const item = document.createElement("li");
        item.textContent =
          `${key}. ${question.options[key]?.text || ""}${question.options[key]?.isCorrect ? " (Correct answer)" : ""}`;
        options.appendChild(item);
      });
      const explanation = document.createElement("p");
      explanation.className = "question-bank-preview-explanation";
      explanation.textContent = question.explanation || "No explanation provided.";
      editor.append(heading, questionContext(question), questionText, options, explanation);
    }

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!form.reportValidity()) {
        return;
      }
      setBusy(true, "Saving question changes…");
      const payload = {
        question: questionInput.value,
        options: Object.fromEntries(
          OPTION_KEYS_FOR_QUESTION_BANK.map((key) => [key, optionInputs[key].value])
        ),
        correctAnswer: correctAnswer.value,
        explanation: explanation.value,
        language: language.value,
        difficulty: difficulty.value
      };
      try {
        const result = await requestJson(
          `${API_BASE_URL}/admin/question-bank/${encodeURIComponent(question.id)}`,
          { method: "PATCH", body: JSON.stringify(payload) }
        );
        showStatus(result.message || "Question changes saved.", "success");
        await loadQuestions({ preserveSelection: true });
        if (selectedQuestionId) {
          await openQuestion(selectedQuestionId, { preserveStatus: true });
        }
      } catch (error) {
        showStatus(error.message, "error");
      } finally {
        setBusy(false);
      }
    });

    approve.addEventListener("click", () => reviewQuestion("approve", approve, form));
    reject.addEventListener("click", () => reviewQuestion("reject", reject, form));
  }

  function renderApprovedUnpublishedQuestion(question) {
    const heading = document.createElement("div");
    heading.className = "question-bank-editor-heading";
    const headingCopy = document.createElement("div");
    const title = document.createElement("h2");
    title.textContent = `Approved question #${question.id}`;
    const metadata = document.createElement("p");
    metadata.textContent = `${question.examName} · ${question.sectionName} · ${question.topicName}`;
    headingCopy.append(title, metadata);
    const state = document.createElement("span");
    state.className = "question-bank-unpublished-badge";
    state.textContent = `${question.reviewStatus} · Unpublished`;
    heading.append(headingCopy, state);

    const questionText = document.createElement("p");
    questionText.className = "question-bank-preview-question";
    questionText.textContent = question.question;
    const options = document.createElement("ul");
    options.className = "question-bank-preview-options";
    OPTION_KEYS_FOR_QUESTION_BANK.forEach((key) => {
      const item = document.createElement("li");
      item.textContent =
        `${key}. ${question.options[key]?.text || ""}${question.options[key]?.isCorrect ? " (Correct answer)" : ""}`;
      options.appendChild(item);
    });
    const explanation = document.createElement("p");
    explanation.className = "question-bank-preview-explanation";
    explanation.textContent = question.explanation || "No explanation provided.";

    const publish = document.createElement("button");
    publish.type = "button";
    publish.className = "question-bank-approve";
    publish.textContent = "Publish question";
    publish.addEventListener("click", async () => {
      publish.disabled = true;
      showStatus("Publishing approved question…");
      try {
        const result = await requestJson(
          `${API_BASE_URL}/admin/question-bank/${encodeURIComponent(question.id)}/publish`,
          { method: "POST" }
        );
        selectedQuestionId = String(question.id);
        await loadQuestions({ preserveSelection: true });
        await openQuestion(question.id, { preserveStatus: true });
        showStatus(result.message || "Question published.", "success");
      } catch (error) {
        publish.disabled = false;
        showStatus(error.message, "error");
      }
    });

    editor.append(
      heading,
      questionContext(question),
      questionText,
      options,
      explanation,
      publish
    );
  }

  async function openQuestion(questionId, options = {}) {
    selectedQuestionId = String(questionId);
    renderQuestionList();
    editor.replaceChildren();
    const loading = document.createElement("p");
    loading.className = "question-bank-editor-loading";
    loading.textContent = "Loading question…";
    editor.appendChild(loading);
    if (!options.preserveStatus) {
      showStatus("Loading question details…");
    }
    try {
      const result = await requestJson(
        `${API_BASE_URL}/admin/question-bank/${encodeURIComponent(questionId)}`
      );
      renderEditor(result.data);
      if (!options.preserveStatus) {
        showStatus("Question loaded.", "success");
      }
    } catch (error) {
      selectedQuestionId = null;
      editor.replaceChildren();
      showStatus(error.message, "error");
      renderQuestionList();
    }
  }

  async function loadQuestions(options = {}) {
    list.replaceChildren();
    const loading = document.createElement("p");
    loading.className = "question-bank-empty-copy";
    loading.textContent = "Loading questions…";
    list.appendChild(loading);
    if (!options.preserveSelection) {
      selectedQuestionId = null;
    }
    try {
      const params = new URLSearchParams();
      for (const name of [
        "search",
        "examId",
        "sectionId",
        "topicId",
        "language",
        "difficulty",
        "reviewStatus",
        "published",
        "origin",
        "source"
      ]) {
        const value = filtersForm.elements[name].value.trim();
        if (value) params.set(name, value);
      }
      params.set("page", String(currentPage));
      params.set("pageSize", String(pageSize));
      const result = await requestJson(
        `${API_BASE_URL}/admin/question-bank?${params.toString()}`
      );
      inventoryQuestions = result.data;
      totalPages = result.totalPages;
      pageIndicator.textContent = result.totalCount
        ? `Page ${result.page} of ${result.totalPages} · ${result.totalCount} questions`
        : "Page 0 of 0 · 0 questions";
      previousPage.disabled = result.page <= 1;
      nextPage.disabled = result.page >= result.totalPages;
      if (
        selectedQuestionId &&
        !inventoryQuestions.some((question) => String(question.id) === selectedQuestionId)
      ) {
        selectedQuestionId = null;
        editor.replaceChildren();
        const empty = document.createElement("div");
        empty.className = "question-bank-empty";
        const heading = document.createElement("h2");
        heading.textContent = "Select a question";
        const copy = document.createElement("p");
        copy.textContent = "Choose a question to review or publish.";
        empty.append(heading, copy);
        editor.appendChild(empty);
      }
      renderQuestionList();
      if (!options.preserveSelection) {
        showStatus(
          result.totalCount
            ? `${result.totalCount} question${result.totalCount === 1 ? "" : "s"} found.`
            : "No questions match these filters.",
          "success"
        );
      }
    } catch (error) {
      inventoryQuestions = [];
      pageIndicator.textContent = "";
      previousPage.disabled = true;
      nextPage.disabled = true;
      renderQuestionList();
      showStatus(error.message, "error");
    }
  }

  async function reviewQuestion(action, clickedButton, form) {
    if (action === "reject" && !window.confirm("Reject this question? It will remain unpublished.")) {
      return;
    }
    Array.from(form.elements).forEach((control) => {
      control.disabled = true;
    });
    showStatus(action === "approve" ? "Approving question…" : "Rejecting question…");
    try {
      const result = await requestJson(
        `${API_BASE_URL}/admin/question-bank/${encodeURIComponent(selectedQuestionId)}/${action}`,
        { method: "POST" }
      );
      selectedQuestionId = null;
      editor.replaceChildren();
      const empty = document.createElement("div");
      empty.className = "question-bank-empty";
      const heading = document.createElement("h2");
      heading.textContent = "Select a question";
      const copy = document.createElement("p");
      copy.textContent = "Choose a question to review or publish.";
      empty.append(heading, copy);
      editor.appendChild(empty);
      await loadQuestions();
      showStatus(
        action === "approve"
          ? "Question approved and remains unpublished."
          : result.message || "Question rejected and remains unpublished.",
        "success"
      );
    } catch (error) {
      clickedButton.disabled = false;
      showStatus(error.message, "error");
    }
  }

  document.getElementById("question-bank-refresh").addEventListener("click", () => {
    showStatus("Refreshing Question Bank…");
    loadQuestions({ preserveSelection: true });
  });

  filtersForm.elements.examId.addEventListener("change", updateSectionOptions);
  filtersForm.elements.sectionId.addEventListener("change", updateTopicOptions);
  filtersForm.addEventListener("submit", (event) => {
    event.preventDefault();
    currentPage = 1;
    selectedQuestionId = null;
    editor.replaceChildren();
    loadQuestions();
  });
  filtersForm.addEventListener("reset", () => {
    window.setTimeout(() => {
      updateSectionOptions();
      currentPage = 1;
      selectedQuestionId = null;
      loadQuestions();
    }, 0);
  });
  previousPage.addEventListener("click", () => {
    if (currentPage > 1) {
      currentPage -= 1;
      loadQuestions({ preserveSelection: true });
    }
  });
  nextPage.addEventListener("click", () => {
    if (currentPage < totalPages) {
      currentPage += 1;
      loadQuestions({ preserveSelection: true });
    }
  });
  loadFilterOptions()
    .then(() => loadQuestions())
    .catch(async (error) => {
      await loadQuestions();
      showStatus(`Filter options could not be loaded: ${error.message}`, "error");
    });
}

function showProfilePage() {
  if (!authenticatedUser) {
    showLoginPage();
    return;
  }

  navigateTo({
    id: "profile",
    title: "Profile",
    requiresAuth: true,
    render: renderProfilePage
  });
}

function renderProfilePage() {
  mainContent.replaceChildren();

  const header = document.createElement("header");
  header.className = "topbar";
  const headingGroup = document.createElement("div");
  const eyebrow = document.createElement("p");
  eyebrow.className = "eyebrow";
  eyebrow.textContent = "Student Account";
  const heading = document.createElement("h1");
  heading.textContent = "My Profile";
  const subtitle = document.createElement("p");
  subtitle.className = "subtitle";
  subtitle.textContent = "You are signed in with a secure server session.";
  headingGroup.append(eyebrow, heading, subtitle);
  header.appendChild(headingGroup);

  const profileCard = document.createElement("section");
  profileCard.className = "registration-panel registered-profile";
  const name = document.createElement("p");
  name.textContent = `Name: ${authenticatedUser.name}`;
  const email = document.createElement("p");
  email.textContent = `Email: ${authenticatedUser.email}`;
  const role = document.createElement("p");
  role.textContent = `Account type: ${authenticatedUser.role}`;
  const notice = document.createElement("p");
  notice.className = "registered-profile-notice";
  notice.textContent =
    "Your account history is server-backed. Older device-local attempts remain separate and are not attributed to this account.";

  const profileActions = document.createElement("div");
  profileActions.className = "profile-actions";

  const historyButton = document.createElement("button");
  historyButton.type = "button";
  historyButton.className = "registration-submit profile-action-button";
  historyButton.textContent = "Attempt History";
  historyButton.addEventListener("click", () => {
    showAttemptHistoryPage();
  });

  const logoutButton = document.createElement("button");
  logoutButton.type = "button";
  logoutButton.className = "mock-quiz-secondary-button profile-action-button";
  logoutButton.textContent = "Log Out";
  logoutButton.addEventListener("click", logout);

  const mockTestsButton = document.createElement("button");
  mockTestsButton.type = "button";
  mockTestsButton.className = "mock-quiz-secondary-button profile-action-button";
  mockTestsButton.textContent = "Mock Tests";
  mockTestsButton.addEventListener("click", showMockTestPage);

  profileActions.append(historyButton, mockTestsButton, logoutButton);
  profileCard.append(name, email, role, notice, profileActions);

  mainContent.append(header, profileCard);
}

function showAttemptHistoryPage() {
  navigateTo({
    id: "attempt-history",
    title: "Attempt History",
    requiresAuth: true,
    render: renderAttemptHistoryPage
  });
}

function renderAttemptHistoryPage() {
  mainContent.replaceChildren();

  const header = document.createElement("header");
  header.className = "topbar";
  const headingGroup = document.createElement("div");
  const eyebrow = document.createElement("p");
  eyebrow.className = "eyebrow";
  eyebrow.textContent = "Account Activity";
  const heading = document.createElement("h1");
  heading.textContent = "Attempt History";
  const subtitle = document.createElement("p");
  subtitle.className = "subtitle";
  subtitle.textContent = "Your completed mock tests linked to your signed-in account.";
  headingGroup.append(eyebrow, heading, subtitle);

  header.appendChild(headingGroup);

  const historyPanel = document.createElement("section");
  historyPanel.className = "attempt-history-panel";
  const status = document.createElement("p");
  status.className = "attempt-history-loading";
  status.setAttribute("role", "status");
  status.textContent = "Loading your attempts...";
  historyPanel.appendChild(status);
  mainContent.append(header, historyPanel);

  loadAuthenticatedAttemptHistory(historyPanel);
}

async function loadAuthenticatedAttemptHistory(historyPanel) {
  try {
    const response = await fetch(`${API_BASE_URL}/results/attempts`, {
      credentials: "same-origin"
    });
    const result = await response.json();

    if (response.status === 401) {
      authenticatedUser = null;
      updateAuthenticatedUserUI();
      resetNavigation({
        id: "welcome",
        title: "Welcome",
        isAuth: true,
        render: renderWelcomePage
      });
      return;
    }
    if (!response.ok || !result.success || !Array.isArray(result.data)) {
      throw new Error(result.message || "Unable to load your attempt history.");
    }

    const listContainer = document.createElement("div");
    listContainer.className = "attempt-history-list";
    historyPanel.replaceChildren(listContainer);

    if (result.data.length === 0) {
      const emptyState = document.createElement("div");
      emptyState.className = "attempt-history-empty";
      const message = document.createElement("p");
      message.textContent = "No account-owned attempts yet. Complete a mock test while signed in to start your history.";
      emptyState.appendChild(message);
      listContainer.appendChild(emptyState);
    } else {
      result.data.forEach((entry) => {
        const item = document.createElement("article");
        item.className = "attempt-history-card";

        const meta = document.createElement("div");
        meta.className = "attempt-history-card-row";
        const testName = document.createElement("h3");
        testName.textContent = entry.testTitle || "Mock Test";
        const date = document.createElement("span");
        date.textContent = formatAttemptHistoryDate(entry.submittedAt);
        meta.append(testName, date);

        const examInfo = document.createElement("p");
        examInfo.className = "attempt-history-meta";
        examInfo.textContent = `${entry.examName || "Exam"} · ${entry.totalQuestions} questions`;

        const stats = document.createElement("div");
        stats.className = "attempt-history-stats";
        [
          `Score: ${entry.score}/${entry.totalMarks}`,
          `Accuracy: ${entry.accuracy}%`,
          `Correct: ${entry.correctAnswers}`,
          `Wrong: ${entry.wrongAnswers}`,
          `Skipped: ${entry.skippedQuestions}`
        ].forEach((label) => {
          const stat = document.createElement("span");
          stat.textContent = label;
          stats.appendChild(stat);
        });

        const actionRow = document.createElement("div");
        actionRow.className = "attempt-history-actions";
        const reviewButton = document.createElement("button");
        reviewButton.type = "button";
        reviewButton.className = "registration-submit";
        reviewButton.textContent = "Review Attempt";
        reviewButton.addEventListener("click", () => {
          loadAuthenticatedAttemptReview(entry.attemptId);
        });
        actionRow.appendChild(reviewButton);

        item.append(meta, examInfo, stats, actionRow);
        listContainer.appendChild(item);
      });
    }

    const localCount = loadAttemptHistory().length;
    if (localCount > 0) {
      const legacyAction = document.createElement("div");
      legacyAction.className = "attempt-history-legacy";
      const legacyNote = document.createElement("p");
      legacyNote.textContent = `${localCount} older attempt${localCount === 1 ? "" : "s"} remain saved on this device only. They have not been moved into your account.`;
      const legacyButton = document.createElement("button");
      legacyButton.type = "button";
      legacyButton.className = "mock-quiz-secondary-button";
      legacyButton.textContent = "View device-local attempts";
      legacyButton.addEventListener("click", showLegacyAttemptHistoryPage);
      legacyAction.append(legacyNote, legacyButton);
      listContainer.appendChild(legacyAction);
    }
  } catch (error) {
    console.error("Unable to load authenticated attempt history:", error);
    const errorPanel = document.createElement("div");
    errorPanel.className = "attempt-history-error";
    const message = document.createElement("p");
    message.textContent = error.message || "Attempt history could not be loaded.";
    const retryButton = document.createElement("button");
    retryButton.type = "button";
    retryButton.className = "registration-submit";
    retryButton.textContent = "Try Again";
    retryButton.addEventListener("click", () => {
      errorPanel.replaceWith(Object.assign(document.createElement("p"), {
        className: "attempt-history-loading",
        textContent: "Loading your attempts..."
      }));
      loadAuthenticatedAttemptHistory(historyPanel);
    });
    errorPanel.append(message, retryButton);
    historyPanel.replaceChildren(errorPanel);
  }
}

async function loadAuthenticatedAttemptReview(attemptId) {
  navigateTo({
    id: `attempt-review-${attemptId}`,
    title: "Attempt Review",
    requiresAuth: true,
    render: () => renderAuthenticatedAttemptReviewPage(attemptId)
  });
}

async function renderAuthenticatedAttemptReviewPage(attemptId) {
  mainContent.replaceChildren();
  const loading = document.createElement("p");
  loading.className = "attempt-history-loading";
  loading.setAttribute("role", "status");
  loading.textContent = "Loading secure attempt review...";
  mainContent.appendChild(loading);

  try {
    const response = await fetch(
      `${API_BASE_URL}/results/attempts/${encodeURIComponent(attemptId)}`,
      { credentials: "same-origin" }
    );
    const result = await response.json();
    if (response.status === 401) {
      authenticatedUser = null;
      updateAuthenticatedUserUI();
      resetNavigation({
        id: "welcome",
        title: "Welcome",
        isAuth: true,
        render: renderWelcomePage
      });
      return;
    }
    if (!response.ok || !result.success || !result.data) {
      throw new Error(result.message || "Attempt review could not be loaded.");
    }
    renderAuthenticatedAttemptReview(result.data);
  } catch (error) {
    console.error("Unable to load authenticated attempt review:", error);
    mainContent.replaceChildren();
    const errorPanel = document.createElement("section");
    errorPanel.className = "attempt-history-error";
    const message = document.createElement("p");
    message.textContent = error.message || "Attempt review could not be loaded.";
    const backButton = document.createElement("button");
    backButton.type = "button";
    backButton.className = "mock-quiz-secondary-button";
    backButton.textContent = "Back to Attempt History";
    backButton.addEventListener("click", goBack);
    errorPanel.append(message, backButton);
    mainContent.appendChild(errorPanel);
  }
}

function getReviewAnswerStatus(answer) {
  if (answer.isCorrect === true || answer.status === "correct") {
    return "correct";
  }
  if (
    answer.isCorrect === false ||
    answer.status === "wrong" ||
    answer.status === "incorrect"
  ) {
    return "incorrect";
  }
  return "unanswered";
}

function renderQuestionReviewNavigation(container, answers, renderAnswer) {
  const reviewAnswers = Array.isArray(answers) ? answers : [];
  const filterOptions = [
    { value: "all", label: "All" },
    { value: "incorrect", label: "Incorrect" },
    { value: "unanswered", label: "Unanswered" }
  ];
  let selectedFilter = "all";
  let currentIndex = reviewAnswers.length > 0 ? 0 : -1;

  const navigation = document.createElement("div");
  navigation.className = "mock-review-navigation";

  const filters = document.createElement("div");
  filters.className = "mock-review-filters";
  filters.setAttribute("role", "group");
  filters.setAttribute("aria-label", "Filter review questions");
  const filterButtons = new Map();
  filterOptions.forEach(({ value, label }) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "mock-review-filter";
    button.textContent = label;
    button.setAttribute("aria-pressed", String(value === selectedFilter));
    button.addEventListener("click", () => {
      selectedFilter = value;
      const visibleIndexes = getVisibleIndexes();
      if (!visibleIndexes.includes(currentIndex)) {
        currentIndex = visibleIndexes.length > 0 ? visibleIndexes[0] : -1;
      }
      render();
    });
    filterButtons.set(value, button);
    filters.appendChild(button);
  });
  navigation.appendChild(filters);

  const currentQuestion = document.createElement("p");
  currentQuestion.className = "mock-review-current";
  currentQuestion.setAttribute("aria-live", "polite");
  navigation.appendChild(currentQuestion);

  const questionNumbers = document.createElement("div");
  questionNumbers.className = "mock-review-question-numbers";
  questionNumbers.setAttribute("role", "group");
  questionNumbers.setAttribute("aria-label", "Question navigation");
  navigation.appendChild(questionNumbers);

  const previousButton = document.createElement("button");
  previousButton.type = "button";
  previousButton.className = "mock-quiz-secondary-button mock-review-step";
  previousButton.textContent = "Previous";
  previousButton.addEventListener("click", () => moveQuestion(-1));

  const nextButton = document.createElement("button");
  nextButton.type = "button";
  nextButton.className = "mock-quiz-secondary-button mock-review-step";
  nextButton.textContent = "Next";
  nextButton.addEventListener("click", () => moveQuestion(1));

  const stepControls = document.createElement("div");
  stepControls.className = "mock-review-step-controls";
  stepControls.append(previousButton, nextButton);
  navigation.appendChild(stepControls);

  const emptyMessage = document.createElement("p");
  emptyMessage.className = "mock-review-empty";
  emptyMessage.textContent = "No questions match this filter.";

  const answerList = document.createElement("ol");
  answerList.className = "mock-result-answer-list";
  container.append(navigation, emptyMessage, answerList);

  function getVisibleIndexes() {
    return reviewAnswers.reduce((indexes, answer, index) => {
      if (
        selectedFilter === "all" ||
        getReviewAnswerStatus(answer) === selectedFilter
      ) {
        indexes.push(index);
      }
      return indexes;
    }, []);
  }

  function moveQuestion(direction) {
    const visibleIndexes = getVisibleIndexes();
    const visiblePosition = visibleIndexes.indexOf(currentIndex);
    const nextIndex = visibleIndexes[visiblePosition + direction];
    if (nextIndex !== undefined) {
      currentIndex = nextIndex;
      render();
    }
  }

  function render() {
    filterButtons.forEach((button, value) => {
      button.setAttribute("aria-pressed", String(value === selectedFilter));
    });

    const visibleIndexes = getVisibleIndexes();
    questionNumbers.replaceChildren();
    visibleIndexes.forEach((index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "mock-review-question-number";
      button.textContent = String(index + 1);
      button.setAttribute("aria-label", `Go to question ${index + 1}`);
      button.setAttribute("data-status", getReviewAnswerStatus(reviewAnswers[index]));
      if (index === currentIndex) {
        button.classList.add("is-current");
        button.setAttribute("aria-current", "step");
      }
      button.addEventListener("click", () => {
        currentIndex = index;
        render();
      });
      questionNumbers.appendChild(button);
    });

    const visiblePosition = visibleIndexes.indexOf(currentIndex);
    const hasCurrentQuestion = visiblePosition >= 0;
    currentQuestion.textContent = hasCurrentQuestion
      ? `Question ${currentIndex + 1} of ${reviewAnswers.length}`
      : "";
    previousButton.disabled = !hasCurrentQuestion || visiblePosition === 0;
    nextButton.disabled =
      !hasCurrentQuestion || visiblePosition === visibleIndexes.length - 1;
    emptyMessage.hidden = hasCurrentQuestion;
    answerList.hidden = !hasCurrentQuestion;
    answerList.replaceChildren();
    if (hasCurrentQuestion) {
      answerList.appendChild(renderAnswer(reviewAnswers[currentIndex], currentIndex));
    }
  }

  render();
}

function renderAuthenticatedAttemptReview(attempt) {
  mainContent.replaceChildren();

  const header = document.createElement("header");
  header.className = "topbar";
  const headingGroup = document.createElement("div");
  const eyebrow = document.createElement("p");
  eyebrow.className = "eyebrow";
  eyebrow.textContent = attempt.examName || "Attempt Review";
  const heading = document.createElement("h1");
  heading.textContent = attempt.testTitle || "Mock Test Review";
  const subtitle = document.createElement("p");
  subtitle.className = "subtitle";
  subtitle.textContent = `Submitted ${formatAttemptHistoryDate(attempt.submittedAt)}`;
  headingGroup.append(eyebrow, heading, subtitle);

  const backButton = document.createElement("button");
  backButton.type = "button";
  backButton.className = "mock-quiz-secondary-button";
  backButton.textContent = "Back to Attempt History";
  backButton.addEventListener("click", goBack);
  header.append(headingGroup, backButton);
  mainContent.appendChild(header);

  const summary = document.createElement("section");
  summary.className = "mock-result-summary";
  [
    ["Score", `${attempt.score} / ${attempt.totalMarks}`],
    ["Accuracy", `${attempt.accuracy}%`],
    ["Correct", attempt.correctAnswers],
    ["Wrong", attempt.wrongAnswers],
    ["Skipped", attempt.skippedQuestions]
  ].forEach(([label, value]) => {
    const card = document.createElement("article");
    card.className = "mock-result-metric";
    const metricValue = document.createElement("strong");
    metricValue.textContent = String(value);
    const metricLabel = document.createElement("span");
    metricLabel.textContent = label;
    card.append(metricValue, metricLabel);
    summary.appendChild(card);
  });
  mainContent.appendChild(summary);

  const reviewPanel = document.createElement("section");
  reviewPanel.className = "mock-result-review";
  const reviewHeading = document.createElement("h2");
  reviewHeading.textContent = "Question-wise review";
  reviewPanel.appendChild(reviewHeading);
  appendWrongQuestionPracticeAction(
    reviewPanel,
    attempt.attemptId,
    attempt.wrongAnswers,
    attempt.testTitle || "Mock Test"
  );
  renderQuestionReviewNavigation(reviewPanel, attempt.answers, (answer, index) => {
    const item = document.createElement("li");
    item.className = "mock-result-answer";
    const itemHeader = document.createElement("div");
    itemHeader.className = "mock-result-answer-heading";
    const question = document.createElement("h3");
    question.textContent = `Question ${index + 1}: ${answer.question}`;
    const status = document.createElement("span");
    status.className = `mock-result-status ${
      answer.status === "correct"
        ? "correct"
        : answer.status === "wrong"
          ? "incorrect"
          : "unattempted"
    }`;
    status.textContent =
      answer.status === "correct" ? "Correct" : answer.status === "wrong" ? "Wrong" : "Skipped";
    itemHeader.append(question, status);

    const selected = document.createElement("p");
    selected.textContent = answer.selectedOption
      ? `Your answer: ${answer.selectedOption.key}. ${answer.selectedOption.text}`
      : "Your answer: Not answered";
    const correct = document.createElement("p");
    correct.textContent = answer.correctOption
      ? `Correct answer: ${answer.correctOption.key}. ${answer.correctOption.text}`
      : "Correct answer: Not available";
    const explanation = document.createElement("p");
    explanation.className = "mock-result-explanation";
    explanation.textContent = answer.explanation || "No explanation provided.";
    item.append(itemHeader, selected, correct, explanation);
    return item;
  });
  mainContent.appendChild(reviewPanel);
}

function appendWrongQuestionPracticeAction(container, attemptId, wrongAnswers, testTitle) {
  if (!attemptId || Number(wrongAnswers) <= 0) {
    return;
  }

  const button = document.createElement("button");
  button.type = "button";
  button.className = "registration-submit mock-wrong-practice-action";
  button.textContent = `Practice Wrong Questions (${Number(wrongAnswers)})`;
  button.addEventListener("click", () => {
    showWrongQuestionPractice(attemptId, testTitle);
  });
  container.appendChild(button);
}

function showWrongQuestionPractice(attemptId, testTitle) {
  navigateTo({
    id: `wrong-question-practice-${attemptId}`,
    title: "Practice Wrong Questions",
    requiresAuth: true,
    render: () => renderWrongQuestionPracticePage(attemptId, testTitle)
  });
}

async function renderWrongQuestionPracticePage(attemptId, testTitle) {
  mainContent.replaceChildren();
  const loading = document.createElement("p");
  loading.className = "attempt-history-loading";
  loading.setAttribute("role", "status");
  loading.textContent = "Loading incorrect questions...";
  mainContent.appendChild(loading);

  try {
    const response = await fetch(
      `${API_BASE_URL}/results/attempts/${encodeURIComponent(attemptId)}/wrong-questions`,
      { credentials: "same-origin" }
    );
    const result = await response.json();
    if (response.status === 401) {
      authenticatedUser = null;
      updateAuthenticatedUserUI();
      resetNavigation({
        id: "welcome",
        title: "Welcome",
        isAuth: true,
        render: renderWelcomePage
      });
      return;
    }
    if (!response.ok || !result.success || !result.data) {
      throw new Error(result.message || "Incorrect questions could not be loaded.");
    }
    if (!Array.isArray(result.data.questions) || result.data.questions.length === 0) {
      throw new Error("This attempt has no incorrect questions to practice.");
    }

    renderWrongQuestionPractice(result.data, testTitle);
  } catch (error) {
    console.error("Unable to load wrong questions for practice:", error);
    mainContent.replaceChildren();
    const errorPanel = document.createElement("section");
    errorPanel.className = "attempt-history-error";
    const message = document.createElement("p");
    message.textContent = error.message || "Incorrect questions could not be loaded.";
    const backButton = document.createElement("button");
    backButton.type = "button";
    backButton.className = "mock-quiz-secondary-button";
    backButton.textContent = "Back to Attempt Review";
    backButton.addEventListener("click", goBack);
    errorPanel.append(message, backButton);
    mainContent.appendChild(errorPanel);
  }
}

function renderWrongQuestionPractice(attempt, fallbackTitle) {
  const questions = attempt.questions;
  const selectedAnswers = new Map();
  let currentIndex = 0;

  const header = document.createElement("header");
  header.className = "mock-result-header";
  const headingGroup = document.createElement("div");
  const eyebrow = document.createElement("p");
  eyebrow.className = "eyebrow";
  eyebrow.textContent = attempt.examName || "Retry Practice";
  const heading = document.createElement("h1");
  heading.textContent = "Practice Wrong Questions";
  const subtitle = document.createElement("p");
  subtitle.className = "subtitle";
  subtitle.textContent = attempt.testTitle || fallbackTitle || "Mock Test";
  headingGroup.append(eyebrow, heading, subtitle);

  const backButton = document.createElement("button");
  backButton.type = "button";
  backButton.className = "mock-quiz-secondary-button";
  backButton.textContent = "Back to Attempt Review";
  backButton.addEventListener("click", goBack);
  header.append(headingGroup, backButton);

  const practiceCard = document.createElement("section");
  practiceCard.className = "mock-result-review wrong-question-practice";
  const progress = document.createElement("p");
  progress.className = "mock-review-current";
  progress.setAttribute("aria-live", "polite");
  const questionTitle = document.createElement("h2");
  questionTitle.className = "wrong-practice-question";
  const metadata = document.createElement("p");
  metadata.className = "mock-review-current";
  const options = document.createElement("div");
  options.className = "wrong-practice-options";
  const feedback = document.createElement("section");
  feedback.className = "wrong-practice-feedback";
  feedback.setAttribute("aria-live", "polite");
  const controls = document.createElement("div");
  controls.className = "mock-review-step-controls";
  const previousButton = document.createElement("button");
  previousButton.type = "button";
  previousButton.className = "mock-quiz-secondary-button";
  previousButton.textContent = "Previous";
  previousButton.addEventListener("click", () => {
    if (currentIndex > 0) {
      currentIndex -= 1;
      renderQuestion();
    }
  });
  const nextButton = document.createElement("button");
  nextButton.type = "button";
  nextButton.className = "mock-quiz-secondary-button";
  nextButton.textContent = "Next";
  nextButton.addEventListener("click", () => {
    if (currentIndex < questions.length - 1) {
      currentIndex += 1;
      renderQuestion();
    }
  });
  controls.append(previousButton, nextButton);
  practiceCard.append(progress, questionTitle, metadata, options, feedback, controls);
  mainContent.replaceChildren(header, practiceCard);

  function renderQuestion() {
    const question = questions[currentIndex];
    const selectedOptionId = selectedAnswers.get(String(question.id));
    progress.textContent = `Question ${currentIndex + 1} of ${questions.length}`;
    questionTitle.textContent = question.text;
    metadata.textContent = [question.subject, question.topic].filter(Boolean).join(" · ");
    options.replaceChildren();

    question.options.forEach((option) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "wrong-practice-option";
      button.setAttribute("aria-pressed", String(String(option.id) === selectedOptionId));
      const key = document.createElement("strong");
      key.textContent = option.key;
      const text = document.createElement("span");
      text.textContent = option.text;
      button.append(key, text);
      button.addEventListener("click", () => {
        selectedAnswers.set(String(question.id), String(option.id));
        renderQuestion();
      });
      options.appendChild(button);
    });

    feedback.replaceChildren();
    if (selectedOptionId !== undefined) {
      const isCorrect = selectedOptionId === String(question.correctOption?.id);
      const status = document.createElement("p");
      status.className = `wrong-practice-feedback-status ${isCorrect ? "correct" : "incorrect"}`;
      status.textContent = isCorrect ? "Correct" : "Incorrect";
      const correctAnswer = document.createElement("p");
      correctAnswer.textContent = question.correctOption
        ? `Correct answer: ${question.correctOption.key}. ${question.correctOption.text}`
        : "Correct answer is unavailable.";
      const explanation = document.createElement("p");
      explanation.className = "mock-result-explanation";
      explanation.textContent = question.explanation || "No explanation provided.";
      feedback.append(status, correctAnswer, explanation);
    }

    previousButton.disabled = currentIndex === 0;
    nextButton.disabled = currentIndex === questions.length - 1;
  }

  renderQuestion();
}

function showLegacyAttemptHistoryPage() {
  navigateTo({
    id: "device-attempt-history",
    title: "Device-local Attempts",
    render: renderLegacyAttemptHistoryPage
  });
}

function renderLegacyAttemptHistoryPage() {
  mainContent.replaceChildren();

  const header = document.createElement("header");
  header.className = "topbar";
  const headingGroup = document.createElement("div");
  const eyebrow = document.createElement("p");
  eyebrow.className = "eyebrow";
  eyebrow.textContent = "Device-local archive";
  const heading = document.createElement("h1");
  heading.textContent = "Older Attempt History";
  const subtitle = document.createElement("p");
  subtitle.className = "subtitle";
  subtitle.textContent = "These attempts remain in this browser only. They are not verified or linked to your account.";
  headingGroup.append(eyebrow, heading, subtitle);

  const backButton = document.createElement("button");
  backButton.type = "button";
  backButton.className = "mock-quiz-secondary-button";
  backButton.textContent = "Back";
  backButton.addEventListener("click", goBack);
  header.append(headingGroup, backButton);

  const listContainer = document.createElement("div");
  listContainer.className = "attempt-history-list";
  const historyEntries = loadAttemptHistory().slice().reverse();
  if (historyEntries.length === 0) {
    const empty = document.createElement("p");
    empty.className = "attempt-history-empty";
    empty.textContent = "No older device-local attempts are saved here.";
    listContainer.appendChild(empty);
  }

  historyEntries.forEach((entry) => {
    const card = document.createElement("article");
    card.className = "attempt-history-card";
    const title = document.createElement("h3");
    title.textContent = entry.testTitle || "Mock Test";
    const details = document.createElement("p");
    details.className = "attempt-history-meta";
    details.textContent = `${entry.examName || "Exam"} · ${formatAttemptHistoryDate(entry.submittedAt)} · Score ${entry.score ?? 0}/${entry.totalMarks ?? 0}`;
    const review = document.createElement("button");
    review.type = "button";
    review.className = "registration-submit";
    review.textContent = "Review device-local attempt";
    review.addEventListener("click", () => renderAttemptHistoryReview(entry));
    card.append(title, details, review);
    listContainer.appendChild(card);
  });

  const reviewPanel = document.createElement("div");
  reviewPanel.className = "attempt-history-review";
  reviewPanel.id = "attempt-history-review";
  const prompt = document.createElement("p");
  prompt.className = "attempt-history-review-empty";
  prompt.textContent = "Select a legacy attempt to review its saved result.";
  reviewPanel.appendChild(prompt);
  listContainer.appendChild(reviewPanel);
  mainContent.append(header, listContainer);
}

function renderAttemptHistoryReview(entry) {
  const reviewPanel = document.getElementById("attempt-history-review");
  if (!reviewPanel) {
    return;
  }

  reviewPanel.replaceChildren();
  const header = document.createElement("h3");
  header.textContent = `Review: ${entry.testTitle || "Mock Test"}`;
  reviewPanel.appendChild(header);

  if (!Array.isArray(entry.answers) || entry.answers.length === 0) {
    const emptyMessage = document.createElement("p");
    emptyMessage.className = "attempt-history-review-empty";
    emptyMessage.textContent = "No answer details were saved for this attempt.";
    reviewPanel.appendChild(emptyMessage);
    return;
  }

  renderQuestionReviewNavigation(reviewPanel, entry.answers, (answer, index) => {
    const item = document.createElement("li");
    item.className = "attempt-history-review-item mock-result-answer";

    const questionLabel = document.createElement("h4");
    questionLabel.textContent = `Question ${index + 1}: ${answer.question}`;

    const userAnswer = document.createElement("p");
    userAnswer.textContent = answer.selectedOption
      ? `Your answer: ${answer.selectedOption.key}. ${answer.selectedOption.text}`
      : "Your answer: Not answered";

    const correctAnswer = document.createElement("p");
    correctAnswer.textContent = answer.correctOption
      ? `Correct answer: ${answer.correctOption.key}. ${answer.correctOption.text}`
      : "Correct answer: Not available";

    const status = document.createElement("span");
    status.className =
      answer.isCorrect === true
        ? "mock-result-status correct"
        : answer.isCorrect === false
          ? "mock-result-status incorrect"
          : "mock-result-status unattempted";
    status.textContent =
      answer.isCorrect === true ? "Correct" : answer.isCorrect === false ? "Incorrect" : "Unattempted";

    const explanation = document.createElement("p");
    explanation.className = "attempt-history-explanation";
    explanation.textContent = answer.explanation || "No explanation provided.";

    item.append(questionLabel, status, userAnswer, correctAnswer, explanation);
    return item;
  });
}

function formatAttemptHistoryDate(isoDate) {
  if (!isoDate) {
    return "Recently";
  }

  try {
    const value = new Date(isoDate);
    if (Number.isNaN(value.getTime())) {
      return "Recently";
    }
    return value.toLocaleString([], {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit"
    });
  } catch (error) {
    return "Recently";
  }
}

function showLoginPage(options = {}) {
  showLoginPageRoute(options);
}

function showLoginPageRoute(options = {}) {
  navigateTo({
    id: "login",
    title: "Login",
    isAuth: true,
    render: renderLoginPage
  }, options);
}

function renderLoginPage() {
  mainContent.innerHTML = `
    <header class="auth-page-header">
      <div>
        <p class="eyebrow">Student Account</p>
        <h1>Login</h1>
        <p class="subtitle">Sign in to your ExamPlatform account.</p>
      </div>
    </header>

    <section class="registration-panel auth-panel">
      <form id="login-form">
        <label class="registration-field">
          <span>Email</span>
          <input name="email" type="email" maxlength="150" autocomplete="email" required>
        </label>
        <label class="registration-field">
          <span>Password</span>
          <input name="password" type="password" maxlength="128" autocomplete="current-password" required>
        </label>
        <p id="login-message" class="registration-message hidden" role="alert"></p>
        <button class="registration-submit" type="submit">Login</button>
      </form>
      <p class="auth-switch">New to ExamPlatform? <button type="button" id="show-registration" class="auth-link">Create an account</button></p>
      <button type="button" id="show-local-history" class="auth-history-button">View device-local Attempt History</button>
    </section>
  `;

  const form = document.getElementById("login-form");
  const message = document.getElementById("login-message");
  const submitButton = form.querySelector('button[type="submit"]');

  document.getElementById("show-registration").addEventListener("click", () => {
    showRegistrationPage();
  });
  document.getElementById("show-local-history").addEventListener("click", () => {
    showLegacyAttemptHistoryPage();
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    message.classList.add("hidden");

    const formData = new FormData(form);
    const email = formData.get("email");
    const password = formData.get("password");
    form.querySelector('[name="password"]').value = "";
    submitButton.disabled = true;

    try {
      const response = await fetch(`${API_BASE_URL}/auth/login`, {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ email, password })
      });
      const result = await response.json();

      if (!response.ok || !result.success || !result.authenticated || !result.data) {
        throw new Error(result.message || "Unable to log in.");
      }

      authenticatedUser = result.data;
      updateAuthenticatedUserUI();
      showDashboardPage({ replace: true });
    } catch (error) {
      message.textContent = error.message || "Unable to log in. Please try again.";
      message.classList.remove("hidden");
    } finally {
      form.reset();
      submitButton.disabled = false;
    }
  });
}

async function logout() {
  const logoutButton = Array.from(
    document.querySelectorAll(".profile-action-button")
  ).find((button) => button.textContent === "Log Out");
  if (logoutButton) {
    logoutButton.disabled = true;
  }

  try {
    const response = await fetch(`${API_BASE_URL}/auth/logout`, {
      method: "POST",
      credentials: "same-origin"
    });
    const result = await response.json();
    if (!response.ok || !result.success) {
      throw new Error(result.message || "Unable to log out.");
    }

    authenticatedUser = null;
    updateAuthenticatedUserUI();
    resetNavigation({
      id: "welcome",
      title: "Welcome",
      isAuth: true,
      render: renderWelcomePage
    });
  } catch (error) {
    console.error("Unable to log out:", error);
    let message = document.getElementById("logout-message");
    if (!message) {
      message = document.createElement("p");
      message.id = "logout-message";
      message.className = "registration-message";
      message.setAttribute("role", "alert");
      document.querySelector(".registered-profile").appendChild(message);
    }
    message.textContent = error.message || "Unable to log out. Please try again.";
    if (logoutButton) {
      logoutButton.disabled = false;
    }
  }
}

function showRegistrationPage() {
  if (authenticatedUser) {
    showProfilePage();
    return;
  }

  navigateTo({
    id: "register",
    title: "Create Account",
    isAuth: true,
    render: renderRegistrationPage
  });
}

function renderRegistrationPage() {
  mainContent.innerHTML = `
    <header class="auth-page-header">
      <div>
        <p class="eyebrow">Student Account</p>
        <h1>Create Account</h1>
        <p class="subtitle">Register to create your ExamPlatform student account.</p>
      </div>
    </header>

    <section class="registration-panel">
      <div id="registration-step"></div>
      <p class="auth-switch">Already have an account? <button type="button" id="show-login" class="auth-link">Login</button></p>
    </section>
  `;

  const registrationStep = document.getElementById("registration-step");
  document.getElementById("show-login").addEventListener("click", () => {
    showLoginPage();
  });

  function showMessage(element, text) {
    element.textContent = text;
    element.classList.remove("hidden");
  }

  function renderVerificationStep(email) {
    registrationStep.innerHTML = `
      <form id="registration-verification-form">
        <p class="registration-success" role="status">A verification code has been sent if this address can be registered.</p>
        <label class="registration-field">
          <span>Email verification code</span>
          <input name="otp" type="text" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required>
        </label>
        <p id="registration-verification-message" class="registration-message hidden" role="alert"></p>
        <button class="registration-submit" type="submit">Verify OTP</button>
        <button class="mock-quiz-secondary-button profile-action-button" id="resend-registration-code" type="button">Resend OTP</button>
      </form>
    `;

    const form = document.getElementById("registration-verification-form");
    const message = document.getElementById("registration-verification-message");
    const verifyButton = form.querySelector('button[type="submit"]');
    const resendButton = document.getElementById("resend-registration-code");

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      message.classList.add("hidden");
      verifyButton.disabled = true;
      resendButton.disabled = true;
      try {
        const response = await fetch(`${API_BASE_URL}/auth/register/verify`, {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email,
            otp: new FormData(form).get("otp")
          })
        });
        const result = await response.json();
        if (!response.ok || !result.success || !result.verified || !result.registrationToken) {
          throw new Error(result.message || "Unable to verify this email.");
        }
        renderPasswordStep(email, result.registrationToken);
      } catch (error) {
        showMessage(message, error.message || "Unable to verify this email.");
        verifyButton.disabled = false;
        resendButton.disabled = false;
      }
    });

    resendButton.addEventListener("click", async () => {
      message.classList.add("hidden");
      resendButton.disabled = true;
      try {
        const response = await fetch(`${API_BASE_URL}/auth/register/resend`, {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email })
        });
        const result = await response.json();
        if (!response.ok || !result.success) {
          throw new Error(result.message || "Unable to resend a verification code.");
        }
        showMessage(message, result.message);
      } catch (error) {
        showMessage(message, error.message || "Unable to resend a verification code.");
      } finally {
        resendButton.disabled = false;
      }
    });
  }

  function renderPasswordStep(email, registrationToken) {
    registrationStep.innerHTML = `
      <form id="registration-password-form">
        <p class="registration-success" role="status">Email verified. Create a password to finish your account.</p>
        <label class="registration-field">
          <span>Password</span>
          <input name="password" type="password" minlength="4" maxlength="128" autocomplete="new-password" required>
          <small>Use 4 to 128 characters.</small>
        </label>
        <label class="registration-field">
          <span>Confirm Password</span>
          <input name="confirmPassword" type="password" minlength="4" maxlength="128" autocomplete="new-password" required>
        </label>
        <p id="registration-password-message" class="registration-message hidden" role="alert"></p>
        <button class="registration-submit" type="submit">Create Account</button>
      </form>
    `;

    const form = document.getElementById("registration-password-form");
    const message = document.getElementById("registration-password-message");
    const submitButton = form.querySelector('button[type="submit"]');
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      message.classList.add("hidden");
      const formData = new FormData(form);
      const password = formData.get("password");
      const confirmPassword = formData.get("confirmPassword");
      if (password !== confirmPassword) {
        showMessage(message, "Passwords do not match.");
        return;
      }

      submitButton.disabled = true;
      try {
        const response = await fetch(`${API_BASE_URL}/auth/register/complete`, {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, registrationToken, password })
        });
        const result = await response.json();
        if (!response.ok || !result.success || !result.authenticated || !result.data) {
          throw new Error(result.message || "Unable to create account.");
        }

        authenticatedUser = result.data;
        updateAuthenticatedUserUI();
        registrationStep.innerHTML = `
          <div class="registration-success" role="status">
            <h2>Account created successfully</h2>
            <p>Your email is verified and you are signed in.</p>
            <button class="registration-submit" id="registration-return" type="button">Continue to Dashboard</button>
          </div>
        `;
        document.getElementById("registration-return").addEventListener("click", () => {
          showDashboardPage({ replace: true });
        });
      } catch (error) {
        showMessage(message, error.message || "Unable to create account. Please try again.");
        submitButton.disabled = false;
      } finally {
        form.querySelector('[name="password"]').value = "";
        form.querySelector('[name="confirmPassword"]').value = "";
      }
    });
  }

  registrationStep.innerHTML = `
    <form id="registration-form">
      <label class="registration-field">
        <span>Name</span>
        <input name="name" type="text" maxlength="100" autocomplete="name" required>
      </label>
      <label class="registration-field">
        <span>Email</span>
        <input name="email" type="email" maxlength="150" autocomplete="email" required>
      </label>
      <p id="registration-message" class="registration-message hidden" role="alert"></p>
      <button class="registration-submit" type="submit">Send OTP</button>
    </form>
  `;

  const form = document.getElementById("registration-form");
  const message = document.getElementById("registration-message");
  const submitButton = form.querySelector('button[type="submit"]');
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    message.classList.add("hidden");
    submitButton.disabled = true;
    const formData = new FormData(form);
    const name = formData.get("name");
    const email = formData.get("email");
    try {
      const response = await fetch(`${API_BASE_URL}/auth/register`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email })
      });
      const result = await response.json();
      if (!response.ok || !result.success || !result.verificationRequired) {
        throw new Error(result.message || "Unable to send a verification code.");
      }
      renderVerificationStep(email.trim().toLowerCase());
    } catch (error) {
      showMessage(message, error.message || "Unable to send a verification code.");
      submitButton.disabled = false;
    }
  });
}

// ================================
// Mock test selection and preview
// ================================

function showMockTestPage(options = {}) {
  navigateTo({
    id: "mock-tests",
    title: "Mock Tests",
    render: () => renderMockTestPage()
  }, options);
}

async function renderMockTestPage(exam = null) {

  mainContent.innerHTML = `
    <div class="topbar">
      <div>
        <p class="eyebrow">Mock Test</p>
        <h1>Choose a Mock Test</h1>
        <p class="subtitle">Select an exam and open a published test to view its details.</p>
      </div>
    </div>

    <section class="mock-test-section">
      <div class="mock-test-panel">
        <div class="mock-test-heading">
          <h2>${exam ? "Select an Exam" : "Choose an Exam"}</h2>
          <span id="mock-exam-status">Loading...</span>
        </div>
        <div id="mock-exam-list" class="mock-exam-list"></div>
      </div>

      <div id="mock-test-panel" class="mock-test-panel${exam ? "" : " hidden"}">
        <div class="mock-test-heading">
          <div>
            <h2 id="mock-tests-title">Available Tests</h2>
            <p id="mock-tests-subtitle" class="mock-test-subtitle"></p>
          </div>
          <span id="mock-test-status"></span>
        </div>
        <div id="mock-test-list" class="mock-test-list"></div>
      </div>

    </section>
  `;

  if (exam) {
    document.getElementById("mock-exam-status").textContent = exam.name;
    await loadMockTests(exam);
    return;
  }
  await loadMockTestExams();
}

async function loadMockTestExams() {
  const examList = document.getElementById("mock-exam-list");
  const examStatus = document.getElementById("mock-exam-status");

  try {
    const response = await fetch(`${API_BASE_URL}/exams`);
    if (!response.ok) {
      throw new Error("Failed to load exams");
    }

    const result = await response.json();
    const exams = result.data.filter((exam) => exam.is_active);

    examStatus.textContent = `${exams.length} Exams`;
    examList.replaceChildren();

    if (exams.length === 0) {
      examList.appendChild(createMockTestMessage("No active exams are available."));
      return;
    }

    exams.forEach((exam) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "mock-exam-button";
      button.textContent = exam.name;
      button.setAttribute("aria-pressed", "false");
      button.addEventListener("click", () => {
        navigateTo({
          id: `mock-exam-${exam.id}`,
          title: exam.name,
          render: () => renderMockTestPage(exam)
        });
      });
      examList.appendChild(button);
    });
  } catch (error) {
    console.error(error);
    examStatus.textContent = "Error";
    examList.replaceChildren(
      createMockTestMessage("Exams could not be loaded. Please check that the server is running.", true)
    );
  }
}

async function loadMockTests(exam) {
  const testPanel = document.getElementById("mock-test-panel");
  const testList = document.getElementById("mock-test-list");
  const testTitle = document.getElementById("mock-tests-title");
  const testSubtitle = document.getElementById("mock-tests-subtitle");
  const testStatus = document.getElementById("mock-test-status");

  testPanel.classList.remove("hidden");
  testTitle.textContent = "Available Tests";
  testSubtitle.textContent = exam.name;
  testStatus.textContent = "Loading...";
  testList.replaceChildren(createMockTestMessage("Loading published tests..."));

  try {
    const response = await fetch(
      `${API_BASE_URL}/exams/${encodeURIComponent(exam.id)}/tests`
    );
    if (!response.ok) {
      throw new Error("Failed to load mock tests");
    }

    const result = await response.json();
    testStatus.textContent = `${result.count} Tests`;
    testList.replaceChildren();

    if (result.data.length === 0) {
      testList.appendChild(
        createMockTestMessage(`No published mock tests are available for ${exam.name}.`)
      );
      return;
    }

    result.data.forEach((test) => {
      const card = document.createElement("article");
      card.className = "mock-test-card";

      const title = document.createElement("h3");
      title.textContent = test.title;

      const description = document.createElement("p");
      description.className = "mock-test-description";
      description.textContent = test.description || "Published mock test";

      const details = document.createElement("p");
      details.className = "mock-test-meta";
      details.textContent =
        `${test.total_questions} questions · ${test.duration_minutes} minutes · ${test.total_marks} marks`;

      const openButton = document.createElement("button");
      openButton.type = "button";
      openButton.className = "mock-test-open-button";
      openButton.textContent = "View test details";
      openButton.addEventListener("click", () => loadMockTestPreview(test.id, test.title));

      card.append(title, description, details, openButton);
      testList.appendChild(card);
    });
  } catch (error) {
    console.error(error);
    testStatus.textContent = "Error";
    testList.replaceChildren(
      createMockTestMessage("Published tests could not be loaded. Please try again.", true)
    );
  }
}

function loadMockTestPreview(testId, testTitle) {
  navigateTo({
    id: `mock-test-${testId}`,
    title: testTitle || "Mock Test",
    render: () => renderMockTestPreview(testId)
  });
}

async function renderMockTestPreview(testId) {
  mainContent.innerHTML = `<section class="mock-test-panel" id="mock-test-preview"></section>`;
  const preview = document.getElementById("mock-test-preview");
  preview.replaceChildren(createMockTestMessage("Loading test details..."));

  try {
    const response = await fetch(
      `${API_BASE_URL}/mock-tests/${encodeURIComponent(testId)}`
    );
    if (!response.ok) {
      throw new Error("Failed to load mock test details");
    }

    const result = await response.json();
    const test = result.data;
    preview.replaceChildren();

    const heading = document.createElement("div");
    heading.className = "mock-test-heading";

    const titleGroup = document.createElement("div");
    const eyebrow = document.createElement("p");
    eyebrow.className = "eyebrow";
    eyebrow.textContent = test.examName;

    const title = document.createElement("h2");
    title.textContent = test.title;
    titleGroup.append(eyebrow, title);

    const meta = document.createElement("span");
    meta.className = "mock-test-preview-meta";
    meta.textContent =
      `${test.totalQuestions} questions · ${test.durationMinutes} minutes · ${test.totalMarks} marks`;
    heading.append(titleGroup, meta);
    preview.appendChild(heading);

    if (test.description) {
      const description = document.createElement("p");
      description.className = "mock-test-description";
      description.textContent = test.description;
      preview.appendChild(description);
    }

    const questionHeading = document.createElement("h3");
    questionHeading.className = "mock-test-question-heading";
    questionHeading.textContent = "Included questions";
    preview.appendChild(questionHeading);

    const questionList = document.createElement("ol");
    questionList.className = "mock-test-question-list";

    test.questions.forEach((question) => {
      const questionItem = document.createElement("li");
      const questionText = document.createElement("p");
      questionText.className = "mock-test-question-text";
      questionText.textContent = question.text;

      const context = [question.subject, question.topic].filter(Boolean).join(" · ");
      if (context) {
        const questionContext = document.createElement("p");
        questionContext.className = "mock-test-question-context";
        questionContext.textContent = context;
        questionItem.appendChild(questionContext);
      }

      const options = document.createElement("ul");
      options.className = "mock-test-option-list";
      question.options.forEach((option) => {
        const optionItem = document.createElement("li");
        optionItem.textContent = `${option.key}. ${option.text}`;
        options.appendChild(optionItem);
      });

      questionItem.append(questionText, options);
      questionList.appendChild(questionItem);
    });

    preview.appendChild(questionList);

    const startButton = document.createElement("button");
    startButton.type = "button";
    startButton.className = "mock-test-start-button";
    startButton.textContent = "Start Test";
    startButton.addEventListener("click", async () => {
      startButton.disabled = true;
      try {
        const startResponse = await fetch(
          `${API_BASE_URL}/mock-tests/${encodeURIComponent(test.id)}/start`,
          { method: "POST", credentials: "same-origin" }
        );
        const startResult = await startResponse.json();
        if (
          !startResponse.ok ||
          !startResult.success ||
          typeof startResult.attemptToken !== "string" ||
          !Number.isSafeInteger(startResult.deadline)
        ) {
          throw new Error(startResult.message || "This test could not be started.");
        }
        startMockTest(test, startResult.attemptToken, startResult.deadline);
      } catch (error) {
        console.error("Unable to start mock test:", error);
        preview.appendChild(
          createMockTestMessage(
            error.message || "This test could not be started. Please try again.",
            true
          )
        );
        startButton.disabled = false;
      }
    });
    preview.appendChild(startButton);
  } catch (error) {
    console.error(error);
    preview.replaceChildren(
      createMockTestMessage("Test details could not be loaded. Please try again.", true)
    );
  }
}

function startMockTest(test, attemptToken, deadline) {
  const durationSeconds = Number(test.durationMinutes) * 60;
  if (
    !Array.isArray(test.questions) ||
    test.questions.length === 0 ||
    !Number.isFinite(durationSeconds) ||
    durationSeconds <= 0
  ) {
    document.getElementById("mock-test-preview").appendChild(
      createMockTestMessage("This test has no questions or a valid duration and cannot be started.", true)
    );
    return;
  }

  clearSavedMockTestResult();
  clearMockTestSession();
  activeMockTestSession = {
    test,
    attemptToken,
    answers: new Map(),
    markedForReview: new Set(),
    currentQuestionIndex: 0,
    remainingSeconds: Math.max(0, Math.ceil((deadline - Date.now()) / 1000)),
    endsAt: deadline,
    expired: false
  };

  navigateTo({
    id: `mock-test-session-${test.id}`,
    title: test.title,
    render: renderMockTestSession
  });
  mockTestTimerInterval = window.setInterval(tickMockTestTimer, 1000);
}

function tickMockTestTimer() {
  if (!activeMockTestSession) {
    clearMockTestSession();
    return;
  }

  activeMockTestSession.remainingSeconds = Math.max(
    0,
    Math.ceil((activeMockTestSession.endsAt - Date.now()) / 1000)
  );

  const timer = document.getElementById("mock-quiz-timer");
  if (timer) {
    timer.textContent = formatMockTestTime(
      activeMockTestSession.remainingSeconds
    );
  }

  if (activeMockTestSession.remainingSeconds === 0) {
    activeMockTestSession.expired = true;
    window.clearInterval(mockTestTimerInterval);
    mockTestTimerInterval = null;

    const notice = document.getElementById("mock-quiz-notice");
    if (notice) {
      notice.textContent = "Time is up. Your answers are being submitted.";
      notice.classList.remove("hidden");
    }

    document
      .querySelectorAll(".mock-quiz-option")
      .forEach((option) => {
        option.disabled = true;
      });
    submitMockTest({ automatic: true });
  }
}

function renderMockTestSession() {
  const session = activeMockTestSession;
  if (!session) {
    return;
  }

  const { test, answers, currentQuestionIndex } = session;
  const markedForReview = session.markedForReview;
  const question = test.questions[currentQuestionIndex];
  const mainContent = document.querySelector(".main-content");
  const answeredCount = answers.size;
  const markedCount = markedForReview.size;
  const currentQuestionId = String(question.id);
  const currentQuestionMarked = markedForReview.has(currentQuestionId);

  mainContent.innerHTML = `
    <div class="mock-quiz-header">
      <div>
        <p class="eyebrow">${escapeHtml(test.examName)}</p>
        <h1>${escapeHtml(test.title)}</h1>
        <p class="subtitle">Question ${currentQuestionIndex + 1} of ${test.questions.length}</p>
      </div>
      <div class="mock-quiz-header-actions">
        <div class="mock-quiz-timer-wrap" role="timer">
          <span>Time remaining</span>
          <strong id="mock-quiz-timer">${formatMockTestTime(session.remainingSeconds)}</strong>
        </div>
        <button type="button" id="mock-quiz-exit" class="mock-quiz-exit-button">Exit test</button>
      </div>
    </div>

    <p id="mock-quiz-notice" class="mock-quiz-notice hidden" role="status"></p>

    <section class="mock-quiz-layout">
      <article class="mock-quiz-question-panel">
        <div class="mock-quiz-question-meta">
          <span>${answeredCount} of ${test.questions.length} answered</span>
          <span>${escapeHtml(question.subject || "")}${question.subject && question.topic ? " · " : ""}${escapeHtml(question.topic || "")}</span>
        </div>
        <h2 id="mock-quiz-question">${escapeHtml(question.text)}</h2>
        <div id="mock-quiz-options" class="mock-quiz-options"></div>
        <button
          type="button"
          id="mock-quiz-mark-review"
          class="mock-quiz-mark-review-button${currentQuestionMarked ? " is-marked" : ""}"
          aria-pressed="${currentQuestionMarked}"
          ${session.expired || session.submitting ? "disabled" : ""}
        >
          ${currentQuestionMarked ? "Remove Review Mark" : "Mark for Review"}
        </button>
        <div class="mock-quiz-navigation">
          <button type="button" id="mock-quiz-previous" class="mock-quiz-secondary-button">Previous</button>
          <button
            type="button"
            id="mock-quiz-next"
            class="${currentQuestionIndex === test.questions.length - 1 ? "mock-quiz-submit-button" : "mock-quiz-next-button"}"
          >
            ${currentQuestionIndex === test.questions.length - 1 ? "Submit Test" : "Next"}
          </button>
        </div>
        <p id="mock-quiz-submit-error" class="mock-quiz-submit-error hidden" role="alert"></p>
      </article>

      <aside class="mock-quiz-palette-panel">
        <h2>Question palette</h2>
        <p class="mock-quiz-palette-summary">${answeredCount} answered · ${test.questions.length - answeredCount} unanswered · ${markedCount} marked for review</p>
        <div id="mock-quiz-palette" class="mock-quiz-palette"></div>
        <div class="mock-quiz-legend">
          <span><i class="answered"></i> Answered</span>
          <span><i class="unanswered"></i> Unanswered</span>
          <span><i class="marked"></i> Marked for review</span>
          <span><i class="answered-marked"></i> Answered + marked</span>
          <span><i class="current"></i> Current</span>
        </div>
      </aside>
    </section>
  `;

  const optionsContainer = document.getElementById("mock-quiz-options");
  const selectedOptionId = answers.get(String(question.id));
  question.options.forEach((option) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "mock-quiz-option";
    if (String(option.id) === String(selectedOptionId)) {
      button.classList.add("selected");
    }
    button.setAttribute(
      "aria-pressed",
      String(String(option.id) === String(selectedOptionId))
    );
    button.disabled = session.expired || session.submitting;

    const key = document.createElement("span");
    key.className = "mock-quiz-option-key";
    key.textContent = option.key;
    const text = document.createElement("span");
    text.textContent = option.text;
    button.append(key, text);
    button.addEventListener("click", () => {
      if (!activeMockTestSession || activeMockTestSession.expired) {
        return;
      }
      activeMockTestSession.answers.set(String(question.id), String(option.id));
      renderMockTestSession();
    });
    optionsContainer.appendChild(button);
  });

  document.getElementById("mock-quiz-mark-review").addEventListener("click", () => {
    if (!activeMockTestSession || activeMockTestSession.expired || activeMockTestSession.submitting) {
      return;
    }
    const questionId = String(question.id);
    if (activeMockTestSession.markedForReview.has(questionId)) {
      activeMockTestSession.markedForReview.delete(questionId);
    } else {
      activeMockTestSession.markedForReview.add(questionId);
    }
    renderMockTestSession();
  });

  const palette = document.getElementById("mock-quiz-palette");
  test.questions.forEach((paletteQuestion, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "mock-quiz-palette-button";
    const questionId = String(paletteQuestion.id);
    const answered = answers.has(questionId);
    const marked = markedForReview.has(questionId);
    if (answered && marked) {
      button.classList.add("answered-marked");
    } else if (answered) {
      button.classList.add("answered");
    } else if (marked) {
      button.classList.add("marked");
    } else {
      button.classList.add("unanswered");
    }
    if (index === currentQuestionIndex) {
      button.classList.add("current");
      button.setAttribute("aria-current", "true");
    }
    button.textContent = String(index + 1);
    button.setAttribute(
      "aria-label",
      `Question ${index + 1}, ${answered ? "answered" : "unanswered"}${marked ? ", marked for review" : ""}${index === currentQuestionIndex ? ", current" : ""}`
    );
    button.disabled = session.submitting;
    button.addEventListener("click", () => {
      activeMockTestSession.currentQuestionIndex = index;
      renderMockTestSession();
    });
    palette.appendChild(button);
  });

  document.getElementById("mock-quiz-previous").disabled =
    currentQuestionIndex === 0 || session.submitting;
  document.getElementById("mock-quiz-next").disabled = session.submitting;
  document.getElementById("mock-quiz-previous").addEventListener("click", () => {
    if (activeMockTestSession.currentQuestionIndex > 0) {
      activeMockTestSession.currentQuestionIndex -= 1;
      renderMockTestSession();
    }
  });
  document.getElementById("mock-quiz-next").addEventListener("click", () => {
    if (currentQuestionIndex === test.questions.length - 1) {
      submitMockTest();
      return;
    }

    if (
      activeMockTestSession.currentQuestionIndex <
      activeMockTestSession.test.questions.length - 1
    ) {
      activeMockTestSession.currentQuestionIndex += 1;
      renderMockTestSession();
    }
  });
  document.getElementById("mock-quiz-exit").addEventListener("click", () => {
    if (activeMockTestSession.submitting) {
      return;
    }

    const shouldLeave = window.confirm(
      "Exit this test? Your answers from this session will be lost. Nothing will be submitted."
    );
    if (shouldLeave) {
      clearMockTestSession();
      goBack();
    }
  });

  document.getElementById("mock-quiz-exit").disabled = session.submitting;

  if (session.submissionError) {
    const errorMessage = document.getElementById("mock-quiz-submit-error");
    errorMessage.textContent = session.submissionError;
    errorMessage.classList.remove("hidden");
  }

  if (session.expired) {
    const notice = document.getElementById("mock-quiz-notice");
    notice.textContent = session.submitting
      ? "Time is up. Your answers are being submitted."
      : "Time is up. Your answers could not be submitted. Please try again.";
    notice.classList.remove("hidden");
  }
}

async function submitMockTest({ automatic = false } = {}) {
  const session = activeMockTestSession;
  if (!session || session.submitting || session.completed) {
    return;
  }

  if (!automatic) {
    const unansweredCount = session.test.questions.length - session.answers.size;
    const confirmationMessage =
      unansweredCount > 0
        ? `Submit this test with ${unansweredCount} unanswered question${unansweredCount === 1 ? "" : "s"}?`
        : "Submit this test now?";
    if (!window.confirm(confirmationMessage)) {
      return;
    }
  }

  const autoSubmitting = automatic || Date.now() >= session.endsAt;
  if (autoSubmitting) {
    session.expired = true;
  }
  session.submitting = true;
  session.submissionError = null;
  renderMockTestSession();

  const answers = session.test.questions.map((question) => ({
    questionId: question.id,
    selectedOptionId: session.answers.has(String(question.id))
      ? session.answers.get(String(question.id))
      : null
  }));

  try {
    const response = await fetch(`${API_BASE_URL}/results`, {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        mockTestId: session.test.id,
        attemptToken: session.attemptToken,
        autoSubmit: autoSubmitting,
        answers
      })
    });
    const result = await response.json();

    if (!response.ok || !result.success || !result.data) {
      throw new Error(result.message || "The test could not be submitted. Please try again.");
    }

    const resultSaved = saveMockTestResult(session.test, result.data);
    if (!result.data.accountOwned) {
      appendAttemptHistoryEntry(session.test, result.data);
    }
    session.completed = true;
    clearMockTestSession();
    navigateTo({
      id: `mock-test-result-${session.test.id}`,
      title: "Test Result",
      render: () => renderMockTestResult(session.test, result.data, !resultSaved)
    }, { replace: true });
  } catch (error) {
    console.error("Mock test submission failed:", error);
    session.submitting = false;
    session.submissionError =
      error.message || "The test could not be submitted. Your answers are still available.";
    renderMockTestSession();
  }
}

function renderMockTestResult(test, result, persistenceUnavailable = false) {
  mainContent.replaceChildren();

  const header = document.createElement("div");
  header.className = "mock-result-header";

  const titleGroup = document.createElement("div");
  const eyebrow = document.createElement("p");
  eyebrow.className = "eyebrow";
  eyebrow.textContent = test.examName;
  const title = document.createElement("h1");
  title.textContent = "Test Result";
  const testTitle = document.createElement("p");
  testTitle.className = "subtitle";
  testTitle.textContent = test.title;
  titleGroup.append(eyebrow, title, testTitle);

  const returnButton = document.createElement("button");
  returnButton.type = "button";
  returnButton.className = "mock-quiz-secondary-button";
  returnButton.textContent = "Back to Mock Tests";
  returnButton.addEventListener("click", () => {
    clearSavedMockTestResult();
    goBack();
  });
  header.append(titleGroup, returnButton);
  mainContent.appendChild(header);

  if (persistenceUnavailable) {
    const notice = document.createElement("p");
    notice.className = "mock-result-persistence-notice";
    notice.setAttribute("role", "status");
    notice.textContent =
      "This result could not be saved for refresh in this tab. Keep this page open to view it.";
    mainContent.appendChild(notice);
  }

  const summary = document.createElement("section");
  summary.className = "mock-result-summary";
  const scoreValue = document.createElement("strong");
  scoreValue.textContent = `${result.score} / ${test.totalMarks}`;
  const scoreLabel = document.createElement("span");
  scoreLabel.textContent = "Score";
  const scoreCard = document.createElement("article");
  scoreCard.className = "mock-result-score";
  scoreCard.append(scoreValue, scoreLabel);
  summary.appendChild(scoreCard);

  const metrics = [
    ["Total questions", result.totalQuestions],
    ["Attempted", result.attemptedQuestions],
    ["Correct", result.correctAnswers],
    ["Incorrect", result.wrongAnswers],
    ["Unattempted", result.skippedQuestions],
    ["Accuracy", `${result.accuracy}%`]
  ];
  metrics.forEach(([label, value]) => {
    const card = document.createElement("article");
    card.className = "mock-result-metric";
    const metricValue = document.createElement("strong");
    metricValue.textContent = String(value);
    const metricLabel = document.createElement("span");
    metricLabel.textContent = label;
    card.append(metricValue, metricLabel);
    summary.appendChild(card);
  });
  mainContent.appendChild(summary);

  const reviewPanel = document.createElement("section");
  reviewPanel.className = "mock-result-review";
  const reviewHeading = document.createElement("h2");
  reviewHeading.textContent = "Question-wise result";
  reviewPanel.appendChild(reviewHeading);
  if (result.accountOwned) {
    appendWrongQuestionPracticeAction(
      reviewPanel,
      result.attemptId,
      result.wrongAnswers,
      test.title
    );
  }

  renderQuestionReviewNavigation(reviewPanel, result.answers, (answer, index) => {
    const item = document.createElement("li");
    item.className = "mock-result-answer";

    const itemHeader = document.createElement("div");
    itemHeader.className = "mock-result-answer-heading";
    const questionTitle = document.createElement("h3");
    questionTitle.textContent = `Question ${index + 1}: ${answer.question}`;
    const status = document.createElement("span");
    status.className =
      answer.isCorrect === true
        ? "mock-result-status correct"
        : answer.isCorrect === false
          ? "mock-result-status incorrect"
          : "mock-result-status unattempted";
    status.textContent =
      answer.isCorrect === true
        ? "Correct"
        : answer.isCorrect === false
          ? "Incorrect"
          : "Unattempted";
    itemHeader.append(questionTitle, status);

    const userAnswer = document.createElement("p");
    userAnswer.textContent = answer.selectedOption
      ? `Your answer: ${answer.selectedOption.key}. ${answer.selectedOption.text}`
      : "Your answer: Not answered";

    const correctAnswer = document.createElement("p");
    correctAnswer.textContent = answer.correctOption
      ? `Correct answer: ${answer.correctOption.key}. ${answer.correctOption.text}`
      : "Correct answer: Not available";

    const explanation = document.createElement("p");
    explanation.className = "mock-result-explanation";
    explanation.textContent = answer.explanation || "No explanation provided.";

    item.append(itemHeader, userAnswer, correctAnswer, explanation);
    return item;
  });
  mainContent.appendChild(reviewPanel);
}

function saveMockTestResult(test, result) {
  try {
    window.sessionStorage.setItem(
      MOCK_TEST_RESULT_STORAGE_KEY,
      JSON.stringify({ version: 1, test, result })
    );
    return true;
  } catch (error) {
    console.error("Unable to save completed mock test result:", error);
    return false;
  }
}

function appendAttemptHistoryEntry(test, result) {
  try {
    const existingHistory = loadAttemptHistory();
    const historyEntry = {
      id: result.attemptId ? String(result.attemptId) : `attempt-${Date.now()}`,
      submittedAt: result.submittedAt || new Date().toISOString(),
      examName: test.examName || "Exam",
      testTitle: test.title || "Mock Test",
      totalQuestions: Number(result.totalQuestions || test.questions?.length || 0),
      totalMarks: Number(test.totalMarks || 0),
      score: Number(result.score || 0),
      accuracy: Number(result.accuracy || 0),
      correctAnswers: Number(result.correctAnswers || 0),
      wrongAnswers: Number(result.wrongAnswers || 0),
      skippedQuestions: Number(result.skippedQuestions || 0),
      answers: Array.isArray(result.answers) ? result.answers : []
    };

    const nextHistory = [...existingHistory, historyEntry].slice(-25);
    saveAttemptHistory(nextHistory);
  } catch (error) {
    console.error("Unable to append device-local attempt history:", error);
  }
}

function clearSavedMockTestResult() {
  try {
    window.sessionStorage.removeItem(MOCK_TEST_RESULT_STORAGE_KEY);
  } catch (error) {
    console.error("Unable to clear saved mock test result:", error);
  }
}

function restoreSavedMockTestResult() {
  let savedResult;
  try {
    const savedValue = window.sessionStorage.getItem(
      MOCK_TEST_RESULT_STORAGE_KEY
    );
    if (!savedValue) {
      return;
    }

    savedResult = JSON.parse(savedValue);
  } catch (error) {
    console.error("Unable to read saved mock test result:", error);
    clearSavedMockTestResult();
    return;
  }

  if (
    !savedResult ||
    typeof savedResult !== "object" ||
    savedResult.version !== 1 ||
    !savedResult.test ||
    !Array.isArray(savedResult.test.questions) ||
    !savedResult.result ||
    !Array.isArray(savedResult.result.answers)
  ) {
    console.error("Saved mock test result has an invalid format");
    clearSavedMockTestResult();
    return;
  }

  resetNavigation({
    id: `mock-test-result-${savedResult.test.id}`,
    title: "Test Result",
    render: () => renderMockTestResult(savedResult.test, savedResult.result)
  });
}

function clearMockTestSession() {
  if (mockTestTimerInterval !== null) {
    window.clearInterval(mockTestTimerInterval);
    mockTestTimerInterval = null;
  }
  activeMockTestSession = null;
}

function formatMockTestTime(totalSeconds) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => {
    const entities = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    };
    return entities[character];
  });
}

function createMockTestMessage(message, isError = false) {
  const element = document.createElement("p");
  element.className = isError ? "mock-test-message error" : "mock-test-message";
  element.textContent = message;
  return element;
}

// ================================
// Practice page
// ================================

function showPracticePage(options = {}) {
  navigateTo({
    id: "practice",
    title: "Practice",
    requiresAuth: true,
    render: renderPracticePage
  }, options);
}

async function renderPracticePage() {
  const state = {
    exam: null,
    subject: null,
    topic: null,
    readySession: null
  };

  mainContent.innerHTML = `
    <header class="topbar">
      <div>
        <p class="eyebrow">Practice</p>
        <h1>Practice Questions</h1>
        <p class="subtitle">Select an exam, subject and topic to prepare.</p>
      </div>
    </header>
    <section class="practice-section">
      <div class="selection-card">
        <div class="selection-header">
          <h2>Select Exam</h2>
          <span id="exam-status" role="status">Loading exams...</span>
        </div>
        <div id="exam-list" class="selection-grid"></div>
      </div>
      <div id="subject-section" class="selection-card hidden">
        <div class="selection-header">
          <h2>Select Subject</h2>
          <span id="subject-status" role="status"></span>
        </div>
        <div id="subject-list" class="selection-grid"></div>
      </div>
      <div id="topic-section" class="selection-card hidden">
        <div class="selection-header">
          <h2>Select Topic</h2>
          <span id="topic-status" role="status"></span>
        </div>
        <div id="topic-list" class="topic-grid"></div>
      </div>
      <section id="practice-options" class="selection-card hidden" aria-labelledby="practice-options-heading">
        <h2 id="practice-options-heading">Practice options</h2>
        <div class="practice-filters">
          <label>
            Difficulty
            <select id="practice-difficulty">
              <option value="">All</option>
              <option value="easy">Easy</option>
              <option value="medium">Medium</option>
              <option value="hard">Hard</option>
            </select>
          </label>
          <label>
            Language
            <select id="practice-language">
              <option value="">All</option>
              <option value="hi">Hindi</option>
              <option value="en">English</option>
            </select>
          </label>
        </div>
        <button id="start-practice" type="button" class="registration-submit" disabled>Start Practice</button>
        <p id="practice-status" class="practice-status" role="status" aria-live="polite"></p>
      </section>
    </section>
  `;

  const examList = document.getElementById("exam-list");
  const examStatus = document.getElementById("exam-status");
  const subjectSection = document.getElementById("subject-section");
  const subjectList = document.getElementById("subject-list");
  const subjectStatus = document.getElementById("subject-status");
  const topicSection = document.getElementById("topic-section");
  const topicList = document.getElementById("topic-list");
  const topicStatus = document.getElementById("topic-status");
  const practiceOptions = document.getElementById("practice-options");
  const startButton = document.getElementById("start-practice");
  const practiceStatus = document.getElementById("practice-status");

  document.getElementById("practice-difficulty").addEventListener("change", clearReadyState);
  document.getElementById("practice-language").addEventListener("change", clearReadyState);
  startButton.addEventListener("click", startPractice);
  await loadExams();

  async function loadExams() {
    examStatus.textContent = "Loading exams...";
    examList.replaceChildren();
    try {
      const result = await fetchPracticeSelectionData(`${API_BASE_URL}/exams`);
      const exams = result.data.filter((exam) => exam.is_active);
      examStatus.textContent = `${exams.length} exams`;
      if (exams.length === 0) {
        examList.appendChild(createPracticeMessage("No active exams are available."));
        return;
      }
      exams.forEach((exam) => {
        examList.appendChild(createPracticeSelectionButton(
          exam.name,
          exam.description || "Practice this exam",
          () => selectExam(exam)
        ));
      });
    } catch (error) {
      console.error("Unable to load Practice exams:", error);
      examStatus.textContent = "Unable to load exams";
      examList.appendChild(createPracticeMessage(error.message, true));
    }
  }

  async function selectExam(exam) {
    state.exam = exam;
    state.subject = null;
    state.topic = null;
    clearReadyState();
    topicSection.classList.add("hidden");
    practiceOptions.classList.add("hidden");
    subjectSection.classList.remove("hidden");
    subjectStatus.textContent = "Loading subjects...";
    subjectList.replaceChildren(createPracticeMessage("Loading subjects..."));
    try {
      const result = await fetchPracticeSelectionData(`${API_BASE_URL}/subjects`);
      const subjects = result.data.filter(
        (subject) => String(subject.exam_id) === String(exam.id) && subject.is_active
      );
      subjectStatus.textContent = `${subjects.length} subjects`;
      subjectList.replaceChildren();
      if (subjects.length === 0) {
        subjectList.appendChild(createPracticeMessage(`No active subjects found for ${exam.name}.`));
        return;
      }
      subjects.forEach((subject) => {
        subjectList.appendChild(createPracticeSelectionButton(
          subject.name,
          subject.description || "Practice this subject",
          () => selectSubject(subject)
        ));
      });
    } catch (error) {
      console.error("Unable to load Practice subjects:", error);
      subjectStatus.textContent = "Unable to load subjects";
      subjectList.replaceChildren(createPracticeMessage(error.message, true));
    }
  }

  async function selectSubject(subject) {
    state.subject = subject;
    state.topic = null;
    clearReadyState();
    topicSection.classList.remove("hidden");
    practiceOptions.classList.add("hidden");
    topicStatus.textContent = "Loading topics...";
    topicList.replaceChildren(createPracticeMessage("Loading topics..."));
    try {
      const result = await fetchPracticeSelectionData(`${API_BASE_URL}/topics`);
      const topics = result.data.filter(
        (topic) => String(topic.subject_id) === String(subject.id) && topic.is_active
      );
      topicStatus.textContent = `${topics.length} topics`;
      topicList.replaceChildren();
      if (topics.length === 0) {
        topicList.appendChild(createPracticeMessage(`No active topics found for ${subject.name}.`));
        return;
      }
      topics.forEach((topic) => {
        topicList.appendChild(createPracticeSelectionButton(
          topic.name,
          topic.description || "Select this topic",
          () => selectTopic(topic)
        ));
      });
    } catch (error) {
      console.error("Unable to load Practice topics:", error);
      topicStatus.textContent = "Unable to load topics";
      topicList.replaceChildren(createPracticeMessage(error.message, true));
    }
  }

  function selectTopic(topic) {
    state.topic = topic;
    clearReadyState();
    practiceOptions.classList.remove("hidden");
    startButton.disabled = !hasValidPracticeSelection();
  }

  function hasValidPracticeSelection() {
    return Boolean(state.exam && state.subject && state.topic);
  }

  function clearReadyState() {
    state.readySession = null;
    practiceStatus.textContent = "";
    if (startButton) {
      startButton.disabled = !hasValidPracticeSelection();
    }
  }

  async function startPractice() {
    if (!hasValidPracticeSelection() || startButton.disabled) {
      return;
    }

    const query = new URLSearchParams({
      examId: String(state.exam.id),
      sectionId: String(state.subject.id),
      topicId: String(state.topic.id)
    });
    const difficulty = document.getElementById("practice-difficulty").value;
    const language = document.getElementById("practice-language").value;
    if (difficulty) {
      query.set("difficulty", difficulty);
    }
    if (language) {
      query.set("language", language);
    }

    startButton.disabled = true;
    practiceStatus.className = "practice-status";
    practiceStatus.textContent = "Loading practice questions...";
    try {
      const response = await fetch(
        `${API_BASE_URL}/practice/questions?${query.toString()}`,
        { credentials: "same-origin" }
      );
      const result = await response.json();
      if (response.status === 401) {
        authenticatedUser = null;
        updateAuthenticatedUserUI();
        resetNavigation({
          id: "welcome",
          title: "Welcome",
          isAuth: true,
          render: renderWelcomePage
        });
        return;
      }
      if (!response.ok || !result.success || !Array.isArray(result.data)) {
        throw new Error(result.message || "Practice questions could not be loaded.");
      }
      if (result.data.length === 0) {
        practiceStatus.textContent = "No questions match these selections. Adjust the filters and try again.";
        return;
      }

      preparePracticeRunner(result.data, {
        exam: state.exam,
        subject: state.subject,
        topic: state.topic,
        difficulty,
        language
      });
    } catch (error) {
      console.error("Unable to start Practice question loading:", error);
      practiceStatus.className = "practice-status error";
      practiceStatus.textContent = error.message || "Practice questions could not be loaded.";
    } finally {
      if (mainContent.contains(startButton)) {
        startButton.disabled = !hasValidPracticeSelection();
      }
    }
  }

  function preparePracticeRunner(questions, selection) {
    const invalidQuestionIndex = questions.findIndex(
      (question) => !isValidPracticeQuestion(question)
    );
    if (invalidQuestionIndex !== -1) {
      practiceStatus.className = "practice-status error";
      practiceStatus.textContent =
        "Some practice questions are incomplete and cannot be started. Please try again later.";
      return;
    }

    state.readySession = { questions, selection };
    navigateTo({
      id: "practice-runner",
      title: "Practice Questions",
      requiresAuth: true,
      render: () => renderPracticeQuestionRunner(state.readySession)
    });
  }
}

function isValidPracticeQuestion(question) {
  return Boolean(
    question &&
    typeof question.id === "string" &&
    question.id &&
    typeof question.question === "string" &&
    question.question.trim() &&
    Array.isArray(question.options) &&
    question.options.length > 0 &&
    question.options.every((option) =>
      option &&
      typeof option.id === "string" &&
      option.id &&
      typeof option.key === "string" &&
      option.key &&
      typeof option.text === "string" &&
      option.text
    ) &&
    question.correctAnswer &&
    typeof question.correctAnswer.id === "string" &&
    typeof question.correctAnswer.key === "string" &&
    typeof question.correctAnswer.text === "string" &&
    question.options.some(
      (option) =>
        option.id === question.correctAnswer.id &&
        option.key === question.correctAnswer.key &&
        option.text === question.correctAnswer.text
    )
  );
}

function renderPracticeQuestionRunner(session) {
  if (!session || !Array.isArray(session.questions) || !session.questions.length) {
    mainContent.replaceChildren(createPracticeMessage(
      "Practice questions are unavailable. Return to selections and try again.",
      true
    ));
    return;
  }

  const { questions, selection } = session;
  const selectedAnswers = new Map();
  let currentIndex = 0;

  const header = document.createElement("header");
  header.className = "mock-result-header";
  const headingGroup = document.createElement("div");
  const eyebrow = document.createElement("p");
  eyebrow.className = "eyebrow";
  eyebrow.textContent = selection.exam.name;
  const title = document.createElement("h1");
  title.textContent = "Practice Questions";
  const subtitle = document.createElement("p");
  subtitle.className = "subtitle";
  subtitle.textContent = `${selection.subject.name} · ${selection.topic.name}`;
  headingGroup.append(eyebrow, title, subtitle);

  const backButton = document.createElement("button");
  backButton.type = "button";
  backButton.className = "mock-quiz-secondary-button";
  backButton.textContent = "Back to Selections";
  backButton.addEventListener("click", () => showPracticePage({ replace: true }));
  header.append(headingGroup, backButton);

  const runner = document.createElement("section");
  runner.className = "mock-result-review practice-runner";
  const progress = document.createElement("p");
  progress.className = "mock-review-current";
  progress.setAttribute("aria-live", "polite");
  const questionTitle = document.createElement("h2");
  questionTitle.className = "wrong-practice-question";
  const metadata = document.createElement("p");
  metadata.className = "mock-review-current";
  const options = document.createElement("div");
  options.className = "wrong-practice-options";
  const feedback = document.createElement("section");
  feedback.className = "wrong-practice-feedback";
  feedback.setAttribute("aria-live", "polite");
  const controls = document.createElement("div");
  controls.className = "mock-review-step-controls";
  const previousButton = document.createElement("button");
  previousButton.type = "button";
  previousButton.className = "mock-quiz-secondary-button";
  previousButton.textContent = "Previous";
  previousButton.addEventListener("click", () => {
    if (currentIndex > 0) {
      currentIndex -= 1;
      renderQuestion();
    }
  });
  const nextButton = document.createElement("button");
  nextButton.type = "button";
  nextButton.className = "mock-quiz-secondary-button";
  nextButton.addEventListener("click", () => {
    if (currentIndex === questions.length - 1) {
      renderPracticeComplete(session, selectedAnswers);
      return;
    }
    currentIndex += 1;
    renderQuestion();
  });
  controls.append(previousButton, nextButton);
  runner.append(progress, questionTitle, metadata, options, feedback, controls);
  mainContent.replaceChildren(header, runner);

  function renderQuestion() {
    const question = questions[currentIndex];
    const questionId = String(question.id);
    const selectedOptionId = selectedAnswers.get(questionId);
    progress.textContent = `Question ${currentIndex + 1} of ${questions.length}`;
    questionTitle.textContent = question.question;
    metadata.textContent = [
      question.section,
      question.topic,
      question.difficulty,
      question.language === "hi" ? "Hindi" : "English"
    ].filter(Boolean).join(" · ");
    options.replaceChildren();

    question.options.forEach((option) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "wrong-practice-option";
      button.setAttribute("aria-pressed", String(option.id === selectedOptionId));
      const key = document.createElement("strong");
      key.textContent = option.key;
      const text = document.createElement("span");
      text.textContent = option.text;
      button.append(key, text);
      button.addEventListener("click", () => {
        selectedAnswers.set(questionId, option.id);
        renderQuestion();
      });
      options.appendChild(button);
    });

    feedback.replaceChildren();
    if (selectedOptionId !== undefined) {
      const isCorrect = selectedOptionId === question.correctAnswer.id;
      const status = document.createElement("p");
      status.className = `wrong-practice-feedback-status ${isCorrect ? "correct" : "incorrect"}`;
      status.textContent = isCorrect ? "Correct" : "Incorrect";
      const correctAnswer = document.createElement("p");
      correctAnswer.textContent =
        `Correct answer: ${question.correctAnswer.key}. ${question.correctAnswer.text}`;
      const explanation = document.createElement("p");
      explanation.className = "mock-result-explanation";
      explanation.textContent = question.explanation || "No explanation provided.";
      feedback.append(status, correctAnswer, explanation);
    }

    previousButton.disabled = currentIndex === 0;
    nextButton.textContent =
      currentIndex === questions.length - 1 ? "Complete Practice" : "Next";
  }

  renderQuestion();
}

function renderPracticeComplete(session, selectedAnswers) {
  const { questions, selection } = session;
  const attempted = selectedAnswers.size;
  const correct = questions.reduce((total, question) => (
    selectedAnswers.get(String(question.id)) === question.correctAnswer.id
      ? total + 1
      : total
  ), 0);
  const incorrect = attempted - correct;
  const unanswered = questions.length - attempted;
  const accuracy = attempted === 0 ? 0 : Number(((correct / attempted) * 100).toFixed(2));

  const header = document.createElement("header");
  header.className = "mock-result-header";
  const headingGroup = document.createElement("div");
  const eyebrow = document.createElement("p");
  eyebrow.className = "eyebrow";
  eyebrow.textContent = selection.exam.name;
  const heading = document.createElement("h1");
  heading.textContent = "Practice Complete";
  const subtitle = document.createElement("p");
  subtitle.className = "subtitle";
  subtitle.textContent = `${selection.subject.name} · ${selection.topic.name}`;
  headingGroup.append(eyebrow, heading, subtitle);
  const returnButton = document.createElement("button");
  returnButton.type = "button";
  returnButton.className = "mock-quiz-secondary-button";
  returnButton.textContent = "Back to Selections";
  returnButton.addEventListener("click", () => showPracticePage({ replace: true }));
  header.append(headingGroup, returnButton);

  const summary = document.createElement("section");
  summary.className = "mock-result-summary";
  [
    ["Total questions", questions.length],
    ["Attempted", attempted],
    ["Correct", correct],
    ["Incorrect", incorrect],
    ["Unanswered", unanswered],
    ["Accuracy", `${accuracy}%`]
  ].forEach(([label, value]) => {
    const card = document.createElement("article");
    card.className = "mock-result-metric";
    const metricValue = document.createElement("strong");
    metricValue.textContent = String(value);
    const metricLabel = document.createElement("span");
    metricLabel.textContent = label;
    card.append(metricValue, metricLabel);
    summary.appendChild(card);
  });

  mainContent.replaceChildren(header, summary);
}

async function fetchPracticeSelectionData(url) {
  const response = await fetch(url, { credentials: "same-origin" });
  const result = await response.json();
  if (response.status === 401) {
    authenticatedUser = null;
    updateAuthenticatedUserUI();
    resetNavigation({
      id: "welcome",
      title: "Welcome",
      isAuth: true,
      render: renderWelcomePage
    });
    throw new Error("Your session has expired. Please sign in again.");
  }
  if (!response.ok || !result.success || !Array.isArray(result.data)) {
    throw new Error(result.message || "Practice selections could not be loaded.");
  }
  return result;
}

function createPracticeSelectionButton(title, description, onSelect) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "selection-button";
  button.setAttribute("aria-pressed", "false");
  const heading = document.createElement("strong");
  heading.textContent = title;
  const detail = document.createElement("span");
  detail.textContent = description;
  button.append(heading, detail);
  button.addEventListener("click", (event) => {
    button.parentElement
      .querySelectorAll(".selection-button.is-selected")
      .forEach((selectedButton) => {
        selectedButton.classList.remove("is-selected");
        selectedButton.setAttribute("aria-pressed", "false");
      });
    button.classList.add("is-selected");
    button.setAttribute("aria-pressed", "true");
    onSelect(event);
  });
  return button;
}

function createPracticeMessage(message, isError = false) {
  const element = document.createElement("p");
  element.className = isError ? "practice-status error" : "practice-status";
  element.textContent = message;
  return element;
}

async function initializeApp() {
  const isAuthenticated = await restoreAuthenticatedUser();
  window.history.replaceState(null, "", window.location.pathname);

  if (isAuthenticated) {
    showDashboardPage({ replace: true });
  } else {
    showWelcomePage({ replace: true });
  }
  restoreSavedMockTestResult();
}

initializeApp();