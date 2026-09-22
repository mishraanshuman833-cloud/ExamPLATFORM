-- ============================================================
-- ExamPLATFORM - Database Migration V2
-- Safe upgrade from the original 14-table schema
-- ============================================================

BEGIN;

-- ============================================================
-- 1. USERS
-- ============================================================

ALTER TABLE users
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.table_constraints
        WHERE constraint_name = 'users_role_check'
          AND table_name = 'users'
    ) THEN
        ALTER TABLE users DROP CONSTRAINT users_role_check;
    END IF;

    ALTER TABLE users
    ADD CONSTRAINT users_role_check
    CHECK (role IN ('student', 'admin', 'teacher'));
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;


-- ============================================================
-- 2. EXAMS
-- ============================================================

ALTER TABLE exams
ADD COLUMN IF NOT EXISTS slug VARCHAR(150);

UPDATE exams
SET slug = LOWER(
    REGEXP_REPLACE(
        REGEXP_REPLACE(TRIM(name), '[^a-zA-Z0-9]+', '-', 'g'),
        '(^-+|-+$)', '', 'g'
    )
)
WHERE slug IS NULL OR slug = '';

ALTER TABLE exams
ALTER COLUMN slug SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_exams_slug
ON exams(slug);


-- ============================================================
-- 3. SUBJECTS
-- ============================================================

ALTER TABLE subjects
ADD COLUMN IF NOT EXISTS slug VARCHAR(150);

ALTER TABLE subjects
ADD COLUMN IF NOT EXISTS display_order INTEGER NOT NULL DEFAULT 0;

UPDATE subjects
SET slug = LOWER(
    REGEXP_REPLACE(
        REGEXP_REPLACE(TRIM(name), '[^a-zA-Z0-9]+', '-', 'g'),
        '(^-+|-+$)', '', 'g'
    )
)
WHERE slug IS NULL OR slug = '';

-- Same subject names under different exams are allowed.
-- Slug is therefore unique together with exam_id.
CREATE UNIQUE INDEX IF NOT EXISTS idx_subjects_exam_slug
ON subjects(exam_id, slug);


-- ============================================================
-- 4. TOPICS
-- ============================================================

ALTER TABLE topics
ADD COLUMN IF NOT EXISTS slug VARCHAR(150);

ALTER TABLE topics
ADD COLUMN IF NOT EXISTS display_order INTEGER NOT NULL DEFAULT 0;

UPDATE topics
SET slug = LOWER(
    REGEXP_REPLACE(
        REGEXP_REPLACE(TRIM(name), '[^a-zA-Z0-9]+', '-', 'g'),
        '(^-+|-+$)', '', 'g'
    )
)
WHERE slug IS NULL OR slug = '';

CREATE UNIQUE INDEX IF NOT EXISTS idx_topics_subject_slug
ON topics(subject_id, slug);


-- ============================================================
-- 5. QUESTIONS
-- ============================================================

ALTER TABLE questions
ADD COLUMN IF NOT EXISTS marks NUMERIC(6,2) NOT NULL DEFAULT 1.00;

ALTER TABLE questions
ADD COLUMN IF NOT EXISTS negative_marks NUMERIC(6,2) NOT NULL DEFAULT 0.00;

ALTER TABLE questions
ADD COLUMN IF NOT EXISTS question_origin VARCHAR(30) NOT NULL DEFAULT 'manual';

ALTER TABLE questions
ADD COLUMN IF NOT EXISTS ai_generated BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE questions
ADD COLUMN IF NOT EXISTS review_status VARCHAR(20) NOT NULL DEFAULT 'approved';

ALTER TABLE questions
ADD COLUMN IF NOT EXISTS reviewed_by BIGINT;

ALTER TABLE questions
ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ;

ALTER TABLE questions
ADD COLUMN IF NOT EXISTS source_exam VARCHAR(150);

ALTER TABLE questions
DROP CONSTRAINT IF EXISTS questions_question_origin_check;

ALTER TABLE questions
ADD CONSTRAINT questions_question_origin_check
CHECK (question_origin IN ('manual', 'ai_generated', 'pyq'));

ALTER TABLE questions
DROP CONSTRAINT IF EXISTS questions_review_status_check;

ALTER TABLE questions
ADD CONSTRAINT questions_review_status_check
CHECK (review_status IN ('pending', 'approved', 'rejected'));

ALTER TABLE questions
DROP CONSTRAINT IF EXISTS questions_marks_check;

ALTER TABLE questions
ADD CONSTRAINT questions_marks_check
CHECK (marks >= 0);

ALTER TABLE questions
DROP CONSTRAINT IF EXISTS questions_negative_marks_check;

ALTER TABLE questions
ADD CONSTRAINT questions_negative_marks_check
CHECK (negative_marks >= 0);

ALTER TABLE questions
ADD CONSTRAINT questions_reviewed_by_fkey
FOREIGN KEY (reviewed_by)
REFERENCES users(id)
ON DELETE SET NULL;


-- ============================================================
-- 6. QUESTION OPTIONS
-- ============================================================

ALTER TABLE question_options
ADD CONSTRAINT question_options_id_question_id_unique
UNIQUE (id, question_id);

-- Ensure option belongs to a valid question.
-- Existing question_id foreign key remains unchanged.


-- ============================================================
-- 7. AI QUESTION GENERATIONS
-- ============================================================

CREATE TABLE IF NOT EXISTS ai_question_generations (
    id BIGSERIAL PRIMARY KEY,

    question_id BIGINT,

    model_name VARCHAR(100) NOT NULL,
    prompt_version VARCHAR(50),

    generation_status VARCHAR(20) NOT NULL DEFAULT 'pending',

    generation_prompt TEXT,
    generation_response TEXT,
    error_message TEXT,

    generated_by BIGINT,

    generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    reviewed_by BIGINT,
    reviewed_at TIMESTAMPTZ,

    CONSTRAINT ai_question_generations_status_check
        CHECK (
            generation_status IN ('pending', 'completed', 'failed')
        ),

    CONSTRAINT ai_question_generations_question_fkey
        FOREIGN KEY (question_id)
        REFERENCES questions(id)
        ON DELETE SET NULL,

    CONSTRAINT ai_question_generations_generated_by_fkey
        FOREIGN KEY (generated_by)
        REFERENCES users(id)
        ON DELETE SET NULL,

    CONSTRAINT ai_question_generations_reviewed_by_fkey
        FOREIGN KEY (reviewed_by)
        REFERENCES users(id)
        ON DELETE SET NULL
);


-- ============================================================
-- 8. PRACTICE SETS
-- ============================================================

CREATE TABLE IF NOT EXISTS practice_sets (
    id BIGSERIAL PRIMARY KEY,

    exam_id BIGINT NOT NULL,
    subject_id BIGINT,
    topic_id BIGINT,

    title VARCHAR(200) NOT NULL,
    description TEXT,

    total_questions INTEGER NOT NULL DEFAULT 0,

    is_ai_generated BOOLEAN NOT NULL DEFAULT FALSE,
    is_published BOOLEAN NOT NULL DEFAULT FALSE,

    created_by BIGINT,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT practice_sets_total_questions_check
        CHECK (total_questions >= 0),

    CONSTRAINT practice_sets_exam_fkey
        FOREIGN KEY (exam_id)
        REFERENCES exams(id)
        ON DELETE CASCADE,

    CONSTRAINT practice_sets_subject_fkey
        FOREIGN KEY (subject_id)
        REFERENCES subjects(id)
        ON DELETE SET NULL,

    CONSTRAINT practice_sets_topic_fkey
        FOREIGN KEY (topic_id)
        REFERENCES topics(id)
        ON DELETE SET NULL,

    CONSTRAINT practice_sets_created_by_fkey
        FOREIGN KEY (created_by)
        REFERENCES users(id)
        ON DELETE SET NULL
);


-- ============================================================
-- 9. PRACTICE SET QUESTIONS
-- ============================================================

CREATE TABLE IF NOT EXISTS practice_set_questions (
    id BIGSERIAL PRIMARY KEY,

    practice_set_id BIGINT NOT NULL,
    question_id BIGINT NOT NULL,

    question_order INTEGER NOT NULL DEFAULT 1,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT practice_set_questions_unique
        UNIQUE (practice_set_id, question_id),

    CONSTRAINT practice_set_questions_practice_set_fkey
        FOREIGN KEY (practice_set_id)
        REFERENCES practice_sets(id)
        ON DELETE CASCADE,

    CONSTRAINT practice_set_questions_question_fkey
        FOREIGN KEY (question_id)
        REFERENCES questions(id)
        ON DELETE RESTRICT
);


-- ============================================================
-- 10. MOCK TESTS
-- ============================================================

ALTER TABLE mock_tests
ADD COLUMN IF NOT EXISTS is_ai_generated BOOLEAN NOT NULL DEFAULT FALSE;


-- ============================================================
-- 11. PYQ DETAILS
-- ============================================================

CREATE TABLE IF NOT EXISTS pyq_details (
    id BIGSERIAL PRIMARY KEY,

    question_id BIGINT NOT NULL UNIQUE,

    exam_name VARCHAR(150),
    exam_year INTEGER,
    exam_shift VARCHAR(100),
    exam_date DATE,

    paper_code VARCHAR(100),
    question_number VARCHAR(50),

    source_url TEXT,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT pyq_details_question_fkey
        FOREIGN KEY (question_id)
        REFERENCES questions(id)
        ON DELETE CASCADE
);


-- ============================================================
-- 12. CLASSES
-- ============================================================

-- Existing classes table is preserved.
-- No destructive change is made here.


-- ============================================================
-- 13. NOTES
-- ============================================================

-- Existing notes table is preserved.
-- No destructive change is made here.


-- ============================================================
-- 14. CURRENT AFFAIRS
-- ============================================================

ALTER TABLE current_affairs
ADD COLUMN IF NOT EXISTS is_ai_generated BOOLEAN NOT NULL DEFAULT FALSE;


-- ============================================================
-- 15. ATTEMPTS
-- ============================================================

ALTER TABLE attempts
ADD COLUMN IF NOT EXISTS mock_test_id BIGINT;

ALTER TABLE attempts
ADD COLUMN IF NOT EXISTS practice_set_id BIGINT;

ALTER TABLE attempts
ADD CONSTRAINT attempts_mock_test_fkey
FOREIGN KEY (mock_test_id)
REFERENCES mock_tests(id)
ON DELETE SET NULL;

ALTER TABLE attempts
ADD CONSTRAINT attempts_practice_set_fkey
FOREIGN KEY (practice_set_id)
REFERENCES practice_sets(id)
ON DELETE SET NULL;


-- ============================================================
-- 16. ATTEMPT ANSWERS
-- ============================================================

ALTER TABLE attempt_answers
ADD COLUMN IF NOT EXISTS selected_option_id BIGINT;

-- Composite FK guarantees that the selected option belongs
-- to the same question being answered.
ALTER TABLE attempt_answers
ADD CONSTRAINT attempt_answers_selected_option_question_fkey
FOREIGN KEY (selected_option_id, question_id)
REFERENCES question_options(id, question_id)
ON DELETE SET NULL;


-- ============================================================
-- 17. NOTIFICATIONS
-- ============================================================

-- Existing notifications table is preserved.


-- ============================================================
-- 18. AI GENERATION REQUESTS
-- ============================================================

CREATE TABLE IF NOT EXISTS ai_generation_requests (
    id BIGSERIAL PRIMARY KEY,

    user_id BIGINT,

    request_type VARCHAR(30) NOT NULL,

    input_data JSONB,
    output_data JSONB,

    status VARCHAR(20) NOT NULL DEFAULT 'pending',

    error_message TEXT,

    model_name VARCHAR(100),

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ,

    CONSTRAINT ai_generation_requests_type_check
        CHECK (
            request_type IN (
                'question',
                'question_set',
                'mock_test',
                'explanation',
                'current_affair',
                'tutor'
            )
        ),

    CONSTRAINT ai_generation_requests_status_check
        CHECK (
            status IN ('pending', 'completed', 'failed')
        ),

    CONSTRAINT ai_generation_requests_user_fkey
        FOREIGN KEY (user_id)
        REFERENCES users(id)
        ON DELETE SET NULL
);


-- ============================================================
-- 19. USER TOPIC PERFORMANCE
-- ============================================================

CREATE TABLE IF NOT EXISTS user_topic_performance (
    id BIGSERIAL PRIMARY KEY,

    user_id BIGINT NOT NULL,
    topic_id BIGINT NOT NULL,

    questions_attempted INTEGER NOT NULL DEFAULT 0,
    questions_correct INTEGER NOT NULL DEFAULT 0,
    questions_wrong INTEGER NOT NULL DEFAULT 0,

    total_marks NUMERIC(10,2) NOT NULL DEFAULT 0,

    last_attempted_at TIMESTAMPTZ,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT user_topic_performance_unique
        UNIQUE (user_id, topic_id),

    CONSTRAINT user_topic_performance_user_fkey
        FOREIGN KEY (user_id)
        REFERENCES users(id)
        ON DELETE CASCADE,

    CONSTRAINT user_topic_performance_topic_fkey
        FOREIGN KEY (topic_id)
        REFERENCES topics(id)
        ON DELETE CASCADE
);


-- ============================================================
-- 20. USER EXAM PERFORMANCE
-- ============================================================

CREATE TABLE IF NOT EXISTS user_exam_performance (
    id BIGSERIAL PRIMARY KEY,

    user_id BIGINT NOT NULL,
    exam_id BIGINT NOT NULL,

    tests_attempted INTEGER NOT NULL DEFAULT 0,
    questions_attempted INTEGER NOT NULL DEFAULT 0,
    questions_correct INTEGER NOT NULL DEFAULT 0,
    questions_wrong INTEGER NOT NULL DEFAULT 0,

    total_marks NUMERIC(10,2) NOT NULL DEFAULT 0,

    last_attempted_at TIMESTAMPTZ,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT user_exam_performance_unique
        UNIQUE (user_id, exam_id),

    CONSTRAINT user_exam_performance_user_fkey
        FOREIGN KEY (user_id)
        REFERENCES users(id)
        ON DELETE CASCADE,

    CONSTRAINT user_exam_performance_exam_fkey
        FOREIGN KEY (exam_id)
        REFERENCES exams(id)
        ON DELETE CASCADE
);


-- ============================================================
-- 21. UPDATED_AT FUNCTION
-- ============================================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;


-- ============================================================
-- 22. UPDATED_AT TRIGGERS
-- ============================================================

DROP TRIGGER IF EXISTS trg_users_updated_at ON users;

CREATE TRIGGER trg_users_updated_at
BEFORE UPDATE ON users
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();


DROP TRIGGER IF EXISTS trg_exams_updated_at ON exams;

CREATE TRIGGER trg_exams_updated_at
BEFORE UPDATE ON exams
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();


DROP TRIGGER IF EXISTS trg_subjects_updated_at ON subjects;

CREATE TRIGGER trg_subjects_updated_at
BEFORE UPDATE ON subjects
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();


DROP TRIGGER IF EXISTS trg_topics_updated_at ON topics;

CREATE TRIGGER trg_topics_updated_at
BEFORE UPDATE ON topics
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();


DROP TRIGGER IF EXISTS trg_questions_updated_at ON questions;

CREATE TRIGGER trg_questions_updated_at
BEFORE UPDATE ON questions
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();


DROP TRIGGER IF EXISTS trg_practice_sets_updated_at ON practice_sets;

CREATE TRIGGER trg_practice_sets_updated_at
BEFORE UPDATE ON practice_sets
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();


DROP TRIGGER IF EXISTS trg_pyq_details_updated_at ON pyq_details;

CREATE TRIGGER trg_pyq_details_updated_at
BEFORE UPDATE ON pyq_details
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();


DROP TRIGGER IF EXISTS trg_user_topic_performance_updated_at
ON user_topic_performance;

CREATE TRIGGER trg_user_topic_performance_updated_at
BEFORE UPDATE ON user_topic_performance
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();


DROP TRIGGER IF EXISTS trg_user_exam_performance_updated_at
ON user_exam_performance;

CREATE TRIGGER trg_user_exam_performance_updated_at
BEFORE UPDATE ON user_exam_performance
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();


-- ============================================================
-- 23. INDEXES
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_questions_review_status
ON questions(review_status);

CREATE INDEX IF NOT EXISTS idx_questions_origin
ON questions(question_origin);

CREATE INDEX IF NOT EXISTS idx_questions_ai_generated
ON questions(ai_generated);

CREATE INDEX IF NOT EXISTS idx_questions_source_exam
ON questions(source_exam);

CREATE INDEX IF NOT EXISTS idx_questions_reviewed_by
ON questions(reviewed_by);

CREATE INDEX IF NOT EXISTS idx_ai_question_generations_question_id
ON ai_question_generations(question_id);

CREATE INDEX IF NOT EXISTS idx_ai_question_generations_status
ON ai_question_generations(generation_status);

CREATE INDEX IF NOT EXISTS idx_ai_question_generations_generated_by
ON ai_question_generations(generated_by);

CREATE INDEX IF NOT EXISTS idx_practice_sets_exam_id
ON practice_sets(exam_id);

CREATE INDEX IF NOT EXISTS idx_practice_sets_subject_id
ON practice_sets(subject_id);

CREATE INDEX IF NOT EXISTS idx_practice_sets_topic_id
ON practice_sets(topic_id);

CREATE INDEX IF NOT EXISTS idx_practice_set_questions_question_id
ON practice_set_questions(question_id);

CREATE INDEX IF NOT EXISTS idx_pyq_details_exam_year
ON pyq_details(exam_year);

CREATE INDEX IF NOT EXISTS idx_attempts_mock_test_id
ON attempts(mock_test_id);

CREATE INDEX IF NOT EXISTS idx_attempts_practice_set_id
ON attempts(practice_set_id);

CREATE INDEX IF NOT EXISTS idx_attempt_answers_selected_option
ON attempt_answers(selected_option_id);

CREATE INDEX IF NOT EXISTS idx_ai_generation_requests_user_id
ON ai_generation_requests(user_id);

CREATE INDEX IF NOT EXISTS idx_ai_generation_requests_type
ON ai_generation_requests(request_type);

CREATE INDEX IF NOT EXISTS idx_ai_generation_requests_status
ON ai_generation_requests(status);

CREATE INDEX IF NOT EXISTS idx_user_topic_performance_user_id
ON user_topic_performance(user_id);

CREATE INDEX IF NOT EXISTS idx_user_topic_performance_topic_id
ON user_topic_performance(topic_id);

CREATE INDEX IF NOT EXISTS idx_user_exam_performance_user_id
ON user_exam_performance(user_id);

CREATE INDEX IF NOT EXISTS idx_user_exam_performance_exam_id
ON user_exam_performance(exam_id);


-- ============================================================
-- MIGRATION COMPLETE
-- ============================================================

COMMIT;