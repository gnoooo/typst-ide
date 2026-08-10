# Insérer des structures

Le bouton **#** de la barre d'outils ouvre un menu de structures prêtes à l'emploi : 
  - **Tableau** : Pour présenter des informations, résultats, etc. 
  - **Grille** : Tableau sans bordures pour agencer les éléments du document (ex : image à gauche, texte à droite).
  - **Rectangle** :  Rectangle, avec la possibilité d'y insérer du texte.
  - **Figure** : Image avec une légende.

Une modale vous guide : dimensions, alignements, bordures, couleurs, etc. Le code généré est inséré à l'endroit du curseur.

```typst
#table(
  columns: 2,
  
  [Nom], [Âge],
  [Alice], [34],
)
```

Exemple de figure avec image et légende :

```typst
#figure(
  image("images/photo.png"),
  caption: [Une photo],
)
```
