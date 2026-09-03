/**
 * Error code helpers
 *
 * Rust Tauri commands return errors as `String`. Error *kinds* that the
 * frontend must branch on are prefixed machine-first, e.g.
 *   "ERR::USER_CANCELLED"
 *   "ERR::ALREADY_EXISTS | Le dossier 'x' existe déjà…"
 * These helpers let the frontend branch without depending on translated
 * message wording.
 */

function code(err) {
  const s = String(err ?? "");
  const m = s.match(/^ERR::([A-Z_]+)/);
  return m ? m[1] : null;
}

export function isUserCancelled(err) {
  return code(err) === "USER_CANCELLED";
}

export function isAlreadyExists(err) {
  return code(err) === "ALREADY_EXISTS";
}

export function stripErrorCode(err) {
  return String(err ?? "").replace(/^ERR::[A-Z_]+ \|? ?/, "");
}