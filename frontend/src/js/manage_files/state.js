let _projectFiles = [];
let _filterText = "";
const _expandedFolders = new Set();

export function getFiles() {
  return _projectFiles;
}

export function setFiles(files) {
  _projectFiles = files;
}

export function filterFiles(fn) {
  _projectFiles = _projectFiles.filter(fn);
}

export function getFilter() {
  return _filterText;
}

export function setFilter(v) {
  _filterText = v;
}

export function isExpanded(relPath) {
  return _expandedFolders.has(relPath);
}

export function addExpanded(relPath) {
  if (relPath) _expandedFolders.add(relPath);
}

export function removeExpanded(relPath) {
  _expandedFolders.delete(relPath);
}

export function toggleExpanded(relPath) {
  const open = !_expandedFolders.has(relPath);
  if (open) _expandedFolders.add(relPath);
  else _expandedFolders.delete(relPath);
  return open;
}

export function removeExpandedWithPrefix(relPath) {
  [..._expandedFolders].forEach(p => {
    if (p === relPath || p.startsWith(relPath + "/")) _expandedFolders.delete(p);
  });
}

export function expandAllFolders() {
  _projectFiles.forEach(f => { if (f.is_dir) _expandedFolders.add(f.relative_path); });
}