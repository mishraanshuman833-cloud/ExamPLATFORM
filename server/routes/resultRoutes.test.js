const assert = require("node:assert/strict");
const crypto = require("crypto");
const express = require("express");
const { after, before, test } = require("node:test");
const mockTestRoutes = require("./mockTestRoutes");
const resultRoutes = require("./resultRoutes");
const { hashSessionToken } = require("../middleware/authSession");
const {
  createMockTestAttemptToken,
  validateMockTestAttemptToken
} = require("../middleware/mockTestAttempt");

process.env.SESSION_SECRET = "test-session-secret-that-is-at-least-32-characters";
const authenticatedToken = crypto.randomBytes(32).toString("base64url");
const authenticatedCookie = `${authenticatedToken}.${crypto
  .createHmac("sha256", process.env.SESSION_SECRET)
  .update(authenticatedToken)
  .digest("base64url")}`;
const authenticatedTokenHash = hashSessionToken(authenticatedToken);

const app = express();
let server;
let baseUrl;
let databaseConnections = 0;
let savedAttempts = 0;

app.use(express.json());
app.locals.pool = {
  async query(sql, values = []) {
    if (sql.includes("FROM auth_sessions s")) {
      return values[0] === authenticatedTokenHash
        ? {
            rowCount: 1,
            rows: [{ id: "7", name: "Test User", email: "test@example.com", role: "student" }]
          }
        : { rowCount: 0, rows: [] };
    }
    if (sql.includes("WITH owned_attempt AS")) {
      assert.match(sql, /aa\.is_correct = FALSE/);
      if (values[0] !== "44" || values[1] !== "7") {
        return { rowCount: 0, rows: [] };
      }
      return { rowCount: 4, rows: wrongQuestionRows() };
    }
    return {
      rowCount: 1,
      rows: [{ id: "1", duration_minutes: 2 }]
    };
  },
  async connect() {
    databaseConnections += 1;
    return {
      async query(sql) {
        if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") {
          return { rowCount: null, rows: [] };
        }
        if (sql.includes("FROM mock_tests mt")) {
          return { rowCount: 4, rows: questionRows() };
        }
        if (sql.includes("INSERT INTO attempts")) {
          savedAttempts += 1;
          return {
            rowCount: 1,
            rows: [{ id: String(savedAttempts), submitted_at: new Date() }]
          };
        }
        if (sql.includes("INSERT INTO attempt_answers")) {
          return { rowCount: 1, rows: [] };
        }
        throw new Error(`Unexpected query: ${sql}`);
      },
      release() {}
    };
  }
};
app.use("/api/mock-tests", mockTestRoutes);
app.use("/api/results", resultRoutes);

function questionRows() {
  return ["A", "B", "C", "D"].map((key, index) => ({
    test_id: "1",
    question_id: "10",
    marks: "1",
    negative_marks: "0.25",
    question_text: "Test question",
    language: "en",
    explanation: "Test explanation",
    option_id: String(11 + index),
    option_key: key,
    option_text: `Option ${key}`,
    is_correct: index === 0
  }));
}

function wrongQuestionRows() {
  return ["A", "B", "C", "D"].map((key, index) => ({
    attemptId: "44",
    testTitle: "PET Mock Test",
    examName: "UPSSSC PET",
    questionOrder: 2,
    questionId: "20",
    question: "Which option is correct?",
    questionType: "mcq",
    difficulty: "easy",
    language: "en",
    explanation: "Review the relevant concept.",
    marks: "1",
    negativeMarks: "0.25",
    topicId: "5",
    topic: "Percentages",
    subjectId: "3",
    subject: "Mathematics",
    optionId: String(101 + index),
    optionKey: key,
    optionText: `Option ${key}`,
    optionIsCorrect: index === 2
  }));
}

before(async () => {
  server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}/api`;
});

after(async () => {
  await new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
});

async function post(path, body) {
  return fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

async function get(path, cookie) {
  const headers = cookie ? { Cookie: `examplatform_session=${cookie}` } : {};
  return fetch(`${baseUrl}${path}`, { headers });
}

test("mock test start returns a signed deadline based on the stored duration", async () => {
  const response = await post("/mock-tests/1/start", {});
  const result = await response.json();
  assert.equal(response.status, 200);
  assert.equal(result.durationMinutes, 2);
  assert.equal(validateMockTestAttemptToken(result.attemptToken, "1"), "valid");
  assert.ok(result.deadline - Date.now() <= 2 * 60 * 1000);
  assert.ok(result.deadline - Date.now() > 0);
});

test("result submission rejects expired or invalid attempt tokens before scoring", async () => {
  const expiredToken = createMockTestAttemptToken(
    "1",
    1,
    Date.now() - 60 * 1000 - 1000
  );
  const expiredResponse = await post("/results", {
    mockTestId: "1",
    attemptToken: expiredToken,
    autoSubmit: false,
    answers: []
  });
  assert.equal(expiredResponse.status, 410);

  const beyondGraceToken = createMockTestAttemptToken(
    "1",
    1,
    Date.now() - 60 * 1000 - 11 * 1000
  );
  const beyondGraceResponse = await post("/results", {
    mockTestId: "1",
    attemptToken: beyondGraceToken,
    autoSubmit: true,
    answers: []
  });
  assert.equal(beyondGraceResponse.status, 410);

  const [payload, signature] = expiredToken.split(".");
  const changedSignature = `${signature.slice(0, -1)}${signature.endsWith("x") ? "y" : "x"}`;
  const invalidResponse = await post("/results", {
    mockTestId: "1",
    attemptToken: `${payload}.${changedSignature}`,
    answers: []
  });
  assert.equal(invalidResponse.status, 400);
  assert.equal(databaseConnections, 0);
  assert.equal(savedAttempts, 0);
});

test("valid in-time attempt submission keeps the existing scoring path", async () => {
  const attemptToken = createMockTestAttemptToken("1", 2);
  const response = await post("/results", {
    mockTestId: "1",
    attemptToken,
    answers: [{ questionId: "10", selectedOptionId: "11" }]
  });
  const result = await response.json();
  assert.equal(response.status, 201);
  assert.equal(result.data.score, 1);
  assert.equal(result.data.correctAnswers, 1);
  assert.equal(databaseConnections, 1);
  assert.equal(savedAttempts, 1);
});

test("automatic submission is accepted during the bounded deadline delivery grace", async () => {
  const previousSavedAttempts = savedAttempts;
  const justExpiredToken = createMockTestAttemptToken(
    "1",
    1,
    Date.now() - 60 * 1000 - 1000
  );
  const response = await post("/results", {
    mockTestId: "1",
    attemptToken: justExpiredToken,
    autoSubmit: true,
    answers: [{ questionId: "10", selectedOptionId: "11" }]
  });
  const result = await response.json();
  assert.equal(response.status, 201);
  assert.equal(result.data.score, 1);
  assert.equal(result.data.correctAnswers, 1);
  assert.equal(savedAttempts, previousSavedAttempts + 1);
});

test("wrong-question practice requires authentication and returns only owned attempt answers", async () => {
  const unauthorized = await get("/results/attempts/44/wrong-questions");
  assert.equal(unauthorized.status, 401);

  const response = await get(
    "/results/attempts/44/wrong-questions",
    authenticatedCookie
  );
  const result = await response.json();
  assert.equal(response.status, 200);
  assert.equal(result.data.attemptId, "44");
  assert.equal(result.data.testTitle, "PET Mock Test");
  assert.equal(result.data.questions.length, 1);
  assert.deepEqual(result.data.questions[0], {
    id: "20",
    order: 2,
    text: "Which option is correct?",
    type: "mcq",
    difficulty: "easy",
    language: "en",
    explanation: "Review the relevant concept.",
    marks: "1",
    negativeMarks: "0.25",
    topicId: "5",
    topic: "Percentages",
    subjectId: "3",
    subject: "Mathematics",
    options: [
      { id: "101", key: "A", text: "Option A" },
      { id: "102", key: "B", text: "Option B" },
      { id: "103", key: "C", text: "Option C" },
      { id: "104", key: "D", text: "Option D" }
    ],
    correctOption: { id: "103", key: "C", text: "Option C" }
  });

  const inaccessible = await get(
    "/results/attempts/999/wrong-questions",
    authenticatedCookie
  );
  assert.equal(inaccessible.status, 404);
});
