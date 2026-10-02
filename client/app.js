const API_BASE_URL = "http://localhost:5000/api";
const REGISTERED_USER_STORAGE_KEY = "examPlatform.registeredUser";
const MOCK_TEST_RESULT_STORAGE_KEY = "examPlatform.latestMockTestResult";
let activeMockTestSession = null;
let mockTestTimerInterval = null;
let registeredUser = loadRegisteredUser();

window.addEventListener("beforeunload", (event) => {
  if (activeMockTestSession) {
    event.preventDefault();
    event.returnValue = "";
  }
});

// ================================
// Dashboard navigation
// ================================

const navItems = document.querySelectorAll(".nav-item");

function loadRegisteredUser() {
  try {
    const storedUser = JSON.parse(
      window.localStorage.getItem(REGISTERED_USER_STORAGE_KEY)
    );
    if (
      !storedUser ||
      typeof storedUser.id !== "string" ||
      typeof storedUser.name !== "string" ||
      typeof storedUser.email !== "string" ||
      typeof storedUser.role !== "string"
    ) {
      return null;
    }
    return storedUser;
  } catch (error) {
    console.error("Unable to load registered account state:", error);
    return null;
  }
}

function updateRegisteredUserUI() {
  const accountLink = Array.from(navItems).find((item) =>
    ["Create Account", "My Profile"].includes(item.textContent.trim())
  );
  const profileBox = document.querySelector(".profile-box");

  if (!registeredUser) {
    if (accountLink) {
      accountLink.textContent = "Create Account";
    }
    return;
  }

  if (accountLink) {
    accountLink.textContent = "My Profile";
  }

  if (profileBox) {
    profileBox.classList.add("is-registered");
    profileBox.setAttribute("role", "button");
    profileBox.setAttribute("tabindex", "0");
    profileBox.setAttribute("aria-label", `My Profile: ${registeredUser.name}`);
    profileBox.querySelector(".avatar").textContent =
      registeredUser.name.trim().charAt(0).toUpperCase();
    profileBox.querySelector("strong").textContent = registeredUser.name;
    profileBox.querySelector("span").textContent = "My Profile";
  }
}

updateRegisteredUserUI();

navItems.forEach((item) => {
  item.addEventListener("click", (event) => {
    event.preventDefault();

    const text = item.textContent.trim();
    if (activeMockTestSession) {
      if (text !== "Practice" && text !== "Mock Test") {
        return;
      }

      const shouldLeave = window.confirm(
        "Leave this test? Your answers from this session will be lost."
      );
      if (!shouldLeave) {
        return;
      }
      clearMockTestSession();
    }

    navItems.forEach((nav) => {
      nav.classList.remove("active");
    });

    item.classList.add("active");

    if (text === "Practice") {
      showPracticePage();
    } else if (text === "Mock Test") {
      showMockTestPage();
    } else if (text === "Create Account") {
      showRegistrationPage();
    } else if (text === "My Profile") {
      showProfilePage();
    }
  });
});

const profileBox = document.querySelector(".profile-box");
profileBox.addEventListener("click", () => {
  if (registeredUser) {
    showProfilePage();
  }
});
profileBox.addEventListener("keydown", (event) => {
  if (
    registeredUser &&
    (event.key === "Enter" || event.key === " ")
  ) {
    event.preventDefault();
    showProfilePage();
  }
});

function showProfilePage() {
  if (!registeredUser) {
    showRegistrationPage();
    return;
  }

  const mainContent = document.querySelector(".main-content");
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
  subtitle.textContent = "Your account has been registered on this device.";
  headingGroup.append(eyebrow, heading, subtitle);
  header.appendChild(headingGroup);

  const profileCard = document.createElement("section");
  profileCard.className = "registration-panel registered-profile";
  const name = document.createElement("p");
  name.textContent = `Name: ${registeredUser.name}`;
  const email = document.createElement("p");
  email.textContent = `Email: ${registeredUser.email}`;
  const role = document.createElement("p");
  role.textContent = `Account type: ${registeredUser.role}`;
  const notice = document.createElement("p");
  notice.className = "registered-profile-notice";
  notice.textContent =
    "This is a device-local registration indicator, not a login session.";
  profileCard.append(name, email, role, notice);

  mainContent.append(header, profileCard);
}

function showRegistrationPage() {
  if (registeredUser) {
    showProfilePage();
    return;
  }

  const mainContent = document.querySelector(".main-content");
  mainContent.innerHTML = `
    <div class="topbar">
      <div>
        <p class="eyebrow">Student Account</p>
        <h1>Create Account</h1>
        <p class="subtitle">Register to create your ExamPlatform student account.</p>
      </div>
    </div>

    <section class="registration-panel">
      <form id="registration-form">
        <label class="registration-field">
          <span>Name</span>
          <input name="name" type="text" maxlength="100" autocomplete="name" required>
        </label>
        <label class="registration-field">
          <span>Email</span>
          <input name="email" type="email" maxlength="150" autocomplete="email" required>
        </label>
        <label class="registration-field">
          <span>Password</span>
          <input name="password" type="password" minlength="4" maxlength="128" autocomplete="new-password" required>
          <small>Use 4 to 128 characters.</small>
        </label>
        <label class="registration-field">
          <span>Confirm Password</span>
          <input name="confirmPassword" type="password" minlength="4" maxlength="128" autocomplete="new-password" required>
        </label>
        <p id="registration-message" class="registration-message hidden" role="alert"></p>
        <button class="registration-submit" type="submit">Create Account</button>
      </form>
    </section>
  `;

  const form = document.getElementById("registration-form");
  const message = document.getElementById("registration-message");
  const submitButton = form.querySelector('button[type="submit"]');

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    message.classList.add("hidden");

    const formData = new FormData(form);
    const name = formData.get("name");
    const email = formData.get("email");
    const password = formData.get("password");
    const confirmPassword = formData.get("confirmPassword");

    if (password !== confirmPassword) {
      message.textContent = "Passwords do not match.";
      message.classList.remove("hidden");
      return;
    }

    submitButton.disabled = true;
    try {
      const response = await fetch(`${API_BASE_URL}/auth/register`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ name, email, password })
      });
      const result = await response.json();

      if (!response.ok || !result.success || !result.data) {
        throw new Error(result.message || "Unable to create account.");
      }

      registeredUser = {
        id: String(result.data.id),
        name: result.data.name,
        email: result.data.email,
        role: result.data.role
      };

      let statePersisted = true;
      try {
        window.localStorage.setItem(
          REGISTERED_USER_STORAGE_KEY,
          JSON.stringify(registeredUser)
        );
      } catch (storageError) {
        statePersisted = false;
        console.error("Unable to persist registered account state:", storageError);
      }
      updateRegisteredUserUI();

      const registrationPanel = document.querySelector(".registration-panel");
      registrationPanel.innerHTML = `
        <div class="registration-success" role="status">
          <h2>Account created successfully</h2>
          <p>${statePersisted
            ? "Your account is registered on this device. This is not a login session."
            : "Your account was created, but this browser could not save its account state."}</p>
          <button class="registration-submit" id="registration-return" type="button">Back to Mock Tests</button>
        </div>
      `;
      document.getElementById("registration-return").addEventListener("click", () => {
        navItems.forEach((item) => {
          item.classList.toggle("active", item.textContent.trim() === "Mock Test");
        });
        showMockTestPage();
      });
    } catch (error) {
      message.textContent = error.message || "Unable to create account. Please try again.";
      message.classList.remove("hidden");
      submitButton.disabled = false;
    }
  });
}

// ================================
// Mock test selection and preview
// ================================

async function showMockTestPage() {
  const mainContent = document.querySelector(".main-content");

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
          <h2>Select Exam</h2>
          <span id="mock-exam-status">Loading...</span>
        </div>
        <div id="mock-exam-list" class="mock-exam-list"></div>
      </div>

      <div id="mock-test-panel" class="mock-test-panel hidden">
        <div class="mock-test-heading">
          <div>
            <h2 id="mock-tests-title">Available Tests</h2>
            <p id="mock-tests-subtitle" class="mock-test-subtitle"></p>
          </div>
          <span id="mock-test-status"></span>
        </div>
        <div id="mock-test-list" class="mock-test-list"></div>
      </div>

      <div id="mock-test-preview" class="mock-test-panel hidden"></div>
    </section>
  `;

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
        examList.querySelectorAll(".mock-exam-button").forEach((item) => {
          item.classList.remove("selected");
          item.setAttribute("aria-pressed", "false");
        });
        button.classList.add("selected");
        button.setAttribute("aria-pressed", "true");
        loadMockTests(exam);
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
  const preview = document.getElementById("mock-test-preview");

  testPanel.classList.remove("hidden");
  preview.classList.add("hidden");
  preview.replaceChildren();
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
      openButton.addEventListener("click", () => loadMockTestPreview(test.id));

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

async function loadMockTestPreview(testId) {
  const preview = document.getElementById("mock-test-preview");
  preview.classList.remove("hidden");
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
    startButton.addEventListener("click", () => startMockTest(test));
    preview.appendChild(startButton);
  } catch (error) {
    console.error(error);
    preview.replaceChildren(
      createMockTestMessage("Test details could not be loaded. Please try again.", true)
    );
  }
}

function startMockTest(test) {
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
    answers: new Map(),
    currentQuestionIndex: 0,
    remainingSeconds: Math.floor(durationSeconds),
    endsAt: Date.now() + Math.floor(durationSeconds) * 1000,
    expired: false
  };

  renderMockTestSession();
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
      notice.textContent =
        "Time is up. Answers have not been submitted; you can leave this test safely.";
      notice.classList.remove("hidden");
    }

    document
      .querySelectorAll(".mock-quiz-option")
      .forEach((option) => {
        option.disabled = true;
      });
  }
}

function renderMockTestSession() {
  const session = activeMockTestSession;
  if (!session) {
    return;
  }

  const { test, answers, currentQuestionIndex } = session;
  const question = test.questions[currentQuestionIndex];
  const mainContent = document.querySelector(".main-content");
  const answeredCount = answers.size;

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
        <p class="mock-quiz-palette-summary">${answeredCount} answered · ${test.questions.length - answeredCount} unanswered</p>
        <div id="mock-quiz-palette" class="mock-quiz-palette"></div>
        <div class="mock-quiz-legend">
          <span><i class="answered"></i> Answered</span>
          <span><i></i> Unanswered</span>
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

  const palette = document.getElementById("mock-quiz-palette");
  test.questions.forEach((paletteQuestion, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "mock-quiz-palette-button";
    if (answers.has(String(paletteQuestion.id))) {
      button.classList.add("answered");
    }
    if (index === currentQuestionIndex) {
      button.classList.add("current");
      button.setAttribute("aria-current", "true");
    }
    button.textContent = String(index + 1);
    button.setAttribute(
      "aria-label",
      `Question ${index + 1}, ${answers.has(String(paletteQuestion.id)) ? "answered" : "unanswered"}`
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
      showMockTestPage();
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
    notice.textContent =
      "Time is up. Answers have not been submitted; you can leave this test safely.";
    notice.classList.remove("hidden");
  }
}

async function submitMockTest() {
  const session = activeMockTestSession;
  if (!session || session.submitting || session.completed) {
    return;
  }

  const unansweredCount = session.test.questions.length - session.answers.size;
  const confirmationMessage =
    unansweredCount > 0
      ? `Submit this test with ${unansweredCount} unanswered question${unansweredCount === 1 ? "" : "s"}?`
      : "Submit this test now?";
  if (!window.confirm(confirmationMessage)) {
    return;
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
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        mockTestId: session.test.id,
        answers
      })
    });
    const result = await response.json();

    if (!response.ok || !result.success || !result.data) {
      throw new Error(result.message || "The test could not be submitted. Please try again.");
    }

    const resultSaved = saveMockTestResult(session.test, result.data);
    session.completed = true;
    clearMockTestSession();
    renderMockTestResult(session.test, result.data, !resultSaved);
  } catch (error) {
    console.error("Mock test submission failed:", error);
    session.submitting = false;
    session.submissionError =
      error.message || "The test could not be submitted. Your answers are still available.";
    renderMockTestSession();
  }
}

function renderMockTestResult(test, result, persistenceUnavailable = false) {
  const mainContent = document.querySelector(".main-content");
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
    showMockTestPage();
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

  const answerList = document.createElement("ol");
  answerList.className = "mock-result-answer-list";
  result.answers.forEach((answer, index) => {
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
    answerList.appendChild(item);
  });
  reviewPanel.appendChild(answerList);
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

  renderMockTestResult(savedResult.test, savedResult.result);
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

async function showPracticePage() {
  const mainContent = document.querySelector(".main-content");

  mainContent.innerHTML = `
    <div class="topbar">
      <div>
        <p class="eyebrow">Practice</p>
        <h1>Practice Questions</h1>
        <p class="subtitle">
          Select an exam, subject and topic to start your preparation.
        </p>
      </div>
    </div>

    <section class="practice-section">

      <div class="selection-card">
        <div class="selection-header">
          <h2>Select Exam</h2>
          <span id="exam-status">Loading...</span>
        </div>

        <div id="exam-list" class="selection-grid"></div>
      </div>

      <div id="subject-section" class="selection-card hidden">
        <div class="selection-header">
          <h2>Select Subject</h2>
          <span id="subject-status"></span>
        </div>

        <div id="subject-list" class="selection-grid"></div>
      </div>

      <div id="topic-section" class="selection-card hidden">
        <div class="selection-header">
          <h2>Select Topic</h2>
          <span id="topic-status"></span>
        </div>

        <div id="topic-list" class="topic-grid"></div>
      </div>

    </section>
  `;

  await loadExams();
}

// ================================
// Load Exams
// ================================

async function loadExams() {
  const examList = document.getElementById("exam-list");
  const examStatus = document.getElementById("exam-status");

  try {
    const response = await fetch(`${API_BASE_URL}/exams`);

    if (!response.ok) {
      throw new Error("Failed to load exams");
    }

    const result = await response.json();

    examStatus.textContent = `${result.count} Exams`;

    examList.innerHTML = "";

    result.data.forEach((exam) => {
      const card = document.createElement("button");

      card.className = "selection-button";

      card.innerHTML = `
        <strong>${exam.name}</strong>
        <span>${exam.description || "Practice this exam"}</span>
      `;

      card.addEventListener("click", () => {
        loadSubjects(exam.id, exam.name);
      });

      examList.appendChild(card);
    });

  } catch (error) {
    console.error(error);

    examStatus.textContent = "Error";

    examList.innerHTML = `
      <div class="error-message">
        Exams load nahi ho paaye.
        Please check that the server is running.
      </div>
    `;
  }
}

// ================================
// Load Subjects
// ================================

async function loadSubjects(examId, examName) {
  const subjectSection = document.getElementById("subject-section");
  const subjectList = document.getElementById("subject-list");
  const subjectStatus = document.getElementById("subject-status");

  const topicSection = document.getElementById("topic-section");

  subjectSection.classList.remove("hidden");
  topicSection.classList.add("hidden");

  subjectList.innerHTML = `
    <div class="loading-message">Loading subjects...</div>
  `;

  try {
    const response = await fetch(`${API_BASE_URL}/subjects`);

    if (!response.ok) {
      throw new Error("Failed to load subjects");
    }

    const result = await response.json();

    const subjects = result.data.filter(
      (subject) => subject.exam_id === examId
    );

    subjectStatus.textContent = `${subjects.length} Subjects`;

    subjectList.innerHTML = "";

    if (subjects.length === 0) {
      subjectList.innerHTML = `
        <div class="empty-message">
          No subjects found for ${examName}.
        </div>
      `;
      return;
    }

    subjects.forEach((subject) => {
      const card = document.createElement("button");

      card.className = "selection-button";

      card.innerHTML = `
        <strong>${subject.name}</strong>
        <span>${subject.description || "Practice this subject"}</span>
      `;

      card.addEventListener("click", () => {
        loadTopics(subject.id, subject.name);
      });

      subjectList.appendChild(card);
    });

  } catch (error) {
    console.error(error);

    subjectStatus.textContent = "Error";

    subjectList.innerHTML = `
      <div class="error-message">
        Subjects load nahi ho paaye.
      </div>
    `;
  }
}

// ================================
// Load Topics
// ================================

async function loadTopics(subjectId, subjectName) {
  const topicSection = document.getElementById("topic-section");
  const topicList = document.getElementById("topic-list");
  const topicStatus = document.getElementById("topic-status");

  topicSection.classList.remove("hidden");

  topicList.innerHTML = `
    <div class="loading-message">Loading topics...</div>
  `;

  try {
    const response = await fetch(`${API_BASE_URL}/topics`);

    if (!response.ok) {
      throw new Error("Failed to load topics");
    }

    const result = await response.json();

    const topics = result.data.filter(
      (topic) => topic.subject_id === subjectId
    );

    topicStatus.textContent = `${topics.length} Topics`;

    topicList.innerHTML = "";

    if (topics.length === 0) {
      topicList.innerHTML = `
        <div class="empty-message">
          No topics found for ${subjectName}.
        </div>
      `;
      return;
    }

    topics.forEach((topic) => {
      const card = document.createElement("button");

      card.className = "topic-button";

      card.innerHTML = `
        <strong>${topic.name}</strong>
        <span>${topic.description || "Start practice"}</span>
      `;

      card.addEventListener("click", () => {
        alert(`Topic selected: ${topic.name}`);
      });

      topicList.appendChild(card);
    });

  } catch (error) {
    console.error(error);

    topicStatus.textContent = "Error";

    topicList.innerHTML = `
      <div class="error-message">
        Topics load nahi ho paaye.
      </div>
    `;
  }
}

restoreSavedMockTestResult();