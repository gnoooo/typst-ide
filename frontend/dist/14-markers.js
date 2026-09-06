var e=`# Markers

**Markers** are Typst comments specially recognized by Typst IDE. Start a comment with a keyword and the editor takes care of the rest:

\`\`\`typst
// TODO: fix the spelling of this heading
/* FIXME: this block should be split in two */
\`\`\`

Five markers ship by default: \`TODO\`, \`NOTE\`, \`COMMENT\`, \`FIXME\` and \`WARNING\`. A marker is active as soon as its keyword (case-insensitive) opens a \`//\` comment or a \`/* … */\` block comment (multi-line blocks count too).

## What Typst IDE does with them

- The marker line is **highlighted** in the marker's color, with the tag (\`// TODO:\`) displayed in **bold**.
- A colored **dot** shows up in the editor gutter and a **stripe** in the scrollbar: spot all your markers at a glance.
- Hovering the line shows the keyword and the marker message.

## Adding a marker

Put the cursor where you want and press **\`Ctrl + Shift + M\`** (or **Edit** > **Add a marker**, or right-click inside the editor). A \`// KEYTAG: \` marker is inserted; if several markers are enabled, a small picker appears first.

## The marker book

The ^chat_bubble^ toolbar button, or **\`Ctrl + Alt + M\`**, opens the **marker book** and lists every marker in the current document.

- **Search** with the text bar and **filter** by marker using the colored chips.
- **Click** an entry: the cursor jumps to the matching line in the editor.
- The **Add a marker** button inserts a marker at the cursor, and the book refreshes.

## Managing markers

**Edit** > **Manage markers** lets you customize the list: add a marker (\`KEYTAG:\` as the keyword), change its label, its **color**, enable or disable it, or delete it. **Reset to defaults** restores the original list at any time.
`;export{e as default};