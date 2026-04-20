const Brevo = require("@getbrevo/brevo");

let transactionalApi = null;

const isEmailEnabled = () => {
  const raw = String(process.env.EMAIL_ENABLED || "").trim().toLowerCase();
  if (!raw) return true;
  return raw !== "false" && raw !== "0" && raw !== "off" && raw !== "no";
};

const getApi = () => {
  if (transactionalApi) return transactionalApi;
  const apiKey = process.env.BREVO_API_KEY || "";
  if (!apiKey) throw new Error("BREVO_API_KEY is not configured");

  // API-only path (no SMTP transport): Brevo Transactional API.
  if (typeof Brevo.TransactionalEmailsApi === "function") {
    const apiInstance = new Brevo.TransactionalEmailsApi();
    if (apiInstance?.authentications?.apiKey) {
      apiInstance.authentications.apiKey.apiKey = apiKey;
    }
    transactionalApi = apiInstance;
    return transactionalApi;
  }

  // Fallback for newer SDK client wrapper.
  if (typeof Brevo.BrevoClient === "function") {
    const client = new Brevo.BrevoClient({ apiKey });
    transactionalApi = {
      sendTransacEmail: (payload) => client.transactionalEmails.sendTransacEmail(payload),
    };
    return transactionalApi;
  }

  throw new Error("Unsupported Brevo SDK version: email API client not found");
};

const sendEmail = async ({ to, subject, html }) => {
  if (!to || !subject || !html) return { skipped: true };
  if (!isEmailEnabled()) {
    console.info(`[email] skipped: EMAIL_ENABLED=false subject="${subject || ""}"`);
    return { skipped: true, reason: "EMAIL_ENABLED=false" };
  }
  if (!process.env.BREVO_API_KEY) {
    console.warn(`[email] skipped: BREVO_API_KEY not configured subject="${subject || ""}"`);
    return { skipped: true };
  }

  const toEmail = typeof to === "string" ? to : to?.email;
  const toName = typeof to === "string" ? undefined : to?.name;
  if (!toEmail) {
    console.info(`[email] skipped: missing recipient email subject="${subject || ""}"`);
    return { skipped: true };
  }

  const api = getApi();
  const senderEmail = process.env.BREVO_SENDER_EMAIL || "no-reply@rangreel.com";
  const senderName = process.env.BREVO_SENDER_NAME || "Rangreel";
  const payload = {
    sender: {
      email: senderEmail,
      name: senderName,
    },
    to: [{ email: toEmail, name: toName }],
    subject,
    htmlContent: html,
  };

  try {
    console.log(
      `[email] sending via Brevo API to=${toEmail} subject="${subject}" sender=${senderEmail}`
    );
    const result = await api.sendTransacEmail(payload);
    console.info(
      `[email] sent via Brevo API to=${toEmail} subject="${subject}"`
    );
    return result;
  } catch (err) {
    console.warn(
      `[email] failed via Brevo API to=${toEmail} subject="${subject}":`,
      err?.message || err
    );
    throw err;
  }
};

module.exports = {
  sendEmail,
};
