#!/usr/bin/env bash
# Test du compteur d'audit npm (scripts/npm-audit.sh).
# Faux npm sur le PATH : aucun accès réseau, aucun node_modules, aucun audit réel.
set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
. "$ROOT/scripts/npm-audit.sh"

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
mkdir -p "$tmp/bin" "$tmp/empty" "$tmp/frontend"

# Faux npm : affiche le contenu de $FAKE_NPM_OUT, puis sort avec $FAKE_NPM_CODE.
cat > "$tmp/bin/npm" <<'FAKE'
#!/bin/sh
if [ -n "${FAKE_NPM_OUT:-}" ]; then cat "$FAKE_NPM_OUT"; fi
exit "${FAKE_NPM_CODE:-0}"
FAKE
chmod +x "$tmp/bin/npm"

fails=0
expect() { # <attendu> <obtenu> <libellé>
  if [ "$1" = "$2" ]; then
    printf '    OK   %s\n' "$3"
  else
    printf '    KO   %s : attendu « %s », obtenu « %s »\n' "$3" "$1" "$2"
    fails=1
  fi
}

audit_json() { # <total> <fichier de sortie>
  cat > "$1" <<JSON
{
  "auditReportVersion": 2,
  "vulnerabilities": {},
  "metadata": {
    "vulnerabilities": {
      "info": 0,
      "low": 0,
      "moderate": 0,
      "high": 0,
      "critical": $2,
      "total": $2
    }
  }
}
JSON
}

export PATH="$tmp/bin:$PATH"

# 1) aucun paquet vulnérable
audit_json "$tmp/clean.json" 0
FAKE_NPM_OUT="$tmp/clean.json" FAKE_NPM_CODE=0
export FAKE_NPM_OUT FAKE_NPM_CODE
expect "0" "$(npm_audit_count "$tmp/frontend")" "audit propre -> 0"

# 2) une seule sévérité (npm sort en 1)
audit_json "$tmp/one.json" 2
FAKE_NPM_OUT="$tmp/one.json" FAKE_NPM_CODE=1
export FAKE_NPM_OUT FAKE_NPM_CODE
expect "2" "$(npm_audit_count "$tmp/frontend")" "une sévérité -> 2"

# 3) plusieurs sévérités : npm dit « 3 vulnerabilities (1 moderate, 1 high, 1 critical) »
audit_json "$tmp/many.json" 3
FAKE_NPM_OUT="$tmp/many.json" FAKE_NPM_CODE=1
export FAKE_NPM_OUT FAKE_NPM_CODE
expect "3" "$(npm_audit_count "$tmp/frontend")" "plusieurs sévérités -> 3"

# 4) audit impossible (réseau coupé) : sortie non JSON, npm sort en 1
cat > "$tmp/neterror.txt" <<'TXT'
npm warn audit request to https://registry.npmjs.org/-/npm/v1/security/audits/quick failed, reason: connect ECONNREFUSED
npm error audit endpoint returned an error
TXT
FAKE_NPM_OUT="$tmp/neterror.txt" FAKE_NPM_CODE=1
export FAKE_NPM_OUT FAKE_NPM_CODE
expect "" "$(npm_audit_count "$tmp/frontend")" "audit impossible -> vide"

# 5) npm absent
out="$( PATH="$tmp/empty" npm_audit_count "$tmp/frontend" )"
expect "" "$out" "npm absent -> vide"

# 6) le rapport lisible reprend la sortie de npm
expect "1" "$(npm_audit_report "$tmp/frontend" | grep -c 'audit endpoint returned an error')" "rapport npm"

if [ "$fails" -ne 0 ]; then
  echo "    npm audit : tests échoués" >&2
  exit 1
fi
echo "    npm audit : tous les tests passent"
