import { t } from '../../i18n/index.js';
import { showToast } from "../toast.js";
import { getCurrentProject } from "../project.js";
import { insertImageAtCursor } from "../editor.js";
import { openSources } from "../bibliography/sources.js";
import { isMainSourceFile } from "./utils.js";
import { handleRename, handleReplace, handleImport, handleCreateFolder, handleMoveTo, handleReveal, handleDelete } from "./operations.js";

let _contextMenu = null;

export function attachRowContextMenu(row, node, container, li) {
  row.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    e.stopPropagation();
    const items = buildContextItems(node, container, li, row);
    if (items.length > 0) showContextMenu(e.clientX, e.clientY, items);
  });
}

function buildContextItems(node, container, li, row) {
  const items = [];
  const isMain = isMainSourceFile(node.relative_path);

  if (!isMain) {
    items.push({ label: t('file.rename'), icon: "edit", action: () => handleRename(node.relative_path, container) });
  }

  if (!node.is_dir) {
    items.push({ label: t('file.replace'), icon: "swap_horiz", action: () => handleReplace(node.relative_path, container) });
    const imageExts = ["png", "jpg", "jpeg", "gif", "svg", "webp"];
    if (imageExts.includes(node.extension)) {
      items.push({
        label: t('modal.insert'),
        icon: "image",
        action: () => {
          insertImageAtCursor(node.relative_path);
          showToast("success", t('file.insert_image', { path: node.relative_path }));
        },
      });
    }
    if (node.extension === "bib") {
      items.push({
        label: t('menu.manage_bibliography'),
        icon: "menu_book",
        action: () => {
          const project = getCurrentProject();
          if (project) openSources(`${project.path}/${node.relative_path}`);
        },
      });
    }
  }

  items.push({ kind: "sep" });

  if (node.is_dir) {
    items.push({ label: t('file.import_here'), icon: "upload_file", action: () => handleImport(container, node.relative_path) });
    items.push({ label: t('file.new_folder_here'), icon: "create_new_folder", action: () => handleCreateFolder(container, node.relative_path) });
    items.push({ kind: "sep" });
    items.push({ label: t('file.move_here'), icon: "drive_file_move", action: () => handleMoveTo(node.relative_path, container) });
  } else {
    items.push({ label: t('file.move_here'), icon: "drive_file_move", action: () => handleMoveTo(node.relative_path, container) });
  }

  items.push({ label: t('file.reveal'), icon: "folder_open", action: () => handleReveal(node.relative_path) });
  items.push({ kind: "sep" });
  items.push({ label: t('modal.delete'), icon: "delete", danger: true, action: () => handleDelete(node.relative_path, li, row, container) });

  return items;
}

export function showContextMenu(x, y, items) {
  closeContextMenu();
  const menu = document.createElement("div");
  menu.className = "file-tree-context-menu";

  items.forEach(item => {
    if (item && item.kind === "sep") {
      const sep = document.createElement("div");
      sep.className = "file-tree-context-sep";
      menu.appendChild(sep);
      return;
    }
    const btn = document.createElement("button");
    btn.className = "file-tree-context-item" + (item.danger ? " file-tree-context-item--danger" : "");
    btn.innerHTML = `<span class="material-symbols-outlined">${item.icon}</span><span class="file-tree-context-label">${item.label}</span>`;
    btn.addEventListener("click", () => {
      closeContextMenu();
      item.action?.();
    });
    menu.appendChild(btn);
  });

  document.body.appendChild(menu);
  const mw = menu.offsetWidth;
  const mh = menu.offsetHeight;
  menu.style.left = `${Math.max(4, Math.min(x, window.innerWidth - mw - 8))}px`;
  menu.style.top = `${Math.max(4, Math.min(y, window.innerHeight - mh - 8))}px`;
  _contextMenu = menu;

  setTimeout(() => document.addEventListener("mousedown", onContextOutsideDown, true), 0);
}

function onContextOutsideDown(e) {
  if (_contextMenu && !_contextMenu.contains(e.target)) closeContextMenu();
}

function closeContextMenu() {
  if (_contextMenu) {
    _contextMenu.remove();
    _contextMenu = null;
  }
  document.removeEventListener("mousedown", onContextOutsideDown, true);
}

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeContextMenu();
});
