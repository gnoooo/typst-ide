/**
 * Debounced wiring for the "search input -> list rebuild" pattern shared by
 * the history, notepad, bibliography, sources, templates, file-tree and
 * comment-book modals. Without a debounce each keystroke rebuilds the whole
 * list (and, for templates, pays an IPC round trip), so a 10-char search
 * means 10 full rebuilds; 500 entries then mean 500 buttons per character.
 */
const SEARCH_DEBOUNCE_MS = 150;

/**
 * Calls `onFilter(trimmedValue)` when the user stops typing.
 * Clearing the field fires immediately: instant empty-field feedback,
 * no visible delay on the common "delete the word" gesture.
 * @param {HTMLInputElement} input
 * @param {(value: string) => void} onFilter
 */
export function wireSearchInput(input, onFilter) {
    let timer;
    input.addEventListener('input', () => {
        clearTimeout(timer);
        const value = input.value.trim();
        if (value) {
            timer = setTimeout(() => onFilter(value), SEARCH_DEBOUNCE_MS);
        } else {
            onFilter('');
        }
    });
}
