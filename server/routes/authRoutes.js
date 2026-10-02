const express = require("express");
const argon2 = require("argon2");

const router = express.Router();

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 4;
const MAX_PASSWORD_LENGTH = 128;

router.post("/register", async (req, res) => {
  const { name, email, password } = req.body || {};

  if (typeof name !== "string" || name.trim().length < 1 || name.trim().length > 100) {
    return res.status(400).json({
      success: false,
      message: "Name must be between 1 and 100 characters"
    });
  }

  if (typeof email !== "string") {
    return res.status(400).json({
      success: false,
      message: "A valid email address is required"
    });
  }

  const normalizedEmail = email.trim().toLowerCase();
  if (
    normalizedEmail.length > 150 ||
    !EMAIL_PATTERN.test(normalizedEmail)
  ) {
    return res.status(400).json({
      success: false,
      message: "A valid email address is required"
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

  const pool = req.app.locals.pool;
  let client;
  let transactionStarted = false;

  try {
    client = await pool.connect();
    await client.query("BEGIN");
    transactionStarted = true;

    await client.query(
      "SELECT pg_advisory_xact_lock(hashtext($1))",
      [normalizedEmail]
    );

    const existingUser = await client.query(
      "SELECT 1 FROM users WHERE LOWER(email) = $1 LIMIT 1",
      [normalizedEmail]
    );

    if (existingUser.rows.length > 0) {
      await client.query("ROLLBACK");
      transactionStarted = false;
      return res.status(409).json({
        success: false,
        message: "An account with this email already exists"
      });
    }

    const passwordHash = await argon2.hash(password, {
      type: argon2.argon2id
    });

    const userResult = await client.query(
      `
      INSERT INTO users (name, email, password_hash)
      VALUES ($1, $2, $3)
      RETURNING id, name, email, role
      `,
      [name.trim(), normalizedEmail, passwordHash]
    );

    await client.query("COMMIT");
    transactionStarted = false;

    return res.status(201).json({
      success: true,
      data: userResult.rows[0]
    });
  } catch (error) {
    if (client && transactionStarted) {
      await client.query("ROLLBACK");
    }

    if (error.code === "23505") {
      return res.status(409).json({
        success: false,
        message: "An account with this email already exists"
      });
    }

    console.error("Error registering user:", error.message);
    return res.status(500).json({
      success: false,
      message: "Unable to create account right now"
    });
  } finally {
    if (client) {
      client.release();
    }
  }
});

module.exports = router;
