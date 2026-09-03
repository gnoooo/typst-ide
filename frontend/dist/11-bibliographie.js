var e=`# Gérer les bibliographies

Le menu **Édition** > **Gérer les bibliographies** liste les fichiers \`.bib\` du projet.

- **Ajouter** : crée un nouveau fichier de source \`.bib\`.
- Cliquez sur une bibliographie pour gérer ses **références** : ajouter, modifier ou supprimer des entrées.
- Modifiez le **titre**, le **style** (IEEE, APA, etc.) ou le **chemin** de la bibliographie.
- L'éditeur de code (^code^) permet d'éditer le contenu brut du fichier \`.bib\`.

Insertion d'une bibliographie dans le projet :
\`\`\`typst
#bibliography("refs.bib", style: "ieee")
\`\`\`

Le fichier est synchronisé avec vos références : ajoutez une entrée dans la modale, elle apparaît dans \`refs.bib\` (et inversement).
`;export{e as default};