BEGIN;

CREATE TABLE IF NOT EXISTS exam_patterns (
    id BIGSERIAL PRIMARY KEY,
    exam_id BIGINT NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
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
    exam_pattern_id BIGINT NOT NULL
        REFERENCES exam_patterns(id) ON DELETE CASCADE,
    section_rule_id BIGINT NOT NULL,
    topic_id BIGINT NOT NULL
        REFERENCES topics(id) ON DELETE RESTRICT,
    question_count INTEGER CHECK (question_count IS NULL OR question_count > 0),
    weight NUMERIC(8,4),
    CONSTRAINT exam_pattern_topics_weight_check
        CHECK (weight IS NULL OR weight > 0 AND weight <= 100),
    CHECK ((question_count IS NULL) <> (weight IS NULL)),
    FOREIGN KEY (section_rule_id, exam_pattern_id)
        REFERENCES exam_pattern_sections(id, exam_pattern_id)
        ON DELETE CASCADE,
    UNIQUE (section_rule_id, topic_id)
);

ALTER TABLE exam_pattern_sections
    DROP CONSTRAINT IF EXISTS exam_pattern_sections_weight_check;
ALTER TABLE exam_pattern_sections
    ADD CONSTRAINT exam_pattern_sections_weight_check
    CHECK (weight IS NULL OR weight > 0 AND weight <= 100);

ALTER TABLE exam_pattern_topics
    DROP CONSTRAINT IF EXISTS exam_pattern_topics_weight_check;
ALTER TABLE exam_pattern_topics
    ADD CONSTRAINT exam_pattern_topics_weight_check
    CHECK (weight IS NULL OR weight > 0 AND weight <= 100);

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

ALTER TABLE mock_tests
    ADD COLUMN IF NOT EXISTS exam_pattern_id BIGINT;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'mock_tests_exam_pattern_exam_fkey'
          AND conrelid = 'mock_tests'::regclass
    ) THEN
        ALTER TABLE mock_tests
            ADD CONSTRAINT mock_tests_exam_pattern_exam_fkey
            FOREIGN KEY (exam_pattern_id, exam_id)
            REFERENCES exam_patterns(id, exam_id)
            ON DELETE RESTRICT;
    END IF;
END $$;

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

DROP TRIGGER IF EXISTS trg_mock_tests_exam_pattern ON mock_tests;
CREATE TRIGGER trg_mock_tests_exam_pattern
BEFORE INSERT OR UPDATE OF exam_pattern_id, exam_id ON mock_tests
FOR EACH ROW EXECUTE FUNCTION bind_mock_test_exam_pattern();

DROP TRIGGER IF EXISTS trg_exam_patterns_updated_at ON exam_patterns;
CREATE TRIGGER trg_exam_patterns_updated_at
BEFORE UPDATE ON exam_patterns
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

COMMIT;
