var e=`# Les marqueurs

Les **marqueurs** sont des commentaires Typst spécialement reconnus par Typst IDE. Écrivez un mot-clé en début de commentaire et l'éditeur s'en occupe :

\`\`\`typst
// TODO: corriger l'orthographe de ce titre
/* FIXME: ce bloc doit être divisé en deux */
\`\`\`

Cinq marqueurs sont disponibles par défaut : \`TODO\`, \`NOTE\`, \`COMMENT\`, \`FIXME\` et \`WARNING\`. Un marqueur est activé dès que son mot-clé (insensible à la casse) ouvre un commentaire \`//\` ou un commentaire bloc \`/* … */\` (même sur plusieurs lignes).

## Ce que Typst IDE en fait

- La ligne du marqueur est **surlignée** dans la couleur du marqueur, et la mention (\`// TODO:\`) est mise en **gras**.
- Une **pastille** colorée apparaît dans la marge de l'éditeur et une **marque** dans la barre de défilement : répérez tous vos marqueurs d'un coup d'oeil.
- Survoler la ligne affiche le mot-clé et le message du marqueur.

## Ajouter un marqueur

Placez le curseur où vous voulez et appuyez sur **\`Ctrl + Shift + M\`** (ou menu **Édition** > **Ajouter un marqueur**, ou clic droit dans l'éditeur). Un marqueur \`// KEYTAG: \` est inséré ; s'il y a plusieurs marqueurs activés, un petit choix s'affiche.

## Le carnet de marqueurs

Le bouton ^chat_bubble^ de la barre d'outils, ou **\`Ctrl + Alt + M\`**, ouvre le **carnet de marqueurs** qui liste tous les marqueurs du document courant.

- **Recherchez** avec la barre de texte et **filtrez** par marqueur avec les pastilles colorées.
- **Cliquez** sur une entrée : le curseur saute à la ligne correspondante dans l'éditeur.
- Le bouton **Ajouter un marqueur** insère un marqueur au curseur, et le carnet se met à jour.

## Gérer les marqueurs

Le menu **Édition** > **Gérer les marqueurs** permet de personnaliser la liste : ajouter un marqueur (\`KEYTAG:\` comme mot-clé), changer son libellé, sa **couleur**, l'activer ou le désactiver, ou le supprimer. Le bouton **Réinitialiser aux défauts** restaure la liste d'origine à tout moment.
`;export{e as default};