const assert = require("node:assert/strict");
const { test } = require("node:test");
const crypto = require("node:crypto");
const nodemailer = require("nodemailer");

const { sendRegistrationOtp } = require("./registrationEmail");

test("Gmail delivery fails closed when server credentials are not configured", async () => {
  const user = process.env.GMAIL_USER;
  const password = process.env.GMAIL_APP_PASSWORD;
  const otp = crypto.randomInt(0, 1000000).toString().padStart(6, "0");
  delete process.env.GMAIL_USER;
  delete process.env.GMAIL_APP_PASSWORD;
  try {
    await assert.rejects(
      sendRegistrationOtp({ to: "recipient@example.invalid", otp }),
      (error) => {
        assert.equal(error.code, "EMAIL_NOT_CONFIGURED");
        assert.equal(error.message.includes(otp), false);
        return true;
      }
    );
  } finally {
    if (user === undefined) {
      delete process.env.GMAIL_USER;
    } else {
      process.env.GMAIL_USER = user;
    }
    if (password === undefined) {
      delete process.env.GMAIL_APP_PASSWORD;
    } else {
      process.env.GMAIL_APP_PASSWORD = password;
    }
  }
});

test("Gmail app-password formatting whitespace is removed before SMTP authentication", async () => {
  const originalCreateTransport = nodemailer.createTransport;
  const originalUser = process.env.GMAIL_USER;
  const originalPassword = process.env.GMAIL_APP_PASSWORD;
  const appPassword = "abcd efgh ijkl mnop";
  let transportOptions;
  let message;
  let smtpError;
  let smtpInfo = {
    messageId: "<test-message@example.invalid>",
    accepted: ["recipient@example.invalid"],
    rejected: []
  };
  let loggedDiagnostic;
  let acceptedDiagnostic;
  process.env.GMAIL_USER = " sender@example.invalid ";
  process.env.GMAIL_APP_PASSWORD = appPassword;
  nodemailer.createTransport = (options) => {
    transportOptions = options;
    return {
      async sendMail(mail) {
        if (smtpError) {
          throw smtpError;
        }
        message = mail;
        return smtpInfo;
      }
    };
  };
  const originalConsoleError = console.error;
  const originalConsoleInfo = console.info;
  try {
    console.info = (...args) => {
      acceptedDiagnostic = args;
    };
    const result = await sendRegistrationOtp({
      to: "recipient@example.invalid",
      otp: "123456"
    });
    assert.equal(transportOptions.auth.user, "sender@example.invalid");
    assert.equal(transportOptions.auth.pass, "abcdefghijklmnop");
    assert.equal(transportOptions.auth.pass.length, 16);
    assert.equal(message.to, "recipient@example.invalid");
    assert.equal(message.text.includes("123456"), true);
    assert.deepEqual(result, {
      messageId: "<test-message@example.invalid>",
      acceptedCount: 1,
      rejectedCount: 0
    });
    assert.deepEqual(acceptedDiagnostic, [
      "Registration SMTP message accepted",
      result
    ]);

    smtpInfo = {
      messageId: "<rejected-message@example.invalid>",
      accepted: [],
      rejected: ["recipient@example.invalid"]
    };
    console.error = (...args) => {
      loggedDiagnostic = args;
    };
    await assert.rejects(
      sendRegistrationOtp({ to: "recipient@example.invalid", otp: "123456" }),
      (error) => error.code === "EMAIL_NOT_ACCEPTED"
    );
    assert.deepEqual(loggedDiagnostic, [
      "Registration SMTP message was not accepted",
      {
        messageId: "<rejected-message@example.invalid>",
        acceptedCount: 0,
        rejectedCount: 1,
        code: "EMAIL_NOT_ACCEPTED"
      }
    ]);

    smtpInfo = {
      messageId: "<test-message@example.invalid>",
      accepted: ["recipient@example.invalid"],
      rejected: []
    };
    smtpError = Object.assign(new Error(appPassword), {
      code: "EAUTH",
      responseCode: 535
    });
    console.error = (...args) => {
      loggedDiagnostic = args;
    };
    await assert.rejects(
      sendRegistrationOtp({ to: "recipient@example.invalid", otp: "654321" }),
      smtpError
    );
    assert.deepEqual(loggedDiagnostic, [
      "Registration SMTP delivery failed",
      { code: "EAUTH", responseCode: 535 }
    ]);
    assert.equal(JSON.stringify(loggedDiagnostic).includes(appPassword), false);
  } finally {
    console.error = originalConsoleError;
    console.info = originalConsoleInfo;
    nodemailer.createTransport = originalCreateTransport;
    if (originalUser === undefined) {
      delete process.env.GMAIL_USER;
    } else {
      process.env.GMAIL_USER = originalUser;
    }
    if (originalPassword === undefined) {
      delete process.env.GMAIL_APP_PASSWORD;
    } else {
      process.env.GMAIL_APP_PASSWORD = originalPassword;
    }
  }
});
