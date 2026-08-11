# The console and errors

If your document contains an error, it appears in the **console**, or if you have disabled the feature that automatically shows the console on error, a red dot appears in the **View** menu, shown when you have a pending error.

- `Ctrl + E`: Show or hide the console.
- Enable **View** > **Show console on error** to open it automatically.
- **View** > **Ignore errors**: Permanently hide the messages you already know (e.g. `file not found`).

```typst
#let width = "10"
#rect(width: width)
// Error: width expects a length with a unit (pt, mm, cm, etc.), not text
```