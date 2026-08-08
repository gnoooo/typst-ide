import { t } from '../../i18n/index.js';
import { openModal, showConfirm, showPrompt } from '../modal.js';
import { showToast } from '../toast.js';
import { openTemplateForm } from './form.js';
import { instantiateTemplate } from './instantiate.js';

const { invoke } = window.__TAURI__.core;

let _templates = [];
let _container = null;

/** Main entry: opens the template manager modal. */
export async function openTemplateManager() {
  const body = document.createElement("div");
  body.style.display = "flex";
  body.style.flexDirection = "column";
  body.style.gap = "8px";
  body.style.flex = "1";
  body.style.minHeight = "0";

  body.appendChild(createSearchBar());

  _container = document.createElement("div");
  _container.style.flex = "1";
  _container.style.overflowY = "auto";
  _container.style.minHeight = "0";
  body.appendChild(_container);

  await rebuildList();

  openModal({
    title: t('template.title'),
    body,
    width: "60%",
    height: "65%",
    buttons: [
      { label: t('modal.close_all'), primary: true, onClick: (close, closeAll) => closeAll() },
      {
        label: t('template.new'), primary: false,
        onClick: async (close) => {
          close();
          const created = await openTemplateForm();
          if (created) await openTemplateManager();
        },
      },
    ],
  });
}

function createSearchBar() {
  const container = document.createElement("div");
  container.style.display = "flex";
  container.style.alignItems = "center";
  container.style.gap = "6px";
  container.style.padding = "4px 6px";
  container.style.border = "1px solid var(--border)";
  container.style.borderRadius = "var(--radius-sm)";
  container.style.background = "var(--bg-input)";

  const icon = document.createElement("span");
  icon.className = "material-symbols-outlined";
  icon.textContent = "search";
  icon.style.fontSize = "18px";
  icon.style.color = "var(--text-muted)";
  container.appendChild(icon);

  const input = document.createElement("input");
  input.type = "text";
  input.placeholder = t('template.search_placeholder');
  input.style.flex = "1";
  input.style.border = "none";
  input.style.background = "transparent";
  input.style.color = "var(--text)";
  input.style.outline = "none";
  input.style.fontSize = "13px";
  container.appendChild(input);

  input.addEventListener("input", () => rebuildList(input.value.trim().toLowerCase()));

  return container;
}

/** Fetches templates from the backend and stores them. */
async function fetchTemplates() {
  try {
    _templates = await invoke('list_templates');
  } catch (err) {
    _templates = [];
    showToast('error', t('template.delete_error', { error: err }));
  }
}

/** Renders the template list, optionally filtered. */
async function rebuildList(filterText = "") {
  if (!_container) return;
  await fetchTemplates();

  _container.innerHTML = "";
  const filtered = filterText
    ? _templates.filter(tpl =>
        tpl.name.toLowerCase().includes(filterText)
      )
    : _templates;

  if (filtered.length === 0) {
    _container.innerHTML = filterText
      ? `<p style="color:var(--text-muted)">${t('template.no_results')}</p>`
      : `<p style="color:var(--text-muted)">${t('template.no_templates')}</p>`;
    return;
  }

  filtered.forEach(renderTemplateEntry);
}

function renderTemplateEntry(tpl) {
  const row = document.createElement('div');
  row.className = 'template-entry';
  row.style.display = 'flex';
  row.style.alignItems = 'center';
  row.style.justifyContent = 'space-between';
  row.style.padding = '8px 10px';
  row.style.border = '1px solid var(--border)';
  row.style.borderRadius = 'var(--radius-sm)';
  row.style.marginBottom = '6px';

  const left = document.createElement('div');
  left.style.display = 'flex';
  left.style.alignItems = 'center';
  left.style.gap = '8px';

  const icon = document.createElement('span');
  icon.className = 'material-symbols-outlined';
  icon.textContent = 'dashboard_customize';
  icon.style.color = 'var(--text-muted)';
  left.appendChild(icon);

  const name = document.createElement('span');
  name.textContent = tpl.name;
  name.style.fontWeight = '600';
  left.appendChild(name);

  const badges = document.createElement('div');
  badges.style.display = 'flex';
  badges.style.gap = '4px';
  for (const [flag, label] of [
    ['has_test', 'test'],
    ['has_images', 'img'],
    ['has_fonts', 'font'],
  ]) {
    if (tpl[flag]) {
      const badge = document.createElement('span');
      badge.textContent = label;
      badge.style.fontSize = '11px';
      badge.style.padding = '1px 6px';
      badge.style.borderRadius = 'var(--radius-sm)';
      badge.style.background = 'var(--bg-hover)';
      badge.style.color = 'var(--text-muted)';
      badges.appendChild(badge);
    }
  }
  left.appendChild(badges);

  const actions = document.createElement('div');
  actions.style.display = 'flex';
  actions.style.gap = '6px';

  const buttons = [
    { icon: 'add_box', title: t('template.instantiate'), fn: () => instantiateTemplate(tpl.name) },
    { icon: 'edit', title: t('template.edit'), fn: () => editTemplate(tpl.name) },
    { icon: 'text_fields_alt', title: t('template.rename'), fn: () => renameTemplate(tpl.name) },
    { icon: 'delete', title: t('template.delete'), danger: true, fn: () => deleteTemplate(tpl.name) },
  ];

  buttons.forEach(btn => {
    const b = document.createElement('button');
    b.className = 'action-btn';
    b.title = btn.title;
    b.innerHTML = `<span class="material-symbols-outlined" style="font-size:18px">${btn.icon}</span>`;
    if (btn.danger) b.style.color = 'var(--error-text)';
    b.addEventListener('click', async () => {
      await btn.fn();
      await rebuildList();
    });
    actions.appendChild(b);
  });

  row.appendChild(left);
  row.appendChild(actions);
  _container.appendChild(row);
}

async function editTemplate(name) {
  await openTemplateForm(name);
}

async function renameTemplate(name) {
  const newName = await showPrompt({
    title: t('template.rename_title'),
    label: t('template.rename_label'),
    defaultValue: name,
    validate: validateName,
  });
  if (!newName || newName === name) return;
  try {
    await invoke('rename_template', { name, newName });
    showToast('success', t('template.renamed', { name: newName }));
  } catch (err) {
    showToast('error', t('template.rename_error', { error: err }));
  }
}

async function deleteTemplate(name) {
  const ok = await showConfirm({
    title: t('template.delete_title'),
    message: t('template.delete_message', { name }),
  });
  if (!ok) return;
  try {
    await invoke('delete_template', { name });
    showToast('success', t('template.deleted', { name }));
  } catch (err) {
    showToast('error', t('template.delete_error', { error: err }));
  }
}

const INVALID_NAME = /[<>:"/\\|?*]/;
function validateName(v) {
  return INVALID_NAME.test(v) ? t('template.name_invalid') : true;
}
