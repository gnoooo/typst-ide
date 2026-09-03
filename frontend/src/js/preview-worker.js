/**
 * Preview Worker
 *  runs Blob creation off the main thread
 *
 * For large documents, the compiled HTML can be tens of megabytes of inline SVGs.
 * Creating a Blob and Object URL from that data on the main thread adds to main-thread pressure and can cause input jank in Monaco.
 *
 * This Worker receives the raw HTML string, creates the Blob + Object URL in a separate thread, and posts back the ready-to-use URL.
 */

/** @type {string|null} */
let _currentBlobUrl = null;

self.onmessage = function (e) {
    const { type, html, id } = e.data;

    if (type === 'createBlob') {
        try {
            if (_currentBlobUrl) {
                URL.revokeObjectURL(_currentBlobUrl);
                _currentBlobUrl = null;
            }

            const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
            _currentBlobUrl = URL.createObjectURL(blob);

            self.postMessage({ type: 'blobReady', url: _currentBlobUrl, id });
        } catch (err) {
            // Surface the error to the main thread rather than dying
            // silently — the previous behaviour left `loadHtml` pending
            // forever (it had no reject path on `createBlobUrlAsync`).
            self.postMessage({
                type: 'blobError',
                id,
                error: (err && err.message) || String(err) || 'unknown error',
            });
        }
    }

    if (type === 'revoke') {
        if (_currentBlobUrl) {
            URL.revokeObjectURL(_currentBlobUrl);
            _currentBlobUrl = null;
        }
    }
};
