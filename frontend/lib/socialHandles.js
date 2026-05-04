/** Keys aligned with backend `socialHandles.util.js`. */
export const SOCIAL_HANDLE_PLATFORM_KEYS = [
  "instagram",
  "facebook",
  "youtube",
  "googleBusiness",
  "twitter",
  "linkedin",
  "tiktok",
  "pinterest",
  "other",
];

export const SOCIAL_HANDLE_FORM_ROWS = [
  { key: "instagram", label: "Instagram" },
  { key: "facebook", label: "Facebook" },
  { key: "youtube", label: "YouTube" },
  { key: "googleBusiness", label: "Google Business" },
  { key: "twitter", label: "X / Twitter" },
  { key: "linkedin", label: "LinkedIn" },
  { key: "pinterest", label: "Pinterest" },
  { key: "tiktok", label: "TikTok" },
  { key: "other", label: "Other" },
];

export const SOCIAL_HANDLE_USERNAME_PLACEHOLDERS = {
  instagram: "@username or instagram.com/…",
  facebook: "Page name or facebook.com/…",
  youtube: "Channel name or youtube.com/…",
  googleBusiness: "Business name or Maps URL",
  twitter: "@handle or x.com/…",
  linkedin: "Company or profile URL",
  pinterest: "@username or pinterest.com/…",
  other: "Link or handle",
  tiktok: "@username or tiktok.com/…",
};

export const SOCIAL_HANDLE_PASSWORD_PLACEHOLDER = "App or account password (optional)";

export function coerceSocialHandlePair(raw) {
  if (raw == null || raw === "") return { username: "", password: "" };
  if (typeof raw === "string") {
    return { username: String(raw).trim(), password: "" };
  }
  if (typeof raw === "object") {
    return {
      username: String(raw.username ?? raw.handle ?? "").trim(),
      password: String(raw.password ?? "").trim(),
    };
  }
  return { username: "", password: "" };
}

export function formatHandleUsername(raw) {
  const { username } = coerceSocialHandlePair(raw);
  return username || "—";
}

export function hasHandlePassword(raw) {
  return coerceSocialHandlePair(raw).password.length > 0;
}

/** Build API payload object for Client.socialHandles. */
export function buildSocialHandlesPayload(formHandles) {
  const src = formHandles && typeof formHandles === "object" ? formHandles : {};
  const out = {};
  for (const key of SOCIAL_HANDLE_PLATFORM_KEYS) {
    out[key] = coerceSocialHandlePair(src[key]);
  }
  return out;
}
