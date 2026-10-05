const express = require("express");
const {
  requireAdminRole,
  requireAuthenticatedUser
} = require("../middleware/authSession");

const router = express.Router();
const MAX_DATABASE_ID = 9223372036854775807n;
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;
const DIFFICULTIES = new Set(["easy", "medium", "hard"]);
const LANGUAGES = new Set(["en", "hi"]);
const REVIEW_STATUSES = new Set(["pending", "approved", "rejected"]);
const QUESTION_ORIGINS = new Set(["manual", "ai_generated", "pyq"]);
const OPTION_KEYS = ["A", "B", "C", "D"];
const EDIT_FIELDS = new Set([
  "question",
  "options",
  "correctAnswer",
  "explanation",
  "language",
  "difficulty"
]);

router.use(requireAuthenticatedUser, requireAdminRole);

function databaseId(value) {
  const text = String(value);
  if (
    text.length > 19 ||
    !/^[1-9]\d*$/.test(text) ||
    BigInt(text) > MAX_DATABASE_ID
  ) {
    return null;
  }
  return text;
}

function queryValue(value, name, maxLength) {
  if (value === undefined) {
    return { value: undefined };
  }
  if (typeof value !== "string" || value.length > maxLength) {
    return { error: `${name} is invalid` };
  }
  return { value: value.trim() || undefined };
}

function parseInventoryQuery(query) {
  const filters = {};
  for (const [name, target] of [
    ["examId", "examId"],
    ["sectionId", "sectionId"],
    ["topicId", "topicId"]
  ]) {
    const parsed = queryValue(query[name], name, 19);
    if (parsed.error) {
      return { error: parsed.error };
    }
    if (parsed.value !== undefined) {
      filters[target] = databaseId(parsed.value);
      if (!filters[target]) {
        return { error: `${name} must be a positive database ID` };
      }
    }
  }

  for (const [name, allowed] of [
    ["language", LANGUAGES],
    ["difficulty", DIFFICULTIES],
    ["reviewStatus", REVIEW_STATUSES],
    ["origin", QUESTION_ORIGINS]
  ]) {
    const parsed = queryValue(query[name], name, 30);
    if (parsed.error) {
      return { error: parsed.error };
    }
    if (parsed.value !== undefined) {
      const normalized = parsed.value.toLowerCase();
      if (!allowed.has(normalized)) {
        return { error: `${name} is invalid` };
      }
      filters[name] = normalized;
    }
  }

  const published = queryValue(query.published, "published", 5);
  if (published.error) {
    return { error: published.error };
  }
  if (published.value !== undefined) {
    if (!["true", "false"].includes(published.value.toLowerCase())) {
      return { error: "published must be true or false" };
    }
    filters.published = published.value.toLowerCase() === "true";
  }

  const search = queryValue(query.search, "search", 200);
  if (search.error) {
    return { error: search.error };
  }
  filters.search = search.value;

  const source = queryValue(query.source, "source", 150);
  if (source.error) {
    return { error: source.error };
  }
  filters.source = source.value;

  const pageText = queryValue(query.page, "page", 16);
  if (pageText.error) {
    return { error: pageText.error };
  }
  if (pageText.value !== undefined && !/^\d+$/.test(pageText.value)) {
    return { error: "page must be a positive integer" };
  }
  const page = pageText.value === undefined ? 1 : Number(pageText.value);
  if (!Number.isSafeInteger(page) || page < 1) {
    return { error: "page must be a positive integer" };
  }

  const pageSizeText = queryValue(query.pageSize, "pageSize", 3);
  if (pageSizeText.error) {
    return { error: pageSizeText.error };
  }
  if (pageSizeText.value !== undefined && !/^\d+$/.test(pageSizeText.value)) {
    return { error: `pageSize must be between 1 and ${MAX_PAGE_SIZE}` };
  }
  const pageSize =
    pageSizeText.value === undefined ? DEFAULT_PAGE_SIZE : Number(pageSizeText.value);
  if (
    !Number.isSafeInteger(pageSize) ||
    pageSize < 1 ||
    pageSize > MAX_PAGE_SIZE
  ) {
    return { error: `pageSize must be between 1 and ${MAX_PAGE_SIZE}` };
  }
  if (page - 1 > Math.floor(Number.MAX_SAFE_INTEGER / pageSize)) {
    return { error: "page is too large" };
  }

  return { value: { filters, page, pageSize } };
}

function validateEdit(body) {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return { error: "A question edit object is required" };
  }
  if (
    Object.keys(body).length !== EDIT_FIELDS.size ||
    Object.keys(body).some((field) => !EDIT_FIELDS.has(field))
  ) {
    return { error: "Only question content, options, language, and difficulty can be edited" };
  }
  if (typeof body.question !== "string" || !body.question.trim()) {
    return { error: "question must be a non-empty string" };
  }
  if (typeof body.explanation !== "string" || !body.explanation.trim()) {
    return { error: "explanation must be a non-empty string" };
  }
  if (!LANGUAGES.has(body.language)) {
    return { error: "language must be en or hi" };
  }
  if (!DIFFICULTIES.has(body.difficulty)) {
    return { error: "difficulty must be easy, medium, or hard" };
  }
  if (
    body.options === null ||
    typeof body.options !== "object" ||
    Array.isArray(body.options) ||
    Object.keys(body.options).length !== OPTION_KEYS.length ||
    Object.keys(body.options).some((key) => !OPTION_KEYS.includes(key)) ||
    OPTION_KEYS.some((key) =>
      typeof body.options[key] !== "string" || !body.options[key].trim()
    )
  ) {
    return { error: "options must contain non-empty A, B, C, and D values" };
  }
  const distinctOptions = new Set(
    OPTION_KEYS.map((key) =>
      body.options[key].trim().replace(/\s+/g, " ").toLocaleLowerCase()
    )
  );
  if (distinctOptions.size !== OPTION_KEYS.length) {
    return { error: "All four options must be distinct" };
  }
  if (!OPTION_KEYS.includes(body.correctAnswer)) {
    return { error: "correctAnswer must be A, B, C, or D" };
  }
  return {
    value: {
      question: body.question.trim(),
      options: Object.fromEntries(
        OPTION_KEYS.map((key) => [key, body.options[key].trim()])
      ),
      correctAnswer: body.correctAnswer,
      explanation: body.explanation.trim(),
      language: body.language,
      difficulty: body.difficulty
    }
  };
}

function questionSelect() {
  return `
    SELECT q.id, q.topic_id AS "topicId", t.name AS "topicName",
           s.id AS "sectionId", s.name AS "sectionName",
           e.id AS "examId", e.name AS "examName",
           q.question_text AS question, q.question_type AS "questionType",
           q.explanation, q.language,
           q.difficulty, q.question_origin AS "questionOrigin",
           q.ai_generated AS "aiGenerated", q.review_status AS "reviewStatus",
           q.is_published AS "isPublished", q.created_by AS "createdBy",
           creator.name AS "creatorName",
           q.reviewed_by AS "reviewedBy", reviewer.name AS "reviewerName",
           q.reviewed_at AS "reviewedAt", q.source,
           q.source_year AS "sourceYear", q.source_exam AS "sourceExam",
           q.created_at AS "createdAt",
           COALESCE((
             SELECT jsonb_object_agg(
               qo.option_key,
               jsonb_build_object('text', qo.option_text, 'isCorrect', qo.is_correct)
             )
             FROM question_options qo
             WHERE qo.question_id = q.id
           ), '{}'::jsonb) AS options
    FROM questions q
    INNER JOIN topics t ON t.id = q.topic_id
    INNER JOIN subjects s ON s.id = t.subject_id
    INNER JOIN exams e ON e.id = s.exam_id
    LEFT JOIN users creator ON creator.id = q.created_by
    LEFT JOIN users reviewer ON reviewer.id = q.reviewed_by
  `;
}

router.get("/", async (req, res) => {
  const parsed = parseInventoryQuery(req.query);
  if (parsed.error) {
    return res.status(400).json({ success: false, message: parsed.error });
  }
  const { filters, page, pageSize } = parsed.value;
  const conditions = [];
  const values = [];
  const addCondition = (sql, value) => {
    values.push(value);
    conditions.push(sql.replace("?", `$${values.length}`));
  };

  if (filters.examId) addCondition("e.id = ?", filters.examId);
  if (filters.sectionId) addCondition("s.id = ?", filters.sectionId);
  if (filters.topicId) addCondition("t.id = ?", filters.topicId);
  if (filters.language) addCondition("q.language = ?", filters.language);
  if (filters.difficulty) addCondition("q.difficulty = ?", filters.difficulty);
  if (filters.reviewStatus) {
    addCondition("q.review_status = ?", filters.reviewStatus);
  }
  if (filters.published !== undefined) {
    addCondition("q.is_published = ?", filters.published);
  }
  if (filters.origin) {
    addCondition("q.question_origin = ?", filters.origin);
  }
  if (filters.search) {
    addCondition(
      "position(lower(?) in lower(q.question_text)) > 0",
      filters.search
    );
  }
  if (filters.source) {
    addCondition("position(lower(?) in lower(COALESCE(q.source, ''))) > 0", filters.source);
  }
  const whereClause = conditions.length
    ? `WHERE ${conditions.join("\n         AND ")}`
    : "";

  try {
    const pool = req.app.locals.pool;
    const countResult = await pool.query(
      `SELECT COUNT(*) AS "totalCount"
       FROM questions q
       INNER JOIN topics t ON t.id = q.topic_id
       INNER JOIN subjects s ON s.id = t.subject_id
       INNER JOIN exams e ON e.id = s.exam_id
       ${whereClause}`,
      values
    );
    const totalCount = Number(countResult.rows[0].totalCount);
    const result = await pool.query(
      `${questionSelect()}
       ${whereClause}
       ORDER BY q.created_at DESC, q.id DESC
       LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
      [...values, pageSize, (page - 1) * pageSize]
    );
    return res.json({
      success: true,
      count: result.rowCount,
      totalCount,
      page,
      pageSize,
      totalPages: Math.ceil(totalCount / pageSize),
      data: result.rows
    });
  } catch (error) {
    console.error("Unable to list Question Bank inventory:", error.message);
    return res.status(500).json({
      success: false,
      message: "Question Bank inventory could not be loaded"
    });
  }
});

router.get("/:questionId", async (req, res) => {
  const questionId = databaseId(req.params.questionId);
  if (!questionId) {
    return res.status(400).json({ success: false, message: "Invalid question ID" });
  }
  try {
    const result = await req.app.locals.pool.query(
      `${questionSelect()}
       WHERE q.id = $1`,
      [questionId]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({
        success: false,
        message: "Question not found"
      });
    }
    return res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    console.error("Unable to load Question Bank question:", error.message);
    return res.status(500).json({
      success: false,
      message: "Question could not be loaded"
    });
  }
});

router.patch("/:questionId", async (req, res) => {
  const questionId = databaseId(req.params.questionId);
  if (!questionId) {
    return res.status(400).json({ success: false, message: "Invalid question ID" });
  }
  const validation = validateEdit(req.body);
  if (validation.error) {
    return res.status(400).json({ success: false, message: validation.error });
  }

  let client;
  let transactionStarted = false;
  try {
    client = await req.app.locals.pool.connect();
    await client.query("BEGIN");
    transactionStarted = true;
    const current = await client.query(
      `SELECT id, ai_generated, review_status, is_published
       FROM questions WHERE id = $1 FOR UPDATE`,
      [questionId]
    );
    if (current.rowCount === 0) {
      await client.query("ROLLBACK");
      transactionStarted = false;
      return res.status(404).json({ success: false, message: "Question not found" });
    }
    const question = current.rows[0];
    if (
      !question.ai_generated ||
      question.review_status !== "pending" ||
      question.is_published
    ) {
      await client.query("ROLLBACK");
      transactionStarted = false;
      return res.status(409).json({
        success: false,
        message: "Only unpublished pending AI-generated questions can be edited"
      });
    }

    const edit = validation.value;
    await client.query(
      `UPDATE questions
       SET question_text = $2, explanation = $3, language = $4, difficulty = $5
       WHERE id = $1`,
      [questionId, edit.question, edit.explanation, edit.language, edit.difficulty]
    );
    for (const key of OPTION_KEYS) {
      const updated = await client.query(
        `UPDATE question_options
         SET option_text = $3, is_correct = $4
         WHERE question_id = $1 AND option_key = $2`,
        [questionId, key, edit.options[key], edit.correctAnswer === key]
      );
      if (updated.rowCount !== 1) {
        throw new Error("Question option set is incomplete");
      }
    }
    await client.query("COMMIT");
    transactionStarted = false;
    return res.json({
      success: true,
      message: "Question updated",
      data: { id: questionId, ...edit }
    });
  } catch (error) {
    if (transactionStarted) {
      await client.query("ROLLBACK");
    }
    console.error("Unable to edit pending AI question:", error.message);
    return res.status(500).json({
      success: false,
      message: "Question could not be updated"
    });
  } finally {
    if (client) {
      client.release();
    }
  }
});

async function setReviewStatus(req, res, status) {
  const questionId = databaseId(req.params.questionId);
  if (!questionId) {
    return res.status(400).json({ success: false, message: "Invalid question ID" });
  }
  try {
    const result = await req.app.locals.pool.query(
      `UPDATE questions
       SET review_status = $2, reviewed_by = $3, reviewed_at = NOW()
       WHERE id = $1
         AND ai_generated = TRUE
         AND review_status = 'pending'
         AND is_published = FALSE
       RETURNING id, review_status AS "reviewStatus", is_published AS "isPublished"`,
      [questionId, status, req.user.id]
    );
    if (result.rowCount === 0) {
      const existing = await req.app.locals.pool.query(
        `SELECT ai_generated, review_status, is_published
         FROM questions WHERE id = $1`,
        [questionId]
      );
      if (existing.rowCount === 0) {
        return res.status(404).json({ success: false, message: "Question not found" });
      }
      return res.status(409).json({
        success: false,
        message: "Only unpublished pending AI-generated questions can be reviewed"
      });
    }
    return res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    console.error(`Unable to ${status} AI question:`, error.message);
    return res.status(500).json({
      success: false,
      message: "Question review could not be saved"
    });
  }
}

router.post("/:questionId/approve", (req, res) =>
  setReviewStatus(req, res, "approved")
);

router.post("/:questionId/reject", (req, res) =>
  setReviewStatus(req, res, "rejected")
);

router.post("/:questionId/publish", async (req, res) => {
  const questionId = databaseId(req.params.questionId);
  if (!questionId) {
    return res.status(400).json({ success: false, message: "Invalid question ID" });
  }

  try {
    const result = await req.app.locals.pool.query(
      `UPDATE questions
       SET is_published = TRUE
       WHERE id = $1
         AND ai_generated = TRUE
         AND review_status = 'approved'
         AND is_published = FALSE
       RETURNING id, review_status AS "reviewStatus", is_published AS "isPublished"`,
      [questionId]
    );
    if (result.rowCount === 0) {
      const existing = await req.app.locals.pool.query(
        `SELECT id FROM questions WHERE id = $1`,
        [questionId]
      );
      if (existing.rowCount === 0) {
        return res.status(404).json({ success: false, message: "Question not found" });
      }
      return res.status(409).json({
        success: false,
        message: "Only approved unpublished AI-generated questions can be published"
      });
    }
    return res.json({
      success: true,
      message: "Question published",
      data: result.rows[0]
    });
  } catch (error) {
    console.error("Unable to publish approved AI question:", error.message);
    return res.status(500).json({
      success: false,
      message: "Question could not be published"
    });
  }
});

module.exports = router;
