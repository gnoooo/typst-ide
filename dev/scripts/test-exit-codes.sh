#!/usr/bin/env bash
# Test des codes de sortie de manage.sh (dev/scripts/exit-codes.sh).
# Aucun réseau, aucun build : seule la table et quelques chemins d'erreur sont exercés.
set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
. "$ROOT/dev/scripts/exit-codes.sh"

fails=0
expect() { # <attendu> <obtenu> <libellé>
  if [ "$1" = "$2" ]; then
    printf '    OK   %s\n' "$3"
  else
    printf '    KO   %s : attendu « %s », obtenu « %s »\n' "$3" "$1" "$2" >&2
    fails=1
  fi
}

# 1) codes uniques
dups="$(printf '%s\n' $EXIT_CODES | sort | uniq -d | tr '\n' ' ')"
expect "" "$dups" "codes uniques"

# 2) codes dans la plage autorisée : 0-1 ou 64-78 (jamais 126/127, jamais 128+n)
bad=""
for c in $EXIT_CODES; do
  if [ "$c" -eq 0 ] || [ "$c" -eq 1 ]; then continue; fi
  if [ "$c" -lt 64 ] || [ "$c" -gt 78 ]; then bad="$bad $c"; fi
done
expect "" "$bad" "codes dans la plage 64-78"

# 3) chaque code a un libellé
for c in $EXIT_CODES; do
  label="$(exit_code_label "$c")"
  if [ -z "$label" ] || [ "$label" = "code inconnu" ]; then
    printf '    KO   libellé manquant pour le code %s\n' "$c" >&2
    fails=1
  fi
done
expect "0" "$?" "libellés définis"

# 4) 'manage.sh codes' liste tous les codes et sort en 0
out="$("$ROOT/manage.sh" codes 2>&1)"; code=$?
expect "0" "$code" "'manage.sh codes' -> 0"
missing=""
for c in $EXIT_CODES; do
  printf '%s\n' "$out" | grep -q "^ *$c " || missing="$missing $c"
done
expect "" "$missing" "'manage.sh codes' liste chaque code"

# 5) commande inconnue -> 64
"$ROOT/manage.sh" commande-inexistante >/dev/null 2>&1; expect "64" "$?" "commande inconnue -> 64"

# 6) option inconnue -> 64 (avant tout build)
"$ROOT/manage.sh" test cible-inconnue >/dev/null 2>&1; expect "64" "$?" "cible inconnue -> 64"

# 7) argument manquant -> 64
"$ROOT/manage.sh" flatpak-bump >/dev/null 2>&1; expect "64" "$?" "argument manquant -> 64"

# 8) version invalide -> 71, et aucun fichier modifié
before="$(cd "$ROOT" && git status --short)"
"$ROOT/manage.sh" bump 1.2 >/dev/null 2>&1; expect "71" "$?" "version invalide -> 71"
after="$(cd "$ROOT" && git status --short)"
expect "$before" "$after" "version invalide : aucun fichier modifié"

# 9) le trap ERR est installé et normalise en 70
if grep -q "trap .*ERR" "$ROOT/manage.sh"; then expect "0" "0" "trap ERR installé"; else expect "0" "1" "trap ERR installé"; fi
out="$(bash -c 'set -Eeuo pipefail; die_code() { local c="$1"; shift; echo "manage: [$c] $*" >&2; exit "$c"; }; trap '"'"'die_code 70 "erreur interne (ligne $LINENO)"'"'"' ERR; false' 2>&1)"; code=$?
expect "70" "$code" "échec non rattrapé -> 70"

# 10) commande inconnue -> l'usage est affiché (et le code 64 reste le même)
out="$("$ROOT/manage.sh" commande-inexistante 2>/dev/null)"
if printf '%s' "$out" | grep -q "Usage:"; then expect "0" "0" "commande inconnue : usage affiché"; else expect "0" "1" "commande inconnue : usage affiché"; fi

# 11) aucune couleur quand stdout n'est pas un terminal (CI, pipes)
esc="$(FORCE_COLOR=0 "$ROOT/manage.sh" help | cat | grep -c $'\033' || true)"
expect "0" "$esc" "help sans TTY : aucune séquence ANSI"

# 12) couleur quand elle est forcée (FORCE_COLOR)
esc="$(FORCE_COLOR=1 "$ROOT/manage.sh" help | grep -c $'\033' || true)"
if [ "${esc:-0}" -gt 0 ]; then expect "0" "0" "help avec FORCE_COLOR : séquences ANSI présentes"; else expect "0" "1" "help avec FORCE_COLOR : séquences ANSI présentes"; fi

# 13) indices de palette dans 16-255
bad=""
for i in $(grep -oE '_palette [0-9]+ [0-9]+ [0-9]+ [0-9]+' "$ROOT/manage.sh" | awk '{print $5}'); do
  if [ "$i" -lt 16 ] || [ "$i" -gt 255 ]; then bad="$bad $i"; fi
done
expect "" "$bad" "indices de palette dans 16-255"

if [ "$fails" -ne 0 ]; then
  echo "    codes de sortie : tests échoués" >&2
  exit 1
fi
echo "    codes de sortie : tous les tests passent"
