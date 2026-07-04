
const { invoke } = window.__TAURI__.core;

import { openModal, showConfirm, showPrompt } from "../modal.js";
import { showToast } from "../toast.js";
import { getCurrentProject } from "../project.js";
import { insertImageAtCursor } from "../editor.js";
import { openSources } from "../bibliography/sources.js";

let _projectFiles = [];
let _filterText = "";
let _dragRelativePath = "";

export async function openFileManager() {
  if (!getCurrentProject()) {
    showToast("warning", "Vous devez ouvrir un projet pour gérer les fichiers.");
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

  await refreshTree(treeContainer);

  openModal({
    title: "Fichiers du projet",
    body,
    width: "65%",
    height: "70%",
    buttons: [
      { label: "Tout fermer", primary: true, onClick: (close, closeAll) => closeAll() },
      { label: "Importer un fichier", primary: false, onClick: () => handleImport(treeContainer) },
      { label: "Nouveau dossier", primary: false, onClick: () => handleCreateFolder(treeContainer) },
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
  input.placeholder = "Rechercher un fichier…";
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
  loading.textContent = "Chargement...";
  loading.style.color = "var(--text-muted)";
  container.appendChild(loading);

  try {
    _projectFiles = await invoke("list_directory", { dirPath: project.path });
    rebuildTreeView(container);
  } catch (err) {
    container.innerHTML = `<p style="color:var(--error-text)">Erreur : ${err}</p>`;
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
  }

  if (files.length === 0) {
    container.innerHTML = _filterText
      ? '<p style="color:var(--text-muted)">Aucun résultat.</p>'
      : '<p style="color:var(--text-muted)">Le projet est vide.</p>';
    return;
  }

  const tree = buildNestedTree(files);
  const ul = document.createElement("ul");
  ul.className = "file-tree-root";
  ul.style.listStyle = "none";
  ul.style.padding = "0";
  ul.style.margin = "0";

  ul.addEventListener("dragover", (e) => e.preventDefault());
  ul.addEventListener("drop", (e) => {
    e.preventDefault();
    if (_dragRelativePath) handleDrop(_dragRelativePath, "", container);
  });

  tree.children.forEach(child => {
    ul.appendChild(renderNode(child, files, 0, container));
  });
  container.appendChild(ul);

  if (_filterText) {
    expandAll(container);
  }
}

function expandAll(container) {
  container.querySelectorAll(".file-tree-children").forEach(el => {
    el.style.display = "block";
  });
  container.querySelectorAll(".file-tree-toggle").forEach(el => {
    el.style.transform = "rotate(90deg)";
  });
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
    const row = document.createElement("div");
    row.className = "file-tree-row";
    row.draggable = true;
    row.dataset.relpath = node.relative_path;

    row.addEventListener("dragstart", (e) => {
      _dragRelativePath = node.relative_path;
      e.dataTransfer.effectAllowed = "move";
    });
    row.addEventListener("dragend", () => { _dragRelativePath = ""; });

    row.addEventListener("dragover", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (_dragRelativePath && !_dragRelativePath.startsWith(node.relative_path)) {
        row.style.outline = "2px solid var(--accent-hover)";
        row.style.outlineOffset = "-2px";
      }
    });
    row.addEventListener("dragleave", () => {
      row.style.outline = "";
    });
    row.addEventListener("drop", (e) => {
      e.preventDefault();
      e.stopPropagation();
      row.style.outline = "";
      if (_dragRelativePath && !_dragRelativePath.startsWith(node.relative_path)) {
        handleDrop(_dragRelativePath, node.relative_path, container);
      }
    });

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
    actions.appendChild(createActionBtn("delete", "Supprimer", () => handleDelete(node.relative_path, li, row, container)));
    actions.style.visibility = "hidden";
    actions.style.pointerEvents = "none";

    row.appendChild(toggle);
    row.appendChild(icon);
    row.appendChild(nameSpan);
    row.appendChild(actions);
    li.appendChild(row);

    const childrenContainer = document.createElement("div");
    childrenContainer.className = "file-tree-children";
    childrenContainer.style.display = "none";
    li.appendChild(childrenContainer);

    let expanded = false;
    toggle.addEventListener("click", (e) => {
      e.stopPropagation();
      expanded = !expanded;
      toggle.style.transform = expanded ? "rotate(90deg)" : "";
      childrenContainer.style.display = expanded ? "block" : "none";
      if (expanded && childrenContainer.children.length === 0) {
        if (node.children && node.children.length > 0) {
          node.children.forEach(child => {
            childrenContainer.appendChild(renderNode(child, allFiles, depth + 1, container));
          });
        } else {
          const empty = document.createElement("p");
          empty.textContent = "(dossier vide)";
          empty.style.color = "var(--text-muted)";
          empty.style.marginLeft = `${(depth + 1) * 20}px`;
          empty.style.fontSize = "12px";
          childrenContainer.appendChild(empty);
        }
      }
    });

    row.addEventListener("mouseenter", () => { actions.style.visibility = "visible"; actions.style.pointerEvents = "auto"; });
    row.addEventListener("mouseleave", () => { actions.style.visibility = "hidden"; actions.style.pointerEvents = "none"; });

  } else {
    const row = document.createElement("div");
    row.className = "file-tree-row";
    row.draggable = true;
    row.dataset.relpath = node.relative_path;

    row.addEventListener("dragstart", (e) => {
      _dragRelativePath = node.relative_path;
      e.dataTransfer.effectAllowed = "move";
    });
    row.addEventListener("dragend", () => { _dragRelativePath = ""; });

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
    actions.style.visibility = "hidden";
    actions.style.pointerEvents = "none";

    const imageExts = ["png", "jpg", "jpeg", "gif", "svg", "webp"];
    if (imageExts.includes(node.extension)) {
      actions.appendChild(createActionBtn("add_photo_alternate", "Insérer", (e) => {
        e.stopPropagation();
        insertImageAtCursor(node.relative_path);
        showToast("success", `Image insérée : ${node.relative_path}`);
      }));
      setupImagePreview(row, node.relative_path);
    }
    if (node.extension === "bib") {
      actions.appendChild(createActionBtn("menu_book", "Bibliographie", (e) => {
        e.stopPropagation();
        const project = getCurrentProject();
        if (project) openSources(`${project.path}/${node.relative_path}`);
      }));
    }
    actions.appendChild(createActionBtn("delete", "Supprimer", () => handleDelete(node.relative_path, li, row, container)));

    row.appendChild(icon);
    row.appendChild(nameSpan);
    row.appendChild(actions);
    li.appendChild(row);

    row.addEventListener("mouseenter", () => { actions.style.visibility = "visible"; actions.style.pointerEvents = "auto"; });
    row.addEventListener("mouseleave", () => { actions.style.visibility = "hidden"; actions.style.pointerEvents = "none"; });
  }

  return li;
}

function createActionBtn(iconName, title, onClick) {
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

async function handleDrop(relPath, targetRelPath, container) {
  const project = getCurrentProject();
  if (!project) return;

  const fileName = relPath.split("/").pop();
  const newRelPath = targetRelPath ? `${targetRelPath}/${fileName}` : fileName;

  if (relPath === newRelPath) return;

  const confirmed = await showConfirm({
    title: "Déplacer",
    message: `Déplacer "${relPath}" vers "${newRelPath}" ?`,
    confirmLabel: "Déplacer",
    cancelLabel: "Annuler",
  });
  if (!confirmed) return;

  try {
    await invoke("rename_file", {
      oldPath: `${project.path}/${relPath}`,
      newPath: `${project.path}/${newRelPath}`,
    });
    await invoke("invalidate_file_cache");
    showToast("success", `"${relPath}" déplacé.`);
    await refreshTree(container);
  } catch (err) {
    showToast("error", `Erreur lors du déplacement : ${err}`);
  }
}

async function handleImport(container) {
  const project = getCurrentProject();
  if (!project) return;

  try {
    const imported = await invoke("import_file_dialog", { destDir: project.path });
    if (imported && imported.length > 0) {
      await invoke("invalidate_file_cache");
      showToast("success", `${imported.length} fichier(s) importé(s).`);
      await refreshTree(container);
    }
  } catch (err) {
    if (!err.includes("Aucun fichier sélectionné")) {
      showToast("error", `Erreur d'import : ${err}`);
    }
  }
}

async function handleCreateFolder(container) {
  const project = getCurrentProject();
  if (!project) return;

  const name = await showPrompt({
    title: "Nouveau dossier",
    label: "Nom du dossier",
    placeholder: "images",
    validate: (v) => /[<>:"/\\|?*]/.test(v) ? "Le nom contient des caractères invalides." : true,
  });
  if (!name) return;

  try {
    await invoke("create_dir", { dirPath: `${project.path}/${name}` });
    await invoke("invalidate_file_cache");
    showToast("success", `Dossier "${name}" créé.`);
    await refreshTree(container);
  } catch (err) {
    showToast("error", `Erreur : ${err}`);
  }
}

async function handleDelete(relativePath, li, row, container) {
  const project = getCurrentProject();
  if (!project) return;

  const confirmed = await showConfirm({
    title: "Supprimer",
    message: `Supprimer "${relativePath}" ? Cette action est irréversible.`,
    confirmLabel: "Supprimer",
    cancelLabel: "Annuler",
  });
  if (!confirmed) return;

  try {
    await invoke("delete_file_or_dir", { path: `${project.path}/${relativePath}` });
    await invoke("invalidate_file_cache");
    showToast("success", `"${relativePath}" supprimé.`);
    _projectFiles = _projectFiles.filter(f => f.relative_path !== relativePath && !f.relative_path.startsWith(relativePath + "/"));
    li.remove();
  } catch (err) {
    showToast("error", `Erreur : ${err}`);
  }
}
