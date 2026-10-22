# Extraction de version, sourcée par manage.sh, hooks/pre-push, scripts/fix-appimage.sh et scripts/build/in-container.sh
# Les patterns sont ici uniquement : un changement de format se modifie en un seul endroit.

# Cargo.toml (première ligne `version = "..."`
version_from_toml() { sed -n 's/^version = "\([^"]*\)"/\1/p' "$1" | head -n 1; }

# tauri.conf.json, package.json : ligne `"version": "..."`
version_from_json() { sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$1" | head -n 1; }

# PKGBUILD (`pkgver=x.y.z`)
version_from_pkgbuild() { sed -n 's/^pkgver=\(.*\)/\1/p' "$1" | head -n 1; }

# première entrée <release> du metainfo Flatpak (la plus récente)
version_from_metainfo() { sed -n 's/.*<release version="\([^"]*\)".*/\1/p' "$1" | head -n 1; }
