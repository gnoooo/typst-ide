var e=`# Inserting structures

The **#** toolbar button opens a menu of ready-made structures:
  - **Table**: To present information, results, etc.
  - **Grid**: Borderless table to arrange the document elements (e.g. image on the left, text on the right).
  - **Rectangle**: Rectangle, with the possibility of inserting text into it.
  - **Figure**: Image with a caption.

A modal guides you: dimensions, alignments, borders, colors, etc. The generated code is inserted at the cursor position.

\`\`\`typst
#table(
  columns: 2,
  
  [Name], [Age],
  [Alice], [34],
)
\`\`\`

Figure example with image and caption:

\`\`\`typst
#figure(
  image("images/photo.png"),
  caption: [A photo],
)
\`\`\``;export{e as default};