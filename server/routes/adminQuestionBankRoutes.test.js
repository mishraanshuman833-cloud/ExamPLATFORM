const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const express = require("express");
const { after, before, beforeEach, test } = require("node:test");

process.env.SESSION_SECRET = "test-session-secret-that-is-at-least-32-characters";

const { hashSessionToken } = require("../middleware/authSession");
const adminQuestionBankRoutes = require("./adminQuestionBankRoutes");

const sessions = new Map();
const app = express();
let server;
let baseUrl;
let question;
let inventoryQuestions = [];

function questionFixture(overrides = {}) {
  return {
    id: "42",
    topicId: "31",
    topicName: "Civics",
    sectionId: "21",
    sectionName: "General Knowledge",
    examId: "11",
    examName: "Configured Exam",
    question: "Original question?",
    questionType: "mcq",
    explanation: "Original explanation.",
    language: "en",
    difficulty: "medium",
    questionOrigin: "ai_generated",
    aiGenerated: true,
    reviewStatus: "pending",
    isPublished: false,
    createdBy: "1",
    creatorName: "Question Creator",
    reviewedBy: null,
    reviewerName: null,
    reviewedAt: null,
    source: "Question generator",
    sourceYear: null,
    sourceExam: null,
    createdAt: "2026-10-02T00:00:00.000Z",
    options: {
      A: { text: "First", isCorrect: true },
      B: { text: "Second", isCorrect: false },
      C: { text: "Third", isCorrect: false },
      D: { text: "Fourth", isCorrect: false }
    },
    ...overrides
  };
}

function matchingInventoryQuestions(sql, values) {
  const matches = inventoryQuestions.filter((item) => {
    const predicates = [
      [/e\.id = \$(\d+)/, "examId"],
      [/s\.id = \$(\d+)/, "sectionId"],
      [/t\.id = \$(\d+)/, "topicId"],
      [/q\.language = \$(\d+)/, "language"],
      [/q\.difficulty = \$(\d+)/, "difficulty"],
      [/q\.review_status = \$(\d+)/, "reviewStatus"],
      [/q\.is_published = \$(\d+)/, "isPublished"],
      [/q\.question_origin = \$(\d+)/, "questionOrigin"]
    ];
    for (const [pattern, property] of predicates) {
      const match = sql.match(pattern);
      if (
        match &&
        String(item[property]) !== String(values[Number(match[1]) - 1])
      ) {
        return false;
      }
    }
    const searchMatch = sql.match(
      /position\(lower\(\$(\d+)\) in lower\(q\.question_text\)\) > 0/
    );
    if (
      searchMatch &&
      !item.question.toLowerCase().includes(values[Number(searchMatch[1]) - 1].toLowerCase())
    ) {
      return false;
    }
    const sourceMatch = sql.match(
      /position\(lower\(\$(\d+)\) in lower\(COALESCE\(q\.source, ''\)\)\) > 0/
    );
    if (
      sourceMatch &&
      !(item.source || "").toLowerCase().includes(
        values[Number(sourceMatch[1]) - 1].toLowerCase()
      )
    ) {
      return false;
    }
    return true;
  });

  if (sql.includes('SELECT COUNT(*) AS "totalCount"')) {
    return { rowCount: 1, rows: [{ totalCount: String(matches.length) }] };
  }
  const pageMatch = sql.match(/LIMIT \$(\d+) OFFSET \$(\d+)/);
  const offset = pageMatch ? Number(values[Number(pageMatch[2]) - 1]) : 0;
  const limit = pageMatch ? Number(values[Number(pageMatch[1]) - 1]) : matches.length;
  const rows = matches.slice(offset, offset + limit).map((item) => structuredClone(item));
  return { rowCount: rows.length, rows };
}

app.use(express.json());
app.locals.pool = {
  async query(sql, values = []) {
    if (sql.includes("FROM auth_sessions s")) {
      return {
        rowCount: sessions.has(values[0]) ? 1 : 0,
        rows: sessions.has(values[0]) ? [sessions.get(values[0])] : []
      };
    }
    if (sql.includes("UPDATE questions") && sql.includes("SET is_published = TRUE")) {
      if (
        question.id !== values[0] ||
        !question.aiGenerated ||
        question.reviewStatus !== "approved" ||
        question.isPublished
      ) {
        return { rowCount: 0, rows: [] };
      }
      question.isPublished = true;
      return {
        rowCount: 1,
        rows: [{
          id: question.id,
          reviewStatus: question.reviewStatus,
          isPublished: question.isPublished
        }]
      };
    }
    if (sql.includes("UPDATE questions") && sql.includes("SET review_status")) {
      if (
        question.id !== values[0] ||
        !question.aiGenerated ||
        question.reviewStatus !== "pending" ||
        question.isPublished
      ) {
        return { rowCount: 0, rows: [] };
      }
      question.reviewStatus = values[1];
      question.reviewedBy = values[2];
      question.reviewedAt = "2026-10-02T00:01:00.000Z";
      return {
        rowCount: 1,
        rows: [{
          id: question.id,
          reviewStatus: question.reviewStatus,
          isPublished: question.isPublished
        }]
      };
    }
    if (sql.includes("FROM questions WHERE id = $1")) {
      if (question.id !== values[0]) {
        return { rowCount: 0, rows: [] };
      }
      return {
        rowCount: 1,
        rows: [{
          ai_generated: question.aiGenerated,
          review_status: question.reviewStatus,
          is_published: question.isPublished
        }]
      };
    }
    if (sql.includes("FROM questions q") && sql.includes("q.id = $1")) {
      const item = inventoryQuestions.find((candidate) => candidate.id === values[0]);
      return item
        ? { rowCount: 1, rows: [structuredClone(item)] }
        : { rowCount: 0, rows: [] };
    }
    if (sql.includes("FROM questions q")) {
      return matchingInventoryQuestions(sql, values);
    }
    throw new Error(`Unexpected database query: ${sql}`);
  },
  async connect() {
    let snapshot;
    return {
      async query(sql, values = []) {
        if (sql === "BEGIN") {
          snapshot = structuredClone(question);
          return { rowCount: null, rows: [] };
        }
        if (sql === "ROLLBACK") {
          question = snapshot;
          return { rowCount: null, rows: [] };
        }
        if (sql === "COMMIT") {
          snapshot = null;
          return { rowCount: null, rows: [] };
        }
        if (sql.includes("SELECT id, ai_generated")) {
          return question.id === values[0]
            ? {
                rowCount: 1,
                rows: [{
                  id: question.id,
                  ai_generated: question.aiGenerated,
                  review_status: question.reviewStatus,
                  is_published: question.isPublished
                }]
              }
            : { rowCount: 0, rows: [] };
        }
        if (sql.includes("UPDATE questions") && sql.includes("SET question_text")) {
          question.question = values[1];
          question.explanation = values[2];
          question.language = values[3];
          question.difficulty = values[4];
          return { rowCount: 1, rows: [] };
        }
        if (sql.includes("UPDATE question_options")) {
          const [id, key, text, isCorrect] = values;
          question.options[key] = { text, isCorrect };
          return { rowCount: 1, rows: [] };
        }
        throw new Error(`Unexpected transactional query: ${sql}`);
      },
      release() {}
    };
  }
};
app.use("/api/admin/question-bank", adminQuestionBankRoutes);

before(async () => {
  server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}/api/admin/question-bank`;
});

beforeEach(() => {
  question = questionFixture();
  inventoryQuestions = [question];
});

function replaceQuestion(overrides = {}) {
  question = questionFixture(overrides);
  inventoryQuestions = [question];
}

after(async () => {
  await new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
});

function sessionCookie(role) {
  const token = crypto.randomBytes(32).toString("base64url");
  const signature = crypto
    .createHmac("sha256", process.env.SESSION_SECRET)
    .update(token)
    .digest("base64url");
  sessions.set(hashSessionToken(token), {
    id: role === "admin" ? "1" : "2",
    name: "Test User",
    email: "test@example.invalid",
    role
  });
  return `examplatform_session=${token}.${signature}`;
}

function adminRequest(path, options = {}) {
  return fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {}),
      ...(options.cookie ? { Cookie: options.cookie } : {})
    }
  });
}

function validEdit(overrides = {}) {
  return {
    question: "Edited question?",
    explanation: "Edited explanation.",
    language: "hi",
    difficulty: "hard",
    correctAnswer: "D",
    options: {
      A: "विकल्प एक",
      B: "विकल्प दो",
      C: "विकल्प तीन",
      D: "विकल्प चार"
    },
    ...overrides
  };
}

test("all Question Bank endpoints require an administrator session", async () => {
  const unauthenticated = await adminRequest("/");
  assert.equal(unauthenticated.status, 401);
  const unauthenticatedPublish = await adminRequest("/42/publish", { method: "POST" });
  assert.equal(unauthenticatedPublish.status, 401);
  const student = await adminRequest("/", { cookie: sessionCookie("student") });
  assert.equal(student.status, 403);
});

test("admin can list and view pending AI questions with options", async () => {
  const cookie = sessionCookie("admin");
  const listResponse = await adminRequest("/", { cookie });
  const list = await listResponse.json();
  assert.equal(listResponse.status, 200);
  assert.equal(list.count, 1);
  assert.equal(list.data[0].id, "42");
  assert.equal(list.data[0].options.A.isCorrect, true);

  const detailResponse = await adminRequest("/42", { cookie });
  const detail = await detailResponse.json();
  assert.equal(detailResponse.status, 200);
  assert.equal(detail.data.question, "Original question?");
  assert.equal(detail.data.topicId, "31");
});

test("admin inventory includes AI, manual, and PYQ questions across review and publish states", async () => {
  const manualPublished = questionFixture({
    id: "43",
    question: "Manual published question?",
    questionOrigin: "manual",
    aiGenerated: false,
    reviewStatus: "approved",
    isPublished: true,
    source: "Editor",
    sourceYear: 2025,
    sourceExam: "Configured Exam"
  });
  const pyqRejected = questionFixture({
    id: "44",
    question: "Previous year question?",
    questionOrigin: "pyq",
    aiGenerated: false,
    reviewStatus: "rejected",
    isPublished: false,
    source: "Previous paper",
    sourceYear: 2024,
    sourceExam: "Configured Exam"
  });
  inventoryQuestions = [question, manualPublished, pyqRejected];

  const response = await adminRequest("/", { cookie: sessionCookie("admin") });
  const result = await response.json();
  assert.equal(response.status, 200);
  assert.equal(result.totalCount, 3);
  assert.deepEqual(
    result.data.map((item) => item.questionOrigin).sort(),
    ["ai_generated", "manual", "pyq"]
  );
  assert.equal(result.data.find((item) => item.id === "43").sourceYear, 2025);
  assert.equal(result.data.find((item) => item.id === "44").reviewStatus, "rejected");

  const detailResponse = await adminRequest("/43", {
    cookie: sessionCookie("admin")
  });
  const detail = await detailResponse.json();
  assert.equal(detailResponse.status, 200);
  assert.equal(detail.data.questionOrigin, "manual");
  assert.equal(detail.data.sourceExam, "Configured Exam");
});

test("inventory search matches question text", async () => {
  inventoryQuestions = [
    question,
    questionFixture({ id: "43", question: "Find this unique phrase." })
  ];
  const response = await adminRequest("/?search=unique%20phrase", {
    cookie: sessionCookie("admin")
  });
  const result = await response.json();
  assert.equal(response.status, 200);
  assert.equal(result.totalCount, 1);
  assert.equal(result.data[0].id, "43");
});

test("inventory applies combined exam, section, topic, language, origin, source, and review filters", async () => {
  inventoryQuestions = [
    question,
    questionFixture({
      id: "43",
      examId: "12",
      sectionId: "22",
      topicId: "32",
      language: "hi",
      questionOrigin: "manual",
      aiGenerated: false,
      reviewStatus: "approved",
      source: "Board Exam"
    }),
    questionFixture({
      id: "44",
      examId: "11",
      sectionId: "21",
      topicId: "32",
      language: "en",
      questionOrigin: "ai_generated",
      reviewStatus: "pending",
      source: "Board Exam"
    })
  ];
  const response = await adminRequest(
    "/?examId=11&sectionId=21&topicId=31&language=en&difficulty=medium&reviewStatus=pending&published=false&origin=ai_generated&source=generator",
    { cookie: sessionCookie("admin") }
  );
  const result = await response.json();
  assert.equal(response.status, 200);
  assert.equal(result.totalCount, 1);
  assert.equal(result.data[0].id, "42");
});

test("inventory pagination returns the requested page and an unpaged total count", async () => {
  inventoryQuestions = [
    question,
    questionFixture({ id: "43" }),
    questionFixture({ id: "44" })
  ];
  const response = await adminRequest("/?page=2&pageSize=2", {
    cookie: sessionCookie("admin")
  });
  const result = await response.json();
  assert.equal(response.status, 200);
  assert.deepEqual(
    {
      count: result.count,
      totalCount: result.totalCount,
      page: result.page,
      pageSize: result.pageSize,
      totalPages: result.totalPages,
      ids: result.data.map((item) => item.id)
    },
    {
      count: 1,
      totalCount: 3,
      page: 2,
      pageSize: 2,
      totalPages: 2,
      ids: ["44"]
    }
  );
});

test("inventory published and unpublished filters return only the requested state", async () => {
  inventoryQuestions = [
    question,
    questionFixture({ id: "43", isPublished: true })
  ];
  for (const [published, expectedId] of [["true", "43"], ["false", "42"]]) {
    const response = await adminRequest(`/?published=${published}`, {
      cookie: sessionCookie("admin")
    });
    const result = await response.json();
    assert.equal(response.status, 200);
    assert.equal(result.totalCount, 1);
    assert.equal(result.data[0].id, expectedId);
  }
});

test("inventory review-status filter returns only matching status", async () => {
  inventoryQuestions = [
    question,
    questionFixture({ id: "43", reviewStatus: "rejected" })
  ];
  const response = await adminRequest("/?reviewStatus=rejected", {
    cookie: sessionCookie("admin")
  });
  const result = await response.json();
  assert.equal(response.status, 200);
  assert.equal(result.totalCount, 1);
  assert.equal(result.data[0].id, "43");
});

test("inventory rejects invalid filters and unsafe pagination values", async () => {
  for (const query of [
    "?examId=not-an-id",
    "?language=fr",
    "?difficulty=extreme",
    "?reviewStatus=archived",
    "?published=yes",
    "?origin=imported",
    "?page=1.5",
    "?pageSize=101",
    `?search=${"x".repeat(201)}`
  ]) {
    const response = await adminRequest(`/${query}`, {
      cookie: sessionCookie("admin")
    });
    assert.equal(response.status, 400, query);
  }
});

test("admin can edit pending content without changing question relationships", async () => {
  const cookie = sessionCookie("admin");
  const response = await adminRequest("/42", {
    method: "PATCH",
    cookie,
    body: JSON.stringify(validEdit())
  });
  const result = await response.json();
  assert.equal(response.status, 200);
  assert.equal(result.data.id, "42");
  assert.equal(question.id, "42");
  assert.equal(question.topicId, "31");
  assert.equal(question.examId, "11");
  assert.equal(question.sectionId, "21");
  assert.equal(question.question, "Edited question?");
  assert.equal(question.options.D.isCorrect, true);
  assert.equal(
    Object.values(question.options).filter((option) => option.isCorrect).length,
    1
  );
});

test("approval changes review status but never publishes", async () => {
  const response = await adminRequest("/42/approve", {
    method: "POST",
    cookie: sessionCookie("admin")
  });
  const result = await response.json();
  assert.equal(response.status, 200);
  assert.equal(result.data.reviewStatus, "approved");
  assert.equal(result.data.isPublished, false);
  assert.equal(question.isPublished, false);
});

test("rejection leaves the question unpublished", async () => {
  const response = await adminRequest("/42/reject", {
    method: "POST",
    cookie: sessionCookie("admin")
  });
  const result = await response.json();
  assert.equal(response.status, 200);
  assert.equal(result.data.reviewStatus, "rejected");
  assert.equal(result.data.isPublished, false);
  assert.equal(question.isPublished, false);
});

test("published AI questions cannot be edited, approved, or rejected", async () => {
  question.isPublished = true;
  const cookie = sessionCookie("admin");

  const edit = await adminRequest("/42", {
    method: "PATCH",
    cookie,
    body: JSON.stringify(validEdit())
  });
  const approve = await adminRequest("/42/approve", {
    method: "POST",
    cookie
  });
  const reject = await adminRequest("/42/reject", {
    method: "POST",
    cookie
  });

  assert.equal(edit.status, 409);
  assert.equal(approve.status, 409);
  assert.equal(reject.status, 409);
  assert.equal(question.question, "Original question?");
  assert.equal(question.reviewStatus, "pending");
  assert.equal(question.isPublished, true);
});

test("admin can publish an approved unpublished question without changing its content or review data", async () => {
  replaceQuestion({ reviewStatus: "approved" });
  const beforePublish = structuredClone(question);
  const listResponse = await adminRequest("/", { cookie: sessionCookie("admin") });
  const list = await listResponse.json();
  assert.equal(listResponse.status, 200);
  assert.equal(list.count, 1);
  assert.equal(list.data[0].reviewStatus, "approved");
  const detailResponse = await adminRequest("/42", { cookie: sessionCookie("admin") });
  assert.equal(detailResponse.status, 200);

  const response = await adminRequest("/42/publish", {
    method: "POST",
    cookie: sessionCookie("admin")
  });
  const result = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(result.data, {
    id: "42",
    reviewStatus: "approved",
    isPublished: true
  });
  assert.equal(question.isPublished, true);
  assert.equal(question.reviewStatus, beforePublish.reviewStatus);
  assert.equal(question.question, beforePublish.question);
  assert.deepEqual(question.options, beforePublish.options);
  assert.equal(question.explanation, beforePublish.explanation);
  assert.equal(question.language, beforePublish.language);
  assert.equal(question.difficulty, beforePublish.difficulty);
  assert.equal(question.questionOrigin, beforePublish.questionOrigin);
  assert.equal(question.aiGenerated, beforePublish.aiGenerated);
  assert.equal(question.createdBy, beforePublish.createdBy);
});

test("non-admin cannot publish an approved unpublished question", async () => {
  replaceQuestion({ reviewStatus: "approved" });
  const response = await adminRequest("/42/publish", {
    method: "POST",
    cookie: sessionCookie("student")
  });
  assert.equal(response.status, 403);
  assert.equal(question.isPublished, false);
});

test("pending and rejected questions cannot be published", async () => {
  for (const reviewStatus of ["pending", "rejected"]) {
    replaceQuestion({ reviewStatus });
    const response = await adminRequest("/42/publish", {
      method: "POST",
      cookie: sessionCookie("admin")
    });
    const result = await response.json();
    assert.equal(response.status, 409, reviewStatus);
    assert.match(result.message, /approved unpublished/i);
    assert.equal(question.isPublished, false);
  }
});

test("already-published question cannot be published again", async () => {
  replaceQuestion({ reviewStatus: "approved", isPublished: true });
  const response = await adminRequest("/42/publish", {
    method: "POST",
    cookie: sessionCookie("admin")
  });
  assert.equal(response.status, 409);
  assert.equal(question.isPublished, true);
});

test("publishing a missing question returns not found", async () => {
  const response = await adminRequest("/43/publish", {
    method: "POST",
    cookie: sessionCookie("admin")
  });
  assert.equal(response.status, 404);
});
