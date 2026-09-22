-- =========================================================
-- ExamPlatform Database Schema
-- PostgreSQL
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
        CHECK (role IN ('student', 'admin')),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- =========================================================
-- 2. EXAMS
-- =========================================================

CREATE TABLE IF NOT EXISTS exams (
    id BIGSERIAL PRIMARY KEY,
    name VARCHAR(150) NOT NULL UNIQUE,
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
    exam_id BIGINT NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
    name VARCHAR(150) NOT NULL,
    description TEXT,
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
    subject_id BIGINT NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
    name VARCHAR(150) NOT NULL,
    description TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE (subject_id, name)
);


-- =========================================================
-- 5. QUESTIONS
-- =========================================================

CREATE TABLE IF NOT EXISTS questions (
    id BIGSERIAL PRIMARY KEY,
    topic_id BIGINT NOT NULL REFERENCES topics(id) ON DELETE CASCADE,

    question_text TEXT NOT NULL,

    question_type VARCHAR(30) NOT NULL DEFAULT 'mcq'
        CHECK (question_type IN ('mcq', 'true_false')),

    explanation TEXT,

    difficulty VARCHAR(20) NOT NULL DEFAULT 'medium'
        CHECK (difficulty IN ('easy', 'medium', 'hard')),

    source VARCHAR(100),
    source_year INTEGER,

    is_published BOOLEAN NOT NULL DEFAULT FALSE,

    created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- =========================================================
-- 6. QUESTION OPTIONS
-- =========================================================

CREATE TABLE IF NOT EXISTS question_options (
    id BIGSERIAL PRIMARY KEY,
    question_id BIGINT NOT NULL REFERENCES questions(id) ON DELETE CASCADE,

    option_key CHAR(1) NOT NULL
        CHECK (option_key IN ('A', 'B', 'C', 'D')),

    option_text TEXT NOT NULL,

    is_correct BOOLEAN NOT NULL DEFAULT FALSE,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE (question_id, option_key)
);


-- =========================================================
-- 7. MOCK TESTS
-- =========================================================

CREATE TABLE IF NOT EXISTS mock_tests (
    id BIGSERIAL PRIMARY KEY,

    exam_id BIGINT NOT NULL REFERENCES exams(id) ON DELETE CASCADE,

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

    is_published BOOLEAN NOT NULL DEFAULT FALSE,

    created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- =========================================================
-- 8. MOCK TEST QUESTIONS
-- =========================================================

CREATE TABLE IF NOT EXISTS mock_test_questions (
    id BIGSERIAL PRIMARY KEY,

    mock_test_id BIGINT NOT NULL REFERENCES mock_tests(id) ON DELETE CASCADE,

    question_id BIGINT NOT NULL REFERENCES questions(id) ON DELETE RESTRICT,

    question_order INTEGER NOT NULL
        CHECK (question_order > 0),

    marks NUMERIC(5,2) NOT NULL DEFAULT 1
        CHECK (marks >= 0),

    UNIQUE (mock_test_id, question_id),
    UNIQUE (mock_test_id, question_order)
);


-- =========================================================
-- 9. CLASSES
-- =========================================================

CREATE TABLE IF NOT EXISTS classes (
    id BIGSERIAL PRIMARY KEY,

    title VARCHAR(250) NOT NULL,

    youtube_url TEXT NOT NULL,
    thumbnail TEXT,

    exam_id BIGINT REFERENCES exams(id) ON DELETE SET NULL,
    subject_id BIGINT REFERENCES subjects(id) ON DELETE SET NULL,
    topic_id BIGINT REFERENCES topics(id) ON DELETE SET NULL,

    teacher VARCHAR(150),
    description TEXT,

    is_published BOOLEAN NOT NULL DEFAULT FALSE,

    created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- =========================================================
-- 10. NOTES
-- =========================================================

CREATE TABLE IF NOT EXISTS notes (
    id BIGSERIAL PRIMARY KEY,

    title VARCHAR(250) NOT NULL,

    exam_id BIGINT REFERENCES exams(id) ON DELETE SET NULL,
    subject_id BIGINT REFERENCES subjects(id) ON DELETE SET NULL,
    topic_id BIGINT REFERENCES topics(id) ON DELETE SET NULL,

    content TEXT NOT NULL,

    is_published BOOLEAN NOT NULL DEFAULT FALSE,

    created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- =========================================================
-- 11. CURRENT AFFAIRS
-- =========================================================

CREATE TABLE IF NOT EXISTS current_affairs (
    id BIGSERIAL PRIMARY KEY,

    title VARCHAR(300) NOT NULL,
    content TEXT NOT NULL,

    category VARCHAR(100),
    source VARCHAR(200),

    published_date DATE NOT NULL,

    is_published BOOLEAN NOT NULL DEFAULT FALSE,

    created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- =========================================================
-- 12. ATTEMPTS
-- =========================================================

CREATE TABLE IF NOT EXISTS attempts (
    id BIGSERIAL PRIMARY KEY,

    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    mock_test_id BIGINT REFERENCES mock_tests(id) ON DELETE SET NULL,

    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    submitted_at TIMESTAMPTZ,

    total_questions INTEGER NOT NULL DEFAULT 0,
    attempted_questions INTEGER NOT NULL DEFAULT 0,
    correct_answers INTEGER NOT NULL DEFAULT 0,
    wrong_answers INTEGER NOT NULL DEFAULT 0,
    skipped_questions INTEGER NOT NULL DEFAULT 0,

    score NUMERIC(8,2) NOT NULL DEFAULT 0,
    accuracy NUMERIC(5,2) NOT NULL DEFAULT 0,

    status VARCHAR(20) NOT NULL DEFAULT 'in_progress'
        CHECK (status IN ('in_progress', 'completed', 'abandoned')),

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- =========================================================
-- 13. ATTEMPT ANSWERS
-- =========================================================

CREATE TABLE IF NOT EXISTS attempt_answers (
    id BIGSERIAL PRIMARY KEY,

    attempt_id BIGINT NOT NULL REFERENCES attempts(id) ON DELETE CASCADE,

    question_id BIGINT NOT NULL REFERENCES questions(id) ON DELETE RESTRICT,

    selected_option_id BIGINT REFERENCES question_options(id) ON DELETE SET NULL,

    is_correct BOOLEAN,
    marks_obtained NUMERIC(6,2) NOT NULL DEFAULT 0,

    answered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE (attempt_id, question_id)
);


-- =========================================================
-- 14. NOTIFICATIONS
-- =========================================================

CREATE TABLE IF NOT EXISTS notifications (
    id BIGSERIAL PRIMARY KEY,

    user_id BIGINT REFERENCES users(id) ON DELETE CASCADE,

    title VARCHAR(250) NOT NULL,
    message TEXT NOT NULL,

    type VARCHAR(50) DEFAULT 'general',

    is_read BOOLEAN NOT NULL DEFAULT FALSE,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


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

CREATE INDEX IF NOT EXISTS idx_question_options_question_id
    ON question_options(question_id);

CREATE INDEX IF NOT EXISTS idx_mock_tests_exam_id
    ON mock_tests(exam_id);

CREATE INDEX IF NOT EXISTS idx_mock_test_questions_test_id
    ON mock_test_questions(mock_test_id);

CREATE INDEX IF NOT EXISTS idx_classes_exam_id
    ON classes(exam_id);

CREATE INDEX IF NOT EXISTS idx_notes_exam_id
    ON notes(exam_id);

CREATE INDEX IF NOT EXISTS idx_current_affairs_date
    ON current_affairs(published_date);

CREATE INDEX IF NOT EXISTS idx_attempts_user_id
    ON attempts(user_id);

CREATE INDEX IF NOT EXISTS idx_attempt_answers_attempt_id
    ON attempt_answers(attempt_id);

CREATE INDEX IF NOT EXISTS idx_notifications_user_id
    ON notifications(user_id);


-- =========================================================
-- SCHEMA COMPLETE
-- =========================================================