const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const express = require("express");
const { after, before, beforeEach, test } = require("node:test");

process.env.SESSION_SECRET = "test-session-secret-that-is-at-least-32-characters";

const {
  hashSessionToken
} = require("../middleware/authSession");
const geminiRoutes = require("./geminiRoutes");

const sessions = new Map();
const persisted = {
  questions: [],
  options: [],
  questionGenerations: [],
  generationRequests: []
};
const app = express();
let server;
let baseUrl;
let generationText;
let generationError;
let capturedPrompt;
let generationCalls = 0;
let nextQuestionId = 100;
let nextGenerationRequestId = 500;
let failQuestionInsertAt = null;

app.use(express.json());
app.locals.pool = {
  async query(sql, values) {
    if (sql.includes("FROM auth_sessions s")) {
      return {
        rowCount: sessions.has(values[0]) ? 1 : 0,
        rows: sessions.has(values[0]) ? [sessions.get(values[0])] : []
      };
    }
    if (sql.includes("FROM exams")) {
      return {
        rowCount: 1,
        rows: [{
          id: "11",
          name: "Configured Exam",
          slug: "configured-exam",
          description: "Canonical exam description"
        }]
      };
    }
    if (sql.includes("FROM subjects")) {
      return {
        rowCount: values[0] === "21" && values[1] === "11" ? 1 : 0,
        rows: values[0] === "21" && values[1] === "11"
          ? [{ id: "21", name: "Configured Section", description: "Section context" }]
          : []
      };
    }
    if (sql.includes("FROM topics")) {
      const validSection = values[2] === null || values[2] === "21";
      return {
        rowCount: values[0] === "31" && values[1] === "11" && validSection ? 1 : 0,
        rows: values[0] === "31" && values[1] === "11" && validSection
          ? [{
              id: "31",
              name: "Configured Topic",
              description: "Topic context",
              section_id: "21",
              section_name: "Configured Section",
              section_description: "Section context"
            }]
          : []
      };
    }
    throw new Error("Unexpected test database query");
  },
  async connect() {
    let snapshot;
    let insertedQuestions = 0;
    return {
      async query(sql, values = []) {
        if (sql === "BEGIN") {
          snapshot = structuredClone(persisted);
          insertedQuestions = 0;
          return { rowCount: null, rows: [] };
        }
        if (sql === "COMMIT") {
          snapshot = null;
          return { rowCount: null, rows: [] };
        }
        if (sql === "ROLLBACK") {
          Object.keys(persisted).forEach((key) => {
            persisted[key].splice(0, persisted[key].length, ...snapshot[key]);
          });
          snapshot = null;
          return { rowCount: null, rows: [] };
        }
        if (sql.includes("INSERT INTO ai_generation_requests")) {
          const id = String(nextGenerationRequestId++);
          persisted.generationRequests.push({
            id,
            userId: values[0],
            status: "processing",
            inputData: JSON.parse(values[1])
          });
          return { rowCount: 1, rows: [{ id }] };
        }
        if (sql.includes("pg_advisory_xact_lock")) {
          return { rowCount: 1, rows: [] };
        }
        if (sql.includes("FROM questions q")) {
          const [examId, language, normalizedQuestion] = values;
          const duplicate = persisted.questions.find((question) =>
            question.examId === examId &&
            question.language === language &&
            question.normalizedQuestion === normalizedQuestion
          );
          return {
            rowCount: duplicate ? 1 : 0,
            rows: duplicate ? [{ id: duplicate.id }] : []
          };
        }
        if (sql.includes("INSERT INTO questions")) {
          insertedQuestions += 1;
          if (failQuestionInsertAt === insertedQuestions) {
            throw new Error("Simulated question-bank insert failure");
          }
          const id = String(nextQuestionId++);
          persisted.questions.push({
            id,
            examId: "11",
            topicId: values[0],
            question: values[1],
            normalizedQuestion: values[1].trim().replace(/\s+/g, " ").toLowerCase(),
            language: values[2],
            explanation: values[3],
            difficulty: values[4],
            questionType: "mcq",
            origin: "ai_generated",
            aiGenerated: true,
            reviewStatus: "pending",
            isPublished: false,
            createdBy: values[5]
          });
          return { rowCount: 1, rows: [{ id }] };
        }
        if (sql.includes("INSERT INTO question_options")) {
          persisted.options.push({
            questionId: values[0],
            key: values[1],
            text: values[2],
            isCorrect: values[3]
          });
          return { rowCount: 1, rows: [] };
        }
        if (sql.includes("INSERT INTO ai_question_generations")) {
          persisted.questionGenerations.push({
            questionId: values[0],
            modelName: values[1],
            generatedBy: values[2]
          });
          return { rowCount: 1, rows: [] };
        }
        if (sql.includes("UPDATE ai_generation_requests")) {
          const generationRequest = persisted.generationRequests.find(
            (item) => item.id === values[0]
          );
          generationRequest.status = "completed";
          generationRequest.outputData = JSON.parse(values[1]);
          return { rowCount: 1, rows: [] };
        }
        throw new Error("Unexpected test transaction query");
      },
      release() {}
    };
  }
};

app.locals.genAI = {
  getGenerativeModel() {
    return {
      async generateContent(prompt) {
        generationCalls += 1;
        if (prompt.includes("Reply with exactly:")) {
          return { response: { text: () => "Gemini connection successful" } };
        }
        capturedPrompt = prompt;
        if (generationError) {
          throw generationError;
        }
        return { response: { text: () => generationText } };
      }
    };
  }
};

app.use("/api/gemini", geminiRoutes);

before(async () => {
  server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

beforeEach(() => {
  Object.values(persisted).forEach((items) => {
    items.splice(0, items.length);
  });
  nextQuestionId = 100;
  nextGenerationRequestId = 500;
  failQuestionInsertAt = null;
});

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

function generatedQuestion(overrides = {}) {
  return {
    question: "Which option is correct?",
    options: {
      A: "First option",
      B: "Second option",
      C: "Third option",
      D: "Fourth option"
    },
    correctAnswer: "A",
    explanation: "The first option is correct.",
    language: "en",
    difficulty: "medium",
    ...overrides
  };
}

function requestBody(overrides = {}) {
  return {
    examId: 11,
    sectionId: 21,
    topicId: 31,
    count: 1,
    language: "en",
    difficulty: "medium",
    ...overrides
  };
}

async function postQuestions(body, cookie) {
  return fetch(`${baseUrl}/api/gemini/generate-questions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: cookie } : {})
    },
    body: JSON.stringify(body)
  });
}

test("generation requires an authenticated administrator", async () => {
  const unauthenticated = await postQuestions(requestBody());
  assert.equal(unauthenticated.status, 401);

  const callsBeforeStudent = generationCalls;
  const student = await postQuestions(requestBody(), sessionCookie("student"));
  assert.equal(student.status, 403);
  assert.equal(generationCalls, callsBeforeStudent);
});

test("generation uses canonical context and returns validated structured questions", async () => {
  generationError = null;
  generationText = JSON.stringify({
    questions: [generatedQuestion()]
  });
  const response = await postQuestions(requestBody(), sessionCookie("admin"));
  const result = await response.json();

  assert.equal(response.status, 200);
  assert.equal(result.count, 1);
  assert.equal(result.exam.name, "Configured Exam");
  assert.equal(result.section.name, "Configured Section");
  assert.equal(result.topic.name, "Configured Topic");
  assert.deepEqual(Object.keys(result.data[0]).sort(), [
    "correctAnswer",
    "difficulty",
    "explanation",
    "id",
    "language",
    "options",
    "question"
  ]);
  assert.match(capturedPrompt, /Canonical exam description/);
  assert.match(capturedPrompt, /Configured Section/);
  assert.match(capturedPrompt, /Configured Topic/);

  generationText = JSON.stringify({
    questions: [generatedQuestion({
      language: "hi",
      question: "सही विकल्प चुनें।",
      options: {
        A: "पहला विकल्प",
        B: "दूसरा विकल्प",
        C: "तीसरा विकल्प",
        D: "चौथा विकल्प"
      },
      explanation: "पहला विकल्प सही है।"
    })]
  });
  const hindiResponse = await postQuestions(
    requestBody({ language: "hi" }),
    sessionCookie("admin")
  );
  const hindiResult = await hindiResponse.json();
  assert.equal(hindiResponse.status, 200);
  assert.equal(hindiResult.data[0].language, "hi");
});

test("generation validates count, language, difficulty, and canonical relationships", async () => {
  const cookie = sessionCookie("admin");
  for (const [body, expectedStatus] of [
    [requestBody({ count: 0 }), 400],
    [requestBody({ topicId: undefined, sectionId: undefined }), 400],
    [requestBody({ language: "fr" }), 400],
    [requestBody({ difficulty: "extreme" }), 400],
    [requestBody({ topicId: 32 }), 400]
  ]) {
    const response = await postQuestions(body, cookie);
    assert.equal(response.status, expectedStatus);
  }
});

test("validated questions and AI generation metadata persist with correct option keys atomically", async () => {
  generationError = null;
  generationText = JSON.stringify({
    questions: [
      generatedQuestion(),
      generatedQuestion({
        question: "Which answer is second?",
        correctAnswer: "C"
      })
    ]
  });

  const response = await postQuestions(
    requestBody({ count: 2 }),
    sessionCookie("admin")
  );
  const result = await response.json();

  assert.equal(response.status, 200);
  assert.equal(result.savedCount, 2);
  assert.equal(persisted.questions.length, 2);
  assert.equal(persisted.options.length, 8);
  assert.equal(persisted.questionGenerations.length, 2);
  assert.equal(persisted.generationRequests.length, 1);
  assert.deepEqual(
    persisted.options.slice(0, 4).map(({ key, isCorrect }) => [key, isCorrect]),
    [["A", true], ["B", false], ["C", false], ["D", false]]
  );
  assert.deepEqual(
    persisted.options.slice(4).map(({ key, isCorrect }) => [key, isCorrect]),
    [["A", false], ["B", false], ["C", true], ["D", false]]
  );
  assert.ok(persisted.questions.every((question) =>
    question.topicId === "31" &&
    question.language === "en" &&
    question.difficulty === "medium" &&
    question.questionType === "mcq" &&
    question.origin === "ai_generated" &&
    question.aiGenerated &&
    question.reviewStatus === "pending" &&
    !question.isPublished &&
    question.createdBy === "1"
  ));
  assert.equal(persisted.generationRequests[0].status, "completed");
});

test("a persistence failure rolls back the complete batch", async () => {
  generationError = null;
  generationText = JSON.stringify({
    questions: [
      generatedQuestion(),
      generatedQuestion({ question: "Second question in rollback batch" })
    ]
  });
  failQuestionInsertAt = 2;

  const response = await postQuestions(
    requestBody({ count: 2 }),
    sessionCookie("admin")
  );
  const result = await response.json();
  failQuestionInsertAt = null;

  assert.equal(response.status, 500);
  assert.equal(result.success, false);
  assert.equal(persisted.questions.length, 0);
  assert.equal(persisted.options.length, 0);
  assert.equal(persisted.questionGenerations.length, 0);
  assert.equal(persisted.generationRequests.length, 0);
});

test("exact duplicates are rejected and duplicate batches are rolled back", async () => {
  generationError = null;
  generationText = JSON.stringify({
    questions: [generatedQuestion()]
  });
  const first = await postQuestions(requestBody(), sessionCookie("admin"));
  assert.equal(first.status, 200);
  const countsAfterFirst = {
    questions: persisted.questions.length,
    options: persisted.options.length,
    requests: persisted.generationRequests.length
  };

  generationText = JSON.stringify({
    questions: [generatedQuestion({ question: "  WHICH   OPTION IS CORRECT? " })]
  });
  const duplicate = await postQuestions(requestBody(), sessionCookie("admin"));
  assert.equal(duplicate.status, 409);
  assert.deepEqual({
    questions: persisted.questions.length,
    options: persisted.options.length,
    requests: persisted.generationRequests.length
  }, countsAfterFirst);

  generationText = JSON.stringify({
    questions: [
      generatedQuestion({ question: "First unique batch question" }),
      generatedQuestion({ question: " first   unique batch question " })
    ]
  });
  const duplicateBatch = await postQuestions(
    requestBody({ count: 2 }),
    sessionCookie("admin")
  );
  assert.equal(duplicateBatch.status, 409);
  assert.deepEqual({
    questions: persisted.questions.length,
    options: persisted.options.length,
    requests: persisted.generationRequests.length
  }, countsAfterFirst);
});

test("malformed and invalid model output is rejected without partial data", async () => {
  const cookie = sessionCookie("admin");
  const invalidOutputs = [
    "{not valid JSON",
    JSON.stringify({ questions: [] }),
    JSON.stringify({
      questions: [generatedQuestion({
        options: {
          A: "Same",
          B: " same ",
          C: "Third",
          D: "Fourth"
        }
      })]
    }),
    JSON.stringify({
      questions: [generatedQuestion({
        options: { A: "First", B: "Second", C: "Third" }
      })]
    }),
    JSON.stringify({
      questions: [generatedQuestion({ correctAnswer: "E" })]
    }),
    JSON.stringify({
      questions: [generatedQuestion({ question: "  " })]
    }),
    JSON.stringify({
      questions: [generatedQuestion({ explanation: "  " })]
    }),
    JSON.stringify({
      questions: [generatedQuestion({ language: "fr" })]
    }),
    JSON.stringify({
      questions: [generatedQuestion({ difficulty: "expert" })]
    }),
    JSON.stringify({
      questions: [generatedQuestion({ language: "hi" })]
    }),
    JSON.stringify({
      questions: [generatedQuestion({ difficulty: "hard" })]
    })
  ];

  for (const output of invalidOutputs) {
    generationText = output;
    generationError = null;
    const response = await postQuestions(requestBody(), cookie);
    const result = await response.json();
    assert.equal(response.status, 502);
    assert.equal(result.success, false);
    assert.equal(Object.hasOwn(result, "data"), false);
    assert.equal(JSON.stringify(result).includes(output), false);
  }
});

test("provider errors are returned safely and the Gemini test route remains available", async () => {
  generationError = new Error("provider error containing a secret");
  const failedGeneration = await postQuestions(requestBody(), sessionCookie("admin"));
  const failureBody = await failedGeneration.text();
  assert.equal(failedGeneration.status, 502);
  assert.equal(failureBody.includes("provider error containing a secret"), false);

  generationError = null;
  const testResponse = await fetch(`${baseUrl}/api/gemini/test`);
  const testBody = await testResponse.json();
  assert.equal(testResponse.status, 200);
  assert.equal(testBody.message, "Gemini connection successful");
});
