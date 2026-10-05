const crypto = require("crypto");

const SESSION_COOKIE_NAME = "examplatform_session";

class SessionConfigurationError extends Error {}

function getSessionSecret() {
  const secret = process.env.SESSION_SECRET;
  if (typeof secret !== "string" || Buffer.byteLength(secret, "utf8") < 32) {
    throw new SessionConfigurationError(
      "SESSION_SECRET must be configured with at least 32 characters"
    );
  }
  return secret;
}

function hashSessionToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function signSessionToken(token, secret) {
  return crypto
    .createHmac("sha256", secret)
    .update(token)
    .digest("base64url");
}

function getSessionToken(req, secret) {
  const cookieHeader = req.headers.cookie || "";
  const cookie = cookieHeader
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${SESSION_COOKIE_NAME}=`));

  if (!cookie) {
    return null;
  }

  const value = cookie.slice(SESSION_COOKIE_NAME.length + 1);
  const separator = value.lastIndexOf(".");
  if (separator < 1) {
    return null;
  }

  const token = value.slice(0, separator);
  const signature = value.slice(separator + 1);
  if (!/^[A-Za-z0-9_-]{43}$/.test(token) || !/^[A-Za-z0-9_-]{43}$/.test(signature)) {
    return null;
  }

  const expectedSignature = Buffer.from(signSessionToken(token, secret));
  const receivedSignature = Buffer.from(signature);
  if (
    expectedSignature.length !== receivedSignature.length ||
    !crypto.timingSafeEqual(expectedSignature, receivedSignature)
  ) {
    return null;
  }

  return token;
}

function setSessionCookie(res, token, secret) {
  const signature = signSessionToken(token, secret);
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.append(
    "Set-Cookie",
    `${SESSION_COOKIE_NAME}=${token}.${signature}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${7 * 24 * 60 * 60}${secure}`
  );
}

function clearSessionCookie(res) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.append(
    "Set-Cookie",
    `${SESSION_COOKIE_NAME}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT${secure}`
  );
}

async function getAuthenticatedUser(req, pool) {
  const cookieHeader = req.headers.cookie || "";
  if (!cookieHeader.split(";").some((part) => part.trim().startsWith(`${SESSION_COOKIE_NAME}=`))) {
    return null;
  }

  const secret = getSessionSecret();
  const token = getSessionToken(req, secret);
  if (!token) {
    return null;
  }

  const result = await pool.query(
    `
    SELECT u.id, u.name, u.email, u.role
    FROM auth_sessions s
    INNER JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = $1
      AND s.expires_at > NOW()
      AND u.is_active = TRUE
    LIMIT 1
    `,
    [hashSessionToken(token)]
  );

  return result.rows[0] || null;
}

function respondToAuthenticationError(res, error) {
  if (error instanceof SessionConfigurationError) {
    console.error(error.message);
    res.status(503).json({
      success: false,
      message: "Authentication is temporarily unavailable"
    });
    return true;
  }
  return false;
}

async function requireAuthenticatedUser(req, res, next) {
  try {
    const user = await getAuthenticatedUser(req, req.app.locals.pool);
    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Authentication required"
      });
    }

    req.user = user;
    res.set("Cache-Control", "no-store");
    return next();
  } catch (error) {
    if (respondToAuthenticationError(res, error)) {
      return;
    }
    console.error("Unable to verify authenticated user:", error.message);
    return res.status(500).json({
      success: false,
      message: "Unable to verify authentication"
    });
  }
}

function requireAdminRole(req, res, next) {
  if (!req.user || req.user.role !== "admin") {
    return res.status(403).json({
      success: false,
      message: "Administrator access required"
    });
  }
  return next();
}

module.exports = {
  clearSessionCookie,
  getAuthenticatedUser,
  getSessionSecret,
  getSessionToken,
  hashSessionToken,
  requireAdminRole,
  requireAuthenticatedUser,
  respondToAuthenticationError,
  setSessionCookie
};
