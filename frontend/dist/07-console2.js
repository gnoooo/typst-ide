var e=`# La console et les erreurs

Si votre document contient une erreur, elle apparaît dans la **console**, ou bien si vous avez désactivé la fonctionnalité permettant à la console d'automatiquement se montrer lors d'une erreur, le point rouge dans le menu **Vue**, affiché si vous avez une erreur en attente.

- \`Ctrl + E\` : Afficher ou masquer la console.
- Activez **Vue** > **Afficher la console en cas d'erreur** pour l'ouvrir automatiquement.
- **Vue** > **Ignorer des erreurs** : Masquez durablement les messages que vous connaissez déjà (ex : \`file not found\`).

\`\`\`typst
#let largeur = "10"
#rect(width: largeur)
// Erreur : width attend une longueur avec unité (pt, mm, cm, etc.), pas du texte 
\`\`\`
`;export{e as default};