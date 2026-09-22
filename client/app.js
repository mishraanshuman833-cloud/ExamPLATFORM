const API_BASE_URL = "http://localhost:5000/api";

// ================================
// Dashboard navigation
// ================================

const navItems = document.querySelectorAll(".nav-item");

navItems.forEach((item) => {
  item.addEventListener("click", (event) => {
    event.preventDefault();

    navItems.forEach((nav) => {
      nav.classList.remove("active");
    });

    item.classList.add("active");

    const text = item.textContent.trim();

    if (text === "Practice") {
      showPracticePage();
    }
  });
});

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