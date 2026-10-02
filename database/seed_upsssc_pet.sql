BEGIN;

INSERT INTO exams (name, slug, description, is_active)
VALUES (
    'UPSSSC PET',
    'upsssc-pet',
    'Uttar Pradesh Subordinate Services Selection Commission Preliminary Eligibility Test.',
    TRUE
)
ON CONFLICT (slug) DO UPDATE
SET name = EXCLUDED.name,
    description = EXCLUDED.description,
    is_active = TRUE;

INSERT INTO subjects (exam_id, name, slug, description, display_order, is_active)
SELECT e.id, seeded.name, seeded.slug, seeded.description, seeded.display_order, TRUE
FROM exams e
CROSS JOIN (
    VALUES
        ('General Knowledge', 'general-knowledge', 'Indian general knowledge and civics.', 1),
        ('General Science', 'general-science', 'Foundational science questions.', 2),
        ('General Hindi', 'general-hindi', 'Hindi vocabulary and grammar.', 3),
        ('Reasoning', 'reasoning', 'Logical and numerical reasoning.', 4),
        ('Mathematics', 'mathematics', 'Basic quantitative aptitude.', 5)
) AS seeded(name, slug, description, display_order)
WHERE e.slug = 'upsssc-pet'
ON CONFLICT (exam_id, name) DO UPDATE
SET slug = EXCLUDED.slug,
    description = EXCLUDED.description,
    display_order = EXCLUDED.display_order,
    is_active = TRUE;

INSERT INTO topics (subject_id, name, slug, description, display_order, is_active)
SELECT s.id, seeded.name, seeded.slug, seeded.description, seeded.display_order, TRUE
FROM exams e
JOIN subjects s ON s.exam_id = e.id
CROSS JOIN (
    VALUES
        ('General Knowledge', 'Indian Constitution', 'indian-constitution', 'Indian Constitution', 1),
        ('General Science', 'Biology', 'biology', 'Biology', 1),
        ('General Hindi', 'Hindi Vocabulary', 'hindi-vocabulary', 'Hindi Vocabulary', 1),
        ('Reasoning', 'Number Series', 'number-series', 'Number Series', 1),
        ('Mathematics', 'Percentages', 'percentages', 'Percentages', 1)
) AS seeded(subject_name, name, slug, description, display_order)
WHERE e.slug = 'upsssc-pet'
  AND s.name = seeded.subject_name
ON CONFLICT (subject_id, name) DO UPDATE
SET slug = EXCLUDED.slug,
    description = EXCLUDED.description,
    display_order = EXCLUDED.display_order,
    is_active = TRUE;

INSERT INTO questions (
    topic_id,
    question_text,
    question_type,
    explanation,
    difficulty,
    marks,
    negative_marks,
    question_origin,
    ai_generated,
    review_status,
    is_published
)
SELECT t.id, seeded.question_text, 'mcq', seeded.explanation, 'easy', 1, 0.25, 'manual', FALSE, 'approved', TRUE
FROM exams e
JOIN subjects s ON s.exam_id = e.id
JOIN topics t ON t.subject_id = s.id
JOIN (
    VALUES
        ('General Knowledge', 'indian-constitution', 'When did the Constitution of India come into effect?', 'The Constitution of India came into effect on 26 January 1950, celebrated as Republic Day.'),
        ('General Science', 'biology', 'Which pigment enables plants to absorb light for photosynthesis?', 'Chlorophyll is the green pigment that absorbs light energy for photosynthesis.'),
        ('General Hindi', 'hindi-vocabulary', '‘जल’ का पर्यायवाची शब्द कौन-सा है?', '‘नीर’ का अर्थ जल या पानी होता है।'),
        ('Reasoning', 'number-series', 'What is the next number in the series 2, 6, 12, 20, 30?', 'The successive differences are 4, 6, 8 and 10. The next difference is 12, so the next number is 42.'),
        ('Mathematics', 'percentages', 'What is 25% of 240?', '25% is one quarter, and one quarter of 240 is 60.')
) AS seeded(subject_name, topic_slug, question_text, explanation)
ON seeded.subject_name = s.name
AND seeded.topic_slug = t.slug
WHERE e.slug = 'upsssc-pet'
AND NOT EXISTS (
    SELECT 1
    FROM questions existing
    WHERE existing.topic_id = t.id
      AND existing.question_text = seeded.question_text
);

INSERT INTO question_options (question_id, option_key, option_text, is_correct)
SELECT q.id, seeded.option_key, seeded.option_text, seeded.is_correct
FROM questions q
JOIN topics t ON t.id = q.topic_id
JOIN subjects s ON s.id = t.subject_id
JOIN exams e ON e.id = s.exam_id
JOIN (
    VALUES
        ('General Knowledge', 'indian-constitution', 'When did the Constitution of India come into effect?', 'A', '15 August 1947', FALSE),
        ('General Knowledge', 'indian-constitution', 'When did the Constitution of India come into effect?', 'B', '26 January 1950', TRUE),
        ('General Knowledge', 'indian-constitution', 'When did the Constitution of India come into effect?', 'C', '26 November 1949', FALSE),
        ('General Knowledge', 'indian-constitution', 'When did the Constitution of India come into effect?', 'D', '2 October 1950', FALSE),
        ('General Science', 'biology', 'Which pigment enables plants to absorb light for photosynthesis?', 'A', 'Haemoglobin', FALSE),
        ('General Science', 'biology', 'Which pigment enables plants to absorb light for photosynthesis?', 'B', 'Melanin', FALSE),
        ('General Science', 'biology', 'Which pigment enables plants to absorb light for photosynthesis?', 'C', 'Chlorophyll', TRUE),
        ('General Science', 'biology', 'Which pigment enables plants to absorb light for photosynthesis?', 'D', 'Keratin', FALSE),
        ('General Hindi', 'hindi-vocabulary', '‘जल’ का पर्यायवाची शब्द कौन-सा है?', 'A', 'अग्नि', FALSE),
        ('General Hindi', 'hindi-vocabulary', '‘जल’ का पर्यायवाची शब्द कौन-सा है?', 'B', 'नीर', TRUE),
        ('General Hindi', 'hindi-vocabulary', '‘जल’ का पर्यायवाची शब्द कौन-सा है?', 'C', 'पवन', FALSE),
        ('General Hindi', 'hindi-vocabulary', '‘जल’ का पर्यायवाची शब्द कौन-सा है?', 'D', 'आकाश', FALSE),
        ('Reasoning', 'number-series', 'What is the next number in the series 2, 6, 12, 20, 30?', 'A', '36', FALSE),
        ('Reasoning', 'number-series', 'What is the next number in the series 2, 6, 12, 20, 30?', 'B', '40', FALSE),
        ('Reasoning', 'number-series', 'What is the next number in the series 2, 6, 12, 20, 30?', 'C', '42', TRUE),
        ('Reasoning', 'number-series', 'What is the next number in the series 2, 6, 12, 20, 30?', 'D', '44', FALSE),
        ('Mathematics', 'percentages', 'What is 25% of 240?', 'A', '40', FALSE),
        ('Mathematics', 'percentages', 'What is 25% of 240?', 'B', '50', FALSE),
        ('Mathematics', 'percentages', 'What is 25% of 240?', 'C', '60', TRUE),
        ('Mathematics', 'percentages', 'What is 25% of 240?', 'D', '80', FALSE)
) AS seeded(subject_name, topic_slug, question_text, option_key, option_text, is_correct)
WHERE e.slug = 'upsssc-pet'
  AND s.name = seeded.subject_name
  AND t.slug = seeded.topic_slug
  AND q.question_text = seeded.question_text
ON CONFLICT (question_id, option_key) DO UPDATE
SET option_text = EXCLUDED.option_text,
    is_correct = EXCLUDED.is_correct;

INSERT INTO mock_tests (
    exam_id,
    title,
    description,
    duration_minutes,
    total_questions,
    total_marks,
    negative_marking,
    is_published
)
SELECT e.id,
       'UPSSSC PET Foundation Mock Test 1',
       'A short sample test to verify the PET test-taking and result flow.',
       15,
       5,
       5,
       0.25,
       TRUE
FROM exams e
WHERE e.slug = 'upsssc-pet'
AND NOT EXISTS (
    SELECT 1
    FROM mock_tests existing
    WHERE existing.exam_id = e.id
      AND existing.title = 'UPSSSC PET Foundation Mock Test 1'
);

INSERT INTO mock_test_questions (mock_test_id, question_id, question_order, marks)
SELECT mt.id, q.id, seeded.order_no, 1
FROM mock_tests mt
JOIN exams e ON e.id = mt.exam_id
JOIN (
    VALUES
        ('UPSSSC PET Foundation Mock Test 1', 'When did the Constitution of India come into effect?', 1),
        ('UPSSSC PET Foundation Mock Test 1', 'Which pigment enables plants to absorb light for photosynthesis?', 2),
        ('UPSSSC PET Foundation Mock Test 1', '‘जल’ का पर्यायवाची शब्द कौन-सा है?', 3),
        ('UPSSSC PET Foundation Mock Test 1', 'What is the next number in the series 2, 6, 12, 20, 30?', 4),
        ('UPSSSC PET Foundation Mock Test 1', 'What is 25% of 240?', 5)
) AS seeded(title, question_text, order_no)
JOIN questions q ON q.question_text = seeded.question_text
WHERE e.slug = 'upsssc-pet'
  AND mt.title = seeded.title
ON CONFLICT (mock_test_id, question_id) DO NOTHING;

UPDATE mock_tests mt
SET total_questions = (
        SELECT COUNT(*)::integer
        FROM mock_test_questions mtq
        WHERE mtq.mock_test_id = mt.id
    ),
    total_marks = (
        SELECT COALESCE(SUM(mtq.marks), 0)
        FROM mock_test_questions mtq
        WHERE mtq.mock_test_id = mt.id
    )
WHERE mt.title = 'UPSSSC PET Foundation Mock Test 1';

COMMIT;
