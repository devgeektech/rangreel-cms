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

  // @getbrevo/brevo v5+ API.
  if (typeof Brevo.BrevoClient === "function") {
    const client = new Brevo.BrevoClient({ apiKey });
    transactionalApi = {
      sendTransacEmail: (payload) => client.transactionalEmails.sendTransacEmail(payload),
    };
    return transactionalApi;
  }

  // Backward compatibility with older SDK shape.
  if (typeof Brevo.TransactionalEmailsApi === "function") {
    const legacy = new Brevo.TransactionalEmailsApi();
    if (legacy?.authentications?.apiKey) {
      legacy.authentications.apiKey.apiKey = apiKey;
    }
    transactionalApi = legacy;
    return transactionalApi;
  }

  throw new Error("Unsupported Brevo SDK version: email client constructor not found");
};

const sendEmail = async ({ to, subject, html }) => {
  if (!to || !subject || !html) return { skipped: true };
  if (!isEmailEnabled()) {
    return { skipped: true, reason: "EMAIL_ENABLED=false" };
  }
  if (!process.env.BREVO_API_KEY) {
    console.warn("[email] BREVO_API_KEY not configured; email skipped");
    return { skipped: true };
  }

  const toEmail = typeof to === "string" ? to : to?.email;
  const toName = typeof to === "string" ? undefined : to?.name;
  if (!toEmail) return { skipped: true };

  const api = getApi();
  return api.sendTransacEmail({
    sender: {
      email: process.env.BREVO_SENDER_EMAIL || "no-reply@rangreel.com",
      name: process.env.BREVO_SENDER_NAME || "Rangreel",
    },
    to: [{ email: toEmail, name: toName }],
    subject,
    htmlContent: html,
  });
};

module.exports = {
  sendEmail,
};
