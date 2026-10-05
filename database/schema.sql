-- =========================================================
-- ExamPLATFORM
-- FINAL DATABASE SCHEMA
-- PostgreSQL
--
-- Architecture:
-- Users
--   ↓
-- Exams → Subjects → Topics → Questions → Options
--                              ↓
--                         AI Generation
--                              ↓
--                       Review / Approval
--
-- Questions
--   ├── Practice
--   ├── PYQ
--   └── Mock Tests
--
-- Users
--   └── Attempts → Attempt Answers → Results / Analytics
--
-- Content:
--   Classes / Notes / Current Affairs / Notifications
-- =========================================================


-- =========================================================
-- 1. USERS
-- =========================================================

CREATE TABLE IF NOT EXISTS users (
    id BIGSERIAL PRIMARY KEY,

    name VARCHAR(100) NOT NULL,

    email VARCHAR(150) UNIQUE,

    password_hash TEXT,

    role VARCHAR(20) NOT NULL DEFAULT 'student'
        CHECK (role IN ('student', 'admin', 'teacher')),

    is_active BOOLEAN NOT NULL DEFAULT TRUE,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- =========================================================
-- 1A. AUTHENTICATION SESSIONS
-- =========================================================

CREATE TABLE IF NOT EXISTS auth_sessions (
    token_hash CHAR(64) PRIMARY KEY,

    user_id BIGINT NOT NULL
        REFERENCES users(id)
        ON DELETE CASCADE,

    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_auth_sessions_expires_at
    ON auth_sessions(expires_at);

CREATE INDEX IF NOT EXISTS idx_auth_sessions_user_id
    ON auth_sessions(user_id);

-- =========================================================
-- 1B. EMAIL REGISTRATION VERIFICATION CHALLENGES
-- =========================================================

CREATE TABLE IF NOT EXISTS email_verification_challenges (
    email VARCHAR(150) PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    otp_hash CHAR(64) NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    attempts SMALLINT NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
    last_sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_email_verification_challenges_expires_at
    ON email_verification_challenges(expires_at);


-- =========================================================
-- 2. EXAMS
-- =========================================================

CREATE TABLE IF NOT EXISTS exams (
    id BIGSERIAL PRIMARY KEY,

    name VARCHAR(150) NOT NULL UNIQUE,

    slug VARCHAR(180) UNIQUE,

    description TEXT,

    is_active BOOLEAN NOT NULL DEFAULT TRUE,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- =========================================================
-- 3. SUBJECTS
-- =========================================================

CREATE TABLE IF NOT EXISTS subjects (
    id BIGSERIAL PRIMARY KEY,

    exam_id BIGINT NOT NULL
        REFERENCES exams(id)
        ON DELETE CASCADE,

    name VARCHAR(150) NOT NULL,

    slug VARCHAR(180),

    description TEXT,

    display_order INTEGER NOT NULL DEFAULT 0
        CHECK (display_order >= 0),

    is_active BOOLEAN NOT NULL DEFAULT TRUE,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE (exam_id, name)
);


-- =========================================================
-- 4. TOPICS
-- =========================================================

CREATE TABLE IF NOT EXISTS topics (
    id BIGSERIAL PRIMARY KEY,

    subject_id BIGINT NOT NULL
        REFERENCES subjects(id)
        ON DELETE CASCADE,

    name VARCHAR(150) NOT NULL,

    slug VARCHAR(180),

    description TEXT,

    display_order INTEGER NOT NULL DEFAULT 0
        CHECK (display_order >= 0),

    is_active BOOLEAN NOT NULL DEFAULT TRUE,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE (subject_id, name)
);


-- =========================================================
-- 4A. VERSIONED EXAM PATTERNS
-- =========================================================

CREATE TABLE IF NOT EXISTS exam_patterns (
    id BIGSERIAL PRIMARY KEY,

    exam_id BIGINT NOT NULL
        REFERENCES exams(id)
        ON DELETE CASCADE,

    name VARCHAR(150) NOT NULL,
    version INTEGER NOT NULL CHECK (version > 0),
    total_questions INTEGER NOT NULL CHECK (total_questions > 0),
    total_marks NUMERIC(10,2) NOT NULL CHECK (total_marks >= 0),
    duration_minutes INTEGER NOT NULL CHECK (duration_minutes > 0),
    negative_marking NUMERIC(8,2) NOT NULL DEFAULT 0
        CHECK (negative_marking >= 0),

    status VARCHAR(20) NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'active', 'inactive')),

    created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE (exam_id, name, version),
    UNIQUE (id, exam_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_exam_patterns_one_active_version
    ON exam_patterns(exam_id, name)
    WHERE status = 'active';

CREATE TABLE IF NOT EXISTS exam_pattern_sections (
    id BIGSERIAL PRIMARY KEY,
    exam_pattern_id BIGINT NOT NULL
        REFERENCES exam_patterns(id) ON DELETE CASCADE,
    subject_id BIGINT NOT NULL
        REFERENCES subjects(id) ON DELETE RESTRICT,
    section_order INTEGER NOT NULL CHECK (section_order > 0),
    question_count INTEGER NOT NULL CHECK (question_count > 0),
    marks_per_question NUMERIC(8,2) NOT NULL
        CHECK (marks_per_question >= 0),
    weight NUMERIC(8,4),

    CONSTRAINT exam_pattern_sections_weight_check
        CHECK (weight IS NULL OR weight > 0 AND weight <= 100),
    UNIQUE (exam_pattern_id, subject_id),
    UNIQUE (exam_pattern_id, section_order),
    UNIQUE (id, exam_pattern_id)
);

CREATE TABLE IF NOT EXISTS exam_pattern_topics (
    id BIGSERIAL PRIMARY KEY,
    exam_pattern_id BIGINT NOT NULL,
    section_rule_id BIGINT NOT NULL,
    topic_id BIGINT NOT NULL
        REFERENCES topics(id) ON DELETE RESTRICT,
    question_count INTEGER CHECK (question_count IS NULL OR question_count > 0),
    weight NUMERIC(8,4),
    CONSTRAINT exam_pattern_topics_weight_check
        CHECK (weight IS NULL OR weight > 0 AND weight <= 100),

    CHECK ((question_count IS NULL) <> (weight IS NULL)),
    FOREIGN KEY (exam_pattern_id)
        REFERENCES exam_patterns(id) ON DELETE CASCADE,
    FOREIGN KEY (section_rule_id, exam_pattern_id)
        REFERENCES exam_pattern_sections(id, exam_pattern_id)
        ON DELETE CASCADE,
    UNIQUE (section_rule_id, topic_id)
);

CREATE TABLE IF NOT EXISTS exam_pattern_distributions (
    id BIGSERIAL PRIMARY KEY,
    exam_pattern_id BIGINT NOT NULL
        REFERENCES exam_patterns(id) ON DELETE CASCADE,
    section_rule_id BIGINT,
    dimension VARCHAR(20) NOT NULL
        CHECK (dimension IN ('difficulty', 'language', 'question_type')),
    value VARCHAR(20) NOT NULL,
    question_count INTEGER CHECK (question_count IS NULL OR question_count > 0),
    weight NUMERIC(8,4) CHECK (weight IS NULL OR weight > 0 AND weight <= 100),

    CHECK ((question_count IS NULL) <> (weight IS NULL)),
    CHECK (
        (dimension = 'difficulty' AND value IN ('easy', 'medium', 'hard'))
        OR (dimension = 'language' AND value IN ('en', 'hi'))
        OR (dimension = 'question_type' AND value IN ('mcq', 'true_false'))
    ),
    FOREIGN KEY (section_rule_id, exam_pattern_id)
        REFERENCES exam_pattern_sections(id, exam_pattern_id)
        ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_exam_pattern_distributions_global
    ON exam_pattern_distributions(exam_pattern_id, dimension, value)
    WHERE section_rule_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_exam_pattern_distributions_section
    ON exam_pattern_distributions(section_rule_id, dimension, value)
    WHERE section_rule_id IS NOT NULL;

CREATE OR REPLACE FUNCTION protect_exam_pattern_configuration()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_TABLE_NAME = 'exam_patterns' THEN
        IF TG_OP = 'DELETE' THEN
            IF OLD.status = 'active' OR EXISTS (
                SELECT 1 FROM mock_tests WHERE exam_pattern_id = OLD.id
            ) THEN
                RAISE EXCEPTION 'Active or used exam patterns cannot be deleted';
            END IF;
            RETURN OLD;
        END IF;

        IF OLD.exam_id IS DISTINCT FROM NEW.exam_id
            OR OLD.name IS DISTINCT FROM NEW.name
            OR OLD.version IS DISTINCT FROM NEW.version
            OR OLD.total_questions IS DISTINCT FROM NEW.total_questions
            OR OLD.total_marks IS DISTINCT FROM NEW.total_marks
            OR OLD.duration_minutes IS DISTINCT FROM NEW.duration_minutes
            OR OLD.negative_marking IS DISTINCT FROM NEW.negative_marking
            OR OLD.created_by IS DISTINCT FROM NEW.created_by
            OR OLD.created_at IS DISTINCT FROM NEW.created_at THEN
            RAISE EXCEPTION 'Exam pattern versions are immutable; create a new version';
        END IF;
        RETURN NEW;
    END IF;

    IF TG_OP <> 'INSERT' AND EXISTS (
        SELECT 1
        FROM exam_patterns p
        WHERE p.id = OLD.exam_pattern_id
          AND (
              p.status <> 'draft'
              OR EXISTS (
                  SELECT 1 FROM mock_tests mt WHERE mt.exam_pattern_id = p.id
              )
          )
    ) THEN
        RAISE EXCEPTION 'Active or used exam pattern rules are immutable';
    END IF;
    IF TG_OP <> 'DELETE' AND EXISTS (
        SELECT 1
        FROM exam_patterns p
        WHERE p.id = NEW.exam_pattern_id
          AND (
              p.status <> 'draft'
              OR EXISTS (
                  SELECT 1 FROM mock_tests mt WHERE mt.exam_pattern_id = p.id
              )
          )
    ) THEN
        RAISE EXCEPTION 'Active or used exam pattern rules are immutable';
    END IF;

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_exam_patterns_immutable ON exam_patterns;
CREATE TRIGGER trg_exam_patterns_immutable
BEFORE UPDATE OR DELETE ON exam_patterns
FOR EACH ROW EXECUTE FUNCTION protect_exam_pattern_configuration();

DROP TRIGGER IF EXISTS trg_exam_pattern_sections_immutable ON exam_pattern_sections;
CREATE TRIGGER trg_exam_pattern_sections_immutable
BEFORE INSERT OR UPDATE OR DELETE ON exam_pattern_sections
FOR EACH ROW EXECUTE FUNCTION protect_exam_pattern_configuration();

DROP TRIGGER IF EXISTS trg_exam_pattern_topics_immutable ON exam_pattern_topics;
CREATE TRIGGER trg_exam_pattern_topics_immutable
BEFORE INSERT OR UPDATE OR DELETE ON exam_pattern_topics
FOR EACH ROW EXECUTE FUNCTION protect_exam_pattern_configuration();

DROP TRIGGER IF EXISTS trg_exam_pattern_distributions_immutable ON exam_pattern_distributions;
CREATE TRIGGER trg_exam_pattern_distributions_immutable
BEFORE INSERT OR UPDATE OR DELETE ON exam_pattern_distributions
FOR EACH ROW EXECUTE FUNCTION protect_exam_pattern_configuration();

CREATE OR REPLACE FUNCTION bind_mock_test_exam_pattern()
RETURNS TRIGGER AS $$
DECLARE
    pattern_status VARCHAR(20);
BEGIN
    IF TG_OP = 'UPDATE'
        AND OLD.exam_pattern_id IS NOT NULL
        AND NEW.exam_pattern_id IS DISTINCT FROM OLD.exam_pattern_id THEN
        RAISE EXCEPTION 'A mock test pattern association is immutable';
    END IF;

    IF NEW.exam_pattern_id IS NOT NULL THEN
        SELECT status INTO pattern_status
        FROM exam_patterns
        WHERE id = NEW.exam_pattern_id
          AND exam_id = NEW.exam_id;
        IF pattern_status IS DISTINCT FROM 'active' THEN
            RAISE EXCEPTION 'Mock tests can only reference an active pattern for the same exam';
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- =========================================================
-- 5. QUESTIONS
-- =========================================================

CREATE TABLE IF NOT EXISTS questions (
    id BIGSERIAL PRIMARY KEY,

    topic_id BIGINT NOT NULL
        REFERENCES topics(id)
        ON DELETE CASCADE,

    question_text TEXT NOT NULL,

    language VARCHAR(2) NOT NULL DEFAULT 'en'
        CHECK (language IN ('en', 'hi')),

    question_type VARCHAR(30) NOT NULL DEFAULT 'mcq'
        CHECK (
            question_type IN (
                'mcq',
                'true_false'
            )
        ),

    explanation TEXT,

    difficulty VARCHAR(20) NOT NULL DEFAULT 'medium'
        CHECK (
            difficulty IN (
                'easy',
                'medium',
                'hard'
            )
        ),

    marks NUMERIC(6,2) NOT NULL DEFAULT 1
        CHECK (marks >= 0),

    negative_marks NUMERIC(6,2) NOT NULL DEFAULT 0
        CHECK (negative_marks >= 0),

    -- Question origin
    question_origin VARCHAR(30) NOT NULL DEFAULT 'manual'
        CHECK (
            question_origin IN (
                'manual',
                'ai_generated',
                'pyq'
            )
        ),

    -- AI flag
    ai_generated BOOLEAN NOT NULL DEFAULT FALSE,

    -- Review workflow
    review_status VARCHAR(30) NOT NULL DEFAULT 'pending'
        CHECK (
            review_status IN (
                'pending',
                'approved',
                'rejected'
            )
        ),

    reviewed_by BIGINT
        REFERENCES users(id)
        ON DELETE SET NULL,

    reviewed_at TIMESTAMPTZ,

    -- Publishing
    is_published BOOLEAN NOT NULL DEFAULT FALSE,

    -- PYQ / source information
    source VARCHAR(150),

    source_year INTEGER
        CHECK (
            source_year IS NULL
            OR source_year >= 1900
        ),

    source_exam VARCHAR(150),

    -- Creator
    created_by BIGINT
        REFERENCES users(id)
        ON DELETE SET NULL,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- =========================================================
-- 6. QUESTION OPTIONS
-- =========================================================

CREATE TABLE IF NOT EXISTS question_options (
    id BIGSERIAL PRIMARY KEY,

    question_id BIGINT NOT NULL
        REFERENCES questions(id)
        ON DELETE CASCADE,

    option_key CHAR(1) NOT NULL
        CHECK (
            option_key IN (
                'A',
                'B',
                'C',
                'D'
            )
        ),

    option_text TEXT NOT NULL,

    is_correct BOOLEAN NOT NULL DEFAULT FALSE,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE (question_id, option_key),

    UNIQUE (id, question_id)
);


-- =========================================================
-- 7. AI QUESTION GENERATIONS
-- =========================================================
-- Stores AI generation history separately from the final
-- question so we know how a question was created.
-- =========================================================

CREATE TABLE IF NOT EXISTS ai_question_generations (
    id BIGSERIAL PRIMARY KEY,

    question_id BIGINT
        REFERENCES questions(id)
        ON DELETE SET NULL,

    model_name VARCHAR(100),

    prompt_version VARCHAR(50),

    generation_status VARCHAR(20) NOT NULL DEFAULT 'completed'
        CHECK (
            generation_status IN (
                'pending',
                'completed',
                'failed'
            )
        ),

    generation_prompt TEXT,

    generation_response TEXT,

    error_message TEXT,

    generated_by BIGINT
        REFERENCES users(id)
        ON DELETE SET NULL,

    generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    reviewed_by BIGINT
        REFERENCES users(id)
        ON DELETE SET NULL,

    reviewed_at TIMESTAMPTZ
);


-- =========================================================
-- 8. PRACTICE SETS
-- =========================================================

CREATE TABLE IF NOT EXISTS practice_sets (
    id BIGSERIAL PRIMARY KEY,

    exam_id BIGINT NOT NULL
        REFERENCES exams(id)
        ON DELETE CASCADE,

    subject_id BIGINT
        REFERENCES subjects(id)
        ON DELETE SET NULL,

    topic_id BIGINT
        REFERENCES topics(id)
        ON DELETE SET NULL,

    title VARCHAR(200) NOT NULL,

    description TEXT,

    total_questions INTEGER NOT NULL DEFAULT 0
        CHECK (total_questions >= 0),

    is_ai_generated BOOLEAN NOT NULL DEFAULT FALSE,

    is_published BOOLEAN NOT NULL DEFAULT FALSE,

    created_by BIGINT
        REFERENCES users(id)
        ON DELETE SET NULL,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- =========================================================
-- 9. PRACTICE SET QUESTIONS
-- =========================================================

CREATE TABLE IF NOT EXISTS practice_set_questions (
    id BIGSERIAL PRIMARY KEY,

    practice_set_id BIGINT NOT NULL
        REFERENCES practice_sets(id)
        ON DELETE CASCADE,

    question_id BIGINT NOT NULL
        REFERENCES questions(id)
        ON DELETE RESTRICT,

    question_order INTEGER NOT NULL
        CHECK (question_order > 0),

    UNIQUE (practice_set_id, question_id),

    UNIQUE (practice_set_id, question_order)
);


-- =========================================================
-- 10. MOCK TESTS
-- =========================================================

CREATE TABLE IF NOT EXISTS mock_tests (
    id BIGSERIAL PRIMARY KEY,

    exam_id BIGINT NOT NULL
        REFERENCES exams(id)
        ON DELETE CASCADE,

    exam_pattern_id BIGINT,

    title VARCHAR(200) NOT NULL,

    description TEXT,

    duration_minutes INTEGER NOT NULL
        CHECK (duration_minutes > 0),

    total_questions INTEGER NOT NULL DEFAULT 0
        CHECK (total_questions >= 0),

    total_marks NUMERIC(8,2) NOT NULL DEFAULT 0
        CHECK (total_marks >= 0),

    negative_marking NUMERIC(5,2) NOT NULL DEFAULT 0
        CHECK (negative_marking >= 0),

    is_ai_generated BOOLEAN NOT NULL DEFAULT FALSE,

    is_published BOOLEAN NOT NULL DEFAULT FALSE,

    created_by BIGINT
        REFERENCES users(id)
        ON DELETE SET NULL,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT mock_tests_exam_pattern_exam_fkey
    FOREIGN KEY (exam_pattern_id, exam_id)
        REFERENCES exam_patterns(id, exam_id)
        ON DELETE RESTRICT
);

DROP TRIGGER IF EXISTS trg_mock_tests_exam_pattern ON mock_tests;
CREATE TRIGGER trg_mock_tests_exam_pattern
BEFORE INSERT OR UPDATE OF exam_pattern_id, exam_id ON mock_tests
FOR EACH ROW EXECUTE FUNCTION bind_mock_test_exam_pattern();


-- =========================================================
-- 11. MOCK TEST QUESTIONS
-- =========================================================

CREATE TABLE IF NOT EXISTS mock_test_questions (
    id BIGSERIAL PRIMARY KEY,

    mock_test_id BIGINT NOT NULL
        REFERENCES mock_tests(id)
        ON DELETE CASCADE,

    question_id BIGINT NOT NULL
        REFERENCES questions(id)
        ON DELETE RESTRICT,

    question_order INTEGER NOT NULL
        CHECK (question_order > 0),

    marks NUMERIC(5,2) NOT NULL DEFAULT 1
        CHECK (marks >= 0),

    UNIQUE (mock_test_id, question_id),

    UNIQUE (mock_test_id, question_order)
);


-- =========================================================
-- 12. PYQ INFORMATION
-- =========================================================
-- Keeps structured information for previous-year questions.
-- The actual question remains in questions table.
-- =========================================================

CREATE TABLE IF NOT EXISTS pyq_details (
    id BIGSERIAL PRIMARY KEY,

    question_id BIGINT NOT NULL UNIQUE
        REFERENCES questions(id)
        ON DELETE CASCADE,

    exam_name VARCHAR(150) NOT NULL,

    exam_year INTEGER NOT NULL
        CHECK (exam_year >= 1900),

    paper_name VARCHAR(200),

    shift_name VARCHAR(100),

    question_number VARCHAR(50),

    source_reference TEXT,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- =========================================================
-- 13. CLASSES
-- =========================================================

CREATE TABLE IF NOT EXISTS classes (
    id BIGSERIAL PRIMARY KEY,

    title VARCHAR(250) NOT NULL,

    youtube_url TEXT NOT NULL,

    thumbnail TEXT,

    exam_id BIGINT
        REFERENCES exams(id)
        ON DELETE SET NULL,

    subject_id BIGINT
        REFERENCES subjects(id)
        ON DELETE SET NULL,

    topic_id BIGINT
        REFERENCES topics(id)
        ON DELETE SET NULL,

    teacher VARCHAR(150),

    description TEXT,

    is_published BOOLEAN NOT NULL DEFAULT FALSE,

    created_by BIGINT
        REFERENCES users(id)
        ON DELETE SET NULL,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- =========================================================
-- 14. NOTES
-- =========================================================

CREATE TABLE IF NOT EXISTS notes (
    id BIGSERIAL PRIMARY KEY,

    title VARCHAR(250) NOT NULL,

    exam_id BIGINT
        REFERENCES exams(id)
        ON DELETE SET NULL,

    subject_id BIGINT
        REFERENCES subjects(id)
        ON DELETE SET NULL,

    topic_id BIGINT
        REFERENCES topics(id)
        ON DELETE SET NULL,

    content TEXT NOT NULL,

    is_published BOOLEAN NOT NULL DEFAULT FALSE,

    created_by BIGINT
        REFERENCES users(id)
        ON DELETE SET NULL,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- =========================================================
-- 15. CURRENT AFFAIRS
-- =========================================================

CREATE TABLE IF NOT EXISTS current_affairs (
    id BIGSERIAL PRIMARY KEY,

    title VARCHAR(300) NOT NULL,

    content TEXT NOT NULL,

    category VARCHAR(100),

    source VARCHAR(200),

    published_date DATE NOT NULL,

    is_ai_generated BOOLEAN NOT NULL DEFAULT FALSE,

    is_published BOOLEAN NOT NULL DEFAULT FALSE,

    created_by BIGINT
        REFERENCES users(id)
        ON DELETE SET NULL,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- =========================================================
-- 16. ATTEMPTS
-- =========================================================

CREATE TABLE IF NOT EXISTS attempts (
    id BIGSERIAL PRIMARY KEY,

    user_id BIGINT
        REFERENCES users(id)
        ON DELETE CASCADE,

    mock_test_id BIGINT
        REFERENCES mock_tests(id)
        ON DELETE SET NULL,

    practice_set_id BIGINT
        REFERENCES practice_sets(id)
        ON DELETE SET NULL,

    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    submitted_at TIMESTAMPTZ,

    total_questions INTEGER NOT NULL DEFAULT 0
        CHECK (total_questions >= 0),

    attempted_questions INTEGER NOT NULL DEFAULT 0
        CHECK (attempted_questions >= 0),

    correct_answers INTEGER NOT NULL DEFAULT 0
        CHECK (correct_answers >= 0),

    wrong_answers INTEGER NOT NULL DEFAULT 0
        CHECK (wrong_answers >= 0),

    skipped_questions INTEGER NOT NULL DEFAULT 0
        CHECK (skipped_questions >= 0),

    score NUMERIC(8,2) NOT NULL DEFAULT 0,

    accuracy NUMERIC(5,2) NOT NULL DEFAULT 0
        CHECK (
            accuracy >= 0
            AND accuracy <= 100
        ),

    status VARCHAR(20) NOT NULL DEFAULT 'in_progress'
        CHECK (
            status IN (
                'in_progress',
                'completed',
                'abandoned'
            )
        ),

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- =========================================================
-- 17. ATTEMPT ANSWERS
-- =========================================================

CREATE TABLE IF NOT EXISTS attempt_answers (
    id BIGSERIAL PRIMARY KEY,

    attempt_id BIGINT NOT NULL
        REFERENCES attempts(id)
        ON DELETE CASCADE,

    question_id BIGINT NOT NULL
        REFERENCES questions(id)
        ON DELETE RESTRICT,

    selected_option_id BIGINT,

    is_correct BOOLEAN,

    marks_obtained NUMERIC(6,2) NOT NULL DEFAULT 0,

    answered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE (attempt_id, question_id),

    FOREIGN KEY (selected_option_id, question_id)
        REFERENCES question_options(id, question_id)
        ON DELETE SET NULL
);


-- =========================================================
-- 18. NOTIFICATIONS
-- =========================================================

CREATE TABLE IF NOT EXISTS notifications (
    id BIGSERIAL PRIMARY KEY,

    user_id BIGINT
        REFERENCES users(id)
        ON DELETE CASCADE,

    title VARCHAR(250) NOT NULL,

    message TEXT NOT NULL,

    type VARCHAR(50) NOT NULL DEFAULT 'general',

    is_read BOOLEAN NOT NULL DEFAULT FALSE,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- =========================================================
-- 19. AI GENERATION REQUESTS
-- =========================================================
-- General AI task tracking.
-- Useful later for question generation, explanations,
-- practice-set generation, mock generation, etc.
-- =========================================================

CREATE TABLE IF NOT EXISTS ai_generation_requests (
    id BIGSERIAL PRIMARY KEY,

    user_id BIGINT
        REFERENCES users(id)
        ON DELETE SET NULL,

    request_type VARCHAR(50) NOT NULL
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

    status VARCHAR(20) NOT NULL DEFAULT 'pending'
        CHECK (
            status IN (
                'pending',
                'processing',
                'completed',
                'failed'
            )
        ),

    input_data JSONB,

    output_data JSONB,

    error_message TEXT,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    completed_at TIMESTAMPTZ
);


-- =========================================================
-- 20. USER TOPIC PERFORMANCE
-- =========================================================
-- Stores calculated performance summaries.
-- Detailed answers remain in attempt_answers.
-- =========================================================

CREATE TABLE IF NOT EXISTS user_topic_performance (
    id BIGSERIAL PRIMARY KEY,

    user_id BIGINT NOT NULL
        REFERENCES users(id)
        ON DELETE CASCADE,

    topic_id BIGINT NOT NULL
        REFERENCES topics(id)
        ON DELETE CASCADE,

    questions_attempted INTEGER NOT NULL DEFAULT 0
        CHECK (questions_attempted >= 0),

    correct_answers INTEGER NOT NULL DEFAULT 0
        CHECK (correct_answers >= 0),

    wrong_answers INTEGER NOT NULL DEFAULT 0
        CHECK (wrong_answers >= 0),

    accuracy NUMERIC(5,2) NOT NULL DEFAULT 0
        CHECK (
            accuracy >= 0
            AND accuracy <= 100
        ),

    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE (user_id, topic_id)
);


-- =========================================================
-- 21. USER EXAM PERFORMANCE
-- =========================================================

CREATE TABLE IF NOT EXISTS user_exam_performance (
    id BIGSERIAL PRIMARY KEY,

    user_id BIGINT NOT NULL
        REFERENCES users(id)
        ON DELETE CASCADE,

    exam_id BIGINT NOT NULL
        REFERENCES exams(id)
        ON DELETE CASCADE,

    tests_attempted INTEGER NOT NULL DEFAULT 0
        CHECK (tests_attempted >= 0),

    questions_attempted INTEGER NOT NULL DEFAULT 0
        CHECK (questions_attempted >= 0),

    correct_answers INTEGER NOT NULL DEFAULT 0
        CHECK (correct_answers >= 0),

    wrong_answers INTEGER NOT NULL DEFAULT 0
        CHECK (wrong_answers >= 0),

    average_score NUMERIC(8,2) NOT NULL DEFAULT 0,

    accuracy NUMERIC(5,2) NOT NULL DEFAULT 0
        CHECK (
            accuracy >= 0
            AND accuracy <= 100
        ),

    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE (user_id, exam_id)
);


-- =========================================================
-- 22. UPDATED_AT FUNCTION
-- =========================================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;


-- =========================================================
-- UPDATED_AT TRIGGERS
-- =========================================================

DROP TRIGGER IF EXISTS trg_users_updated_at
ON users;

CREATE TRIGGER trg_users_updated_at
BEFORE UPDATE ON users
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();


DROP TRIGGER IF EXISTS trg_exams_updated_at
ON exams;

CREATE TRIGGER trg_exams_updated_at
BEFORE UPDATE ON exams
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS trg_exam_patterns_updated_at
ON exam_patterns;

CREATE TRIGGER trg_exam_patterns_updated_at
BEFORE UPDATE ON exam_patterns
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();


DROP TRIGGER IF EXISTS trg_subjects_updated_at
ON subjects;

CREATE TRIGGER trg_subjects_updated_at
BEFORE UPDATE ON subjects
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();


DROP TRIGGER IF EXISTS trg_topics_updated_at
ON topics;

CREATE TRIGGER trg_topics_updated_at
BEFORE UPDATE ON topics
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();


DROP TRIGGER IF EXISTS trg_questions_updated_at
ON questions;

CREATE TRIGGER trg_questions_updated_at
BEFORE UPDATE ON questions
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();


DROP TRIGGER IF EXISTS trg_practice_sets_updated_at
ON practice_sets;

CREATE TRIGGER trg_practice_sets_updated_at
BEFORE UPDATE ON practice_sets
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();


DROP TRIGGER IF EXISTS trg_mock_tests_updated_at
ON mock_tests;

CREATE TRIGGER trg_mock_tests_updated_at
BEFORE UPDATE ON mock_tests
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();


DROP TRIGGER IF EXISTS trg_classes_updated_at
ON classes;

CREATE TRIGGER trg_classes_updated_at
BEFORE UPDATE ON classes
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();


DROP TRIGGER IF EXISTS trg_notes_updated_at
ON notes;

CREATE TRIGGER trg_notes_updated_at
BEFORE UPDATE ON notes
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();


DROP TRIGGER IF EXISTS trg_current_affairs_updated_at
ON current_affairs;

CREATE TRIGGER trg_current_affairs_updated_at
BEFORE UPDATE ON current_affairs
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();


-- =========================================================
-- INDEXES
-- =========================================================

CREATE INDEX IF NOT EXISTS idx_subjects_exam_id
    ON subjects(exam_id);

CREATE INDEX IF NOT EXISTS idx_topics_subject_id
    ON topics(subject_id);

CREATE INDEX IF NOT EXISTS idx_questions_topic_id
    ON questions(topic_id);

CREATE INDEX IF NOT EXISTS idx_questions_published
    ON questions(is_published);

CREATE INDEX IF NOT EXISTS idx_questions_review_status
    ON questions(review_status);

CREATE INDEX IF NOT EXISTS idx_questions_origin
    ON questions(question_origin);

CREATE INDEX IF NOT EXISTS idx_questions_difficulty
    ON questions(difficulty);

CREATE INDEX IF NOT EXISTS idx_questions_language
    ON questions(language);

CREATE INDEX IF NOT EXISTS idx_question_options_question_id
    ON question_options(question_id);

CREATE INDEX IF NOT EXISTS idx_ai_question_generations_question_id
    ON ai_question_generations(question_id);

CREATE INDEX IF NOT EXISTS idx_ai_question_generations_status
    ON ai_question_generations(generation_status);

CREATE INDEX IF NOT EXISTS idx_practice_sets_exam_id
    ON practice_sets(exam_id);

CREATE INDEX IF NOT EXISTS idx_practice_sets_subject_id
    ON practice_sets(subject_id);

CREATE INDEX IF NOT EXISTS idx_practice_sets_topic_id
    ON practice_sets(topic_id);

CREATE INDEX IF NOT EXISTS idx_practice_set_questions_set_id
    ON practice_set_questions(practice_set_id);

CREATE INDEX IF NOT EXISTS idx_mock_tests_exam_id
    ON mock_tests(exam_id);

CREATE INDEX IF NOT EXISTS idx_exam_patterns_exam_status
    ON exam_patterns(exam_id, status);

CREATE INDEX IF NOT EXISTS idx_exam_pattern_sections_subject
    ON exam_pattern_sections(subject_id);

CREATE INDEX IF NOT EXISTS idx_exam_pattern_topics_topic
    ON exam_pattern_topics(topic_id);

CREATE INDEX IF NOT EXISTS idx_exam_pattern_distributions_pattern
    ON exam_pattern_distributions(exam_pattern_id);

CREATE INDEX IF NOT EXISTS idx_mock_tests_exam_pattern_id
    ON mock_tests(exam_pattern_id);

CREATE INDEX IF NOT EXISTS idx_mock_test_questions_test_id
    ON mock_test_questions(mock_test_id);

CREATE INDEX IF NOT EXISTS idx_pyq_details_exam_year
    ON pyq_details(exam_name, exam_year);

CREATE INDEX IF NOT EXISTS idx_classes_exam_id
    ON classes(exam_id);

CREATE INDEX IF NOT EXISTS idx_classes_subject_id
    ON classes(subject_id);

CREATE INDEX IF NOT EXISTS idx_classes_topic_id
    ON classes(topic_id);

CREATE INDEX IF NOT EXISTS idx_notes_exam_id
    ON notes(exam_id);

CREATE INDEX IF NOT EXISTS idx_notes_subject_id
    ON notes(subject_id);

CREATE INDEX IF NOT EXISTS idx_notes_topic_id
    ON notes(topic_id);

CREATE INDEX IF NOT EXISTS idx_current_affairs_date
    ON current_affairs(published_date);

CREATE INDEX IF NOT EXISTS idx_current_affairs_category
    ON current_affairs(category);

CREATE INDEX IF NOT EXISTS idx_attempts_user_id
    ON attempts(user_id);

CREATE INDEX IF NOT EXISTS idx_attempts_mock_test_id
    ON attempts(mock_test_id);

CREATE INDEX IF NOT EXISTS idx_attempts_practice_set_id
    ON attempts(practice_set_id);

CREATE INDEX IF NOT EXISTS idx_attempt_answers_attempt_id
    ON attempt_answers(attempt_id);

CREATE INDEX IF NOT EXISTS idx_attempt_answers_question_id
    ON attempt_answers(question_id);

CREATE INDEX IF NOT EXISTS idx_notifications_user_id
    ON notifications(user_id);

CREATE INDEX IF NOT EXISTS idx_ai_generation_requests_user_id
    ON ai_generation_requests(user_id);

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


-- =========================================================
-- SCHEMA COMPLETE
-- =========================================================