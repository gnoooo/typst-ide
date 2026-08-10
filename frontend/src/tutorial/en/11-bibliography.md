# Managing bibliographies

The **Edit** > **Manage bibliographies** menu lists the project's `.bib` files.

- ^add^ **Add**: creates a new `.bib` file and declares it in the project;
- click a bibliography to manage its **references**: add, edit or delete entries;
- change the bibliography's **title**, **style** (IEEE, APA...) or **path**;
- the code editor (`{ }`) edits the raw contents of the `.bib` file.

```typst
#bibliography("refs.bib", style: "ieee")
```

The file is synchronized with your references: add an entry in the modal, it appears in `refs.bib` (and vice versa).