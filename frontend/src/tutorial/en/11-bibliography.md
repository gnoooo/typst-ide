# Managing bibliographies

The **Edit** > **Manage bibliographies** menu lists the project's `.bib` files.

- **Add**: creates a new `.bib` source file.
- Click a bibliography to manage its **references**: add, edit or delete entries.
- Change the **title**, **style** (IEEE, APA, etc.) or **path** of the bibliography.
- The code editor (^code^) allows editing the raw contents of the `.bib` file.

Inserting a bibliography in the project:
```typst
#bibliography("refs.bib", style: "ieee")
```

The file is synchronized with your references: add an entry in the modal, it appears in `refs.bib` (and vice versa).