# Extraction de version, sourcée par manage.sh, hooks/pre-push, scripts/fix-appimage.sh et scripts/build/in-container.sh
# Les patterns sont ici uniquement : un changement de format se modifie en un seul endroit.

# Cargo.toml (première ligne `version = "..."`
version_from_toml() { sed -n 's/^version = "\([^"]*\)"/\1/p' "$1" | head -n 1; }

# tauri.conf.json, package.json : ligne `"version": "..."`
version_from_json() { sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$1" | head -n 1; }

# PKGBUILD (`pkgver=x.y.z`)
version_from_pkgbuild() { sed -n 's/^pkgver=\(.*\)/\1/p' "$1" | head -n 1; }

# Premiere entree <release> du metainfo Flatpak (la plus recente)
version_from_metainfo() { sed -n 's/.*<release version="\([^"]*\)".*/\1/p' "$1" | head -n 1; }

# Liste une divergence par ligne entre fichiers de version (vide si tout est aligne).
# La reference est la version du Cargo.toml. Un fichier absent ou exempt de
# version compte comme une divergence. Regle unique pour manage.sh
# (check_consistency) et le hook pre-push: les deux doivent tuer sur la meme
# liste, sinon l'un des deux verrouilles devient silencieux.
version_mismatches() {
  local app="$1" tauri="$2" pkgbuild="$3" meta="$4"
  [ -n "$app" ]      || echo "crates/app/Cargo.toml (version absente)"
  [ "$app" = "$tauri" ]    || echo "crates/app/tauri.conf.json ($tauri)"
  [ "$app" = "$pkgbuild" ] || echo "PKGBUILD ($pkgbuild)"
  [ "$app" = "$meta" ]     || echo "flatpak/io.github.gnoooo.typst-ide.metainfo.xml ($meta)"
}
