import { t } from '../../i18n/index.js';
import { openModal, showConfirm } from '../modal.js';
import { showToast } from '../toast.js';
import { isUserCancelled } from '../utils/error-codes.js';

const { invoke } = window.__TAURI__.core;

const INVALID_NAME = /[<>:"/\\|?*]/;

/**
 * Opens the create/edit template form.
 * @param {string|null} name Template name when editing, null when creating.
 * @returns {Promise<boolean>} true if the template was saved.
 */
export async function openTemplateForm(name = null) {
  const editing = name !== null;

  let libTyp = '';
  let testTyp = '';
  let root = '';
  try {
    root = await invoke('get_templates_dir');
    if (editing) {
      const content = await invoke('read_template', { name });
      libTyp = content.lib_typ;
      testTyp = content.test_typ || '';
    }
  } catch (err) {
    showToast('error', t('template.update_error', { error: err }));
    return false;
  }

  const body = document.createElement('div');
  body.style.display = 'flex';
  body.style.flexDirection = 'column';
  body.style.gap = '12px';

  // Name
  const nameField = document.createElement('div');
  nameField.innerHTML = `
<label class="ide-modal-label">${t('template.name_label')}</label>
<input id="tpl-form-name" type="text" class="ide-modal-input" placeholder="${t('template.name_placeholder')}" maxlength="80" autocomplete="off" />
  `;
  if (editing) nameField.querySelector('#tpl-form-name').value = name;
  body.appendChild(nameField);

  // lib.typ
  body.appendChild(createTextArea('tpl-form-lib', t('template.lib_label'), libTyp, t('template.lib_placeholder'), '400px'));

  // test.typ
  body.appendChild(createTextArea('tpl-form-test', t('template.test_label'), testTyp, t('template.test_placeholder'), '300px'));

  // Assets: images/ and fonts/ sections (create mode collects pending files,
  // edit mode works directly on the existing template folder)
  const assetsRow = document.createElement('div');
  assetsRow.style.display = 'flex';
  assetsRow.style.flexWrap = 'wrap';
  assetsRow.style.gap = '12px';
  assetsRow.style.flex = 'none';
  assetsRow.style.height = '200px';
  const imageSection = await createAssetSection('images', root, name, editing);
  const fontSection = await createAssetSection('fonts', root, name, editing);
  assetsRow.appendChild(imageSection.el);
  assetsRow.appendChild(fontSection.el);
  body.appendChild(assetsRow);

  return new Promise((resolve) => {
    openModal({
      title: editing ? `${t('template.title')} : ${name}` : t('template.new'),
      body,
      width: '720px',
      height: '80%',
      buttons: [
        {
          label: t('modal.cancel'), primary: false,
          onClick: (close) => { close(); resolve(false); },
        },
        {
          label: t('modal.save'), primary: true,
          onClick: async (close) => {
            const finalName = editing ? name : body.querySelector('#tpl-form-name').value.trim();
            if (!finalName) {
              showToast('error', t('modal.required'));
              return;
            }
            if (!editing && INVALID_NAME.test(finalName)) {
              showToast('error', t('template.name_invalid'));
              return;
            }
            const lib = body.querySelector('#tpl-form-lib').value;
            if (!lib.trim()) {
              showToast('error', t('modal.required'));
              return;
            }
            const test = body.querySelector('#tpl-form-test').value.trim() || null;
            try {
              if (editing) {
                await invoke('update_template', { name, libTyp: lib, testTyp: test });
                showToast('success', t('template.updated', { name }));
              } else {
                const images = imageSection.pending.length ? imageSection.pending : null;
                const fonts = fontSection.pending.length ? fontSection.pending : null;
                await invoke('create_template', { name: finalName, libTyp: lib, testTyp: test, images, fonts });
                showToast('success', t('template.created', { name: finalName }));
              }
              close();
              resolve(true);
            } catch (err) {
              showToast('error', editing
                ? t('template.update_error', { error: err })
                : t('template.create_error', { error: err }));
            }
          },
        },
      ],
    });
  });
}

function createTextArea(id, label, value, placeholder, height) {
  const wrapper = document.createElement('div');
  wrapper.style.display = 'flex';
  wrapper.style.flexDirection = 'column';
  wrapper.style.flex = 'none';
  wrapper.innerHTML = `
<label class="ide-modal-label">${label}</label>
<textarea id="${id}" class="ide-modal-textarea" style="height:${height};" placeholder="${placeholder}"></textarea>
  `;
  wrapper.querySelector(`#${id}`).value = value;
  return wrapper;
}

/**
 * Creates an images/ or fonts/ section with add + list + delete.
 * - Edit mode: files are copied immediately into the template folder.
 * - Create mode: files are picked and kept as pending paths (copied on save).
 * @param {'images'|'fonts'} kind
 * @param {string} root Absolute path of the templates dir.
 * @param {string|null} name Template name (null when creating).
 * @param {boolean} editing
 * @returns {Promise<{el: HTMLElement, pending: string[]}>}
 */
async function createAssetSection(kind, root, name, editing) {
  const section = document.createElement('div');
  section.style.display = 'flex';
  section.style.flexDirection = 'column';
  section.style.flex = '1 1 40%';
  section.style.minWidth = '240px';
  section.style.border = '1px solid var(--border)';
  section.style.borderRadius = 'var(--radius-sm)';
  section.style.padding = '8px';

  const pending = [];

  const label = kind === 'images' ? t('template.images_label') : t('template.fonts_label');
  const fileIcon = kind === 'images' ? 'image' : 'font_download';
  const fileLabel = kind === 'images' ? t('template.import_images') : t('template.import_fonts');
  const folderLabel = kind === 'images' ? t('template.import_images_folder') : t('template.import_fonts_folder');
  const noItems = kind === 'images' ? t('template.no_images') : t('template.no_fonts');
  const importErrorKey = kind === 'images' ? 'template.import_images_error' : 'template.import_fonts_error';

  const listEl = document.createElement('div');
  listEl.style.flex = '1';
  listEl.style.overflowY = 'auto';
  listEl.style.minHeight = '0';
  listEl.style.fontSize = '13px';
  listEl.style.color = 'var(--text-muted)';

  const header = document.createElement('div');
  header.style.display = 'flex';
  header.style.alignItems = 'center';
  header.style.justifyContent = 'space-between';
  header.style.marginBottom = '6px';

  const titleEl = document.createElement('span');
  titleEl.style.fontSize = '13px';
  titleEl.style.fontWeight = '600';
  titleEl.textContent = label;
  header.appendChild(titleEl);

  const iconBtns = document.createElement('div');
  iconBtns.style.display = 'flex';
  iconBtns.style.gap = '4px';

  function makeIconBtn(icon, tip, onClick) {
    const btn = document.createElement('button');
    btn.className = 'action-btn';
    btn.title = tip;
    btn.innerHTML = `<span class="material-symbols-outlined" style="font-size:18px">${icon}</span>`;
    btn.addEventListener('click', onClick);
    iconBtns.appendChild(btn);
  }

  makeIconBtn(fileIcon, fileLabel, async () => {
    try {
      if (editing) {
        await invoke('import_file_dialog', { destDir: `${root}/${name}/${kind}` });
        await refreshList();
      } else {
        const paths = await invoke('pick_files');
        for (const p of paths) {
          if (!pending.includes(p)) pending.push(p);
        }
        renderPending();
      }
    } catch (err) {
      if (isUserCancelled(err)) return;
      showToast('error', t(importErrorKey, { error: err }));
    }
  });

  makeIconBtn('create_new_folder', folderLabel, async () => {
    try {
      if (editing) {
        await invoke('import_folder_dialog', { destDir: `${root}/${name}/${kind}` });
        await refreshList();
      } else {
        const path = await invoke('open_folder_dialog');
        if (path && !pending.includes(path)) {
          pending.push(path);
          renderPending();
        }
      }
    } catch (err) {
      if (isUserCancelled(err)) return;
      showToast('error', t(importErrorKey, { error: err }));
    }
  });

  header.appendChild(iconBtns);
  section.appendChild(header);
  section.appendChild(listEl);

  function renderRow(icon, text, onDelete) {
    const row = document.createElement('div');
    row.style.display = 'flex';
    row.style.alignItems = 'center';
    row.style.justifyContent = 'space-between';
    row.style.gap = '6px';
    row.style.padding = '2px 0';

    const iconEl = document.createElement('span');
    iconEl.className = 'material-symbols-outlined';
    iconEl.textContent = icon;
    iconEl.style.fontSize = '16px';
    iconEl.style.color = 'var(--text-muted)';

    const span = document.createElement('span');
    span.textContent = text;
    span.style.overflow = 'hidden';
    span.style.textOverflow = 'ellipsis';
    span.style.whiteSpace = 'nowrap';
    span.style.flex = '1';

    const del = document.createElement('button');
    del.className = 'action-btn';
    del.innerHTML = '<span class="material-symbols-outlined" style="font-size:16px">delete</span>';
    del.addEventListener('click', onDelete);

    row.appendChild(iconEl);
    row.appendChild(span);
    row.appendChild(del);
    return row;
  }

  function renderPending() {
    listEl.innerHTML = '';
    if (pending.length === 0) {
      listEl.innerHTML = noItems;
      return;
    }
    pending.forEach((p) => {
      const fname = p.split(/[/\\]/).pop();
      const row = renderRow(
        kind === 'images' ? 'image' : 'font_download',
        fname,
        () => {
          pending.splice(pending.indexOf(p), 1);
          renderPending();
        },
      );
      listEl.appendChild(row);
    });
  }

  async function refreshList() {
    let files = [];
    try {
      const entries = await invoke('list_directory', { dirPath: `${root}/${name}/${kind}` });
      // Top-level entries only: an imported folder appears as a single entry,
      // not as its whole content
      files = entries.filter((e) => !e.relative_path.includes('/') && !e.relative_path.includes('\\'));
    } catch (err) {
      files = [];
    }
    listEl.innerHTML = '';
    if (files.length === 0) {
      listEl.innerHTML = noItems;
      return;
    }
    files.forEach((f) => {
      const row = renderRow(
        f.is_dir ? 'folder' : (kind === 'images' ? 'image' : 'font_download'),
        f.name,
        async () => {
          const ok = await showConfirm({
            title: t('template.delete_asset_title'),
            message: t('template.delete_asset_message', { name: f.name }),
          });
          if (!ok) return;
          try {
            await invoke('delete_file_or_dir', { path: `${root}/${name}/${kind}/${f.name}` });
            await refreshList();
          } catch (err) {
            showToast('error', t(importErrorKey, { error: err }));
          }
        },
      );
      listEl.appendChild(row);
    });
  }

  if (editing) {
    await refreshList();
  } else {
    renderPending();
  }

  return { el: section, pending };
}
