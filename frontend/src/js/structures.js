/**
 * structures.js
 *  helping structures module
 *
 * ## API
 */

import { t } from '../i18n/index.js'
import { getCurrentFontFamily, getEditor } from './editor'
import { openModal } from './modal';
import { showToast } from './toast';
import { getCurrentProject } from './project';

export const STRUCT_ELEMENTS = [
  {
    id: 'table',
    content: '#table',
    classes: '',
    title: 'structures.table',
    openModal: () => {
      const body = document.createElement('div');
      body.innerHTML = `
        <div id="structures-table-modal">
          <p class="structures-input-label">${t('structures.dimensions')}</p>
           <div class="flex items-center w-full" style="margin-bottom: 8px">
             <div class="flex items-center flex-none gap-2">
               <input
                 id="structures-table-input-cols"
                type="number"
                placeholder="cols"
                min="1"
                value="2"
                class="w-18 h-8 p-2 text-base"
              />
              <span class="material-symbols-outlined" style="font-size:1rem;">close</span>
              <input
                id="structures-table-input-rows"
                type="number"
                placeholder="rows"
                min="1"
                value="2"
                class="w-18 h-8 text-base mb-2"
              />
            </div>
            <div class="flex-1 text-right min-w-0">
              <pre class="text-s whitespace-nowrap truncate opacity-50" style="font-family: ${getCurrentFontFamily()};">2 2</pre>
            </div>
          </div>

          <p class="structures-input-label">${t('structures.inset')}</p>
          <div class="flex items-center w-full" style="margin-bottom: 8px">
            <div class="flex items-center gap-2 flex-none">
              <input
                id="structures-table-input-inset"
                type="number"
                placeholder="inset"
                min="0"
                class="w-18 h-8 text-base mb-2"
              />
              <select
                id="structures-table-select-inset"
                class="w-18 h-8 text-base mb-2"
              >
                <option value="pt" selected>pt</option>
                <option value="mm">mm</option>
                <option value="cm">cm</option>
                <option value="inches">inches</option>
                <option value="%">%</option>
              </select>
            </div>
            <div class="flex-1 text-right min-w-0">
              <pre class="text-s whitespace-nowrap truncate opacity-50" style="font-family: ${getCurrentFontFamily()};">0pt</pre>
            </div>
          </div>

          <p class="structures-input-label">${t('structures.align_h')}</p>
          <div class="flex items-center w-full" style="margin-bottom: 8px">
            <select
              id="structures-table-input-horizontal-align"
              class="w-20 h-8 text-base mb-2"
            >
              <option value="left" selected>left</option>
              <option value="center">center</option>
              <option value="right">right</option>
            </select>
            <div class="flex-1 text-right min-w-0">
              <pre class="text-s whitespace-nowrap truncate opacity-50" style="font-family: ${getCurrentFontFamily()};">left</pre>
            </div>
          </div>

          <p class="structures-input-label">${t('structures.align_v')}</p>
          <div class="flex items-center w-full" style="margin-bottom: 8px">
            <select
              id="structures-table-input-vertical-align"
              class="w-20 h-8 text-base mb-2"
            >
              <option value="top" selected>top</option>
              <option value="horizon">horizon</option>
              <option value="bottom">bottom</option>
            </select>
            <div class="flex-1 text-right min-w-0">
              <pre class="text-s whitespace-nowrap truncate opacity-50" style="font-family: ${getCurrentFontFamily()};">top</pre>
            </div>
          </div>
          <p
            data-tauri-open-url="https://typst.app/docs/reference/model/table/"
            style="cursor:pointer;color:var(--color-link);text-decoration: underline;display:flex;width:fit-content;"
          >More information...</p>
        </div>
      `;
      openModal({
        title: t('structures.insert_table'),
        body: body,
        buttons: [
          {
            label: t('modal.insert'),
            primary: true,
            onClick: () => {
              // get all values from the form
              const cols = parseInt(document.getElementById('structures-table-input-cols').value);
              const rows = parseInt(document.getElementById('structures-table-input-rows').value);
              const inset_value = document.getElementById('structures-table-input-inset').value;
              const inset_unit = document.getElementById('structures-table-select-inset').value;
              const horizontalalign = document.getElementById('structures-table-input-horizontal-align').value;
              const verticalalign = document.getElementById('structures-table-input-vertical-align').value;

              // create the typst code
              const cols_code = cols ? `\tcolumns: ${cols},\n` : '';
              const rows_code = rows ? `\trows: ${rows},\n` : '';
              const inset_code = inset_value ? `\tinset: ${inset_value}${inset_unit},\n` : '';
              const align_code = horizontalalign || verticalalign ? `\talign: ${horizontalalign}+${verticalalign},\n` : '';


              let cells = "";
              for (let i = 0; i < rows; i++) {
                for (let j = 0; j < cols; j++) {
                  if (j === 0 && i === 0) cells += `\n\t`;
                  cells += `[],`;
                }
                cells += `\n`;
                if (i !== rows - 1) cells += `\t`;
              }
              const typst_code = `#table(\n${cols_code}${rows_code}${inset_code}${align_code}${cells})\n`;
              const editor = getEditor();
              if (editor) {
                  const selection = editor.getSelection();
                  if (selection) {
                      editor.executeEdits(null, [
                          {
                              range: selection,
                              text: typst_code,
                              // forceMoveMarkers: true
                          }
                      ]);
                  }
              }
            },
          }
        ],
      });
    },
  },
  {
    id: 'grid',
    content: '#grid',
    classes: '',
    title: 'structures.grid',
    openModal: () => {
      const body = document.createElement('div');
      body.innerHTML = `
      <div id="structures-grid-modal">
        <p class="structures-input-label">${t('structures.dimensions')}</p>
        <div class="flex items-center w-full" style="margin-bottom: 8px">
          <div class="flex items-center flex-none gap-2">
            <input
              id="structures-grid-input-cols"
              type="number"
              placeholder="cols"
              min="1"
              value="1"
              class="w-18 h-8 p-2 text-base"
            />
            <span class="material-symbols-outlined" style="font-size:1rem;">close</span>
            <input
              id="structures-grid-input-rows"
              type="number"
              placeholder="rows"
              min="1"
              value="1"
              class="w-18 h-8 text-base mb-2"
            />
          </div>
          <div class="flex-1 text-right min-w-0">
            <pre class="text-s whitespace-nowrap truncate opacity-50" style="font-family: ${getCurrentFontFamily()};">1 1</pre>
          </div>
        </div>

        <p class="structures-input-label">${t('structures.inset')}</p>
        <div class="flex items-center w-full" style="margin-bottom: 8px">
          <div class="flex items-center gap-2 flex-none">
            <input
              id="structures-grid-input-inset"
              type="number"
              placeholder="inset"
              min="0"
              class="w-18 h-8 text-base mb-2"
            />
            <select
              id="structures-grid-select-inset"
              class="w-18 h-8 text-base mb-2"
            >
              <option value="pt" selected>pt</option>
              <option value="mm">mm</option>
              <option value="cm">cm</option>
              <option value="inches">inches</option>
              <option value="%">%</option>
            </select>
          </div>
          <div class="flex-1 text-right min-w-0">
            <pre class="text-s whitespace-nowrap truncate opacity-50" style="font-family: ${getCurrentFontFamily()};">none</pre>
          </div>
        </div>

        <p class="structures-input-label">${t('structures.align_h')}</p>
        <div class="flex items-center w-full" style="margin-bottom: 8px">
          <select
            id="structures-grid-input-horizontal-align"
            class="w-20 h-8 text-base mb-2"
          >
            <option value="left" selected>left</option>
            <option value="center">center</option>
            <option value="right">right</option>
          </select>
          <div class="flex-1 text-right min-w-0">
            <pre class="text-s whitespace-nowrap truncate opacity-50" style="font-family: ${getCurrentFontFamily()};">left</pre>
          </div>
        </div>

        <p class="structures-input-label">${t('structures.align_v')}</p>
        <div class="flex items-center w-full" style="margin-bottom: 8px">
          <select
            id="structures-grid-input-vertical-align"
            class="w-20 h-8 text-base mb-2"
          >
            <option value="top" selected>top</option>
            <option value="horizon">horizon</option>
            <option value="bottom">bottom</option>
          </select>
          <div class="flex-1 text-right min-w-0">
            <pre class="text-s whitespace-nowrap truncate opacity-50" style="font-family: ${getCurrentFontFamily()};">top</pre>
          </div>
        </div>

        <p
          data-tauri-open-url="https://typst.app/docs/reference/layout/grid/"
          style="cursor:pointer;color:var(--color-link);text-decoration: underline;display:flex;width:fit-content;"
        >More information...</p>
      </div>
            `;
      openModal({
        title: t('structures.insert_grid'),
        body: body,
        buttons: [
          {
            label: t('modal.insert'),
            primary: true,
            onClick: () => {
              // get all values from the form
              const cols = parseInt(document.getElementById('structures-grid-input-cols').value);
              const rows = parseInt(document.getElementById('structures-grid-input-rows').value);
              const inset_value = document.getElementById('structures-grid-input-inset').value;
              const inset_unit = document.getElementById('structures-grid-select-inset').value;
              const horizontalalign = document.getElementById('structures-grid-input-horizontal-align').value;
              const verticalalign = document.getElementById('structures-grid-input-vertical-align').value;

              // create the typst code
              const cols_code = cols ? `\tcolumns: ${cols},\n` : '';
              const rows_code = rows ? `\trows: ${rows},\n` : '';
              const inset_code = inset_value ? `\tinset: ${inset_value}${inset_unit},\n` : '';
              const align_code = horizontalalign || verticalalign ? `\talign: ${horizontalalign}+${verticalalign},\n` : '';


              let cells = "";
              for (let i = 0; i < rows; i++) {
                for (let j = 0; j < cols; j++) {
                  if (j === 0 && i === 0) cells += `\n\t`;
                  cells += `[],`;
                }
                cells += `\n`;
                if (i !== rows - 1) cells += `\t`;
              }
              const typst_code = `#grid(\n${cols_code}${rows_code}${inset_code}${align_code}${cells})\n`;
              const editor = getEditor();
              if (editor) {
                  const selection = editor.getSelection();
                  if (selection) {
                      editor.executeEdits(null, [
                          {
                              range: selection,
                              text: typst_code,
                              // forceMoveMarkers: true
                          }
                      ]);
                  }
              }
            },
          }
        ],
      });
    },
  },
  {
    id: 'rect',
    content: '#rect',
    classes: '',
    title: 'structures.rect',
    openModal: () => {
      const body = document.createElement('div');
      body.innerHTML = `
        <div id="structures-rect-modal">
          <p class="structures-input-label">${t('structures.dimensions')}</p>
          <div class="flex items-center w-full" style="margin-bottom: 8px">
            <div class="flex items-center flex-none gap-2">
              <input
                id="structures-rect-input-width"
                type="number"
                placeholder="width"
                min="1"
                class="w-18 h-8 p-2 text-base"
              />
              <select
                id="structures-rect-select-width"
                class="w-18 h-8 text-base mb-2"
              >
                <option value="pt" selected>pt</option>
                <option value="mm">mm</option>
                <option value="cm">cm</option>
                <option value="inches">inches</option>
                <option value="%">%</option>
              </select>
              <span class="material-symbols-outlined" style="font-size:1rem;">close</span>
              <input
                id="structures-rect-input-height"
                type="number"
                placeholder="height"
                min="1"
                class="w-18 h-8 text-base mb-2"
              />
              <select
                id="structures-rect-select-height"
                class="w-18 h-8 text-base mb-2"
              >
                <option value="pt" selected>pt</option>
                <option value="mm">mm</option>
                <option value="cm">cm</option>
                <option value="inches">inches</option>
                <option value="%">%</option>
              </select>
            </div>
            <div class="flex-1 text-right min-w-0">
              <pre class="text-s whitespace-nowrap truncate opacity-50" style="font-family: ${getCurrentFontFamily()};">auto auto</pre>
            </div>
          </div>

          <p class="structures-input-label">${t('structures.inset')}</p>
          <div class="flex items-center w-full" style="margin-bottom: 8px">
            <div class="flex items-center gap-2 flex-none">
              <input
                id="structures-rect-input-inset"
                type="number"
                placeholder="inset"
                min="0"
                class="w-18 h-8 text-base mb-2"
              />
              <select
                id="structures-rect-select-inset"
                class="w-18 h-8 text-base mb-2"
              >
                <option value="pt" selected>pt</option>
                <option value="mm">mm</option>
                <option value="cm">cm</option>
                <option value="inches">inches</option>
                <option value="%">%</option>
              </select>
            </div>
            <div class="flex-1 text-right min-w-0">
              <pre class="text-s whitespace-nowrap truncate opacity-50" style="font-family: ${getCurrentFontFamily()};">0pt</pre>
            </div>
          </div>

          <p class="structures-input-label">${t('structures.border')}</p>
          <div class="flex items-center w-full gap-2" style="margin-bottom: 8px">
            <input
              id="structures-rect-input-border"
              type="number"
              placeholder="border"
              min="0"
              value="1"
              class="w-18 h-8 text-base mb-2"
            />
            <select
              id="structures-rect-select-border"
              class="w-18 h-8 text-base mb-2"
            >
              <option value="pt" selected>pt</option>
              <option value="mm">mm</option>
              <option value="cm">cm</option>
              <option value="inches">inches</option>
            </select>
            <input
              id="structures-rect-input-bordercolor"
              type="color"
              value="#000000"
              class="w-8 h-8 text-base mb-2"
            />
            <div class="flex-1 text-right min-w-0">
              <pre class="text-s whitespace-nowrap truncate opacity-50" style="font-family: ${getCurrentFontFamily()};">1pt + black</pre>
            </div>
          </div>

          <p class="structures-input-label">${t('structures.radius')}</p>
          <div class="flex items-center w-full gap-2" style="margin-bottom: 8px">
            <input
              id="structures-rect-input-radius"
              type="number"
              placeholder="radius"
              min="0"
              value="0"
              class="w-18 h-8 text-base mb-2"
            />
            <select
              id="structures-rect-select-radius"
              class="w-18 h-8 text-base mb-2"
            >
              <option value="pt" selected>pt</option>
              <option value="mm">mm</option>
              <option value="cm">cm</option>
              <option value="inches">inches</option>
              <option value="%">%</option>
            </select>
            <div class="flex-1 text-right min-w-0">
              <pre class="text-s whitespace-nowrap truncate opacity-50" style="font-family: ${getCurrentFontFamily()};">0pt</pre>
            </div>
          </div>

          <p class="structures-input-label">${t('structures.fill')}</p>
          <div class="flex items-center w-full gap-2" style="margin-bottom: 8px">
            <input type="checkbox" id="structures-rect-checkbox-fill" class="w-6 h-6 mb-2" />
            <input
              id="structures-rect-input-fillcolor"
              type="color"
              value="#000000"
              class="w-16 h-8 text-base mb-2"
              style="opacity: 0.5;transition:0.2s;"
            />
            <div class="flex-1 text-right min-w-0">
              <pre class="text-s whitespace-nowrap truncate opacity-50" style="font-family: ${getCurrentFontFamily()};">none</pre>
            </div>
          </div>

          <p
            data-tauri-open-url="https://typst.app/docs/reference/visualize/rect/"
            style="cursor:pointer;color:var(--color-link);text-decoration: underline;display:flex;width:fit-content;"
          >More information...</p>
        </div>
      `;
      const color_checkbox = body.querySelector('#structures-rect-checkbox-fill');
      const color_input = body.querySelector('#structures-rect-input-fillcolor');
      color_checkbox.addEventListener('change', () => {
        if (color_checkbox.checked) {
          color_input.style.opacity = '1';
        } else {
          color_input.style.opacity = '0.2';
        }
      });

      openModal({
        title: t('structures.insert_rect'),
        body: body,
        buttons: [
          {
            label: t('modal.insert'),
            primary: true,
            onClick: () => {
              // get all values from the form
              const width_value = parseFloat(document.getElementById('structures-rect-input-width').value);
              const width_unit = document.getElementById('structures-rect-select-width').value;
              const height_value = parseFloat(document.getElementById('structures-rect-input-height').value);
              const height_unit = document.getElementById('structures-rect-select-height').value;
              const inset_value = document.getElementById('structures-rect-input-inset').value;
              const inset_unit = document.getElementById('structures-rect-select-inset').value;
              const thickness_value = document.getElementById('structures-rect-input-border').value;
              const thickness_unit = document.getElementById('structures-rect-select-border').value;
              const radius_value = document.getElementById('structures-rect-input-radius').value;
              const radius_unit = document.getElementById('structures-rect-select-radius').value;
              const border_color = document.getElementById('structures-rect-input-bordercolor').value;
              const fill_color = document.getElementById('structures-rect-input-fillcolor').value;
              const fill_enabled = document.getElementById('structures-rect-checkbox-fill').checked;

              // create the typst code
              const width_code = width_value ? `\nwidth: ${width_value}${width_unit},\n` : '\twidth: auto,\n';
              const height_code = height_value ? `\nheight: ${height_value}${height_unit},\n` : '\theight: auto,\n';
              const inset_code = inset_value ? `\tinset: ${inset_value}${inset_unit},\n` : '';
              const stroke_code = thickness_value ? `\tstroke: ${thickness_value}${thickness_unit} + rgb("${border_color}"),\n` : '';
              const radius_code = radius_value ? `\tradius: ${radius_value}${radius_unit},\n` : '';
              const fill_code = fill_enabled && fill_color ? `\tfill: rgb("${fill_color}"),\n` : '';

              const typst_code = `#rect(\n${width_code}${height_code}${inset_code}${stroke_code}${radius_code}${fill_code})[\n\t\n]`;
              const editor = getEditor();
              if (editor) {
                  const selection = editor.getSelection();
                  if (selection) {
                      editor.executeEdits(null, [
                          {
                              range: selection,
                              text: typst_code,
                              // forceMoveMarkers: true
                          }
                      ]);
                  }
              }
            },
          }
        ],
      });
    },
  },
  {
    id: 'figure',
    content: '#figure',
    classes: '',
    title: 'structures.figure',
    openModal: () => {
      const body = document.createElement('div');

      const updatePreview = async () => {
        const pathInput = document.getElementById('structures-figure-input-path');
        const img = document.getElementById('structures-figure-preview-img');
        const empty = document.getElementById('structures-figure-preview-empty');
        const path = pathInput?.value.trim();
        if (!path) {
          if (img) img.style.display = 'none';
          if (empty) empty.style.display = '';
          return;
        }
        const project = getCurrentProject();
        if (!project?.path) return;
        try {
          const fullPath = path.startsWith('/') ? path : `${project.path}/${path}`;
          const dataUrl = await window.__TAURI__.core.invoke('read_image_as_base64', { path: fullPath, projectRoot: project.path });
          img.src = dataUrl;
          img.style.display = '';
          empty.style.display = 'none';
        } catch (error) {
          img.style.display = 'none';
          empty.style.display = '';
        }
      };

      const browseImage = async () => {
        const project = getCurrentProject();
        if (!project?.path) {
          showToast('warning', t('toast.image_paste_no_project'));
          return;
        }
        try {
          const relativePath = await window.__TAURI__.core.invoke('import_image_dialog', {
            projectPath: project.path,
          });
          if (!relativePath) return;
          const pathInput = document.getElementById('structures-figure-input-path');
          if (pathInput) pathInput.value = relativePath;
          await updatePreview();
          document.getElementById('structures-figure-input-caption')?.focus();
        } catch (error) {
          showToast('error', t('toast.image_import_error', { error: String(error) }));
        }
      };

      body.innerHTML = `
        <div id="structures-figure-modal">
          <p class="structures-input-label">${t('structures.image_path')}</p>
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;">
            <input
              id="structures-figure-input-path"
              type="text"
              placeholder="images/photo.png"
              autocomplete="off"
              spellcheck="false"
              style="flex:1;min-width:0;height:32px;padding:0 8px;box-sizing:border-box;border:1px solid var(--border);border-radius:var(--radius-sm);font-size:14px;"
            />
            <button id="structures-figure-btn-browse" type="button" class="btn structures-inline-btn">${t('structures.browse')}</button>
          </div>

          <p class="structures-input-label">${t('structures.preview')}</p>
          <div
            id="structures-figure-preview"
            style="display:flex;align-items:center;justify-content:center;min-height:80px;max-height:220px;overflow:hidden;margin-bottom:8px;border:1px solid rgba(128,128,128,.3);border-radius:6px;padding:8px;"
          >
            <img id="structures-figure-preview-img" alt="" style="max-width:100%;max-height:220px;display:none;" />
            <span id="structures-figure-preview-empty" style="opacity:.5;font-size:12px;">${t('structures.preview_unavailable')}</span>
          </div>

          <p class="structures-input-label">${t('structures.caption')}</p>
          <input
            id="structures-figure-input-caption"
            type="text"
            autocomplete="off"
            style="width:100%;height:32px;padding:0 8px;box-sizing:border-box;border:1px solid var(--border);border-radius:var(--radius-sm);font-size:14px;margin-bottom:8px;"
          />

          <p
            data-tauri-open-url="https://typst.app/docs/reference/model/figure/"
            style="cursor:pointer;color:var(--color-link);text-decoration:underline;display:flex;width:fit-content;"
          >More information...</p>
        </div>
      `;

      const { invoke } = window.__TAURI__.core;
      const pathInput = body.querySelector('#structures-figure-input-path');
      if (pathInput) {
        pathInput.addEventListener('input', () => {
          clearTimeout(pathInput._previewTimer);
          pathInput._previewTimer = setTimeout(updatePreview, 300);
        });
      }
      const browseBtn = body.querySelector('#structures-figure-btn-browse');
      browseBtn?.addEventListener('click', () => browseImage());

      openModal({
        title: t('structures.insert_figure'),
        body: body,
        width: '560px',
        buttons: [
          {
            label: t('modal.insert'),
            primary: true,
            onClick: (close) => {
              const path = document.getElementById('structures-figure-input-path')?.value.trim() ?? '';
              const caption = document.getElementById('structures-figure-input-caption')?.value.trim() ?? '';
              if (!path) {
                showToast('warning', t('toast.image_path_required'));
                return;
              }
              const typst_code = `\n#figure(\n    image("${path}"),\n    caption: [${caption}]\n)\n`;
              const editor = getEditor();
              if (editor) {
                const selection = editor.getSelection();
                if (selection) {
                  editor.executeEdits(null, [{ range: selection, text: typst_code }]);
                }
                editor.focus();
              }
              close();
            },
          },
        ],
      });
    }
  },
];


// Since the button have the editor font....
export function updateBtn() {
  const btn = document.getElementById('structures-menu');
  if (btn) btn.style.fontFamily = getCurrentFontFamily();

  const dropdown = document.getElementById("structures-dropdown");
  if (!dropdown) setBtnIcon(false);
}

export function toggleBtnIcon() {
  const icon = document.getElementById("structures-btn-icon");
  if (!icon) return;

  icon.classList.toggle("structures-btn-icon-rotate");
}

export function setBtnIcon(open) {
  const icon = document.getElementById("structures-btn-icon");
  if (!icon) return;

  icon.classList.toggle("structures-btn-icon-rotate", open);
}

export function populateStructureDropdown() {
  /*
  elements:
   - id: string
   - content: string
   - classes: string
   - title: string
  */
  const dropdown = document.getElementById("structures-dropdown");
  if (!dropdown) return;

  dropdown.innerHTML = '';
  STRUCT_ELEMENTS.forEach((item) => {
    const li = document.createElement('li');
    li.classList.add("structures-dropdown-item");
    const button = document.createElement('button');
    button.addEventListener('click', () => {
      item.openModal();
    });
    button.innerHTML = item.content;
    if (item.classes) button.classList.add(...item.classes.split(' '));
    button.title = item.title ? t(item.title) : '';
    if (item.id) button.id = item.id;
    li.appendChild(button);
    dropdown.appendChild(li);
  });
}
