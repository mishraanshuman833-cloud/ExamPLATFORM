BEGIN;

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

COMMIT;
