import fr from './fr.json'
import en from './en.json'

const locales = { fr, en }
let currentLang = null

export function t(key, params = {}) {
  let val = locales[currentLang]?.[key]
  if (val === undefined) val = key
  if (params && Object.keys(params).length > 0) {
    Object.entries(params).forEach(([k, v]) => {
      val = val.replace(`{${k}}`, v)
    })
  }
  return val
}

export function getLang() {
  return currentLang
}

export function setLang(lang) {
  if (!locales[lang]) return
  currentLang = lang
  localStorage.setItem('lang', lang)
  applyI18n()
}

function applyI18nToEl(el) {
  const key = el.getAttribute('data-i18n')
  if (key) {
    const translated = t(key)
    if (translated !== key) el.textContent = translated
  }

  const placeholderKey = el.getAttribute('data-i18n-placeholder')
  if (placeholderKey) {
    const translated = t(placeholderKey)
    if (translated !== placeholderKey) el.placeholder = translated
  }

  const titleKey = el.getAttribute('data-i18n-title')
  if (titleKey) {
    const translated = t(titleKey)
    if (translated !== titleKey) el.title = translated
  }
}

export function applyI18n(root = document) {
  root.querySelectorAll('[data-i18n]').forEach(applyI18nToEl)
  root.querySelectorAll('[data-i18n-placeholder]').forEach(applyI18nToEl)
  root.querySelectorAll('[data-i18n-title]').forEach(applyI18nToEl)
}

export function initI18n() {
  currentLang = localStorage.getItem('lang') || 'fr'
  if (!locales[currentLang]) currentLang = 'fr'
  applyI18n()
}
