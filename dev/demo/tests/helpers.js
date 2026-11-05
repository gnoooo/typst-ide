/**
 * helpers.js
 *   shared utilities for demo recording tests.
 *
 * Provides screenshot capture and human-speed typing for Monaco
 * and regular form elements.
 */

const path = require("node:path");
const fs = require("node:fs");

// ## Screenshot capture #######################################################

/**
 * Creates a screenshot helper bound to a named output directory
 */
function createRecorder(name) {
  const dir = path.join(__dirname, "..", "output", name);
  fs.mkdirSync(dir, { recursive: true });
  let frame = 0;

  return async function shot(label = "frame") {
    const file = path.join(
      dir,
      `${String(frame++).padStart(4, "0")}_${label}.png`,
    );
    await browser.saveScreenshot(file);
  };
}

// ## Typing helpers ###########################################################

const ENTER = "\uE007"; // webdriver enter key

/**
 * Types into the Monaco editor character by character
 * Takes a screenshot every `freq` characters
 */
async function typeInEditor(shot, text, { freq = 2, delay = 60 } = {}) {
  const input = await $('[id="typst-editor"] .monaco-editor .inputarea');
  let count = 0;
  for (const ch of text) {
    await input.addValue(ch === "\n" ? ENTER : ch);
    count++;
    await browser.pause(delay);
    if (count % freq === 0) await shot(`typing_${count}`);
  }
  await browser.pause(500);
  await shot("typing-done");
}

/**
 * Types into a regular <input> or <textarea> character by character
 * Takes a screenshot every `freq` characters
 */
async function typeInField(shot, element, text, { freq = 3, delay = 60 } = {}) {
  let count = 0;
  for (const ch of text) {
    await element.addValue(ch);
    count++;
    await browser.pause(delay);
    if (count % freq === 0) await shot(`field_${count}`);
  }
}

/**
 * Waits for Monaco to be ready and returns a shot() after a brief settle
 */
async function waitForEditor() {
  await $('[id="typst-editor"] .monaco-editor').waitForExist({
    timeout: 15_000,
  });
  await browser.pause(500);
}

/**
 * Performs a raw pointer click at the center of the element matched by
 * `selector`. Element-level clicks are rejected by WebKitWebDriver when a
 * child element covers the click point (e.g. Monaco's `.view-lines` over
 * `#typst-editor`), while raw pointer actions are not checked.
 */
async function rawClickCenter(selector) {
  const el = await $(selector);
  await el.waitForExist({ timeout: 15_000 });
  const loc = await el.getLocation();
  const size = await el.getSize();
  const x = Math.round(loc.x + size.width / 2);
  const y = Math.round(loc.y + size.height / 2);
  await browser.performActions([
    {
      type: "pointer",
      id: "demo-mouse",
      parameters: { pointerType: "mouse" },
      actions: [
        { type: "pointerMove", duration: 0, origin: "viewport", x, y },
        { type: "pointerDown", button: 0 },
        { type: "pointerUp", button: 0 },
      ],
    },
  ]);
}

/**
 * Clicks the Monaco editor area to give it focus
 */
async function focusEditor() {
  await rawClickCenter('[id="typst-editor"]');
  await browser.pause(200);
}

/**
 * Clears the Monaco editor content (select-all + delete)
 */
async function clearEditor() {
  await rawClickCenter('[id="typst-editor"] .monaco-editor .inputarea');
  await browser.keys(["Control", "a"]);
  await browser.keys("Delete");
  await browser.pause(200);
}

module.exports = {
  createRecorder,
  typeInEditor,
  typeInField,
  waitForEditor,
  focusEditor,
  clearEditor,
  rawClickCenter,
};
