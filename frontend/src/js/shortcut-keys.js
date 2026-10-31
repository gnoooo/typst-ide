/**
 * Pure keyboard shortcut predicates.
 *
 * Kept separate from shortcuts.js so they can be unit-tested without pulling in Monaco, the Tauri API or the DOM modules.
 */

/** True for Ctrl+E (Linux/Windows) or Cmd+E (macOS), without modifiers. */
export function isToggleConsoleShortcut(event) {
    if (!event || (!event.ctrlKey && !event.metaKey)) return false;
    if (event.shiftKey || event.altKey) return false;
    // `code` is layout-independent, `key` is a fallback for engines that do not expose KeyboardEvent.code (older WebKitGTK builds).
    return event.code === 'KeyE' || String(event.key ?? '').toLowerCase() === 'e';
}
