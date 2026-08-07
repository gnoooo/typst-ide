export function createButton(iconName, title, onClick) {
  const btn = document.createElement("button");
  btn.className = "file-tree-action-btn";
  btn.title = title;
  btn.innerHTML = `<span class="material-symbols-outlined" style="font-size:18px">${iconName}</span>`;
  btn.addEventListener("click", onClick);
  return btn;
}

export function getFileIcon(ext) {
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