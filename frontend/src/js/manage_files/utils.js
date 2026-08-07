import { getCurrentProject } from "../project.js";

export function isMainSourceFile(relPath) {
  const proj = getCurrentProject();
  return !!proj && !!proj.typFile && relPath === proj.typFile && relPath.endsWith(".typ");
}

export function getParentDir(relPath) {
  const i = relPath.lastIndexOf("/");
  return i === -1 ? "" : relPath.slice(0, i);
}

export function isSelfOrDescendant(dragPath, folderPath) {
  return dragPath === folderPath || dragPath.startsWith(folderPath + "/");
}