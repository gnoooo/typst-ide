import { t } from '../../i18n/index.js';
import { openModal } from "../modal.js";
import { showToast } from "../toast.js";
import { getCurrentProject } from "../project.js";
import { wireSet } from "./wire.js";
import { refreshTree, rebuildTreeView } from "./tree.js";
import { setFilter } from "./state.js";
import { handleImport, handleCreateFolder } from "./operations.js";

export async function openFileManager() {
  if (!getCurrentProject()) {
    showToast("warning", t('file.no_project'));
    return;
  }

  wireSet("refresh", refreshTree);

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
    setFilter(input.value.trim().toLowerCase());
    const treeContainer = document.getElementById("file-tree-container");
    if (treeContainer) rebuildTreeView(treeContainer);
  });

  return container;
}