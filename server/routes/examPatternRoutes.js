const express = require("express");
const {
  requireAdminRole,
  requireAuthenticatedUser
} = require("../middleware/authSession");

const router = express.Router();
const MAX_DATABASE_ID = 9223372036854775807n;
const MAX_INTEGER = 2147483647;
const DIFFICULTIES = new Set(["easy", "medium", "hard"]);
const LANGUAGES = new Set(["en", "hi"]);
const QUESTION_TYPES = new Set(["mcq", "true_false"]);
const DISTRIBUTIONS = new Set(["difficulty", "language", "question_type"]);
const ALLOWED_VALUES = {
  difficulty: DIFFICULTIES,
  language: LANGUAGES,
  question_type: QUESTION_TYPES
};

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

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

function positiveInteger(value) {
  return Number.isInteger(value) && value > 0 && value <= MAX_INTEGER;
}

function nonNegativeNumber(value, decimals = 2, max = 999999.99) {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= max &&
    Number(value.toFixed(decimals)) === value
  );
}

function validateAllocations(items, expectedCount, label) {
  if (!Array.isArray(items)) {
    return `${label} must be an array`;
  }

  const allocations = new Map();

  for (const item of items) {
    if (!isRecord(item) || typeof item.value !== "string") {
      return `${label} entries require a value`;
    }
    const value = item.value.trim().toLowerCase();
    if (
      !DISTRIBUTIONS.has(item.dimension) ||
      !ALLOWED_VALUES[item.dimension].has(value)
    ) {
      return `${label} contains an unsupported value`;
    }
    if (!allocations.has(item.dimension)) {
      allocations.set(item.dimension, {
        seen: new Set(),
        modes: new Set(),
        countTotal: 0,
        weightTotal: 0
      });
    }
    const allocation = allocations.get(item.dimension);
    const key = `${item.dimension}:${value}`;
    if (allocation.seen.has(key)) {
      return `${label} contains a duplicate value`;
    }
    allocation.seen.add(key);

    const hasCount = item.questionCount !== undefined;
    const hasWeight = item.weight !== undefined;
    if (hasCount === hasWeight) {
      return `${label} entries require either questionCount or weight`;
    }
    if (hasCount) {
      if (!positiveInteger(item.questionCount)) {
        return `${label} questionCount values must be positive integers`;
      }
      allocation.modes.add("count");
      allocation.countTotal += item.questionCount;
    } else {
      if (
        !nonNegativeNumber(item.weight, 4) ||
        item.weight <= 0 ||
        item.weight > 100
      ) {
        return `${label} weights must be greater than 0 and at most 100`;
      }
      allocation.modes.add("weight");
      allocation.weightTotal += item.weight;
    }
  }

  for (const allocation of allocations.values()) {
    if (allocation.modes.size > 1) {
      return `${label} cannot mix question counts and weights within a distribution`;
    }
    if (
      allocation.modes.has("count") &&
      allocation.countTotal !== expectedCount
    ) {
      return `${label} question counts must total ${expectedCount} per dimension`;
    }
    if (
      allocation.modes.has("weight") &&
      Math.abs(allocation.weightTotal - 100) > 0.0001
    ) {
      return `${label} weights must total 100 per dimension`;
    }
  }
  return null;
}

function validatePatternInput(body) {
  if (!isRecord(body)) {
    return { error: "A pattern configuration object is required" };
  }

  const examId = databaseId(body.examId);
  if (!examId) {
    return { error: "examId must be a positive database ID" };
  }
  if (typeof body.name !== "string" || !body.name.trim() || body.name.trim().length > 150) {
    return { error: "name is required and must be at most 150 characters" };
  }
  if (!positiveInteger(body.version)) {
    return { error: "version must be a positive integer" };
  }
  if (!positiveInteger(body.totalQuestions)) {
    return { error: "totalQuestions must be a positive integer" };
  }
  if (!nonNegativeNumber(body.totalMarks, 2, 99999999.99)) {
    return { error: "totalMarks must be a non-negative number with at most 2 decimals" };
  }
  if (!positiveInteger(body.durationMinutes)) {
    return { error: "durationMinutes must be a positive integer" };
  }
  if (
    body.negativeMarking !== undefined &&
    !nonNegativeNumber(body.negativeMarking)
  ) {
    return { error: "negativeMarking must be a non-negative number with at most 2 decimals" };
  }
  if (!Array.isArray(body.sections) || body.sections.length === 0) {
    return { error: "At least one section rule is required" };
  }
  if (body.status !== undefined) {
    return { error: "New patterns must be created as drafts" };
  }

  const sections = [];
  const subjectIds = new Set();
  const sectionOrders = new Set();
  const allTopicIds = new Set();
  let questionTotal = 0;
  let markTotal = 0;

  for (const input of body.sections) {
    if (!isRecord(input)) {
      return { error: "Each section rule must be an object" };
    }
    const subjectId = databaseId(input.subjectId);
    if (!subjectId) {
      return { error: "Each section requires a valid subjectId" };
    }
    if (subjectIds.has(subjectId)) {
      return { error: "Duplicate section rules are not allowed" };
    }
    if (!positiveInteger(input.order) || sectionOrders.has(input.order)) {
      return { error: "Section order values must be unique positive integers" };
    }
    if (!positiveInteger(input.questionCount)) {
      return { error: "Section questionCount must be a positive integer" };
    }
    if (!nonNegativeNumber(input.marksPerQuestion)) {
      return { error: "marksPerQuestion must be non-negative with at most 2 decimals" };
    }
    if (
      input.weight !== undefined &&
      (!nonNegativeNumber(input.weight, 4, 100) || input.weight <= 0)
    ) {
      return { error: "Section weight must be greater than zero" };
    }

    const section = {
      subjectId,
      order: input.order,
      questionCount: input.questionCount,
      marksPerQuestion: input.marksPerQuestion,
      weight: input.weight ?? null,
      topics: [],
      distributions: []
    };
    subjectIds.add(subjectId);
    sectionOrders.add(input.order);
    questionTotal += input.questionCount;
    markTotal += input.questionCount * input.marksPerQuestion;

    if (input.topics !== undefined) {
      if (!Array.isArray(input.topics)) {
        return { error: "Section topics must be an array" };
      }
      let topicCountTotal = 0;
      let topicWeightTotal = 0;
      let topicMode = null;
      for (const topic of input.topics) {
        if (!isRecord(topic)) {
          return { error: "Each topic rule must be an object" };
        }
        const topicId = databaseId(topic.topicId);
        if (!topicId || allTopicIds.has(topicId)) {
          return { error: "Topic rules require unique valid topic IDs" };
        }
        const hasCount = topic.questionCount !== undefined;
        const hasWeight = topic.weight !== undefined;
        if (hasCount === hasWeight) {
          return { error: "Each topic rule requires questionCount or weight" };
        }
        if (hasCount) {
          if (!positiveInteger(topic.questionCount)) {
            return { error: "Topic questionCount values must be positive integers" };
          }
          topicMode = topicMode && topicMode !== "count" ? "mixed" : "count";
          topicCountTotal += topic.questionCount;
        } else {
          if (
            !nonNegativeNumber(topic.weight, 4) ||
            topic.weight <= 0 ||
            topic.weight > 100
          ) {
            return { error: "Topic weights must be greater than 0 and at most 100" };
          }
          topicMode = topicMode && topicMode !== "weight" ? "mixed" : "weight";
          topicWeightTotal += topic.weight;
        }
        allTopicIds.add(topicId);
        section.topics.push({
          topicId,
          questionCount: hasCount ? topic.questionCount : null,
          weight: hasWeight ? topic.weight : null
        });
      }
      if (
        topicMode === "mixed" ||
        (topicMode === "count" && topicCountTotal !== section.questionCount) ||
        (topicMode === "weight" && Math.abs(topicWeightTotal - 100) > 0.0001)
      ) {
        return {
          error: `Topic rules for section ${section.order} must use one allocation method and cover its full question count`
        };
      }
    }

    if (input.distributions !== undefined) {
      if (!Array.isArray(input.distributions)) {
        return { error: "Section distributions must be an array" };
      }
      const distributions = input.distributions.map((rule) => ({
        ...rule,
        dimension: typeof rule?.dimension === "string"
          ? rule.dimension.trim().toLowerCase()
          : ""
      }));
      if (distributions.some((rule) => !DISTRIBUTIONS.has(rule.dimension))) {
        return { error: "Section distributions have an invalid dimension" };
      }
      const distributionError = validateAllocations(
        distributions,
        section.questionCount,
        `Section ${section.order} distributions`
      );
      if (distributionError) {
        return { error: distributionError };
      }
      section.distributions = distributions.map((rule) => ({
        dimension: rule.dimension,
        value: rule.value.trim().toLowerCase(),
        questionCount: rule.questionCount ?? null,
        weight: rule.weight ?? null
      }));
    }
    sections.push(section);
  }

  if (questionTotal !== body.totalQuestions) {
    return { error: "Section question counts must total totalQuestions" };
  }
  if (Math.abs(markTotal - body.totalMarks) > 0.005) {
    return { error: "Section question counts and marksPerQuestion must total totalMarks" };
  }
  const weightedSections = sections.filter((section) => section.weight !== null);
  if (
    weightedSections.length > 0 &&
    (
      weightedSections.length !== sections.length ||
      Math.abs(weightedSections.reduce((sum, section) => sum + section.weight, 0) - 100) > 0.0001
    )
  ) {
    return { error: "Section weights must be provided for every section and total 100" };
  }

  const distributionsInput = body.distributions ?? [];
  const normalizedDistributions = Array.isArray(distributionsInput)
    ? distributionsInput.map((rule) => ({
        ...rule,
        dimension: typeof rule?.dimension === "string"
          ? rule.dimension.trim().toLowerCase()
          : ""
      }))
    : null;
  if (!normalizedDistributions) {
    return { error: "distributions must be an array" };
  }
  if (normalizedDistributions.some((rule) => !DISTRIBUTIONS.has(rule.dimension))) {
    return { error: "Pattern distributions have an invalid dimension" };
  }
  const distributionError = validateAllocations(
    normalizedDistributions,
    body.totalQuestions,
    "Pattern distributions"
  );
  if (distributionError) {
    return { error: distributionError };
  }

  const globalDimensions = new Set(normalizedDistributions.map((rule) => rule.dimension));
  if (sections.some((section) =>
    section.distributions.some((rule) => globalDimensions.has(rule.dimension))
  )) {
    return { error: "A distribution dimension cannot be configured both globally and per section" };
  }

  return {
    value: {
      examId,
      name: body.name.trim(),
      version: body.version,
      totalQuestions: body.totalQuestions,
      totalMarks: body.totalMarks,
      durationMinutes: body.durationMinutes,
      negativeMarking: body.negativeMarking ?? 0,
      sections,
      distributions: normalizedDistributions.map((rule) => ({
        dimension: rule.dimension,
        value: rule.value.trim().toLowerCase(),
        questionCount: rule.questionCount ?? null,
        weight: rule.weight ?? null
      }))
    }
  };
}

async function loadPattern(pool, patternId) {
  const patternResult = await pool.query(
    `
    SELECT p.id, p.exam_id AS "examId", e.name AS "examName",
           e.slug AS "examSlug", e.is_active AS "examIsActive",
           p.name, p.version,
           p.total_questions AS "totalQuestions",
           p.total_marks AS "totalMarks",
           p.duration_minutes AS "durationMinutes",
           p.negative_marking AS "negativeMarking",
           p.status, p.created_at AS "createdAt", p.updated_at AS "updatedAt"
    FROM exam_patterns p
    INNER JOIN exams e ON e.id = p.exam_id
    WHERE p.id = $1
    `,
    [patternId]
  );
  if (patternResult.rowCount === 0) {
    return null;
  }

  const [sectionsResult, topicsResult, distributionsResult] = await Promise.all([
    pool.query(
      `
      SELECT ps.id, ps.subject_id AS "subjectId", s.name AS "sectionName",
             ps.section_order AS "order", ps.question_count AS "questionCount",
             ps.marks_per_question AS "marksPerQuestion", ps.weight
      FROM exam_pattern_sections ps
      INNER JOIN subjects s ON s.id = ps.subject_id
      WHERE ps.exam_pattern_id = $1
      ORDER BY ps.section_order
      `,
      [patternId]
    ),
    pool.query(
      `
      SELECT pt.section_rule_id AS "sectionRuleId", pt.topic_id AS "topicId",
             t.name AS "topicName", pt.question_count AS "questionCount", pt.weight
      FROM exam_pattern_topics pt
      INNER JOIN topics t ON t.id = pt.topic_id
      WHERE pt.exam_pattern_id = $1
      ORDER BY pt.section_rule_id, pt.id
      `,
      [patternId]
    ),
    pool.query(
      `
      SELECT section_rule_id AS "sectionRuleId", dimension, value,
             question_count AS "questionCount", weight
      FROM exam_pattern_distributions
      WHERE exam_pattern_id = $1
      ORDER BY section_rule_id NULLS FIRST, dimension, value
      `,
      [patternId]
    )
  ]);

  const sections = sectionsResult.rows.map((section) => ({
    ...section,
    topics: topicsResult.rows
      .filter((topic) => String(topic.sectionRuleId) === String(section.id))
      .map(({ sectionRuleId, ...topic }) => topic),
    distributions: distributionsResult.rows
      .filter((rule) => String(rule.sectionRuleId) === String(section.id))
      .map(({ sectionRuleId, ...rule }) => rule)
  }));
  return {
    ...patternResult.rows[0],
    sections,
    distributions: distributionsResult.rows
      .filter((rule) => rule.sectionRuleId === null)
      .map(({ sectionRuleId, ...rule }) => rule)
  };
}

async function insertDistributions(client, patternId, sectionRuleId, rules) {
  for (const rule of rules) {
    await client.query(
      `
      INSERT INTO exam_pattern_distributions
        (exam_pattern_id, section_rule_id, dimension, value, question_count, weight)
      VALUES ($1, $2, $3, $4, $5, $6)
      `,
      [
        patternId,
        sectionRuleId,
        rule.dimension,
        rule.value,
        rule.questionCount,
        rule.weight
      ]
    );
  }
}

router.get("/", async (req, res) => {
  const examId = typeof req.query.examId === "string"
    ? req.query.examId.trim()
    : null;
  if (examId && !/^(?:[1-9]\d{0,18}|[a-z0-9-]{1,180})$/i.test(examId)) {
    return res.status(400).json({
      success: false,
      message: "examId must be a database ID or exam slug"
    });
  }
  try {
    const result = await req.app.locals.pool.query(
      `
      SELECT p.id, p.exam_id AS "examId", e.name AS "examName",
             e.slug AS "examSlug", p.name, p.version,
             p.total_questions AS "totalQuestions",
             p.total_marks AS "totalMarks",
             p.duration_minutes AS "durationMinutes",
             p.negative_marking AS "negativeMarking",
             p.status, p.created_at AS "createdAt"
      FROM exam_patterns p
      INNER JOIN exams e ON e.id = p.exam_id
      WHERE p.status = 'active'
        AND e.is_active = TRUE
        AND ($1::text IS NULL OR e.id::text = $1 OR e.slug = $1)
      ORDER BY e.id, p.name, p.version DESC
      `,
      [examId || null]
    );
    return res.json({ success: true, count: result.rowCount, data: result.rows });
  } catch (error) {
    console.error("Unable to list active exam patterns:", error.message);
    return res.status(500).json({
      success: false,
      message: "Exam patterns could not be loaded"
    });
  }
});

router.get("/admin", requireAuthenticatedUser, requireAdminRole, async (req, res) => {
  const examId = typeof req.query.examId === "string"
    ? req.query.examId.trim()
    : null;
  if (examId && !/^(?:[1-9]\d{0,18}|[a-z0-9-]{1,180})$/i.test(examId)) {
    return res.status(400).json({
      success: false,
      message: "examId must be a database ID or exam slug"
    });
  }
  try {
    const result = await req.app.locals.pool.query(
      `
      SELECT p.id, p.exam_id AS "examId", e.name AS "examName",
             e.slug AS "examSlug", p.name, p.version,
             p.total_questions AS "totalQuestions",
             p.total_marks AS "totalMarks",
             p.duration_minutes AS "durationMinutes",
             p.negative_marking AS "negativeMarking",
             p.status, p.created_at AS "createdAt"
      FROM exam_patterns p
      INNER JOIN exams e ON e.id = p.exam_id
      WHERE ($1::text IS NULL OR e.id::text = $1 OR e.slug = $1)
      ORDER BY e.id, p.name, p.version DESC
      `,
      [examId || null]
    );
    return res.json({ success: true, count: result.rowCount, data: result.rows });
  } catch (error) {
    console.error("Unable to list exam patterns for administration:", error.message);
    return res.status(500).json({
      success: false,
      message: "Exam patterns could not be loaded"
    });
  }
});

router.get("/admin/:patternId", requireAuthenticatedUser, requireAdminRole, async (req, res) => {
  const patternId = databaseId(req.params.patternId);
  if (!patternId) {
    return res.status(400).json({ success: false, message: "Invalid pattern ID" });
  }
  try {
    const pattern = await loadPattern(req.app.locals.pool, patternId);
    if (!pattern) {
      return res.status(404).json({ success: false, message: "Exam pattern not found" });
    }
    return res.json({ success: true, data: pattern });
  } catch (error) {
    console.error("Unable to load exam pattern for administration:", error.message);
    return res.status(500).json({
      success: false,
      message: "Exam pattern could not be loaded"
    });
  }
});

router.get("/:patternId", async (req, res) => {
  const patternId = databaseId(req.params.patternId);
  if (!patternId) {
    return res.status(400).json({ success: false, message: "Invalid pattern ID" });
  }
  try {
    const pattern = await loadPattern(req.app.locals.pool, patternId);
    if (!pattern || pattern.status !== "active" || !pattern.examIsActive) {
      return res.status(404).json({ success: false, message: "Exam pattern not found" });
    }
    return res.json({ success: true, data: pattern });
  } catch (error) {
    console.error("Unable to load active exam pattern:", error.message);
    return res.status(500).json({
      success: false,
      message: "Exam pattern could not be loaded"
    });
  }
});

router.post("/", requireAuthenticatedUser, requireAdminRole, async (req, res) => {
  const validation = validatePatternInput(req.body);
  if (validation.error) {
    return res.status(400).json({ success: false, message: validation.error });
  }
  const pattern = validation.value;
  const pool = req.app.locals.pool;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const examResult = await client.query(
      "SELECT id FROM exams WHERE id = $1",
      [pattern.examId]
    );
    if (examResult.rowCount === 0) {
      await client.query("ROLLBACK");
      return res.status(400).json({ success: false, message: "Exam does not exist" });
    }

    const subjectIds = pattern.sections.map((section) => section.subjectId);
    const subjectsResult = await client.query(
      `
      SELECT id FROM subjects
      WHERE exam_id = $1
        AND is_active = TRUE
        AND id = ANY($2::bigint[])
      `,
      [pattern.examId, subjectIds]
    );
    if (subjectsResult.rowCount !== subjectIds.length) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        success: false,
        message: "Every section must reference a subject belonging to the selected exam"
      });
    }

    const topicIds = pattern.sections.flatMap((section) =>
      section.topics.map((topic) => topic.topicId)
    );
    if (topicIds.length > 0) {
      const topicsResult = await client.query(
        `
        SELECT t.id, t.subject_id
        FROM topics t
        INNER JOIN subjects s ON s.id = t.subject_id
        WHERE s.exam_id = $1
          AND s.is_active = TRUE
          AND t.is_active = TRUE
          AND t.id = ANY($2::bigint[])
        `,
        [pattern.examId, topicIds]
      );
      const topicSubjectById = new Map(
        topicsResult.rows.map((row) => [String(row.id), String(row.subject_id)])
      );
      if (
        topicSubjectById.size !== topicIds.length ||
        pattern.sections.some((section) =>
          section.topics.some((topic) =>
            topicSubjectById.get(topic.topicId) !== section.subjectId
          )
        )
      ) {
        await client.query("ROLLBACK");
        return res.status(400).json({
          success: false,
          message: "Every topic rule must belong to its configured section and exam"
        });
      }
    }

    const insertPattern = await client.query(
      `
      INSERT INTO exam_patterns (
        exam_id, name, version, total_questions, total_marks,
        duration_minutes, negative_marking, created_by
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING id
      `,
      [
        pattern.examId,
        pattern.name,
        pattern.version,
        pattern.totalQuestions,
        pattern.totalMarks,
        pattern.durationMinutes,
        pattern.negativeMarking,
        req.user.id
      ]
    );
    const patternId = insertPattern.rows[0].id;

    for (const section of pattern.sections) {
      const insertedSection = await client.query(
        `
        INSERT INTO exam_pattern_sections (
          exam_pattern_id, subject_id, section_order,
          question_count, marks_per_question, weight
        )
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING id
        `,
        [
          patternId,
          section.subjectId,
          section.order,
          section.questionCount,
          section.marksPerQuestion,
          section.weight
        ]
      );
      const sectionRuleId = insertedSection.rows[0].id;

      for (const topic of section.topics) {
        await client.query(
          `
          INSERT INTO exam_pattern_topics (
            exam_pattern_id, section_rule_id, topic_id, question_count, weight
          )
          VALUES ($1, $2, $3, $4, $5)
          `,
          [
            patternId,
            sectionRuleId,
            topic.topicId,
            topic.questionCount,
            topic.weight
          ]
        );
      }
      await insertDistributions(
        client,
        patternId,
        sectionRuleId,
        section.distributions
      );
    }

    await insertDistributions(client, patternId, null, pattern.distributions);
    await client.query("COMMIT");

    const createdPattern = await loadPattern(pool, patternId);
    return res.status(201).json({ success: true, data: createdPattern });
  } catch (error) {
    await client.query("ROLLBACK");
    if (error.code === "23505") {
      return res.status(409).json({
        success: false,
        message: "That exam pattern name and version already exist"
      });
    }
    console.error("Unable to create exam pattern:", error.message);
    return res.status(500).json({
      success: false,
      message: "Exam pattern could not be created"
    });
  } finally {
    client.release();
  }
});

async function setPatternStatus(req, res, status) {
  const patternId = databaseId(req.params.patternId);
  if (!patternId) {
    return res.status(400).json({ success: false, message: "Invalid pattern ID" });
  }
  const pool = req.app.locals.pool;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const existing = await client.query(
      `
      SELECT p.id, p.status, e.is_active AS "examIsActive"
      FROM exam_patterns p
      INNER JOIN exams e ON e.id = p.exam_id
      WHERE p.id = $1
      FOR UPDATE OF p
      `,
      [patternId]
    );
    if (existing.rowCount === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ success: false, message: "Exam pattern not found" });
    }
    if (status === "active" && !existing.rows[0].examIsActive) {
      await client.query("ROLLBACK");
      return res.status(409).json({
        success: false,
        message: "An inactive exam cannot have an active pattern"
      });
    }
    if (status === "active" && existing.rows[0].status === "inactive") {
      const used = await client.query(
        "SELECT EXISTS (SELECT 1 FROM mock_tests WHERE exam_pattern_id = $1) AS used",
        [patternId]
      );
      if (used.rows[0].used) {
        await client.query("ROLLBACK");
        return res.status(409).json({
          success: false,
          message: "A pattern already used by a paper cannot be reactivated"
        });
      }
    }
    if (status === "inactive" && existing.rows[0].status === "draft") {
      await client.query("ROLLBACK");
      return res.status(409).json({
        success: false,
        message: "A draft pattern cannot be deactivated"
      });
    }
    const updated = await client.query(
      `
      UPDATE exam_patterns
      SET status = $2
      WHERE id = $1
      RETURNING id, status
      `,
      [patternId, status]
    );
    await client.query("COMMIT");
    return res.json({ success: true, data: updated.rows[0] });
  } catch (error) {
    await client.query("ROLLBACK");
    if (error.code === "23505") {
      return res.status(409).json({
        success: false,
        message: "Another version of this pattern name is already active"
      });
    }
    console.error(`Unable to set exam pattern ${status}:`, error.message);
    return res.status(500).json({
      success: false,
      message: "Exam pattern status could not be updated"
    });
  } finally {
    client.release();
  }
}

router.post("/:patternId/activate", requireAuthenticatedUser, requireAdminRole, (req, res) =>
  setPatternStatus(req, res, "active")
);

router.post("/:patternId/deactivate", requireAuthenticatedUser, requireAdminRole, (req, res) =>
  setPatternStatus(req, res, "inactive")
);

module.exports = router;
