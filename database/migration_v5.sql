BEGIN;

ALTER TABLE questions
ADD COLUMN IF NOT EXISTS language VARCHAR(2) NOT NULL DEFAULT 'en';

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'questions_language_check'
          AND conrelid = 'questions'::regclass
    ) THEN
        ALTER TABLE questions
        ADD CONSTRAINT questions_language_check
        CHECK (language IN ('en', 'hi'));
    END IF;
END $$;

-- Existing rows default to English. Mark rows containing Devanagari
-- question, explanation, or option text as Hindi before adding future data.
-- Match UTF-8 bytes for U+0900-U+097F to avoid locale-sensitive character ranges.
UPDATE questions q
SET language = 'hi'
WHERE encode(convert_to(q.question_text, 'UTF8'), 'hex') ~ 'e0a[45][0-9a-f]'
   OR encode(convert_to(COALESCE(q.explanation, ''), 'UTF8'), 'hex') ~ 'e0a[45][0-9a-f]'
   OR EXISTS (
       SELECT 1
       FROM question_options qo
       WHERE qo.question_id = q.id
         AND encode(convert_to(qo.option_text, 'UTF8'), 'hex') ~ 'e0a[45][0-9a-f]'
   );

CREATE INDEX IF NOT EXISTS idx_questions_language
    ON questions(language);

COMMIT;
