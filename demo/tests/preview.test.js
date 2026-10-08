/**
 * Preview screenshot: the "hero" image of the app.
 * Shows the editor with a polished demo document and the live preview.
 * The last frame of this scenario is exported to images/preview.png.
 */
const {
  createRecorder,
  waitForEditor,
  focusEditor,
  clearEditor,
  typeInEditor,
} = require("./helpers");

const shot = createRecorder("preview");

const DEMO_DOCUMENT = `= Typst IDE, the local editor

A modern, *local-first* editor for Typst, rebuilt
with Tauri and Rust. Documents stay on your own
machine: no account, no cloud, no browser.

== Features

- Live preview rendered by the same compiler
  as Typst.app
- Click in the preview to jump to the matching
  source position
- Project file manager with drag & drop
- Markers (TODO, FIXME, …) with a marker book
- Global and per-project notes
- PDF export

== Example

#let greet(name) = [Hello, *#name*!]
#greet("world")

#figure(
  rect(width: 60%, height: 3cm, fill: blue.lighten(80%)),
  caption: [A simple rectangle],
)
`;

describe("Preview screenshot", () => {
  it("shows the editor and the live preview with a demo document", async () => {
    await waitForEditor();

    await focusEditor();
    await clearEditor();
    await typeInEditor(shot, DEMO_DOCUMENT, { freq: 999999, delay: 15 });

    await browser.pause(1500);
    await shot("final");
  });
});
