const { invoke } = window.__TAURI__.core;

import { t } from '../../i18n/index.js'
import { openModal, showConfirm, showPrompt } from "../modal.js";
import { showToast } from "../toast.js";
import { getCurrentProject } from "../project.js";
import { insertImageAtCursor, getEditor } from "../editor.js";
import { openSources } from "../bibliography/sources.js";

let _projectFiles = [];
let _filterText = "";
let _dragRelativePath = "";
let _expandedFolders = new Set();
let _autoScroll = null;
let _contextMenu = null;

const EDGE_SCROLL = 90;

export async function openFileManager() {
  if (!getCurrentProject()) {
    showToast("warning", t('file.no_project'));
    return;
  }

  const body = document.createElement("div");
  body.style.display = "flex";
  body.style.flexDirection = "column";
  body.style.gap = "8px";
  body.style.flex = "1";
  body.style.minHeight = "0";

  const searchBar = createSearchBar();
  body.appendChild(searchBar);

  const treeContainer = document.createElement("div");
  treeContainer.id = "file-tree-container";
  treeContainer.style.flex = "1";
  treeContainer.style.overflowY = "auto";
  treeContainer.style.minHeight = "0";
  body.appendChild(treeContainer);

  treeContainer.addEventListener("dragover", (e) => {
    e.preventDefault();
    updateAutoScroll(treeContainer, e.clientY);
  });

  await refreshTree(treeContainer);

  openModal({
    title: t('file.title'),
    body,
    width: "65%",
    height: "70%",
    buttons: [
      { label: t('modal.close_all'), primary: true, onClick: (close, closeAll) => closeAll() },
      { label: t('modal.import_file'), primary: false, onClick: () => handleImport(treeContainer) },
      { label: t('modal.new_folder'), primary: false, onClick: () => handleCreateFolder(treeContainer) },
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
  input.placeholder = t('file.search');
  input.style.flex = "1";
  input.style.border = "none";
  input.style.background = "transparent";
  input.style.color = "var(--text)";
  input.style.outline = "none";
  input.style.fontSize = "13px";
  container.appendChild(input);

  input.addEventListener("input", () => {
    _filterText = input.value.trim().toLowerCase();
    const treeContainer = document.getElementById("file-tree-container");
    if (treeContainer) rebuildTreeView(treeContainer);
  });

  return container;
}

async function refreshTree(container) {
  const project = getCurrentProject();
  if (!project) return;

  container.innerHTML = "";
  const loading = document.createElement("p");
  loading.textContent = t('file.loading');
  loading.style.color = "var(--text-muted)";
  container.appendChild(loading);

  try {
    _projectFiles = await invoke("list_directory", { dirPath: project.path });
    rebuildTreeView(container);
  } catch (err) {
    container.innerHTML = `<p style="color:var(--error-text)">${t('file.error', { error: err })}</p>`;
  }
}

function rebuildTreeView(container) {
  container.innerHTML = "";
  let files = _projectFiles;

  if (_filterText) {
    const matchingPaths = new Set();
    files.forEach(f => {
      if (f.name.toLowerCase().includes(_filterText)) {
        const parts = f.relative_path.split("/");
        for (let i = 1; i <= parts.length; i++) {
          matchingPaths.add(parts.slice(0, i).join("/"));
        }
      }
    });
    files = files.filter(f => matchingPaths.has(f.relative_path));
    _projectFiles.forEach(f => { if (f.is_dir) _expandedFolders.add(f.relative_path); });
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
    const rel = readDropData(e) || _dragRelativePath;
    if (rel) handleMove(rel, "", container);
  });

  ul.appendChild(renderRootDropZone(container));

  if (tree.children.length === 0) {
    const empty = document.createElement("li");
    const p = document.createElement("p");
    p.textContent = _filterText ? t('file.no_results') : t('file.empty_project');
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
    if (_dragRelativePath) row.classList.add("is-drop-target");
  });
  row.addEventListener("dragleave", () => row.classList.remove("is-drop-target"));
  row.addEventListener("drop", (e) => {
    e.preventDefault();
    e.stopPropagation();
    row.classList.remove("is-drop-target");
    const rel = readDropData(e) || _dragRelativePath;
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

  const expanded = _expandedFolders.has(node.relative_path);
  toggle.style.transform = expanded ? "rotate(90deg)" : "";
  childrenContainer.style.display = expanded ? "block" : "none";
  if (expanded) renderFolderChildren(node, childrenContainer, container, depth + 1);

  toggle.addEventListener("click", (e) => {
    e.stopPropagation();
    const open = !_expandedFolders.has(node.relative_path);
    if (open) _expandedFolders.add(node.relative_path);
    else _expandedFolders.delete(node.relative_path);
    toggle.style.transform = open ? "rotate(90deg)" : "";
    childrenContainer.style.display = open ? "block" : "none";
    if (open && childrenContainer.children.length === 0) {
      renderFolderChildren(node, childrenContainer, container, depth + 1);
    }
  });

  bindRowUI(row, actions, node, container, li);
  return li;
}

function renderFolderChildren(node, childrenContainer, container, depth = 1) {
  childrenContainer.innerHTML = "";
  if (node.children && node.children.length > 0) {
    node.children.forEach(child => {
      childrenContainer.appendChild(renderNode(child, _projectFiles, depth, container));
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

  bindRowUI(row, actions, node, container, li);
  return li;
}

function bindRowUI(row, actions, node, container, li) {
  row.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    e.stopPropagation();
    const items = buildContextItems(node, container, li, row);
    if (items.length > 0) showContextMenu(e.clientX, e.clientY, items);
  });
  row.addEventListener("mouseenter", () => {
    actions.style.visibility = "visible";
    actions.style.pointerEvents = "auto";
  });
  row.addEventListener("mouseleave", () => {
    actions.style.visibility = "hidden";
    actions.style.pointerEvents = "none";
  });
}

function setupDragSource(row, relPath) {
  row.draggable = true;

  row.addEventListener("dragstart", (e) => {
    _dragRelativePath = relPath;
    try {
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.dropEffect = "move";
      e.dataTransfer.setData("text/plain", relPath);
    } catch (_) {}
  });

  row.addEventListener("dragend", () => {
    _dragRelativePath = "";
    stopAutoScroll();
    clearDropHighlights();
  });
}

function setupFolderDrop(row, folderRelPath, container) {
  row.addEventListener("dragover", (e) => {
    e.preventDefault();
    updateAutoScroll(container, e.clientY);
    if (_dragRelativePath && !isSelfOrDescendant(_dragRelativePath, folderRelPath)) {
      row.classList.add("is-drop-target");
    }
  });
  row.addEventListener("dragleave", () => row.classList.remove("is-drop-target"));
  row.addEventListener("drop", (e) => {
    e.preventDefault();
    e.stopPropagation();
    row.classList.remove("is-drop-target");
    const rel = readDropData(e) || _dragRelativePath;
    if (rel && !isSelfOrDescendant(rel, folderRelPath)) {
      handleMove(rel, folderRelPath, container);
    }
  });
}

function setupFileDrop(row, fileRelPath, container) {
  const parentDir = getParentDir(fileRelPath);
  row.addEventListener("dragover", (e) => {
    e.preventDefault();
    updateAutoScroll(container, e.clientY);
    if (_dragRelativePath && _dragRelativePath !== fileRelPath && parentDir) {
      row.classList.add("is-drop-target");
    }
  });
  row.addEventListener("dragleave", () => row.classList.remove("is-drop-target"));
  row.addEventListener("drop", (e) => {
    e.preventDefault();
    e.stopPropagation();
    row.classList.remove("is-drop-target");
    const rel = readDropData(e) || _dragRelativePath;
    if (rel && parentDir) {
      handleMove(rel, parentDir, container);
    }
  });
}

function readDropData(e) {
  try {
    return e.dataTransfer.getData("text/plain") || "";
  } catch (_) {
    return "";
  }
}

function clearDropHighlights() {
  document.querySelectorAll(".is-drop-target").forEach(el => el.classList.remove("is-drop-target"));
}

function updateAutoScroll(container, clientY) {
  if (!_dragRelativePath) {
    stopAutoScroll();
    return;
  }
  const rect = container.getBoundingClientRect();
  let dir = 0;
  let speed = 0;
  if (clientY < rect.top + EDGE_SCROLL && container.scrollTop > 0) {
    dir = -1;
    speed = 4 + ((rect.top + EDGE_SCROLL - clientY) / EDGE_SCROLL) * 22;
  } else if (clientY > rect.bottom - EDGE_SCROLL &&
             container.scrollTop < container.scrollHeight - container.clientHeight - 1) {
    dir = 1;
    speed = 4 + ((clientY - (rect.bottom - EDGE_SCROLL)) / EDGE_SCROLL) * 22;
  }

  if (dir === 0) {
    stopAutoScroll();
    return;
  }

  if (!_autoScroll) {
    _autoScroll = { container, dir, speed, raf: 0, last: performance.now() };
    _autoScroll.raf = requestAnimationFrame(autoScrollTick);
  } else {
    _autoScroll.dir = dir;
    _autoScroll.speed = speed;
    _autoScroll.last = performance.now();
  }
}

function autoScrollTick(now) {
  const as = _autoScroll;
  if (!as) return;
  const dt = Math.min(now - as.last, 60) / 16.7;
  as.last = now;
  if (as.dir !== 0) as.container.scrollTop += as.dir * as.speed * dt;
  as.raf = requestAnimationFrame(autoScrollTick);
}

function stopAutoScroll() {
  if (_autoScroll) {
    cancelAnimationFrame(_autoScroll.raf);
    _autoScroll = null;
  }
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
        icon: "add_photo_alternate",
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

function createButton(iconName, title, onClick) {
  const btn = document.createElement("button");
  btn.className = "file-tree-action-btn";
  btn.title = title;
  btn.innerHTML = `<span class="material-symbols-outlined" style="font-size:18px">${iconName}</span>`;
  btn.addEventListener("click", onClick);
  return btn;
}

function getFileIcon(ext) {
  const map = {
    typ: "description",
    pdf: "picture_as_pdf",
    png: "image",
    jpg: "image",
    jpeg: "image",
    gif: "image",
    svg: "image",
    webp: "image",
    bib: "menu_book",
    csv: "table_rows",
    yaml: "settings",
    json: "data_object",
    txt: "text_snippet",
    md: "article",
    html: "code",
    css: "code",
    js: "javascript",
    rs: "rust",
  };
  return map[ext] || "insert_drive_file";
}

function isMainSourceFile(relPath) {
  const proj = getCurrentProject();
  return !!proj && !!proj.typFile && relPath === proj.typFile && relPath.endsWith(".typ");
}

function getParentDir(relPath) {
  const i = relPath.lastIndexOf("/");
  return i === -1 ? "" : relPath.slice(0, i);
}

function isSelfOrDescendant(dragPath, folderPath) {
  return dragPath === folderPath || dragPath.startsWith(folderPath + "/");
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

async function handleMove(relPath, targetDir, container, skipConfirm = false) {
  const project = getCurrentProject();
  if (!project) return;

  if (isMainSourceFile(relPath)) {
    showToast("warning", t('file.rename_main_forbidden'));
    return;
  }

  const fileName = relPath.split("/").pop();
  const newRelPath = targetDir ? `${targetDir}/${fileName}` : fileName;

  if (relPath === newRelPath) return;

  if (!skipConfirm) {
    const confirmed = await showConfirm({
      title: t('modal.move'),
      message: t('file.move_message', { source: relPath, dest: newRelPath }),
      confirmLabel: t('modal.move'),
      cancelLabel: t('modal.cancel'),
    });
    if (!confirmed) return;
  }

  try {
    await invoke("rename_file", {
      oldPath: `${project.path}/${relPath}`,
      newPath: `${project.path}/${newRelPath}`,
    });
    await invoke("invalidate_file_cache");
    if (targetDir) _expandedFolders.add(targetDir);
    showToast("success", t('file.moved', { name: fileName }));
    await refreshTree(container);
  } catch (err) {
    showToast("error", t('file.move_error', { error: err }));
    return;
  }

  await updateEditorReferences(buildPathMapping(relPath, newRelPath));
}

async function handleRename(relPath, container) {
  const project = getCurrentProject();
  if (!project) return;

  if (isMainSourceFile(relPath)) {
    showToast("warning", t('file.rename_main_forbidden'));
    return;
  }

  const node = _projectFiles.find(f => f.relative_path === relPath);
  if (!node) return;
  const oldName = node.name;

  const newName = await showPrompt({
    title: t('file.rename_title'),
    label: t('file.rename_label'),
    placeholder: oldName,
    defaultValue: oldName,
    validate: validateFileName,
  });
  if (!newName) return;

  const parentDir = getParentDir(relPath);
  const newRelPath = parentDir ? `${parentDir}/${newName}` : newName;

  if (newRelPath === relPath) return;
  if (_projectFiles.some(f => f.relative_path === newRelPath)) {
    showToast("error", t('file.rename_exists', { name: newName }));
    return;
  }

  try {
    await invoke("rename_file", {
      oldPath: `${project.path}/${relPath}`,
      newPath: `${project.path}/${newRelPath}`,
    });
    await invoke("invalidate_file_cache");
    if (parentDir) _expandedFolders.add(parentDir);
    showToast("success", t('file.renamed', { name: newName }));
    await refreshTree(container);
  } catch (err) {
    showToast("error", t('file.rename_error', { error: err }));
    return;
  }

  await updateEditorReferences(buildPathMapping(relPath, newRelPath));
}

function validateFileName(v) {
  return /[<>:"/\\|?*]/.test(v) ? t('file.rename_invalid') : true;
}

function buildPathMapping(oldRel, newRel) {
  const map = {};
  if (oldRel === newRel) return map;
  map[oldRel] = newRel;
  const oldPrefix = oldRel + "/";
  _projectFiles.forEach(f => {
    if (f.relative_path.startsWith(oldPrefix)) {
      map[f.relative_path] = newRel + f.relative_path.slice(oldRel.length);
    }
  });
  return map;
}

async function updateEditorReferences(map) {
  const entries = Object.entries(map).filter(([oldPath, newPath]) => oldPath !== newPath);
  if (entries.length === 0) return;

  try {
    const editor = getEditor();
    const model = editor?.getModel();
    if (!model) return;

    const full = model.getValue();
    const edits = [];

    for (const [oldPath, newPath] of entries) {
      const needle = `"${oldPath}"`;
      const replacement = `"${newPath}"`;
      let idx = 0;
      while (idx < full.length) {
        idx = full.indexOf(needle, idx);
        if (idx === -1) break;
        const startPos = model.getPositionAt(idx);
        const endPos = model.getPositionAt(idx + needle.length);
        edits.push({
          range: {
            startLineNumber: startPos.lineNumber,
            startColumn: startPos.column,
            endLineNumber: endPos.lineNumber,
            endColumn: endPos.column,
          },
          text: replacement,
        });
        idx += needle.length;
      }
    }

    if (edits.length === 0) return;

    const confirmed = await showConfirm({
      title: t('file.ref_update_title'),
      message: t('file.ref_update_message', { count: edits.length }),
      confirmLabel: t('modal.confirm'),
      cancelLabel: t('modal.cancel'),
    });
    if (!confirmed) return;

    editor.executeEdits("file-manager", edits);
    editor.focus();
    showToast("success", t('file.ref_updated', { count: edits.length }));
  } catch (err) {
    showToast("warning", t('file.ref_update_error', { error: err }));
  }
}

async function handleReplace(relPath, container) {
  const project = getCurrentProject();
  if (!project) return;

  const confirmed = await showConfirm({
    title: t('file.replace_title'),
    message: t('file.replace_message', { name: relPath }),
    confirmLabel: t('modal.replace'),
    cancelLabel: t('modal.cancel'),
  });
  if (!confirmed) return;

  try {
    const name = await invoke("replace_file", { path: `${project.path}/${relPath}` });
    if (!name) return;
    await invoke("invalidate_file_cache");
    showToast("success", t('file.replaced', { name }));
  } catch (err) {
    if (!err.includes("Aucun fichier sélectionné")) {
      showToast("error", t('file.replace_error', { error: err }));
    }
  }
}

async function handleImport(container, destRel = "") {
  const project = getCurrentProject();
  if (!project) return;

  const destDir = destRel ? `${project.path}/${destRel}` : project.path;

  try {
    const imported = await invoke("import_file_dialog", { destDir });
    if (imported && imported.length > 0) {
      await invoke("invalidate_file_cache");
      if (destRel) _expandedFolders.add(destRel);
      showToast("success", t('file.imported', { count: imported.length }));
      await refreshTree(container);
    }
  } catch (err) {
    if (!err.includes("Aucun fichier sélectionné")) {
      showToast("error", t('file.import_error', { error: err }));
    }
  }
}

async function handleCreateFolder(container, parentRel = "") {
  const project = getCurrentProject();
  if (!project) return;

  const name = await showPrompt({
    title: t('file.new_folder_title'),
    label: t('file.new_folder_label'),
    placeholder: t('file.new_folder_placeholder'),
    validate: (v) => /[<>:"/\\|?*]/.test(v) ? t('file.new_folder_invalid') : true,
  });
  if (!name) return;

  const relPath = parentRel ? `${parentRel}/${name}` : name;

  try {
    await invoke("create_dir", { dirPath: `${project.path}/${relPath}` });
    await invoke("invalidate_file_cache");
    if (parentRel) _expandedFolders.add(parentRel);
    showToast("success", t('file.folder_created', { name }));
    await refreshTree(container);
  } catch (err) {
    showToast("error", t('file.folder_error', { error: err }));
  }
}

async function handleReveal(relPath) {
  const project = getCurrentProject();
  if (!project) return;

  try {
    await invoke("reveal_in_file_manager", { path: `${project.path}/${relPath}` });
  } catch (err) {
    showToast("error", t('file.reveal_error', { error: err }));
  }
}

async function handleMoveTo(relPath, container) {
  const folders = _projectFiles.filter(f => f.is_dir && !isSelfOrDescendant(f.relative_path, relPath) && !isSelfOrDescendant(relPath, f.relative_path));

  const select = document.createElement("select");
  select.className = "ide-modal-input";
  const rootOpt = document.createElement("option");
  rootOpt.value = "";
  rootOpt.textContent = t('file.project_root');
  select.appendChild(rootOpt);
  folders.forEach(f => {
    const opt = document.createElement("option");
    opt.value = f.relative_path;
    opt.textContent = f.relative_path;
    select.appendChild(opt);
  });

  const bodyEl = document.createElement("div");
  bodyEl.appendChild(select);

  openModal({
    title: t('file.move_title'),
    body: bodyEl,
    buttons: [
      { label: t('modal.cancel'), primary: false, onClick: (close) => close() },
      { label: t('modal.move'), primary: true, onClick: (close) => {
        handleMove(relPath, select.value, container, true);
        close();
      } },
    ],
  });
}

async function handleDelete(relativePath, li, row, container) {
  const project = getCurrentProject();
  if (!project) return;

  const confirmed = await showConfirm({
    title: t('file.delete_title'),
    message: t('file.delete_message', { name: relativePath }),
    confirmLabel: t('modal.delete'),
    cancelLabel: t('modal.cancel'),
  });
  if (!confirmed) return;

  try {
    await invoke("delete_file_or_dir", { path: `${project.path}/${relativePath}` });
    await invoke("invalidate_file_cache");
    showToast("success", t('file.deleted', { name: relativePath }));
    _projectFiles = _projectFiles.filter(f => f.relative_path !== relativePath && !f.relative_path.startsWith(relativePath + "/"));
    [..._expandedFolders].forEach(p => { if (p === relativePath || p.startsWith(relativePath + "/")) _expandedFolders.delete(p); });
    li.remove();
  } catch (err) {
    showToast("error", t('file.delete_error', { error: err }));
  }
}

function showContextMenu(x, y, items) {
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