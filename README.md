# ExamPlatform

## Authentication setup

Apply `database/migration_v4.sql` to the existing PostgreSQL database before
using login or registration, and apply `database/migration_v7.sql` to enable
email registration verification. Add a unique `SESSION_SECRET` of at least 32
characters to `server/.env`; do not commit that secret. Configure Gmail delivery
with `GMAIL_USER` and a Gmail app password in `GMAIL_APP_PASSWORD`, also only in
`server/.env`. Registration remains unavailable until email delivery is
configured; no development verification bypass is provided. To provision the
developer administrator, set `ADMIN_EMAIL` there to the verified account email.
Only that account is promoted to `admin` during registration or a successful
login; when unset, new accounts remain students. The setting is server-only and
must not be exposed to the browser. Generate a session secret with:

```sh
node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"
```

The browser receives an HttpOnly session cookie. Session records are stored in
PostgreSQL and only a SHA-256 hash of each random session token is persisted.
Registration emails a time-limited code and stores only a keyed digest in
`email_verification_challenges`. A successful verification is required before
the account, password hash, or session is created. Resending replaces the
previous code, and verification is limited to five attempts per code.

Authenticated mock-test submissions use the verified session to populate the
existing nullable `attempts.user_id` column. The protected history endpoints are
`GET /api/results/attempts` and `GET /api/results/attempts/:attemptId`; attempt
ownership is never selected from request parameters. Existing anonymous attempts
remain unassigned, and prior device-local history remains in the browser as a
separate legacy archive.

## Question data foundation

Questions are organized through the existing `exams` → `subjects` (the current
section grouping) → `topics` → `questions` relationships. Question options stay
normalized in `question_options`, with `is_correct` as the scoring source of
truth. Difficulty is constrained to `easy`, `medium`, or `hard`; question
language is constrained to `en` or `hi`.

For an existing database, apply `database/migration_v5.sql` after the earlier
migrations. It preserves existing questions, defaults them to English, and
marks a question Hindi if its text, explanation, or an option contains
Devanagari characters. The question API supports `examId` (ID or slug),
`sectionId` (subject ID), `topicId`, `difficulty`, and `language` filters.
Student-facing question and mock-test APIs do not include answer keys or
explanations before submission; explanations remain available in result review.

## Exam pattern foundation

For an existing database, apply `database/migration_v6.sql` after migration v5.
Exam patterns are versioned and use the existing exam, subject-as-section, and
topic records. Pattern configuration is created as a draft; administrators can
activate or deactivate it, and configuration edits require a new version.
`mock_tests.exam_pattern_id` is nullable so existing tests retain their current
behavior; when a future paper is linked to a pattern, the database prevents
deleting or changing that active/used pattern configuration.

`GET /api/exam-patterns` and `GET /api/exam-patterns/:patternId` expose active
patterns. Authenticated administrators can list all patterns at
`GET /api/exam-patterns/admin`, inspect one with
`GET /api/exam-patterns/admin/:patternId`, create a draft with
`POST /api/exam-patterns`, and activate/deactivate it with
`POST /api/exam-patterns/:patternId/activate` and
`POST /api/exam-patterns/:patternId/deactivate`. Creation validates section,
topic, totals, and optional difficulty/language/question-type allocations on
the server. Rule allocations accept exact question counts or percentage weights;
weights must total 100 within each configured distribution. No sample pattern
is seeded automatically.

## Admin Question Bank

Administrators can search and filter the full question inventory through
`GET /api/admin/question-bank`. It supports question-text search; exam, section,
topic, language, difficulty, review-status, published-state, origin, and source
filters; and server-side pagination (`page` defaults to 1 and `pageSize`
defaults to 20, with a maximum of 100). The response includes `totalCount`,
`page`, `pageSize`, and `totalPages`. Question details are available through
`GET /api/admin/question-bank/:questionId`.

Edit pending unpublished AI-generated question content with
`PATCH /api/admin/question-bank/:questionId`, or approve/reject with
`POST /api/admin/question-bank/:questionId/approve` and
`POST /api/admin/question-bank/:questionId/reject`. Approved unpublished AI
questions can be published with
`POST /api/admin/question-bank/:questionId/publish`. Approval does not publish
the question; editing, review, and publish eligibility remain restricted to
their existing states. All Question Bank endpoints require an administrator
session.