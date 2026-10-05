const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const express = require("express");
const { after, before, test } = require("node:test");
const { hashSessionToken } = require("../middleware/authSession");
const practiceQuestionRoutes = require("./practiceQuestionRoutes");

process.env.SESSION_SECRET = "test-session-secret-that-is-at-least-32-characters";

const sessionToken = crypto.randomBytes(32).toString("base64url");
const sessionCookie = `${sessionToken}.${crypto
  .createHmac("sha256", process.env.SESSION_SECRET)
  .update(sessionToken)
  .digest("base64url")}`;
const sessionHash = hashSessionToken(sessionToken);
const app = express();
let server;
let baseUrl;
let lastFilters;

app.locals.pool = {
  async query(sql, values = []) {
    if (sql.includes("FROM auth_sessions s")) {
      return values[0] === sessionHash
        ? { rowCount: 1, rows: [{ id: "7", name: "Practice User", role: "student" }] }
        : { rowCount: 0, rows: [] };
    }
    if (sql.includes("FROM questions q")) {
      lastFilters = values;
      if (values[2] === "999") {
        return { rowCount: 0, rows: [] };
      }
      return { rowCount: 4, rows: questionRows() };
    }
    throw new Error(`Unexpected query: ${sql}`);
  }
};
app.use("/api/practice/questions", practiceQuestionRoutes);

function questionRows() {
  return ["A", "B", "C", "D"].map((key, index) => ({
    questionId: "42",
    topicId: "31",
    topic: "Civics",
    sectionId: "21",
    section: "General Knowledge",
    examId: "11",
    exam: "Configured Exam",
    question: "Which option is correct?",
    language: "en",
    questionType: "mcq",
    difficulty: "medium",
    marks: "1",
    negativeMarks: "0.25",
    explanation: "Review the relevant concept.",
    optionId: String(101 + index),
    optionKey: key,
    optionText: `Option ${key}`,
    optionIsCorrect: index === 2
  }));
}

before(async () => {
  server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}/api/practice/questions`;
});

after(async () => {
  await new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
});

async function get(path, authenticated = true) {
  const headers = authenticated
    ? { Cookie: `examplatform_session=${sessionCookie}` }
    : {};
  return fetch(`${baseUrl}${path}`, { headers });
}

test("practice question route requires authentication", async () => {
  const response = await get("/", false);
  const result = await response.json();
  assert.equal(response.status, 401);
  assert.equal(result.message, "Authentication required");
});

test("valid filters return practice questions with options, correct answer, and explanation", async () => {
  const response = await get(
    "/?examId=pet&sectionId=21&topicId=31&difficulty=MEDIUM&language=EN"
  );
  const result = await response.json();
  assert.equal(response.status, 200);
  assert.deepEqual(lastFilters, ["pet", "21", "31", "medium", "en"]);
  assert.equal(result.count, 1);
  assert.deepEqual(result.data[0], {
    id: "42",
    topicId: "31",
    topic: "Civics",
    sectionId: "21",
    section: "General Knowledge",
    examId: "11",
    exam: "Configured Exam",
    question: "Which option is correct?",
    language: "en",
    questionType: "mcq",
    difficulty: "medium",
    marks: "1",
    negativeMarks: "0.25",
    explanation: "Review the relevant concept.",
    options: [
      { id: "101", key: "A", text: "Option A" },
      { id: "102", key: "B", text: "Option B" },
      { id: "103", key: "C", text: "Option C" },
      { id: "104", key: "D", text: "Option D" }
    ],
    correctAnswer: { id: "103", key: "C", text: "Option C" }
  });
  assert.equal(response.headers.get("cache-control"), "no-store");
});

test("invalid practice filters are rejected", async () => {
  for (const query of [
    "?examId=bad%20slug",
    "?sectionId=0",
    "?topicId=9223372036854775808",
    "?difficulty=extreme",
    "?language=fr"
  ]) {
    const response = await get(`/${query}`);
    assert.equal(response.status, 400, query);
  }
});

test("practice route returns an empty list when no questions match", async () => {
  const response = await get("/?topicId=999");
  const result = await response.json();
  assert.equal(response.status, 200);
  assert.deepEqual(result, { success: true, count: 0, data: [] });
});
