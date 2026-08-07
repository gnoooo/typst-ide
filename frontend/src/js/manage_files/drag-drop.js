import { getParentDir, isSelfOrDescendant } from "./utils.js";
import { handleMove } from "./operations.js";

const EDGE_SCROLL = 90;

let _dragRelativePath = "";
let _autoScroll = null;

export function getDragPath() {
  return _dragRelativePath;
}

export function setupDragSource(row, relPath) {
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

export function setupFolderDrop(row, folderRelPath, container) {
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

export function setupFileDrop(row, fileRelPath, container) {
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

export function readDropData(e) {
  try {
    return e.dataTransfer.getData("text/plain") || "";
  } catch (_) {
    return "";
  }
}

export function clearDropHighlights() {
  document.querySelectorAll(".is-drop-target").forEach(el => el.classList.remove("is-drop-target"));
}

export function updateAutoScroll(container, clientY) {
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