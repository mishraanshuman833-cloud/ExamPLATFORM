const crypto = require("crypto");
const express = require("express");
const argon2 = require("argon2");
const {
  clearSessionCookie,
  getAuthenticatedUser,
  getSessionSecret,
  getSessionToken,
  hashSessionToken,
  respondToAuthenticationError,
  setSessionCookie
} = require("../middleware/authSession");

const router = express.Router();

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 4;
const MAX_PASSWORD_LENGTH = 128;
const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;
const OTP_TTL_MINUTES = 10;
const OTP_MAX_ATTEMPTS = 5;
const OTP_RESEND_COOLDOWN_SECONDS = 60;

function configuredAdminEmail() {
  const email = process.env.ADMIN_EMAIL;
  return typeof email === "string" && email.trim()
    ? email.trim().toLowerCase()
    : null;
}

function registrationOtpHash(email, otp, secret) {
  return crypto
    .createHmac("sha256", secret)
    .update(`${email}:${otp}`)
    .digest("hex");
}

function registrationCompletionHash(email, token, secret) {
  return crypto
    .createHmac("sha256", secret)
    .update(`${email}:registration:${token}`)
    .digest("hex");
}

function generateRegistrationOtp() {
  return crypto.randomInt(0, 1000000).toString().padStart(6, "0");
}

function validOtpHash(candidate, stored) {
  const candidateBuffer = Buffer.from(candidate, "hex");
  const storedBuffer = Buffer.from(stored, "hex");
  return candidateBuffer.length === storedBuffer.length &&
    crypto.timingSafeEqual(candidateBuffer, storedBuffer);
}

function validateRegistrationInput(body) {
  const { name, email } = body || {};
  if (typeof name !== "string" || name.trim().length < 1 || name.trim().length > 100) {
    return { error: "Name must be between 1 and 100 characters" };
  }
  if (typeof email !== "string") {
    return { error: "A valid email address is required" };
  }
  const normalizedEmail = email.trim().toLowerCase();
  if (normalizedEmail.length > 150 || !EMAIL_PATTERN.test(normalizedEmail)) {
    return { error: "A valid email address is required" };
  }
  return { value: { name: name.trim(), email: normalizedEmail } };
}

async function createSession(client, userId) {
  const token = crypto.randomBytes(32).toString("base64url");
  await client.query(
    `
    INSERT INTO auth_sessions (token_hash, user_id, expires_at)
    VALUES ($1, $2, NOW() + ($3 * INTERVAL '1 second'))
    `,
    [hashSessionToken(token), userId, SESSION_TTL_SECONDS]
  );
  return token;
}

router.post("/register", async (req, res) => {
  const validation = validateRegistrationInput(req.body);
  if (validation.error) {
    return res.status(400).json({
      success: false,
      message: validation.error
    });
  }
  const { name, email } = validation.value;

  let client;
  let transactionStarted = false;

  try {
    const sessionSecret = getSessionSecret();
    const pool = req.app.locals.pool;
    const otp = generateRegistrationOtp();
    client = await pool.connect();
    await client.query("BEGIN");
    transactionStarted = true;

    await client.query(
      "SELECT pg_advisory_xact_lock(hashtext($1))",
      [email]
    );

    const existingUser = await client.query(
      "SELECT 1 FROM users WHERE LOWER(email) = $1 LIMIT 1",
      [email]
    );

    if (existingUser.rows.length > 0) {
      await client.query("ROLLBACK");
      transactionStarted = false;
      return res.status(409).json({
        success: false,
        message: "An account with this email already exists"
      });
    }

    const existingChallenge = await client.query(
      `
      SELECT last_sent_at > NOW() - ($2 * INTERVAL '1 second') AS cooldown_active
      FROM email_verification_challenges
      WHERE email = $1
      FOR UPDATE
      `,
      [email, OTP_RESEND_COOLDOWN_SECONDS]
    );
    if (existingChallenge.rows[0]?.cooldown_active) {
      await client.query("ROLLBACK");
      transactionStarted = false;
      return res.status(429).json({
        success: false,
        message: "Please wait before requesting another verification code"
      });
    }

    await client.query(
      `
      INSERT INTO email_verification_challenges
        (email, name, otp_hash, expires_at, attempts, last_sent_at, updated_at)
      VALUES ($1, $2, $3, NOW() + ($4 * INTERVAL '1 minute'), 0, NOW(), NOW())
      ON CONFLICT (email) DO UPDATE
      SET name = EXCLUDED.name,
          otp_hash = EXCLUDED.otp_hash,
          expires_at = EXCLUDED.expires_at,
          attempts = 0,
          last_sent_at = NOW(),
          updated_at = NOW()
      `,
      [email, name, registrationOtpHash(email, otp, getSessionSecret()), OTP_TTL_MINUTES]
    );

    try {
      await req.app.locals.sendRegistrationOtp({ to: email, otp });
    } catch {
      await client.query("ROLLBACK");
      transactionStarted = false;
      console.error("Registration verification email could not be sent");
      return res.status(503).json({
        success: false,
        message: "Verification email could not be sent. Please try again later."
      });
    }

    await client.query("COMMIT");
    transactionStarted = false;
    return res.status(202).json({
      success: true,
      verificationRequired: true,
      message: "If the address can be registered, a verification code has been emailed."
    });
  } catch (error) {
    if (client && transactionStarted) {
      await client.query("ROLLBACK");
    }

    if (respondToAuthenticationError(res, error)) {
      return;
    }
    console.error("Unable to start email registration verification");
    return res.status(500).json({
      success: false,
      message: "Unable to start registration right now"
    });
  } finally {
    if (client) {
      client.release();
    }
  }
});

router.post("/register/resend", async (req, res) => {
  const email = typeof req.body?.email === "string"
    ? req.body.email.trim().toLowerCase()
    : "";
  if (email.length > 150 || !EMAIL_PATTERN.test(email)) {
    return res.status(400).json({
      success: false,
      message: "A valid email address is required"
    });
  }

  let client;
  let transactionStarted = false;
  try {
    const secret = getSessionSecret();
    client = await req.app.locals.pool.connect();
    await client.query("BEGIN");
    transactionStarted = true;
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [email]);
    const current = await client.query(
      `
      SELECT last_sent_at > NOW() - ($2 * INTERVAL '1 second') AS cooldown_active
      FROM email_verification_challenges
      WHERE email = $1
      FOR UPDATE
      `,
      [email, OTP_RESEND_COOLDOWN_SECONDS]
    );

    if (current.rowCount === 0) {
      await client.query("COMMIT");
      transactionStarted = false;
      return res.status(202).json({
        success: true,
        message: "If a pending registration exists, a new verification code has been emailed."
      });
    }

    if (current.rows[0].cooldown_active) {
      await client.query("ROLLBACK");
      transactionStarted = false;
      return res.status(429).json({
        success: false,
        message: "Please wait before requesting another verification code"
      });
    }

    const otp = generateRegistrationOtp();
    await client.query(
      `
      UPDATE email_verification_challenges
      SET otp_hash = $2,
          expires_at = NOW() + ($3 * INTERVAL '1 minute'),
          attempts = 0,
          last_sent_at = NOW(),
          updated_at = NOW()
      WHERE email = $1
      `,
      [email, registrationOtpHash(email, otp, secret), OTP_TTL_MINUTES]
    );
    await client.query("COMMIT");
    transactionStarted = false;

    try {
      await req.app.locals.sendRegistrationOtp({ to: email, otp });
    } catch {
      console.error("Registration verification email could not be resent");
      return res.status(503).json({
        success: false,
        message: "Verification email could not be sent. Please try again later."
      });
    }
    return res.status(202).json({
      success: true,
      message: "If a pending registration exists, a new verification code has been emailed."
    });
  } catch (error) {
    if (client && transactionStarted) {
      await client.query("ROLLBACK");
    }
    if (respondToAuthenticationError(res, error)) {
      return;
    }
    console.error("Unable to resend email registration verification");
    return res.status(500).json({
      success: false,
      message: "Unable to resend a verification code right now"
    });
  } finally {
    if (client) {
      client.release();
    }
  }
});

router.post("/register/verify", async (req, res) => {
  const email = typeof req.body?.email === "string"
    ? req.body.email.trim().toLowerCase()
    : "";
  const otp = req.body?.otp;
  if (email.length > 150 || !EMAIL_PATTERN.test(email)) {
    return res.status(400).json({
      success: false,
      message: "A valid email address is required"
    });
  }
  if (typeof otp !== "string" || !/^\d{6}$/.test(otp)) {
    return res.status(400).json({
      success: false,
      message: "Enter the six-digit verification code"
    });
  }

  let client;
  let transactionStarted = false;
  try {
    const sessionSecret = getSessionSecret();
    const pool = req.app.locals.pool;
    client = await pool.connect();
    await client.query("BEGIN");
    transactionStarted = true;
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [email]);
    const challengeResult = await client.query(
      `SELECT name, otp_hash, expires_at, attempts,
              expires_at <= NOW() AS expired
       FROM email_verification_challenges
       WHERE email = $1
       FOR UPDATE`,
      [email]
    );
    if (challengeResult.rowCount === 0) {
      await client.query("ROLLBACK");
      transactionStarted = false;
      return res.status(400).json({
        success: false,
        message: "Verification code is invalid or expired"
      });
    }
    const challenge = challengeResult.rows[0];
    if (challenge.expired) {
      await client.query(
        "DELETE FROM email_verification_challenges WHERE email = $1",
        [email]
      );
      await client.query("COMMIT");
      transactionStarted = false;
      return res.status(400).json({
        success: false,
        message: "Verification code is invalid or expired"
      });
    }
    if (challenge.attempts >= OTP_MAX_ATTEMPTS) {
      await client.query("ROLLBACK");
      transactionStarted = false;
      return res.status(429).json({
        success: false,
        message: "Verification attempt limit reached. Request a new code."
      });
    }

    const expectedOtpHash = registrationOtpHash(email, otp, sessionSecret);
    if (!validOtpHash(expectedOtpHash, challenge.otp_hash.trim())) {
      const attemptCount = challenge.attempts + 1;
      await client.query(
        `UPDATE email_verification_challenges
         SET attempts = $2, updated_at = NOW()
         WHERE email = $1`,
        [email, attemptCount]
      );
      await client.query("COMMIT");
      transactionStarted = false;
      return res.status(attemptCount >= OTP_MAX_ATTEMPTS ? 429 : 400).json({
        success: false,
        message: attemptCount >= OTP_MAX_ATTEMPTS
          ? "Verification attempt limit reached. Request a new code."
          : "Verification code is invalid or expired"
      });
    }

    const existingUser = await client.query(
      "SELECT 1 FROM users WHERE LOWER(email) = $1 LIMIT 1",
      [email]
    );
    if (existingUser.rowCount > 0) {
      await client.query("DELETE FROM email_verification_challenges WHERE email = $1", [email]);
      await client.query("COMMIT");
      transactionStarted = false;
      return res.status(409).json({
        success: false,
        message: "An account with this email already exists"
      });
    }

    const registrationToken = crypto.randomBytes(32).toString("base64url");
    await client.query(
      `
      UPDATE email_verification_challenges
      SET otp_hash = $2,
          expires_at = NOW() + ($3 * INTERVAL '1 minute'),
          attempts = 0,
          updated_at = NOW()
      WHERE email = $1
      `,
      [
        email,
        registrationCompletionHash(email, registrationToken, sessionSecret),
        OTP_TTL_MINUTES
      ]
    );
    await client.query("COMMIT");
    transactionStarted = false;
    return res.json({
      success: true,
      verified: true,
      registrationToken
    });
  } catch (error) {
    if (client && transactionStarted) {
      await client.query("ROLLBACK");
    }
    if (respondToAuthenticationError(res, error)) {
      return;
    }
    if (error.code === "23505") {
      return res.status(409).json({
        success: false,
        message: "An account with this email already exists"
      });
    }
    console.error("Unable to verify registration email");
    return res.status(500).json({
      success: false,
      message: "Unable to verify the email right now"
    });
  } finally {
    if (client) {
      client.release();
    }
  }
});

router.post("/register/complete", async (req, res) => {
  const email = typeof req.body?.email === "string"
    ? req.body.email.trim().toLowerCase()
    : "";
  const registrationToken = req.body?.registrationToken;
  const password = req.body?.password;
  if (email.length > 150 || !EMAIL_PATTERN.test(email)) {
    return res.status(400).json({
      success: false,
      message: "A valid email address is required"
    });
  }
  if (
    typeof registrationToken !== "string" ||
    !/^[A-Za-z0-9_-]{43}$/.test(registrationToken)
  ) {
    return res.status(400).json({
      success: false,
      message: "Email verification is required before creating an account"
    });
  }
  if (
    typeof password !== "string" ||
    password.length < MIN_PASSWORD_LENGTH ||
    password.length > MAX_PASSWORD_LENGTH
  ) {
    return res.status(400).json({
      success: false,
      message: `Password must be between ${MIN_PASSWORD_LENGTH} and ${MAX_PASSWORD_LENGTH} characters`
    });
  }

  let client;
  let transactionStarted = false;
  try {
    const sessionSecret = getSessionSecret();
    client = await req.app.locals.pool.connect();
    await client.query("BEGIN");
    transactionStarted = true;
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [email]);
    const challengeResult = await client.query(
      `SELECT name, otp_hash, expires_at, attempts,
              expires_at <= NOW() AS expired
       FROM email_verification_challenges
       WHERE email = $1
       FOR UPDATE`,
      [email]
    );
    if (challengeResult.rowCount === 0) {
      await client.query("ROLLBACK");
      transactionStarted = false;
      return res.status(400).json({
        success: false,
        message: "Email verification is required before creating an account"
      });
    }

    const challenge = challengeResult.rows[0];
    if (challenge.expired) {
      await client.query(
        "DELETE FROM email_verification_challenges WHERE email = $1",
        [email]
      );
      await client.query("COMMIT");
      transactionStarted = false;
      return res.status(400).json({
        success: false,
        message: "Email verification has expired. Request a new code."
      });
    }

    if (
      challenge.attempts >= OTP_MAX_ATTEMPTS ||
      !validOtpHash(
        registrationCompletionHash(email, registrationToken, sessionSecret),
        challenge.otp_hash.trim()
      )
    ) {
      await client.query("ROLLBACK");
      transactionStarted = false;
      return res.status(400).json({
        success: false,
        message: "Email verification is invalid or expired"
      });
    }

    const existingUser = await client.query(
      "SELECT 1 FROM users WHERE LOWER(email) = $1 LIMIT 1",
      [email]
    );
    if (existingUser.rowCount > 0) {
      await client.query("DELETE FROM email_verification_challenges WHERE email = $1", [email]);
      await client.query("COMMIT");
      transactionStarted = false;
      return res.status(409).json({
        success: false,
        message: "An account with this email already exists"
      });
    }

    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    const role = email === configuredAdminEmail() ? "admin" : "student";
    const userResult = await client.query(
      `
      INSERT INTO users (name, email, password_hash, role)
      VALUES ($1, $2, $3, $4)
      RETURNING id, name, email, role
      `,
      [challenge.name, email, passwordHash, role]
    );
    await client.query("DELETE FROM auth_sessions WHERE expires_at <= NOW()");
    const sessionToken = await createSession(client, userResult.rows[0].id);
    await client.query("DELETE FROM email_verification_challenges WHERE email = $1", [email]);
    await client.query("COMMIT");
    transactionStarted = false;
    setSessionCookie(res, sessionToken, sessionSecret);
    return res.status(201).json({
      success: true,
      authenticated: true,
      data: userResult.rows[0]
    });
  } catch (error) {
    if (client && transactionStarted) {
      await client.query("ROLLBACK");
    }
    if (respondToAuthenticationError(res, error)) {
      return;
    }
    if (error.code === "23505") {
      return res.status(409).json({
        success: false,
        message: "An account with this email already exists"
      });
    }
    console.error("Unable to complete verified email registration");
    return res.status(500).json({
      success: false,
      message: "Unable to create the account right now"
    });
  } finally {
    if (client) {
      client.release();
    }
  }
});

router.post("/login", async (req, res) => {
  const { email, password } = req.body || {};
  if (
    typeof email !== "string" ||
    typeof password !== "string" ||
    password.length < 1 ||
    password.length > MAX_PASSWORD_LENGTH
  ) {
    return res.status(400).json({
      success: false,
      message: "A valid email address and password are required"
    });
  }

  const normalizedEmail = email.trim().toLowerCase();
  if (normalizedEmail.length > 150 || !EMAIL_PATTERN.test(normalizedEmail)) {
    return res.status(400).json({
      success: false,
      message: "A valid email address and password are required"
    });
  }

  let sessionSecret;
  try {
    sessionSecret = getSessionSecret();
  } catch (error) {
    respondToAuthenticationError(res, error);
    return;
  }

  const pool = req.app.locals.pool;
  let user;
  try {
    const userResult = await pool.query(
      `
      SELECT id, name, email, role, password_hash
      FROM users
      WHERE LOWER(email) = $1 AND is_active = TRUE
      LIMIT 1
      `,
      [normalizedEmail]
    );
    user = userResult.rows[0];

    if (
      !user ||
      typeof user.password_hash !== "string" ||
      !(await argon2.verify(user.password_hash, password))
    ) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password"
      });
    }
  } catch (error) {
    console.error("Error verifying login credentials:", error.message);
    return res.status(500).json({
      success: false,
      message: "Unable to log in right now"
    });
  }

  let client;
  let transactionStarted = false;
  try {
    client = await pool.connect();
    await client.query("BEGIN");
    transactionStarted = true;
    await client.query("DELETE FROM auth_sessions WHERE expires_at <= NOW()");

    const sessionToken = crypto.randomBytes(32).toString("base64url");
    const activeUser = await client.query(
      `
      INSERT INTO auth_sessions (token_hash, user_id, expires_at)
      SELECT $1, id, NOW() + ($3 * INTERVAL '1 second')
      FROM users
      WHERE id = $2 AND is_active = TRUE
      RETURNING user_id
      `,
      [
        hashSessionToken(sessionToken),
        user.id,
        SESSION_TTL_SECONDS
      ]
    );

    if (activeUser.rows.length === 0) {
      await client.query("ROLLBACK");
      transactionStarted = false;
      return res.status(401).json({
        success: false,
        message: "Invalid email or password"
      });
    }

    const adminEmail = configuredAdminEmail();
    if (adminEmail && user.email.trim().toLowerCase() === adminEmail) {
      const promotedUser = await client.query(
        `
        UPDATE users
        SET role = 'admin'
        WHERE id = $1 AND LOWER(email) = $2
        RETURNING id, name, email, role
        `,
        [user.id, adminEmail]
      );
      if (promotedUser.rowCount !== 1) {
        throw new Error("Configured administrator account could not be verified");
      }
      user = promotedUser.rows[0];
    }

    await client.query("COMMIT");
    transactionStarted = false;
    setSessionCookie(res, sessionToken, sessionSecret);
    return res.json({
      success: true,
      authenticated: true,
      data: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role
      }
    });
  } catch (error) {
    if (client && transactionStarted) {
      await client.query("ROLLBACK");
    }
    console.error("Error creating login session:", error.message);
    return res.status(500).json({
      success: false,
      message: "Unable to log in right now"
    });
  } finally {
    if (client) {
      client.release();
    }
  }
});

router.get("/me", async (req, res) => {
  try {
    const user = await getAuthenticatedUser(req, req.app.locals.pool);
    if (!user) {
      clearSessionCookie(res);
      return res.status(401).json({
        success: false,
        message: "Authentication required"
      });
    }

    return res.json({
      success: true,
      authenticated: true,
      data: user
    });
  } catch (error) {
    if (respondToAuthenticationError(res, error)) {
      return;
    }
    console.error("Error retrieving authenticated user:", error.message);
    return res.status(500).json({
      success: false,
      message: "Unable to retrieve account right now"
    });
  }
});

router.post("/logout", async (req, res) => {
  let sessionToken;
  try {
    sessionToken = getSessionToken(req, getSessionSecret());
  } catch (error) {
    clearSessionCookie(res);
    respondToAuthenticationError(res, error);
    return;
  }

  if (sessionToken) {
    try {
      await req.app.locals.pool.query(
        "DELETE FROM auth_sessions WHERE token_hash = $1",
        [hashSessionToken(sessionToken)]
      );
    } catch (error) {
      console.error("Error invalidating login session:", error.message);
      return res.status(500).json({
        success: false,
        message: "Unable to log out right now"
      });
    }
  }

  clearSessionCookie(res);
  return res.json({
    success: true,
    message: "Logged out successfully"
  });
});

module.exports = router;
