# The console and errors

If your document contains an error, it appears in the **console**, or the ^report^ badge blinks in the **View** menu until it is read.

- ^terminal^ `Ctrl + E`: show or hide the console;
- click a message: the editor jumps to the offending line (the faulty code is underlined);
- enable **View** > **Show console on error** to open it automatically;
- **View** > **Ignore errors**: permanently hide messages you already know.

```typst
#let largeur = "10"

// "10" is a string, not a length: error!
#rect(width: largeur)
```