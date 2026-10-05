const nodemailer = require("nodemailer");

let transporter;

function getTransporter() {
  const user = process.env.GMAIL_USER;
  const password = process.env.GMAIL_APP_PASSWORD;
  if (
    typeof user !== "string" ||
    !user.trim() ||
    typeof password !== "string" ||
    !password.trim()
  ) {
    const error = new Error("Registration email is not configured");
    error.code = "EMAIL_NOT_CONFIGURED";
    throw error;
  }

  const normalizedUser = user.trim();
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: "smtp.gmail.com",
      port: 465,
      secure: true,
      auth: { user: normalizedUser, pass: password.replace(/\s+/g, "") }
    });
  }
  return { transporter, user: normalizedUser };
}

async function sendRegistrationOtp({ to, otp }) {
  const { transporter: mailer, user } = getTransporter();
  try {
    const info = await mailer.sendMail({
      from: `"ExamPlatform" <${user}>`,
      to,
      subject: "Verify your ExamPlatform email",
      text: `Your ExamPlatform email verification code is ${otp}. It expires in 10 minutes. If you did not request this code, you can ignore this email.`
    });
    const acceptedCount = Array.isArray(info.accepted) ? info.accepted.length : 0;
    const rejectedCount = Array.isArray(info.rejected) ? info.rejected.length : 0;
    const result = {
      messageId: typeof info.messageId === "string" ? info.messageId : null,
      acceptedCount,
      rejectedCount
    };
    if (acceptedCount === 0 || rejectedCount > 0) {
      const error = new Error("Registration email was not accepted by the SMTP server");
      error.code = "EMAIL_NOT_ACCEPTED";
      console.error("Registration SMTP message was not accepted", {
        ...result,
        code: error.code
      });
      throw error;
    }
    console.info("Registration SMTP message accepted", result);
    return result;
  } catch (error) {
    if (error?.code === "EMAIL_NOT_ACCEPTED") {
      throw error;
    }
    console.error("Registration SMTP delivery failed", {
      code: typeof error?.code === "string" && /^[A-Z0-9_]+$/.test(error.code)
        ? error.code
        : "UNKNOWN",
      responseCode: Number.isInteger(error?.responseCode)
        ? error.responseCode
        : null
    });
    throw error;
  }
}

module.exports = { sendRegistrationOtp };
