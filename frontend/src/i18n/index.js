import fr from './fr.json'
import en from './en.json'

const locales = { fr, en }
let currentLang = null

export function t(key, params = {}) {
  let val = locales[currentLang]?.[key]
  if (val === undefined) val = key
  if (params && Object.keys(params).length > 0) {
    Object.entries(params).forEach(([k, v]) => {
      val = val.replaceAll(`{${k}}`, v)
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
  document.documentElement.lang = lang
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

export async function initI18n() {
  const saved = localStorage.getItem('lang')
  if (saved && locales[saved]) {
    currentLang = saved
  } else {
    // Machine language: prefer the Tauri command (reads the host locale env vars, reliable inside the Flatpak sandbox) over navigator.language,
    // whose behaviour varies under WebKitGTK.
    let sys = null
    if (window.__TAURI__) {
      try { sys = await window.__TAURI__.core.invoke('system_lang') } catch (_) {}
    }
    if (!sys) sys = navigator.language?.startsWith('fr') ? 'fr' : 'en'
    currentLang = locales[sys] ? sys : 'en'
  }
  document.documentElement.lang = currentLang
  applyI18n()
}
