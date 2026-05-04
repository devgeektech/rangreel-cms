/**
 * Human-facing task/content label: strategist display name overrides system id and title.
 * @param {{ strategistAlias?: string, displayId?: string, title?: string, fallbackLabel?: string }} parts
 * @returns {string}
 */
export function contentTaskDisplayLabel(parts) {
  const alias = String(parts?.strategistAlias ?? "").trim();
  if (alias) return alias;
  const id = String(parts?.displayId ?? "").trim();
  if (id) return id;
  const t = String(parts?.title ?? "").trim();
  if (t) return t;
  return String(parts?.fallbackLabel ?? "Task");
}
