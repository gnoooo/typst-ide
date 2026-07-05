# Maintainer: gnoooo

pkgname=typst-ide
pkgver=1.2.6
pkgrel=1
pkgdesc="A modern IDE for Typst"
arch=('x86_64')
url="https://github.com/gnoooo/typst-ide"
license=('MIT')
depends=(
  'cairo'
  'desktop-file-utils'
  'gdk-pixbuf2'
  'glib2'
  'gtk3'
  'hicolor-icon-theme'
  'libsoup'
  'pango'
  'webkit2gtk-4.1'
)
options=('!strip' '!emptydirs')
source_x86_64=("${url}/releases/download/v${pkgver}/typst-ide_${pkgver}_amd64.deb")
sha256sums_x86_64=('SKIP')

package() {
  tar -xf data.tar.zst -C "${pkgdir}" 2>/dev/null \
    || tar -xf data.tar.xz -C "${pkgdir}" 2>/dev/null \
    || tar -xf data.tar.gz -C "${pkgdir}"
}
