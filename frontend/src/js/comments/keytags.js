/**
 * keytags.js
 *  Registry of "keytags": comment markers recognized by Typst IDE
 *  (e.g. `// TODO: fix this`). Each keytag carries a keyword, a display
 *  label, a highlight color and an enabled flag.
 *
 *  The list is user-configurable (see keytag-manager.js) and persisted in
 *  localStorage. Loading always merges the built-in defaults first, so new
 *  default keytags shipped with a future version show up automatically
 *  next to the user's custom ones.
 *
 * ## API
 *
 * getKeytags() -> Keytag[]
 *   Keytag = { id, keyword ("TODO:"), label, color ("#rrggbb"), enabled }
 *
 * saveKeytags(list) -> void
 *   Validates and persists; notifies `onChange` listeners.
 *
 * resetKeytags() -> Keytag[]
 *   Clears the stored list and returns the built-in defaults.
 *
 * getKeytagByKeyword(keyword) -> Keytag | null
 *   First ENABLED keytag whose keyword matches (case-insensitive).
 *
 * onChange(cb) -> unsubscribe
 *   Registers a listener fired after save/reset (manager → highlights).
 */

const STORAGE_KEY = "comments.keytags.v1";

// Built-in keytags. `color` is the saturated accent; the highlight is
// rendered with transparency (see highlights.js) so it works in both
// themes. `keyword` must be matched verbatim (case-insensitively) at the
// start of a comment, colon included.
const DEFAULT_KEYTAGS = [
  { id: "todo",     keyword: "TODO:",     label: "TODO",     color: "#eab308", enabled: true },
  { id: "note",     keyword: "NOTE:",     label: "NOTE",     color: "#3b82f6", enabled: true },
  { id: "comment",  keyword: "COMMENT:",  label: "COMMENT",  color: "#22c55e", enabled: true },
  { id: "fixme",    keyword: "FIXME:",    label: "FIXME",    color: "#ef4444", enabled: true },
  { id: "warning",  keyword: "WARNING:",  label: "WARNING",  color: "#f97316", enabled: true },
];

// ## Change notification ####################################################

const _listeners = new Set();

function _emit() {
  for (const cb of _listeners) cb();
}

export function onChange(cb) {
  _listeners.add(cb);
  return () => _listeners.delete(cb);
}

// ## Persistence ############################################################

/** Sanitizes a raw stored keytag so a corrupted entry can never break the UI. */
function _normalize(raw) {
  if (!raw || typeof raw !== "object") return null;
  const keyword = String(raw.keyword ?? "").trim();
  if (!keyword) return null;
  const label = String(raw.label ?? keyword.replace(/:$/, "")).trim() || keyword.replace(/:$/, "");
  const color = /^#[0-9a-fA-F]{6}$/.test(String(raw.color ?? "")) ? String(raw.color) : "#888888";
  return {
    id: String(raw.id || keyword.replace(/[^a-zA-Z0-9-]/g, "").toLowerCase() || "custom"),
    keyword,
    label,
    color,
    enabled: raw.enabled !== false,
  };
}

function _readStored() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return Array.isArray(parsed) ? parsed.map(_normalize).filter(Boolean) : [];
  } catch {
    return [];
  }
}

/**
 * Returns the effective keytag list: stored (custom + overridden) keytags
 * on top of the defaults, with built-ins appended when absent.
 */
export function getKeytags() {
  const stored = _readStored();
  const byId = new Map();
  for (const kt of stored) byId.set(kt.id, kt);

  const merged = DEFAULT_KEYTAGS.map((def) => byId.get(def.id) ?? { ...def });
  for (const kt of stored) {
    if (!merged.some((m) => m.id === kt.id)) merged.push(kt);
  }
  return merged;
}

/**
 * Validates a keyword for form input (keytag-manager.js):
 * non-empty, no whitespace (would break matching), not a comment marker.
 */
export function isValidKeyword(keyword) {
  if (!keyword || keyword !== keyword.trim()) return false;
  if (/\s/.test(keyword)) return false;
  if (keyword.includes("//") || keyword.includes("/*") || keyword.includes("*/")) return false;
  return true;
}

export function saveKeytags(list) {
  if (!Array.isArray(list)) return;
  const clean = list.map(_normalize).filter(Boolean);
  // Reject duplicate keywords (case-insensitive) — keeps matching unambiguous.
  const seen = new Set();
  const unique = clean.filter((kt) => {
    const key = kt.keyword.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  localStorage.setItem(STORAGE_KEY, JSON.stringify(unique));
  _emit();
}

export function resetKeytags() {
  localStorage.removeItem(STORAGE_KEY);
  _emit();
  return getKeytags();
}

/** First enabled keytag whose keyword matches `keyword` (case-insensitive). */
export function getKeytagByKeyword(keyword) {
  const needle = keyword.toLowerCase();
  return getKeytags().find((kt) => kt.enabled && kt.keyword.toLowerCase() === needle) ?? null;
}