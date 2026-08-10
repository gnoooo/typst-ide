# Inserting structures

The **#** toolbar button opens a menu of ready-made structures: ^grid_view^ table, grid, rectangle and figure.

A modal guides you: dimensions, alignments, borders, colors... The generated code is inserted at the cursor.

```typst
#table(
  columns: 2,
  rows: 2,
  [Name], [Age],
  [Alice], [34],
)
```

Figure example with image and caption:

```typst
#figure(
  image("images/photo.png"),
  caption: [A photo],
)
```