const { invoke } = window.__TAURI__.core;

import { t } from '../../i18n/index.js';
import { openModal, showConfirm, showPrompt } from "../modal.js";
import { showToast } from "../toast.js";
import { getCurrentProject } from "../project.js";
import { getEditor } from "../editor.js";
import { wireGet } from "./wire.js";
import { getFiles, filterFiles, addExpanded, removeExpandedWithPrefix } from "./state.js";
import { getParentDir, isSelfOrDescendant, isMainSourceFile } from "./utils.js";

async function refreshTree(container) {
  return wireGet("refresh")(container);
}

export async function handleMove(relPath, targetDir, container, skipConfirm = false) {
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
    if (targetDir) addExpanded(targetDir);
    showToast("success", t('file.moved', { name: fileName }));
    await refreshTree(container);
  } catch (err) {
    showToast("error", t('file.move_error', { error: err }));
    return;
  }

  await updateEditorReferences(buildPathMapping(relPath, newRelPath));
}

export async function handleRename(relPath, container) {
  const project = getCurrentProject();
  if (!project) return;

  if (isMainSourceFile(relPath)) {
    showToast("warning", t('file.rename_main_forbidden'));
    return;
  }

  const node = getFiles().find(f => f.relative_path === relPath);
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
  if (getFiles().some(f => f.relative_path === newRelPath)) {
    showToast("error", t('file.rename_exists', { name: newName }));
    return;
  }

  try {
    await invoke("rename_file", {
      oldPath: `${project.path}/${relPath}`,
      newPath: `${project.path}/${newRelPath}`,
    });
    await invoke("invalidate_file_cache");
    if (parentDir) addExpanded(parentDir);
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
  getFiles().forEach(f => {
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

export async function handleReplace(relPath, container) {
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

export async function handleImport(container, destRel = "") {
  const project = getCurrentProject();
  if (!project) return;

  const destDir = destRel ? `${project.path}/${destRel}` : project.path;

  try {
    const imported = await invoke("import_file_dialog", { destDir });
    if (imported && imported.length > 0) {
      await invoke("invalidate_file_cache");
      if (destRel) addExpanded(destRel);
      showToast("success", t('file.imported', { count: imported.length }));
      await refreshTree(container);
    }
  } catch (err) {
    if (!err.includes("Aucun fichier sélectionné")) {
      showToast("error", t('file.import_error', { error: err }));
    }
  }
}

export async function handleCreateFolder(container, parentRel = "") {
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
    if (parentRel) addExpanded(parentRel);
    showToast("success", t('file.folder_created', { name }));
    await refreshTree(container);
  } catch (err) {
    showToast("error", t('file.folder_error', { error: err }));
  }
}

export async function handleReveal(relPath) {
  const project = getCurrentProject();
  if (!project) return;

  try {
    await invoke("reveal_in_file_manager", { path: `${project.path}/${relPath}` });
  } catch (err) {
    showToast("error", t('file.reveal_error', { error: err }));
  }
}

export async function handleMoveTo(relPath, container) {
  const folders = getFiles().filter(f => f.is_dir && !isSelfOrDescendant(f.relative_path, relPath) && !isSelfOrDescendant(relPath, f.relative_path));

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

export async function handleDelete(relativePath, li, row, container) {
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
    filterFiles(f => f.relative_path !== relativePath && !f.relative_path.startsWith(relativePath + "/"));
    removeExpandedWithPrefix(relativePath);
    li.remove();
  } catch (err) {
    showToast("error", t('file.delete_error', { error: err }));
  }
}