const _table = new Map();

export function wireSet(key, fn) {
  _table.set(key, fn);
}

export function wireGet(key) {
  const fn = _table.get(key);
  if (typeof fn !== "function") {
    throw new Error(`[manage-files] callback "${key}" not wired`);
  }
  return fn;
}