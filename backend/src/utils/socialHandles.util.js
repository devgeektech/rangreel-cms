/** Canonical keys stored on Client.socialHandles (Mixed). */
const SOCIAL_HANDLE_KEYS = [
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

function normalizeHandleEntry(raw) {
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

/**
 * @param {Record<string, unknown>} input
 * @returns {Record<string, { username: string, password: string }>}
 */
function normalizeSocialHandlesInput(input) {
  const src = input && typeof input === "object" ? input : {};
  const out = {};
  for (const key of SOCIAL_HANDLE_KEYS) {
    if (Object.prototype.hasOwnProperty.call(src, key)) {
      out[key] = normalizeHandleEntry(src[key]);
    } else {
      out[key] = { username: "", password: "" };
    }
  }
  return out;
}

module.exports = {
  SOCIAL_HANDLE_KEYS,
  normalizeHandleEntry,
  normalizeSocialHandlesInput,
};
