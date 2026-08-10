# Insérer des images

Collez simplement une image (`Ctrl + V`) alors que l'éditeur a le focus : elle est enregistrée dans le dossier `images/` du projet et le code `#image(...)` est inséré à l'endroit du curseur.

```typst
#image("images/photo.png", width: 60%)
```

Note : 
- On peut changer la taille avec les paramètres `width` ou `height`.
- Pour plus d'informations : https://typst.app/docs/reference/visualize/image/

Autres façons d'insérer une image :
- Bouton **Gérer les fichiers** (^folder_managed^) : Survolez une image puis choisissez **Insérer**.
- Modale **figure** du bouton `#` : Recherchez une image dans votre ordinateur puis insérez la figure.
