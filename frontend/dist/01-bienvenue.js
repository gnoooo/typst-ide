var e=`# Bienvenue dans Typst IDE

Typst IDE est un éditeur local pour [Typst](https://typst.app), un langage de mise en page moderne et puissant, un mélange entre LaTeX et Markdown.

L'interface se compose de deux zones :
- **L'éditeur** (à gauche) : C'est ici que vous écrirez le texte, les structures et autres éléments de votre document.
- **L'aperçu** (à droite) : L'aperçu de votre document compilé par Typst.

Dès lors que vous écrivez du texte dans le document, ce dernier sera automatiquement mis à jour dans la preview.

Exemple :
\`\`\`typst
#set text(size: 14pt)

= Introduction

Bonjour *le monde* ! Ce document est compilé en direct.
\`\`\`

Note :
- Les petits documents très peu complexes seront rendus presque instantanément.
- Les documents lourds (>18 pages avec beaucoup de structures complexes et d'images) seront rendus plus lentement.
`;export{e as default};