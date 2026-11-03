#!/usr/bin/env bash
# Audit npm mutualisé entre manage.sh (info) et hooks/pre-push (garde-fou push).
# Comme scripts/version.sh pour les versions : un seul endroit sait lire npm,
# sinon les deux appelants dérivent et un seul bloque (cf. version_mismatches).
#
# npm_audit_count <frontend_dir> : écrit sur stdout le nombre de paquets
#   vulnérables (0 = aucun). N'écrit RIEN si l'audit n'a pas pu tourner (npm
#   absent, pas de réseau, node absent, lockfile illisible) : l'appelant
#   choisit alors s'il bloque ou s'il se contente d'un avertissement.
# npm_audit_report <frontend_dir> : rapport npm lisible (liste des paquets).
#
# Le compte est lu dans metadata.vulnerabilities.total du rapport JSON de npm,
# pas dans le texte affiché : npm change la formulation du résumé ("2 critical
# severity vulnerabilities" quand tout est critique, mais "3 vulnerabilities
# (1 moderate, 1 high, 1 critical)" dès que deux sévérités coexistent), le
# champ JSON lui est stable.

npm_audit_count() {
  local frontend_dir="${1:-}" out count=""
  command -v npm >/dev/null 2>&1 || return 0
  out="$( cd "$frontend_dir" && npm audit --package-lock-only --json 2>/dev/null )" || true
  count="$(printf '%s' "$out" | node -e '
let s = ""
process.stdin.on("data", d => s += d).on("end", () => {
  try {
    const m = JSON.parse(s).metadata
    if (m) process.stdout.write(String(m.vulnerabilities.total))
  } catch (e) {}
})')" || true
  printf '%s' "$count"
}

npm_audit_report() {
  local frontend_dir="${1:-}"
  ( cd "$frontend_dir" && npm audit --package-lock-only 2>&1 ) || true
}
