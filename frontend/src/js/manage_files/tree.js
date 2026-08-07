const { invoke } = window.__TAURI__.core;

import { t } from '../../i18n/index.js';
import { showToast } from "../toast.js";
import { getCurrentProject } from "../project.js";
import { insertImageAtCursor } from "../editor.js";
import { openSources } from "../bibliography/sources.js";
import { getFiles, setFiles, getFilter, isExpanded, toggleExpanded, expandAllFolders } from "./state.js";
import { isMainSourceFile } from "./utils.js";
import { createButton, getFileIcon } from "./icons.js";
import { setupDragSource, setupFolderDrop, setupFileDrop, readDropData, updateAutoScroll, getDragPath } from "./drag-drop.js";
import { attachRowContextMenu } from "./context-menu.js";
import { handleCreateFolder, handleImport, handleReveal, handleDelete, handleRename, handleReplace, handleMove } from "./operations.js";

export async function refreshTree(container) {
  const project = getCurrentProject();
  if (!project) return;

  container.innerHTML = "";
  const loading = document.createElement("p");
  loading.textContent = t('file.loading');
  loading.style.color = "var(--text-muted)";
  container.appendChild(loading);

  try {
    setFiles(await invoke("list_directory", { dirPath: project.path }));
    rebuildTreeView(container);
  } catch (err) {
    container.innerHTML = `<p style="color:var(--error-text)">${t('file.error', { error: err })}</p>`;
  }
}

export function rebuildTreeView(container) {
  container.innerHTML = "";
  let files = getFiles();
  const filterText = getFilter();

  if (filterText) {
    const matchingPaths = new Set();
    getFiles().forEach(f => {
      if (f.name.toLowerCase().includes(filterText)) {
        const parts = f.relative_path.split("/");
        for (let i = 1; i <= parts.length; i++) {
          matchingPaths.add(parts.slice(0, i).join("/"));
        }
      }
    });
    files = getFiles().filter(f => matchingPaths.has(f.relative_path));
    expandAllFolders();
  }

  const tree = buildNestedTree(files);
  const ul = document.createElement("ul");
  ul.className = "file-tree-root";
  ul.style.listStyle = "none";
  ul.style.padding = "0";
  ul.style.margin = "0";

  ul.addEventListener("dragover", (e) => {
    e.preventDefault();
    updateAutoScroll(container, e.clientY);
  });
  ul.addEventListener("drop", (e) => {
    e.preventDefault();
    const rel = readDropData(e) || getDragPath();
    if (rel) handleMove(rel, "", container);
  });

  ul.appendChild(renderRootDropZone(container));

  if (tree.children.length === 0) {
    const empty = document.createElement("li");
    const p = document.createElement("p");
    p.textContent = filterText ? t('file.no_results') : t('file.empty_project');
    p.style.color = "var(--text-muted)";
    p.style.marginLeft = "26px";
    empty.appendChild(p);
    ul.appendChild(empty);
    container.appendChild(ul);
    return;
  }

  tree.children.forEach(child => {
    ul.appendChild(renderNode(child, files, 0, container));
  });
  container.appendChild(ul);
}

function renderRootDropZone(container) {
  const li = document.createElement("li");

  const row = document.createElement("div");
  row.className = "file-tree-row file-tree-root-drop";
  row.dataset.relpath = "";

  const icon = document.createElement("span");
  icon.className = "material-symbols-outlined";
  icon.textContent = "home";
  icon.style.fontSize = "18px";
  icon.style.color = "var(--accent-hover)";

  const nameSpan = document.createElement("span");
  nameSpan.className = "file-tree-name";
  nameSpan.textContent = t('file.project_root');
  nameSpan.style.color = "var(--text-muted)";

  row.appendChild(icon);
  row.appendChild(nameSpan);
  li.appendChild(row);

  row.addEventListener("dragover", (e) => {
    e.preventDefault();
    updateAutoScroll(container, e.clientY);
    if (getDragPath()) row.classList.add("is-drop-target");
  });
  row.addEventListener("dragleave", () => row.classList.remove("is-drop-target"));
  row.addEventListener("drop", (e) => {
    e.preventDefault();
    e.stopPropagation();
    row.classList.remove("is-drop-target");
    const rel = readDropData(e) || getDragPath();
    if (rel) handleMove(rel, "", container);
  });

  return li;
}

function buildNestedTree(files) {
  const root = { name: "", children: [], is_dir: true };

  for (const file of files) {
    const parts = file.relative_path.split("/");
    let current = root;

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isLast = i === parts.length - 1;
      let child = current.children.find(c => c.name === part);

      if (!child) {
        if (isLast) {
          child = { ...file, children: [] };
          current.children.push(child);
        } else {
          child = { name: part, relative_path: parts.slice(0, i + 1).join("/"), is_dir: true, children: [], size: 0, extension: "" };
          current.children.push(child);
        }
      }
      current = child;
    }
  }
  return root;
}

function renderNode(node, allFiles, depth, container) {
  const li = document.createElement("li");
  li.style.marginLeft = `${depth * 20}px`;

  if (node.is_dir) {
    return renderFolder(node, allFiles, depth, container, li);
  } else {
    return renderFile(node, allFiles, depth, container, li);
  }
}

function renderFolder(node, allFiles, depth, container, li) {
  const row = document.createElement("div");
  row.className = "file-tree-row";
  row.dataset.relpath = node.relative_path;

  setupDragSource(row, node.relative_path);
  setupFolderDrop(row, node.relative_path, container);

  const toggle = document.createElement("span");
  toggle.className = "file-tree-toggle material-symbols-outlined";
  toggle.textContent = "chevron_right";
  toggle.style.cursor = "pointer";
  toggle.style.fontSize = "18px";
  toggle.style.transition = "transform 0.15s";

  const icon = document.createElement("span");
  icon.className = "material-symbols-outlined";
  icon.textContent = "folder";
  icon.style.fontSize = "18px";
  icon.style.color = "var(--warning-text)";

  const nameSpan = document.createElement("span");
  nameSpan.className = "file-tree-name";
  nameSpan.textContent = node.name;

  const actions = document.createElement("span");
  actions.className = "file-tree-actions";
  actions.appendChild(createButton("create_new_folder", t('file.new_folder_here'), (e) => {
    e.stopPropagation();
    handleCreateFolder(container, node.relative_path);
  }));
  actions.appendChild(createButton("upload_file", t('file.import_here'), (e) => {
    e.stopPropagation();
    handleImport(container, node.relative_path);
  }));
  actions.appendChild(createButton("folder_open", t('file.reveal'), (e) => {
    e.stopPropagation();
    handleReveal(node.relative_path);
  }));
  actions.appendChild(createButton("delete", t('modal.delete'), () => handleDelete(node.relative_path, li, row, container)));
  actions.style.visibility = "hidden";
  actions.style.pointerEvents = "none";

  row.appendChild(toggle);
  row.appendChild(icon);
  row.appendChild(nameSpan);
  row.appendChild(actions);
  li.appendChild(row);

  const childrenContainer = document.createElement("div");
  childrenContainer.className = "file-tree-children";
  li.appendChild(childrenContainer);

  const expanded = isExpanded(node.relative_path);
  toggle.style.transform = expanded ? "rotate(90deg)" : "";
  childrenContainer.style.display = expanded ? "block" : "none";
  if (expanded) renderFolderChildren(node, childrenContainer, container, depth + 1);

  toggle.addEventListener("click", (e) => {
    e.stopPropagation();
    const open = toggleExpanded(node.relative_path);
    toggle.style.transform = open ? "rotate(90deg)" : "";
    childrenContainer.style.display = open ? "block" : "none";
    if (open && childrenContainer.children.length === 0) {
      renderFolderChildren(node, childrenContainer, container, depth + 1);
    }
  });

  attachRowUI(row, actions, node, container, li);
  return li;
}

function renderFolderChildren(node, childrenContainer, container, depth = 1) {
  childrenContainer.innerHTML = "";
  if (node.children && node.children.length > 0) {
    node.children.forEach(child => {
      childrenContainer.appendChild(renderNode(child, getFiles(), depth, container));
    });
  } else {
    const empty = document.createElement("p");
    empty.textContent = t('file.empty_folder');
    empty.style.color = "var(--text-muted)";
    empty.style.marginLeft = `${depth * 20}px`;
    empty.style.fontSize = "12px";
    childrenContainer.appendChild(empty);
  }
}

function renderFile(node, allFiles, depth, container, li) {
  const row = document.createElement("div");
  row.className = "file-tree-row";
  row.dataset.relpath = node.relative_path;

  setupDragSource(row, node.relative_path);
  setupFileDrop(row, node.relative_path, container);

  const icon = document.createElement("span");
  icon.className = "material-symbols-outlined file-tree-icon";
  icon.textContent = getFileIcon(node.extension);
  icon.style.fontSize = "18px";

  const nameSpan = document.createElement("span");
  nameSpan.className = "file-tree-name";
  nameSpan.textContent = node.name;
  nameSpan.style.flex = "1";
  nameSpan.style.overflow = "hidden";
  nameSpan.style.textOverflow = "ellipsis";
  nameSpan.style.whiteSpace = "nowrap";

  const actions = document.createElement("span");
  actions.className = "file-tree-actions";

  const imageExts = ["png", "jpg", "jpeg", "gif", "svg", "webp"];
  if (imageExts.includes(node.extension)) {
    actions.appendChild(createButton("add_photo_alternate", t('modal.insert'), (e) => {
      e.stopPropagation();
      insertImageAtCursor(node.relative_path);
      showToast("success", t('file.insert_image', { path: node.relative_path }));
    }));
    setupImagePreview(row, node.relative_path);
  }
  if (node.extension === "bib") {
    actions.appendChild(createButton("menu_book", t('bib.title'), (e) => {
      e.stopPropagation();
      const project = getCurrentProject();
      if (project) openSources(`${project.path}/${node.relative_path}`);
    }));
  }
  if (!isMainSourceFile(node.relative_path)) {
    actions.appendChild(createButton("edit", t('file.rename'), (e) => {
      e.stopPropagation();
      handleRename(node.relative_path, container);
    }));
  }
  actions.appendChild(createButton("swap_horiz", t('file.replace'), (e) => {
    e.stopPropagation();
    handleReplace(node.relative_path, container);
  }));
  actions.appendChild(createButton("folder_open", t('file.reveal'), (e) => {
    e.stopPropagation();
    handleReveal(node.relative_path);
  }));
  actions.appendChild(createButton("delete", t('modal.delete'), () => handleDelete(node.relative_path, li, row, container)));
  actions.style.visibility = "hidden";
  actions.style.pointerEvents = "none";

  row.appendChild(icon);
  row.appendChild(nameSpan);
  if (isMainSourceFile(node.relative_path)) {
    const mainTag = document.createElement("span");
    mainTag.className = "file-tree-main-tag";
    mainTag.textContent = t('file.main_tag');
    mainTag.title = t('file.main_typ_hint');
    row.appendChild(mainTag);
  }
  row.appendChild(actions);
  li.appendChild(row);

  attachRowUI(row, actions, node, container, li);
  return li;
}

function attachRowUI(row, actions, node, container, li) {
  row.addEventListener("mouseenter", () => {
    actions.style.visibility = "visible";
    actions.style.pointerEvents = "auto";
  });
  row.addEventListener("mouseleave", () => {
    actions.style.visibility = "hidden";
    actions.style.pointerEvents = "none";
  });
  attachRowContextMenu(row, node, container, li);
}

function setupImagePreview(row, relativePath) {
  let previewEl = null;
  let timer = null;
  const project = getCurrentProject();
  if (!project) return;
  const fullPath = `${project.path}/${relativePath}`;

  function positionAtCursor(e) {
    if (!previewEl) return;
    let left = e.clientX + 16;
    let top = e.clientY + 16;
    const pw = previewEl.offsetWidth || 400;
    const ph = previewEl.offsetHeight || 400;
    if (left + pw > window.innerWidth) left = e.clientX - pw - 16;
    if (top + ph > window.innerHeight) top = window.innerHeight - ph - 8;
    if (top < 4) top = 4;
    previewEl.style.left = `${left}px`;
    previewEl.style.top = `${top}px`;
  }

  row.addEventListener("mouseenter", (e) => {
    timer = setTimeout(async () => {
      try {
        const dataUrl = await invoke("read_image_as_base64", { path: fullPath });
        previewEl = document.createElement("div");
        previewEl.className = "file-tree-preview-tooltip";
        previewEl.style.position = "fixed";
        previewEl.style.zIndex = "9000";
        previewEl.style.background = "var(--bg-panel)";
        previewEl.style.border = "1px solid var(--border)";
        previewEl.style.borderRadius = "var(--radius-sm)";
        previewEl.style.boxShadow = "var(--shadow-lg)";
        previewEl.style.padding = "8px";
        previewEl.style.display = "flex";
        previewEl.style.alignItems = "center";
        previewEl.style.justifyContent = "center";
        previewEl.style.pointerEvents = "none";

        const img = document.createElement("img");
        img.src = dataUrl;
        img.style.maxWidth = "380px";
        img.style.maxHeight = "380px";
        img.style.objectFit = "contain";
        img.style.borderRadius = "4px";
        previewEl.appendChild(img);

        document.body.appendChild(previewEl);
        positionAtCursor(e);
      } catch (_) {}
    }, 400);
  });

  row.addEventListener("mouseleave", () => {
    clearTimeout(timer);
    if (previewEl) {
      previewEl.remove();
      previewEl = null;
    }
  });
}