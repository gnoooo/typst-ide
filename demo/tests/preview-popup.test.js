/**
 * Preview popup screenshot.
 * Shows a document full of markers with the marker book open.
 * The last frame of this scenario is exported to images/preview-popup.png.
 */
const {
  createRecorder,
  waitForEditor,
  focusEditor,
  clearEditor,
  typeInEditor,
} = require("./helpers");

const shot = createRecorder("preview-popup");

const MARKER_DOCUMENT = `= Project report

// TODO: review the introduction once more
// NOTE: remember to export the PDF before sharing
// FIXME: add the missing figure caption

== Draft

The marker book collects every TODO, NOTE and
FIXME found in the document. Clicking an entry
jumps the editor to the matching line.

// WARNING: check the bibliography entry format
`;

describe("Popup screenshot", () => {
  it("shows the marker book over the editor", async () => {
    await waitForEditor();

    await focusEditor();
    await clearEditor();
    await typeInEditor(shot, MARKER_DOCUMENT, { freq: 999999, delay: 15 });

    await browser.pause(800);

    // The toolbar button lives in a dropdown menu; use the Ctrl+Alt+M
    // shortcut instead (handled globally in shortcuts.js).
    await browser.keys(["Alt", "m"]);

    await $("#comments-book-list").waitForExist({ timeout: 10_000 });
    await browser.pause(800);
    await shot("popup");
  });
});
