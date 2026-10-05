const crypto = require("crypto");
const { getSessionSecret } = require("./authSession");

const AUTOMATIC_SUBMISSION_GRACE_MS = 10 * 1000;

function createMockTestAttemptToken(testId, durationMinutes, startedAt = Date.now()) {
  const durationMs = durationMinutes * 60 * 1000;
  if (
    !Number.isSafeInteger(durationMs) ||
    durationMs <= 0 ||
    !Number.isSafeInteger(startedAt)
  ) {
    throw new Error("Invalid mock test duration or start time");
  }

  const payload = Buffer.from(JSON.stringify({
    version: 1,
    testId: String(testId),
    startedAt,
    durationMs,
    deadline: startedAt + durationMs
  })).toString("base64url");
  const signature = crypto
    .createHmac("sha256", getSessionSecret())
    .update(payload)
    .digest("base64url");
  return `${payload}.${signature}`;
}

function validateMockTestAttemptToken(
  token,
  testId,
  now = Date.now(),
  allowAutomaticGrace = false
) {
  if (typeof token !== "string" || token.length > 512) {
    return "invalid";
  }

  const parts = token.split(".");
  if (
    parts.length !== 2 ||
    !/^[A-Za-z0-9_-]+$/.test(parts[0]) ||
    !/^[A-Za-z0-9_-]{43}$/.test(parts[1])
  ) {
    return "invalid";
  }

  const expectedSignature = Buffer.from(
    crypto.createHmac("sha256", getSessionSecret()).update(parts[0]).digest("base64url")
  );
  const receivedSignature = Buffer.from(parts[1]);
  if (
    expectedSignature.length !== receivedSignature.length ||
    !crypto.timingSafeEqual(expectedSignature, receivedSignature)
  ) {
    return "invalid";
  }

  let payload;
  try {
    const decoded = Buffer.from(parts[0], "base64url");
    if (decoded.toString("base64url") !== parts[0]) {
      return "invalid";
    }
    payload = JSON.parse(decoded.toString("utf8"));
  } catch {
    return "invalid";
  }

  if (
    !payload ||
    payload.version !== 1 ||
    payload.testId !== String(testId) ||
    !Number.isSafeInteger(payload.startedAt) ||
    !Number.isSafeInteger(payload.durationMs) ||
    payload.durationMs <= 0 ||
    payload.deadline !== payload.startedAt + payload.durationMs ||
    payload.startedAt > now ||
    !Number.isSafeInteger(payload.deadline)
  ) {
    return "invalid";
  }

  if (now <= payload.deadline) {
    return "valid";
  }
  if (
    allowAutomaticGrace &&
    now <= payload.deadline + AUTOMATIC_SUBMISSION_GRACE_MS
  ) {
    return "automatic-grace";
  }
  return "expired";
}

module.exports = {
  createMockTestAttemptToken,
  validateMockTestAttemptToken
};
