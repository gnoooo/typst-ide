/**
 * tutorial.js
 *  Tutorial window: sidebar navigation + markdown rendered steps.
 *
 *  Steps are discovered from the markdown files themselves:
 *  ../tutorial/{fr,en}/*.md -> order = filename sort, label = basename
 *  with dashes replaced by spaces (the numeric prefix becomes a badge).
 */

import "../style.css";

import { marked } from "marked";
import { initI18n, t, getLang, setLang, applyI18n } from "../i18n/index.js";
import { highlightTypst, escapeHtml } from "./tutorial-highlight.js";

const STEPS_FR = import.meta.glob("../tutorial/fr/*.md", {
  query: "?raw",
  import: "default",
});
const STEPS_EN = import.meta.glob("../tutorial/en/*.md", {
  query: "?raw",
  import: "default",
});

const STEP_HASH_PREFIX = "step-";

// ## Pure helpers (unit-testable) #################################

/** "01-bienvenue" -> 1 (or null when there is no numeric prefix) */
export function stepNumber(base) {
  const first = base.split("-")[0];
  return /^\d+$/.test(first) ? parseInt(first, 10) : null;
}

/** "01-bienvenue" -> "Bienvenue" (number moved to the sidebar badge) */
export function formatStepLabel(base) {
  const parts = base.split("-").filter(Boolean);
  const start = parts.length > 0 && /^\d+$/.test(parts[0]) ? 1 : 0;
  return parts
    .slice(start)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/** "^icon_name^" -> material symbol span (markdown text tokens only) */
export function inlineIcons(text) {
  return text.replace(
    /\^([a-z0-9_]+)\^/g,
    '<span class="material-symbols-outlined">$1</span>',
  );
}

export async function renderMarkdown(source) {
  return await marked.parse(source);
}

marked.use({
  renderer: {
    text(token) {
      // List items reach this hook with child inline tokens (strong, em, ...):
      // render them the same way the default text renderer does.
      if (token.tokens?.length) {
        return inlineIcons(this.parser.parseInline(token.tokens));
      }
      return inlineIcons(token.text);
    },
    code(token) {
      const isTypst = token.lang === "typst";
      const body = isTypst
        ? highlightTypst(token.text)
        : escapeHtml(token.text);
      return `<pre class="tut-code"><code${isTypst ? ' class="typst"' : ""}>${body}</code></pre>`;
    },
  },
});

// ## Window logic ##################################################

let _index = 0;
let _steps = [];

function stepMap(lang) {
  return lang === "en" ? STEPS_EN : STEPS_FR;
}

function listSteps(lang) {
  return Object.keys(stepMap(lang))
    .sort()
    .map((path) => {
      const base = path.slice(path.lastIndexOf("/") + 1).replace(/\.md$/, "");
      return { path, num: stepNumber(base), label: formatStepLabel(base) };
    });
}

function applyTheme() {
  const theme = localStorage.getItem("theme") ?? "light";
  document.documentElement.setAttribute("data-theme", theme);
}

async function showStep(index) {
  if (!_steps.length) return;
  _index = Math.max(0, Math.min(index, _steps.length - 1));
  const step = _steps[_index];
  const loader = stepMap(getLang())[step.path];
  const source = loader ? await loader() : "";
  document.getElementById("tut-article").innerHTML = await renderMarkdown(
    source,
  );
  document.querySelector(".tut-content")?.scrollTo({ top: 0 });
  document.title = `${t("tutorial.title")} — ${String(step.num ?? _index + 1).padStart(2, "0")} ${step.label}`;
  renderSidebar();
  updateNav();
  window.location.hash = `${STEP_HASH_PREFIX}${_index + 1}`;
}

function renderSidebar() {
  const list = document.getElementById("tut-step-list");
  if (!list) return;
  list.innerHTML = "";
  _steps.forEach((step, i) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "tut-step" + (i === _index ? " active" : "");
    btn.innerHTML = `<span class="tut-step-num">${String(step.num ?? i + 1).padStart(2, "0")}</span><span class="tut-step-label">${step.label}</span>`;
    btn.addEventListener("click", () => showStep(i));
    list.appendChild(btn);
  });
  list
    .querySelector(".tut-step.active")
    ?.scrollIntoView({ block: "nearest" });
}

function updateNav() {
  const prev = document.getElementById("tut-prev");
  const next = document.getElementById("tut-next");
  if (prev) prev.disabled = _index <= 0;
  if (next) next.disabled = _index >= _steps.length - 1;
  const progress = document.getElementById("tut-progress");
  if (progress) {
    progress.textContent = t("tutorial.progress", {
      current: _index + 1,
      total: _steps.length,
    });
  }
}

function switchLang(lang) {
  setLang(lang);
  document.querySelectorAll("[data-lang]").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.lang === lang);
  });
  applyI18n();
  _steps = listSteps(lang);
  showStep(_index);
}

function initialIndex() {
  const match = window.location.hash.match(
    new RegExp(`^#${STEP_HASH_PREFIX}(\\d+)$`),
  );
  return match ? parseInt(match[1], 10) - 1 : 0;
}

function bindChrome() {
  document.querySelectorAll("[data-lang]").forEach((btn) =>
    btn.addEventListener("click", () => switchLang(btn.dataset.lang)),
  );
  document
    .getElementById("tut-prev")
    ?.addEventListener("click", () => showStep(_index - 1));
  document
    .getElementById("tut-next")
    ?.addEventListener("click", () => showStep(_index + 1));
  document.addEventListener("keydown", (e) => {
    if (e.key === "ArrowLeft") showStep(_index - 1);
    if (e.key === "ArrowRight") showStep(_index + 1);
  });
  const lang = getLang();
  document.querySelectorAll("[data-lang]").forEach((btn) =>
    btn.classList.toggle("active", btn.dataset.lang === lang),
  );
}

function init() {
  initI18n();
  applyTheme();
  _steps = listSteps(getLang());
  bindChrome();
  showStep(initialIndex());
}

if (typeof window !== "undefined" && typeof document !== "undefined") {
  init();
}