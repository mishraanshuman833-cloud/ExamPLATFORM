const assert = require("node:assert/strict");
const express = require("express");
const { after, before, beforeEach, test } = require("node:test");
const argon2 = require("argon2");

process.env.SESSION_SECRET = "test-session-secret-that-is-at-least-32-characters";
delete process.env.ADMIN_EMAIL;

const authRoutes = require("./authRoutes");

const users = [];
const sessions = [];
const challenges = new Map();
const deliveries = [];
const app = express();
let server;
let baseUrl;
let nextUserId = 1;
let failEmailDelivery = false;

app.use(express.json());
app.locals.pool = {
  async query(sql, values = []) {
    if (sql.includes("SELECT id, name, email, role, password_hash")) {
      const user = users.find((item) => item.email.toLowerCase() === values[0]);
      return { rowCount: user ? 1 : 0, rows: user ? [{ ...user }] : [] };
    }
    throw new Error(`Unexpected pool query: ${sql}`);
  },
  async connect() {
    let snapshot;
    return {
      async query(sql, values = []) {
        if (sql === "BEGIN") {
          snapshot = {
            users: structuredClone(users),
            sessions: structuredClone(sessions),
            challenges: structuredClone(Array.from(challenges.entries())),
            nextUserId
          };
          return { rowCount: null, rows: [] };
        }
        if (sql === "COMMIT") {
          snapshot = null;
          return { rowCount: null, rows: [] };
        }
        if (sql === "ROLLBACK") {
          users.splice(0, users.length, ...snapshot.users);
          sessions.splice(0, sessions.length, ...snapshot.sessions);
          challenges.clear();
          snapshot.challenges.forEach(([email, challenge]) => {
            challenges.set(email, challenge);
          });
          nextUserId = snapshot.nextUserId;
          snapshot = null;
          return { rowCount: null, rows: [] };
        }
        if (sql.includes("pg_advisory_xact_lock")) {
          return { rowCount: 1, rows: [] };
        }
        if (sql.includes("SELECT 1 FROM users WHERE LOWER(email)")) {
          const found = users.some((user) => user.email.toLowerCase() === values[0]);
          return { rowCount: found ? 1 : 0, rows: found ? [{ "?column?": 1 }] : [] };
        }
        if (sql.includes("DELETE FROM email_verification_challenges")) {
          challenges.delete(values[0]);
          return { rowCount: 1, rows: [] };
        }
        if (sql.includes("FROM email_verification_challenges")) {
          const challenge = challenges.get(values[0]);
          if (!challenge) {
            return { rowCount: 0, rows: [] };
          }
          if (sql.includes("cooldown_active")) {
            return {
              rowCount: 1,
              rows: [{
                cooldown_active:
                  Date.now() - challenge.lastSentAt <
                  Number(values[1]) * 1000
              }]
            };
          }
          return {
            rowCount: 1,
            rows: [{
              name: challenge.name,
              otp_hash: challenge.otpHash,
              expires_at: new Date(challenge.expiresAt),
              attempts: challenge.attempts,
              expired: challenge.expiresAt <= Date.now()
            }]
          };
        }
        if (sql.includes("INSERT INTO email_verification_challenges")) {
          challenges.set(values[0], {
            name: values[1],
            otpHash: values[2],
            expiresAt: Date.now() + Number(values[3]) * 60 * 1000,
            attempts: 0,
            lastSentAt: Date.now()
          });
          return { rowCount: 1, rows: [] };
        }
        if (sql.includes("UPDATE email_verification_challenges") && sql.includes("otp_hash")) {
          const challenge = challenges.get(values[0]);
          challenge.otpHash = values[1];
          challenge.expiresAt = Date.now() + Number(values[2]) * 60 * 1000;
          challenge.attempts = 0;
          challenge.lastSentAt = Date.now();
          return { rowCount: 1, rows: [] };
        }
        if (sql.includes("UPDATE email_verification_challenges") && sql.includes("attempts =")) {
          const challenge = challenges.get(values[0]);
          challenge.attempts = values[1];
          return { rowCount: 1, rows: [] };
        }
        if (sql.includes("INSERT INTO users")) {
          const user = {
            id: String(nextUserId++),
            name: values[0],
            email: values[1],
            password_hash: values[2],
            role: values[3],
            is_active: true
          };
          users.push(user);
          return {
            rowCount: 1,
            rows: [{
              id: user.id,
              name: user.name,
              email: user.email,
              role: user.role
            }]
          };
        }
        if (sql.includes("DELETE FROM auth_sessions")) {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes("INSERT INTO auth_sessions") && sql.includes("VALUES ($1, $2, NOW()")) {
          sessions.push({ tokenHash: values[0], userId: values[1] });
          return { rowCount: 1, rows: [] };
        }
        if (sql.includes("INSERT INTO auth_sessions") && sql.includes("SELECT $1, id")) {
          const user = users.find((item) => item.id === values[1] && item.is_active);
          if (!user) {
            return { rowCount: 0, rows: [] };
          }
          sessions.push({ tokenHash: values[0], userId: user.id });
          return { rowCount: 1, rows: [{ user_id: user.id }] };
        }
        if (sql.includes("UPDATE users") && sql.includes("SET role = 'admin'")) {
          const user = users.find((item) =>
            item.id === values[0] && item.email.toLowerCase() === values[1]
          );
          if (!user) {
            return { rowCount: 0, rows: [] };
          }
          user.role = "admin";
          return {
            rowCount: 1,
            rows: [{
              id: user.id,
              name: user.name,
              email: user.email,
              role: user.role
            }]
          };
        }
        throw new Error(`Unexpected transactional query: ${sql}`);
      },
      release() {}
    };
  }
};
app.locals.sendRegistrationOtp = async ({ to, otp }) => {
  if (failEmailDelivery) {
    throw new Error(`Test-only provider failure for OTP ${otp}`);
  }
  deliveries.push({ to, otp });
};
app.use("/api/auth", authRoutes);

before(async () => {
  server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}/api/auth`;
});

beforeEach(() => {
  users.splice(0, users.length);
  sessions.splice(0, sessions.length);
  challenges.clear();
  deliveries.splice(0, deliveries.length);
  nextUserId = 1;
  failEmailDelivery = false;
  delete process.env.ADMIN_EMAIL;
});

after(async () => {
  await new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
});

async function post(path, body) {
  return fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

async function startRegistration(overrides = {}) {
  return post("/register", {
    name: "Test User",
    email: "user@example.invalid",
    ...overrides
  });
}

async function verifyRegistration(otp, overrides = {}) {
  return post("/register/verify", {
    email: "user@example.invalid",
    otp,
    ...overrides
  });
}

async function completeRegistration(registrationToken, overrides = {}) {
  return post("/register/complete", {
    email: "user@example.invalid",
    registrationToken,
    password: "test-password",
    ...overrides
  });
}

async function login(email, password = "test-password") {
  return post("/login", { email, password });
}

test("registration verifies OTP before account creation and then creates a student account", async () => {
  const response = await startRegistration();
  const result = await response.json();

  assert.equal(response.status, 202);
  assert.equal(result.verificationRequired, true);
  assert.equal(users.length, 0);
  assert.equal(sessions.length, 0);
  assert.equal(deliveries.length, 1);
  assert.equal(deliveries[0].to, "user@example.invalid");
  assert.match(deliveries[0].otp, /^\d{6}$/);
  assert.equal(challenges.get("user@example.invalid").name, "Test User");
  assert.equal(JSON.stringify(result).includes("password"), false);
  assert.equal(challenges.get("user@example.invalid").otpHash.includes(deliveries[0].otp), false);
  assert.equal(JSON.stringify(result).includes(deliveries[0].otp), false);

  const verified = await verifyRegistration(deliveries[0].otp);
  const verifiedResult = await verified.json();
  assert.equal(verified.status, 200);
  assert.equal(verifiedResult.verified, true);
  assert.match(verifiedResult.registrationToken, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(JSON.stringify(verifiedResult).includes(deliveries[0].otp), false);
  assert.equal(users.length, 0);
  assert.equal(sessions.length, 0);
  assert.equal(challenges.size, 1);

  const completed = await completeRegistration(verifiedResult.registrationToken);
  const completedResult = await completed.json();
  assert.equal(completed.status, 201);
  assert.equal(completedResult.authenticated, true);
  assert.equal(users.length, 1);
  assert.equal(users[0].role, "student");
  assert.equal(sessions.length, 1);
  assert.equal(challenges.size, 0);
});

test("account creation is rejected until OTP verification succeeds", async () => {
  await startRegistration();
  const withoutToken = await completeRegistration();
  assert.equal(withoutToken.status, 400);
  assert.equal(users.length, 0);
  assert.equal(sessions.length, 0);

  const actualOtp = deliveries[0].otp;
  const wrongOtpValue = `${actualOtp[0] === "0" ? "1" : "0"}${actualOtp.slice(1)}`;
  const wrongOtp = await verifyRegistration(wrongOtpValue);
  assert.equal(wrongOtp.status, 400);
  assert.equal(users.length, 0);
  assert.equal(sessions.length, 0);

  const correctOtp = await verifyRegistration(deliveries[0].otp);
  const verified = await correctOtp.json();
  assert.equal(correctOtp.status, 200);
  assert.equal(users.length, 0);
  assert.equal(sessions.length, 0);

  const completed = await completeRegistration(verified.registrationToken);
  assert.equal(completed.status, 201);
  assert.equal(users.length, 1);
});

test("wrong OTPs are rejected and attempts are limited", async () => {
  await startRegistration();
  const actualOtp = deliveries[0].otp;
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const wrongOtp = `${actualOtp[0] === "0" ? "1" : "0"}${actualOtp.slice(1)}`;
    const response = await verifyRegistration(wrongOtp);
    assert.equal(response.status, attempt === 5 ? 429 : 400);
    assert.equal(users.length, 0);
    assert.equal(sessions.length, 0);
  }
  const correctAfterLimit = await verifyRegistration(actualOtp);
  assert.equal(correctAfterLimit.status, 429);
  assert.equal(users.length, 0);
});

test("expired OTP is rejected without activating an account", async () => {
  await startRegistration();
  challenges.get("user@example.invalid").expiresAt = Date.now() - 1;
  const response = await verifyRegistration(deliveries[0].otp);
  assert.equal(response.status, 400);
  assert.equal(users.length, 0);
  assert.equal(sessions.length, 0);
  assert.equal(challenges.size, 0);
});

test("resending replaces the previous OTP and the previous code is rejected", async () => {
  await startRegistration();
  const previousOtp = deliveries[0].otp;
  challenges.get("user@example.invalid").lastSentAt = Date.now() - 61000;

  const resend = await post("/register/resend", { email: "user@example.invalid" });
  assert.equal(resend.status, 202);
  assert.equal(deliveries.length, 2);
  assert.notEqual(deliveries[1].otp, previousOtp);

  const oldCode = await verifyRegistration(previousOtp);
  assert.equal(oldCode.status, 400);
  assert.equal(users.length, 0);

  const newCode = await verifyRegistration(deliveries[1].otp);
  assert.equal(newCode.status, 200);
  const verified = await newCode.json();
  const completed = await completeRegistration(verified.registrationToken);
  assert.equal(completed.status, 201);
  assert.equal(users.length, 1);
});

test("email delivery failure does not create a challenge, account, session, or expose OTP", async () => {
  failEmailDelivery = true;
  const originalConsoleError = console.error;
  const logged = [];
  console.error = (...args) => logged.push(args.join(" "));
  let response;
  let result;
  try {
    response = await startRegistration();
    result = await response.text();
  } finally {
    console.error = originalConsoleError;
  }
  assert.equal(response.status, 503);
  assert.equal(challenges.size, 0);
  assert.equal(users.length, 0);
  assert.equal(sessions.length, 0);
  assert.equal(/\b\d{6}\b/.test(result), false);
  assert.equal(/\b\d{6}\b/.test(logged.join(" ")), false);
});

test("normal registration stays student and client role escalation is ignored", async () => {
  const response = await startRegistration({
    role: "admin",
    isAdmin: true
  });
  assert.equal(response.status, 202);
  const verified = await verifyRegistration(deliveries[0].otp);
  const verification = await verified.json();
  assert.equal(verified.status, 200);
  const completed = await completeRegistration(verification.registrationToken);
  const result = await completed.json();
  assert.equal(completed.status, 201);
  assert.equal(result.data.role, "student");
});

test("configured verified email receives the admin role and successful login preserves provisioning", async () => {
  process.env.ADMIN_EMAIL = "developer.admin@example.invalid";
  const response = await startRegistration({
    email: "developer.admin@example.invalid"
  });
  assert.equal(response.status, 202);
  const verified = await verifyRegistration(deliveries[0].otp, {
    email: "developer.admin@example.invalid"
  });
  const verification = await verified.json();
  assert.equal(verified.status, 200);
  const completed = await completeRegistration(verification.registrationToken, {
    email: "developer.admin@example.invalid"
  });
  const result = await completed.json();
  assert.equal(completed.status, 201);
  assert.equal(result.data.role, "admin");

  const loginResponse = await login("developer.admin@example.invalid");
  assert.equal(loginResponse.status, 200);
  assert.equal((await loginResponse.json()).data.role, "admin");
});

test("existing login accepts valid credentials and rejects invalid credentials", async () => {
  users.push({
    id: "1",
    name: "Existing User",
    email: "existing@example.invalid",
    password_hash: await argon2.hash("test-password"),
    role: "student",
    is_active: true
  });
  const valid = await login("existing@example.invalid");
  const invalid = await login("existing@example.invalid", "wrong-password");
  assert.equal(valid.status, 200);
  assert.equal(invalid.status, 401);
});
